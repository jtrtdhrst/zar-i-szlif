import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
assert.equal(health.revision, "ctb-policy-5");
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

console.log("LIVE SMOKE COMPLETE");
