import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4098";
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = Object.fromEntries(
  fs.readFileSync(path.join(here, "credentials.txt"), "utf8").trim().split(/\r?\n/).map((line) => line.split(/=(.*)/, 2)),
);

async function rpc(token, sessionId, id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(90000),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return { sessionId: response.headers.get("mcp-session-id") || sessionId, body: await response.json() };
}

const reg = await (await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "komaa-matrix", redirect_uris: ["http://127.0.0.1/callback"] }) })).json();
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(`${base}/oauth/authorize`);
authorize.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: "http://127.0.0.1/callback", response_type: "code", scope: "offline_access mcp:read mcp:write", code_challenge: challenge, code_challenge_method: "S256", state: "m" }).toString();
const authResponse = await fetch(authorize, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: credentials.username, password: credentials.password }), redirect: "manual" });
const code = new URL(authResponse.headers.get("location")).searchParams.get("code");
const tokenResponse = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: reg.client_id, redirect_uri: "http://127.0.0.1/callback", code, code_verifier: verifier }) });
const token = (await tokenResponse.json()).access_token;
console.log("KOMAA-MATRIX OAuth: PASS");

let r = await rpc(token, null, 1, "initialize", { protocolVersion: "2025-03-26" });
const sid = r.sessionId;

const WORKSPACE_DIR = "C:\\Kompas Zbírek".replace("Zbírek", "Zbiórek");
const komaaChecks = [];
async function komaaCheck(name, fn) {
  try {
    const detail = (await fn()) || "";
    komaaChecks.push({ name, ok: true, detail });
    console.log(`KOMAA-168 ${name}: PASS${detail ? " (" + detail + ")" : ""}`);
  } catch (err) {
    komaaChecks.push({ name, ok: false, detail: err.message });
    console.log(`KOMAA-168 ${name}: FAIL (${err.message})`);
  }
}
const scOf = (res) => (res?.body?.result?.structuredContent || {});
const failedOf = (res) => res?.body?.result?.isError === true;

// --- Pre-flight: surface sync (root cause A). tools/list must expose the CURRENT upstream
// contract and must NOT contain phantom legacy tools the fresh engine no longer ships. ---
const toolsList = await rpc(token, sid, 2, "tools/list", {});
const exposed = new Set((toolsList.body?.result?.tools || []).map((t) => t.name));
const requiredSurface = ["opencode_run", "opencode_session_prompt", "opencode_session_create", "opencode_provider_list", "opencode_model_info", "opencode_message_model_info"];
const missingSurface = requiredSurface.filter((name) => !exposed.has(name));
assert.equal(missingSurface.length, 0, `surface drift: missing current tools ${missingSurface.join(", ")} (tools/list threw CTB_TOOL_CLASSIFICATION_MISSING previously)`);
console.log(`KOMAA-168 surface-sync: PASS (exposed ${exposed.size} tools; session_prompt=${exposed.has("opencode_session_prompt")})`);

await komaaCheck("healthy-free-model-completed", async () => {
  const res = await rpc(token, sid, 21, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_HEALTHY_PASS", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const sc = scOf(res);
  assert.equal(sc.status, "completed", `healthy run status=${sc.status}`);
  assert.equal(failedOf(res), false, "healthy run reported isError=true");
  return `state=${sc.state} model=${sc.model?.modelActual ?? sc.modelActual ?? "?"}`;
});

let badRunRes = null;
await komaaCheck("known-bad-free-model-failed", async () => {
  const res = await rpc(token, sid, 22, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_SHOULD_NOT_PASS", directory: WORKSPACE_DIR, modelID: "nemotron-3.5-lightning-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  badRunRes = res;
  const sc = scOf(res);
  assert.equal(failedOf(res), true, "known-bad run did NOT surface isError=true (masked as success)");
  assert.ok(sc.errorCode, `known-bad run missing errorCode: ${JSON.stringify(sc).slice(0, 200)}`);
  assert.notEqual(sc.status, "completed", `known-bad run status=${sc.status} (must not be completed)`);
  assert.equal(sc.state, "failed", `known-bad run state=${sc.state} (must be failed)`);
  return `errorCode=${sc.errorCode} status=${sc.status}`;
});

await komaaCheck("same-session-reply-affinity", async () => {
  const created = await rpc(token, sid, 23, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_REPLY_SEED", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const seedSession = scOf(created).sessionId;
  assert.ok(seedSession, `seed session missing: ${JSON.stringify(scOf(created)).slice(0, 200)}`);
  // Continue via the CURRENT continuation primitive (opencode_session_prompt), not the legacy
  // opencode_reply which the fresh upstream no longer ships.
  const replied = await rpc(token, sid, 24, "tools/call", {
    name: "opencode_session_prompt",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_REPLY_TURN", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb", executionContext: { sessionId: seedSession } } },
  });
  const repliedSession = scOf(replied).sessionId;
  assert.equal(repliedSession, seedSession, `reply created a NEW session ${repliedSession} instead of continuing ${seedSession}`);
  assert.equal(failedOf(replied), false, "reply into existing session reported isError");
  const badReply = await rpc(token, sid, 25, "tools/call", {
    name: "opencode_session_prompt",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_REPLY_GHOST", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb", executionContext: { sessionId: "ses_does_not_exist_KOMAA168" } } },
  });
  assert.equal(failedOf(badReply), true, "reply into non-existent session did NOT fail closed");
  assert.ok(scOf(badReply).errorCode, "reply into non-existent session missing errorCode");
  return `seed=${seedSession} repliedInto=${repliedSession}`;
});

await komaaCheck("consistent-execution-projections", async () => {
  const good = await rpc(token, sid, 26, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_PROJECTION_PASS", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const gs = scOf(good);
  assert.equal(gs.state, gs.status, `completed run state=${gs.state} != status=${gs.status}`);
  assert.equal(gs.status, "completed", `projection status=${gs.status}`);
  assert.notEqual(gs.state, "running", "completed run nested state still running");
  const bs = scOf(badRunRes);
  assert.equal(bs.state, bs.status, `failed run state=${bs.state} != status=${bs.status}`);
  assert.equal(bs.state, "failed", `failed run nested state=${bs.state} (contradiction)`);
  return `completed(${gs.state}) failed(${bs.state})`;
});

await komaaCheck("diagnose-no-write-and-ctb-invalid-issue", async () => {
  const before = new Set(fs.readdirSync(WORKSPACE_DIR));
  const diag = await rpc(token, sid, 27, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_DIAGNOSE_NOWRITE", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const after = new Set(fs.readdirSync(WORKSPACE_DIR));
  const created = [...after].filter((f) => !before.has(f));
  assert.equal(created.length, 0, `DIAGNOSE wrote files to workspace: ${created.join(", ")}`);
  assert.equal(failedOf(diag), false, "DIAGNOSE run reported isError");
  assert.ok(JSON.stringify(scOf(diag)).includes("KOMAA168_DIAGNOSE_NOWRITE"), "DIAGNOSE echo missing");
  const badIssue = await rpc(token, sid, 28, "tools/call", {
    name: "opencode_run",
    arguments: {
      prompt: "Zwróć dokładnie: KOMAA168_SHOULD_NOT_EXECUTE",
      directory: WORKSPACE_DIR,
      modelID: "hy3-free",
      ctb: {
        mode: "EXECUTE",
        changeClass: "ctb",
        paperclipIssueId: "KOMAA168-DOES-NOT-EXIST-0000",
        changeIntent: "KOMAA-168 invalid-issue negative path (must be rejected, not executed).",
        scope: `${WORKSPACE_DIR} (none)`,
        acceptanceCriteria: "Issue rejected before any model invocation.",
        idempotencyKey: `komaa168-invalid-issue-${Date.now()}`,
      },
    },
  });
  const bi = scOf(badIssue);
  assert.equal(failedOf(badIssue), true, "invalid issue did NOT fail closed");
  assert.ok(/^(PAPERCLIP_|CTB_)/.test(bi.errorCode || ""), `invalid issue errorCode not CTB/PAPERCLIP family: ${bi.errorCode}`);
  assert.notEqual(bi.status, "completed", `invalid issue status=${bi.status} (must not complete)`);
  return `diagnoseFilesCreated=${created.length} invalidIssueCode=${bi.errorCode}`;
});

const komaaFailed = komaaChecks.filter((c) => !c.ok);
console.log(`KOMAA-168 MATRIX: ${komaaChecks.length - komaaFailed.length}/${komaaChecks.length} PASS`);
if (komaaFailed.length) console.log("KOMAA-168 FAILURES: " + komaaFailed.map((c) => `${c.name}=${c.detail}`).join(" | "));
process.exit(komaaFailed.length ? 1 : 0);
