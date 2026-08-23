import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4098";
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = Object.fromEntries(
  fs.readFileSync(path.join(here, ".runtime", "credentials.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/=(.*)/, 2)),
);

async function rpc(token, sessionId, id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return { sessionId: response.headers.get("mcp-session-id") || sessionId, body: await response.json() };
}

const health = await fetch(`${base}/health`);
assert.equal(health.status, 200);
const healthBody = await health.json();
assert.equal(healthBody.engine, "AlaeddineMessadi/opencode-mcp@1.11.0");

const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
assert.equal(metadata.status, 200);
const protectedResource = await metadata.json();
assert.deepEqual(protectedResource.scopes_supported, ["opencode:read", "opencode:session", "opencode:ctb:execute", "opencode:admin", "opencode:write", "mcp:read", "mcp:write", "offline_access"]);

const redirectUri = "http://127.0.0.1/callback";
const registration = await fetch(`${base}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "OpenCode CTB smoke test", redirect_uris: [redirectUri] }),
});
assert.equal(registration.status, 201);
const client = await registration.json();
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(`${base}/oauth/authorize`);
authorize.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  resource: protectedResource.resource,
  scope: "offline_access mcp:read mcp:write",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "ctb-smoke-test",
}).toString();
const authResponse = await fetch(authorize, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: credentials.username, password: credentials.password }),
  redirect: "manual",
});
assert.equal(authResponse.status, 302);
const code = new URL(authResponse.headers.get("location")).searchParams.get("code");
assert.ok(code);
const tokenResponse = await fetch(`${base}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }),
});
assert.equal(tokenResponse.status, 200);
const token = await tokenResponse.json();

let response = await rpc(token.access_token, null, 1, "initialize", { protocolVersion: "2025-03-26" });
assert.equal(response.body.result.serverInfo.name, "kompas-opencode-ctb");
assert.ok(response.sessionId);
const sessionId = response.sessionId;
response = await rpc(token.access_token, sessionId, 2, "tools/list");
const names = response.body.result.tools.map((tool) => tool.name);
assert.ok(names.length >= 85, `expected upstream plus CTB tools, received ${names.length}`);
assert.ok(names.includes("opencode_ask"));
assert.ok(names.includes("opencode_list_skills"));
assert.ok(names.includes("opencode_ctb_get_metrics"));
const ask = response.body.result.tools.find((tool) => tool.name === "opencode_ask");
assert.equal(ask._meta.kompas.toolClass, "WRITE");
assert.ok(ask.inputSchema.properties.ctb);
response = await rpc(token.access_token, sessionId, 3, "resources/list");
assert.ok(response.body.result.resources.length >= 10);
response = await rpc(token.access_token, sessionId, 4, "prompts/list");
assert.ok(response.body.result.prompts.length >= 6);
response = await rpc(token.access_token, sessionId, 5, "tools/call", { name: "opencode_list_skills", arguments: {} });
assert.ok(response.body.result.structuredContent.skills.length >= 6);
response = await rpc(token.access_token, sessionId, 6, "tools/call", { name: "opencode_ask", arguments: { prompt: "This must not execute." } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_CONTEXT_REQUIRED");
response = await rpc(token.access_token, sessionId, 7, "tools/call", { name: "opencode_config_update", arguments: { config: {}, ctb: { mode: "EXECUTE", changeClass: "ctb", paperclipIssueId: "missing", changeIntent: "test", scope: "test", acceptanceCriteria: "test", idempotencyKey: "test" } } });
assert.equal(response.body.result.structuredContent.errorCode, "INSUFFICIENT_SCOPE");
response = await rpc(token.access_token, sessionId, 8, "tools/call", { name: "opencode_context", arguments: { directory: "C:\\Windows" } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_PROJECT_DENIED");

if (process.env.PAPERCLIP_ITB_ISSUE_ID) {
  response = await rpc(token.access_token, sessionId, 9, "tools/call", {
    name: "opencode_run",
    arguments: {
      directory: "C:\\paperclip",
      prompt: "Run a narrow CTB ITB check. In this exact order: search and read package.json, write C:\\paperclip\\ctb-itb-proof.txt containing PASS, run node --check C:\\paperclip\\mcp-public-gateway.mjs, then delete only C:\\paperclip\\ctb-itb-proof.txt. Do not modify any other file. Report the completed steps.",
      ctb: {
        mode: "EXECUTE",
        changeClass: "ctb",
        paperclipIssueId: process.env.PAPERCLIP_ITB_ISSUE_ID,
        changeIntent: "Validate CTB OpenCode tool telemetry end-to-end.",
        scope: "C:\\paperclip only",
        acceptanceCriteria: "search/read, write and test are recorded in normalized run events.",
        idempotencyKey: `ctb-itb-${process.env.PAPERCLIP_ITB_ISSUE_ID}`,
      },
    },
  });
  assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body.result.structuredContent));
  const runId = /(?:ses|session)_[A-Za-z0-9_-]+/.exec(JSON.stringify(response.body.result))?.[0];
  assert.ok(runId, "CTB ITB execute must return an OpenCode run id");
  console.log(`OpenCode CTB real EXECUTE: PASS (${runId})`);
}

console.log("OpenCode CTB upstream surface, OAuth, resources/prompts, skills, policy scopes and path isolation: PASS");
