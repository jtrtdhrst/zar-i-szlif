import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4097";
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = Object.fromEntries(fs.readFileSync(path.join(here, ".runtime", "credentials.txt"), "utf8").trim().split(/\r?\n/).map((line) => line.split(/=(.*)/, 2)));

async function rpc(token, sessionId, id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  assert.equal(response.status, 200);
  return { sessionId: response.headers.get("mcp-session-id") || sessionId, body: await response.json() };
}

const redirectUri = "http://127.0.0.1/callback";
const registration = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "fallback probe", redirect_uris: [redirectUri] }) });
const client = await registration.json();
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(`${base}/oauth/authorize`);
authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: "offline_access mcp:read mcp:write", code_challenge: challenge, code_challenge_method: "S256", state: "fb" }).toString();
const authResponse = await fetch(authorize, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: credentials.username, password: credentials.password }), redirect: "manual" });
const code = new URL(authResponse.headers.get("location")).searchParams.get("code");
const tokenResponse = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }) });
const token = (await tokenResponse.json()).access_token;
const init = await rpc(token, null, 1, "initialize", { protocolVersion: "2025-03-26" });
const sid = init.sessionId;

// Surface check after slim-down.
let r = await rpc(token, sid, 2, "tools/list");
const names = r.body.result.tools.map((tool) => tool.name);
assert.ok(!names.includes("paperclipGetRunMetrics"), "consolidated getter still eager");
assert.ok(names.includes("opencode_run_inspect"), "run inspector missing");
console.log(`PROBE public surface size=${names.length}: PASS`);

// Fallback probe: primary model intentionally invalid -> explicit retry on Hy3 Free.
r = await rpc(token, sid, 3, "tools/call", {
  name: "opencode_ask",
  arguments: {
    prompt: "Zwróć dokładnie: CTB_FALLBACK_HY3_PASS",
    providerID: "opencode",
    modelID: "definitely-not-a-real-model",
    directory: "C:\\Kompas Zbiórek",
    ctb: { mode: "DIAGNOSE", changeClass: "ctb" },
  },
});
const text = JSON.stringify(r.body.result);
if (r.body.result.isError) throw new Error(`fallback did not rescue invocation: ${text.slice(0, 400)}`);
assert.match(text, /CTB_FALLBACK_HY3_PASS/, `expected successful fallback answer: ${text.slice(0, 400)}`);
const fbSession = /ses_[A-Za-z0-9_-]+/.exec(text)?.[0];
r = await rpc(token, sid, 4, "tools/call", { name: "opencode_message_model_info", arguments: { sessionId: fbSession } });
const info = r.body.result.structuredContent;
const assistant = info.messages.filter((message) => message.role === "assistant").pop();
assert.equal(assistant.modelActual, "hy3-free", `actual model should be hy3-free: ${JSON.stringify(assistant)}`);
assert.equal(assistant.fallbackUsed, true, "fallbackUsed must be deterministic true");
assert.ok(assistant.fallbackReason, "fallbackReason required");
assert.deepEqual(assistant.attempts?.map((attempt) => attempt.role), ["primary", "fallback"]);
assert.equal(info.gatewayInvocationRecord.requestedModel.modelRequested, "definitely-not-a-real-model");
console.log(`PROBE Ox->Hy3 fallback E2E: PASS (${assistant.providerActual}/${assistant.modelActual}, reason="${String(assistant.fallbackReason).slice(0, 80)}")`);

// Negative control: default DIAGNOSE must NOT use fallback.
r = await rpc(token, sid, 5, "tools/call", { name: "opencode_ask", arguments: { prompt: "Zwróć dokładnie: CTB_NO_FALLBACK_PASS", directory: "C:\\Kompas Zbiórek", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } } });
const nfText = JSON.stringify(r.body.result);
assert.match(nfText, /CTB_NO_FALLBACK_PASS/, nfText.slice(0, 300));
const nfSession = /ses_[A-Za-z0-9_-]+/.exec(nfText)?.[0];
r = await rpc(token, sid, 6, "tools/call", { name: "opencode_message_model_info", arguments: { sessionId: nfSession } });
const nfAssistant = r.body.result.structuredContent.messages.filter((message) => message.role === "assistant").pop();
assert.equal(nfAssistant.modelActual, "x-preview-f-free");
assert.equal(nfAssistant.fallbackUsed, false, "default invocation must report deterministic fallbackUsed=false");
console.log(`PROBE no-fallback default run reports fallbackUsed=false via ${nfAssistant.providerActual}/${nfAssistant.modelActual}: PASS`);

// Agent governance: DIAGNOSE must execute on a read-only plan agent (native ctb-plan once
// OPENCODE_MCP_NATIVE_AGENTS=on after a backend restart; built-in "plan" until then).
assert.ok(["plan", "ctb-plan"].includes(nfAssistant.agent), `DIAGNOSE agent should be read-only plan, got ${nfAssistant.agent}`);
console.log(`PROBE server-side agent enforcement (read-only plan agent="${nfAssistant.agent}"): PASS`);

// MCP status enrichment
r = await rpc(token, sid, 7, "tools/call", { name: "opencode_mcp_status", arguments: {} });
const statusPayload = JSON.stringify(r.body.result);
assert.match(statusPayload, /effectiveForCurrentProfile/, "profile-aware MCP status annotation missing");
console.log("PROBE opencode_mcp_status profile annotation: PASS");

console.log("LIVE FALLBACK PROBE COMPLETE");
