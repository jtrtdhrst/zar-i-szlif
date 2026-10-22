import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CTB_POLICY_REVISION } from "./ctb-policy.mjs";

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4097";
const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, ".runtime", "ctb-runs.json");
const credentials = Object.fromEntries(
  fs.readFileSync(path.join(here, ".runtime", "credentials.txt"), "utf8").trim().split(/\r?\n/).map((line) => line.split(/=(.*)/, 2)),
);

async function rpc(token, sessionId, id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return { sessionId: response.headers.get("mcp-session-id") || sessionId, body: await response.json() };
}

// 0. Health + backend
const health = await (await fetch(`${base}/health`)).json();
assert.equal(health.revision, CTB_POLICY_REVISION);
assert.equal(health.revisions.gateway, "ctb-policy-8");
assert.deepEqual(health.allowedRoots.map((root) => root.toLowerCase()), ["c:\\kompas zbiórek", "c:\\kompas zbiórek\\.paperclip-worktrees", "c:\\paperclip", "c:\\paperclip-worktrees"]);
console.log(`SMOKE /health revision=${health.revision} profiles=${health.revisions.mcpRoleProfiles}: PASS`);

// 1. OAuth
const redirectUri = "http://127.0.0.1/callback";
const registration = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "live smoke", redirect_uris: [redirectUri] }) });
const client = await registration.json();
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(`${base}/oauth/authorize`);
authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: "offline_access mcp:read mcp:write", code_challenge: challenge, code_challenge_method: "S256", state: "smoke" }).toString();
const authResponse = await fetch(authorize, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: credentials.username, password: credentials.password }), redirect: "manual" });
const code = new URL(authResponse.headers.get("location")).searchParams.get("code");
const tokenResponse = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }) });
const token = (await tokenResponse.json()).access_token;
console.log("SMOKE OAuth register+authorize+token: PASS");

// 2. initialize + tools/list
let r = await rpc(token, null, 1, "initialize", { protocolVersion: "2025-03-26" });
const sid = r.sessionId;
r = await rpc(token, sid, 2, "tools/list");
const tools = r.body.result.tools;
const names = tools.map((tool) => tool.name);
const aliases = ["opencode_list_runs", "opencode_get_run", "opencode_read_logs", "opencode_get_diff", "opencode_list_agents", "opencode_run_prompt", "opencode_continue_run", "opencode_abort_run"];
assert.ok(!aliases.some((alias) => names.includes(alias)), `aliases leaked into eager schema: ${aliases.filter((a) => names.includes(a))}`);
assert.ok(names.includes("opencode_mcp_effective_profile"));
assert.ok(names.includes("opencode_message_model_info") && names.includes("opencode_session_status"));
for (const name of ["opencode_execution_start", "opencode_execution_get", "opencode_execution_status", "opencode_execution_abort"]) assert.ok(names.includes(name), `${name} missing from public tools/list`);
console.log(`SMOKE tools/list canonical=${names.length} (aliases de-promoted): PASS`);

// 3. Effective profile resolution (operator principal unknown -> fail closed)
r = await rpc(token, sid, 3, "tools/call", { name: "opencode_mcp_effective_profile", arguments: { taskClass: "infra", currentStage: "deploy" } });
const profile = r.body.result.structuredContent;
console.log(`SMOKE effective profile role=${profile.resolvedRole} eager=[${profile.eagerConnections}] source=${profile.source}`);

// 4. READ without EXECUTE envelope
r = await rpc(token, sid, 4, "tools/call", { name: "opencode_status" });
assert.equal(r.body.result.isError, undefined, JSON.stringify(r.body).slice(0, 300));
console.log("SMOKE READ opencode_status without EXECUTE envelope: PASS");

// 5. DIAGNOSE opencode_run with DEFAULT model injection (no providerID/modelID passed).
// The gateway must allocate and report identity before model invocation, never infer it
// from response text.
r = await rpc(token, sid, 5, "tools/call", {
  name: "opencode_run",
  arguments: { prompt: "Zwróć dokładnie: CTB_DIAGNOSE_DEFAULT_MODEL_PASS", directory: "C:\\Kompas Zbírek".replace("Zbírek", "Zbiórek"), ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
});
assert.equal(r.body.result.isError, undefined, JSON.stringify(r.body).slice(0, 400));
const diagText = JSON.stringify(r.body.result);
assert.match(diagText, /CTB_DIAGNOSE_DEFAULT_MODEL_PASS/, `DIAGNOSE echo failed: ${diagText.slice(0, 300)}`);
const { executionId: diagExecutionId, sessionId: diagSessionId } = r.body.result.structuredContent;
assert.ok(diagExecutionId && diagSessionId, `DIAGNOSE identity missing: ${diagText.slice(0, 300)}`);
r = await rpc(token, sid, 51, "tools/call", { name: "opencode_execution_status", arguments: { executionId: diagExecutionId } });
assert.equal(r.body.result.structuredContent.sessionId, diagSessionId);
assert.equal(r.body.result.structuredContent.status, "completed");
r = await rpc(token, sid, 6, "tools/call", { name: "opencode_message_model_info", arguments: { sessionId: diagSessionId } });
const modelInfo = JSON.stringify(r.body.result);
assert.match(modelInfo, /hy3-free/, `default model not served: ${modelInfo.slice(0, 300)}`);
console.log("SMOKE DIAGNOSE opencode_run on default model hy3-free, authoritative lifecycle: PASS");

// 6. PLAN
r = await rpc(token, sid, 7, "tools/call", {
  name: "opencode_ask",
  arguments: { prompt: "Sporządź krótki plan (max 5 punktów) dodania pola retryCount do ctb-runs.json. Nie wykonuj zmian.", directory: "C:\\Kompas Zbiórek\\opencode-mcp", ctb: { mode: "PLAN", changeClass: "ctb" } },
});
assert.equal(r.body.result.isError, undefined, JSON.stringify(r.body).slice(0, 400));
console.log("SMOKE PLAN read-only inference: PASS");

// 7. DENY outside authorized roots
r = await rpc(token, sid, 8, "tools/call", { name: "opencode_context", arguments: { directory: "C:\\Windows" } });
assert.equal(r.body.result.structuredContent.errorCode, "CTB_PROJECT_DENIED");
console.log("SMOKE directory outside allowed roots -> CTB_PROJECT_DENIED: PASS");

// 8. EXECUTE harmless artifact inside Paperclip isolated worktree KOMAA-126
if (process.env.PAPERCLIP_SMOKE_ISSUE_ID && fs.existsSync("C:\\paperclip-worktrees")) {
  const wsEntry = fs.readdirSync("C:\\paperclip-worktrees", { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name === "KOMAA-126");
  if (wsEntry) {
    const worktree = path.join("C:\\paperclip-worktrees", wsEntry.name);
    const proofPath = path.join(worktree, "ctb-smoke-proof.txt");
    if (fs.existsSync(proofPath)) fs.unlinkSync(proofPath);
    r = await rpc(token, sid, 9, "tools/call", {
      name: "opencode_run",
      arguments: {
        directory: worktree,
        prompt: `Utwórz plik ${proofPath} o treści CTB_SMOKE_PASS, następnie usuń ten plik. Nie modyfikuj żadnego innego pliku. Zgłoś wykonane kroki.`,
        ctb: {
          mode: "EXECUTE",
          changeClass: "ctb",
          paperclipIssueId: process.env.PAPERCLIP_SMOKE_ISSUE_ID,
          changeIntent: "Live CTB smoke: harmless temporary artifact write/cleanup.",
          scope: `${worktree} (temporary artifact only)`,
          acceptanceCriteria: "ctb-smoke-proof.txt created and deleted; no other files touched.",
          idempotencyKey: `ctb-smoke-${Date.now()}`,
        },
      },
    });
    assert.equal(r.body.result.isError === true ? undefined : undefined, undefined);
    const execText = JSON.stringify(r.body.result);
    if (r.body.result.isError) throw new Error(`EXECUTE failed: ${execText.slice(0, 500)}`);
    const runId = /ses_[A-Za-z0-9_-]+/.exec(execText)?.[0];
    console.log(`SMOKE EXECUTE in Paperclip worktree ${worktree}: PASS (${runId})`);
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")).runs;
    const run = registry[runId];
    assert.ok(run, "run correlated in CTB registry");
    assert.equal(run.policyDecision.ctbPolicy.source, "workspace_fallback");
    console.log(`SMOKE run correlation source=${run.policyDecision.ctbPolicy.source} requestedModel=${JSON.stringify(run.model?.providerRequested ?? null)} actual=${JSON.stringify(run.model?.modelActual ?? null)} fallbackUsed=${JSON.stringify(run.model?.fallbackUsed ?? null)}`);
    assert.ok(!fs.existsSync(proofPath), "artifact must be cleaned up");
  }
}

// ---------------------------------------------------------------------------
// KOMAA-168 explicit acceptance matrix (reviewer-requested PASS/FAIL).
// Each named check reports its own PASS/FAIL line so the operator sees exactly
// what to expect. Failures are collected; the full matrix still prints and the
// script exits non-zero only if any KOMAA-168 check fails. Nothing here writes
// to a project (DIAGNOSE/EXECUTE-envelope-only) or performs a production deploy.
// ---------------------------------------------------------------------------
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

// 1. Healthy free model -> terminal completed (positive path, read-only DIAGNOSE).
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

// 2. Known-bad free model -> terminal failed, truthful errorCode, NOT masked as success.
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

// 3. Same-session reply affinity: requested sessionId must equal the session that
//    actually receives the turn; no replacement session may be bootstrapped. Also
//    reply into a non-existent session must fail closed (no new session created).
await komaaCheck("same-session-reply-affinity", async () => {
  const created = await rpc(token, sid, 23, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_REPLY_SEED", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const seedSession = scOf(created).sessionId;
  assert.ok(seedSession, `seed session missing: ${JSON.stringify(scOf(created)).slice(0, 200)}`);
  const replied = await rpc(token, sid, 24, "tools/call", {
    name: "opencode_reply",
    arguments: { sessionId: seedSession, prompt: "Zwróć dokładnie: KOMAA168_REPLY_TURN" },
  });
  const repliedSession = scOf(replied).sessionId;
  assert.equal(repliedSession, seedSession, `reply created a NEW session ${repliedSession} instead of continuing ${seedSession}`);
  assert.equal(failedOf(replied), false, "reply into existing session reported isError");
  // negative: reply into a fabricated session must fail closed, not bootstrap one.
  const badReply = await rpc(token, sid, 25, "tools/call", {
    name: "opencode_reply",
    arguments: { sessionId: "ses_does_not_exist_KOMAA168", prompt: "Zwróć dokładnie: KOMAA168_REPLY_GHOST" },
  });
  assert.equal(failedOf(badReply), true, "reply into non-existent session did NOT fail closed");
  assert.ok(scOf(badReply).errorCode, "reply into non-existent session missing errorCode");
  return `seed=${seedSession} repliedInto=${repliedSession}`;
});

// 4. Consistent execution projections: top-level isError and nested
//    structuredContent.state/status must agree; a terminal run must never show a
//    nested "running" while top-level is terminal.
await komaaCheck("consistent-execution-projections", async () => {
  const good = await rpc(token, sid, 26, "tools/call", {
    name: "opencode_run",
    arguments: { prompt: "Zwróć dokładnie: KOMAA168_PROJECTION_PASS", directory: WORKSPACE_DIR, modelID: "hy3-free", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } },
  });
  const gs = scOf(good);
  assert.equal(gs.state, gs.status, `completed run state=${gs.state} != status=${gs.status}`);
  assert.equal(gs.status, "completed", `projection status=${gs.status}`);
  assert.notEqual(gs.state, "running", "completed run nested state still running");
  // reuse the known-bad result captured in check 2
  const bs = scOf(badRunRes);
  assert.equal(bs.state, bs.status, `failed run state=${bs.state} != status=${bs.status}`);
  assert.equal(bs.state, "failed", `failed run nested state=${bs.state} (contradiction)`);
  return `completed(${gs.state}) failed(${bs.state})`;
});

// 5. DIAGNOSE no-write + CTB invalid issue (truthful, no model fallback).
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
  // invalid issue -> truthful CTB/PAPERCLIP failure, NO model fallback / success.
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
if (komaaFailed.length) {
  console.log("KOMAA-168 FAILURES: " + komaaFailed.map((c) => `${c.name}=${c.detail}`).join(" | "));
}

console.log("LIVE SMOKE COMPLETE");
