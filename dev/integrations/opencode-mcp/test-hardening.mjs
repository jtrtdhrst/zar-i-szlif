import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateIssueCtbPolicyDetailed, isFallbackEligibleError, selectIdempotentRun, sessionOwnershipError } from "./ctb-policy.mjs";
import { KNOWN_DEV_MCP, loadMcpRoleProfiles, reconcileProfileWithAgent, resolveEffectiveProfile } from "./mcp-role-profiles.mjs";
import { analyzeShellCommand, assertShellCommandAllowed, capabilitiesForAgent, NATIVE_AGENT_CAPABILITIES } from "./ctb-capability.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(condition, label) { if (!condition) { console.error(`FAIL: ${label}`); process.exitCode = 1; } else { passed += 1; console.log(`PASS ${passed}: ${label}`); } }

// ============ 1. SHELL BYPASS ADVERSARIAL SUITE ============
const NO_CAPS = [];
const GIT_CAPS = ["git"];
const CF_CAPS = ["cloudflare"];

for (const command of ["git status", "git.exe log", 'cmd /c git push', 'cmd.exe /c "git commit -m x"', "powershell -Command git status", "powershell.exe -Command '& git push'", "pwsh -c git pull", "gh pr view", "gh.exe api x"]) {
  let denied = false;
  try { assertShellCommandAllowed(NO_CAPS, command); } catch (error) { denied = error.code === "CTB_SHELL_CAPABILITY_DENIED"; }
  ok(denied, `shell deny without git capability: ${command}`);
}
for (const command of ["wrangler deploy", "wrangler.exe versions upload", "npx wrangler deploy", "pnpm exec wrangler whoami", "npm exec wrangler deploy", "yarn wrangler deploy", "cmd /c wrangler deploy"]) {
  let denied = false;
  try { assertShellCommandAllowed(GIT_CAPS, command); } catch (error) { denied = error.code === "CTB_SHELL_CAPABILITY_DENIED"; }
  ok(denied, `shell deny without cloudflare capability: ${command}`);
}
for (const command of ['node -e "require(\'child_process\').execSync(\'git push\')"', "python -c \"import os; os.system('git push')\"", "powershell -EncodedCommand Z2l0IHB1c2g="]) {
  let denied = false;
  try { assertShellCommandAllowed(CF_CAPS, command); } catch (error) { denied = error.code === "CTB_SHELL_CAPABILITY_DENIED"; }
  ok(denied, `inline interpreter/encoded payload denied: ${command.slice(0, 50)}`);
}
for (const command of ["npm test", "node build.mjs", "pytest -q"]) {
  let threw = false;
  try { assertShellCommandAllowed(NO_CAPS, command); } catch { threw = true; }
  ok(!threw, `unprotected command stays allowed: ${command}`);
}
ok((() => { try { assertShellCommandAllowed(GIT_CAPS, "cmd /c git status"); return true; } catch { return false; } })(), "granted capability allows its tool through launchers");
ok(analyzeShellCommand("npx wrangler deploy").protectedCapabilities.includes("cloudflare"), "launcher unwrapping resolves underlying binary family");

// ============ 2. CAPABILITY INVARIANT (profile == executable) ============
const doc = loadMcpRoleProfiles();
// Every baseline role profile must reconcile to itself (agent enforces all grants).
for (const [role] of Object.entries(doc.profiles)) {
  const profile = resolveEffectiveProfile({ role }, doc, {});
  const reconciled = reconcileProfileWithAgent(profile, "EXECUTE");
  ok(profile.known && reconciled.unenforceableCapabilities.length === 0 && JSON.stringify([...reconciled.executableCapabilities].sort()) === JSON.stringify([...profile.eagerConnections].sort()), `baseline role ${role}: granted == executable`);
}
// Combination grant (designer + issue-scoped git): coarse agent cannot enforce git ->
// reconciliation reports it unenforceable instead of pretending execution.
const designerWithGit = resolveEffectiveProfile({ role: "designer", projectKey: "KOMAA-126" }, doc, {});
ok(designerWithGit.eagerConnections.includes("git"), "issue override widens designer eager set (policy level)");
const reconciledDesignerGit = reconcileProfileWithAgent(designerWithGit, "EXECUTE");
ok(reconciledDesignerGit.agent === "ctb-designer" && reconciledDesignerGit.executableCapabilities.includes("shadcn") && !reconciledDesignerGit.executableCapabilities.includes("git") && reconciledDesignerGit.unenforceableCapabilities.includes("git"), "combination git+shadcn reconciles honestly (unenforceable reported)");
// CTO infra stage (server-derived) -> cloudflare enforced by ctb-cto-infra.
const ctoInfra = resolveEffectiveProfile({ role: "cto", currentStage: "infra" }, doc, {});
const reconciledCto = reconcileProfileWithAgent(ctoInfra, "EXECUTE");
ok(reconciledCto.agent === "ctb-cto-infra" && JSON.stringify(reconciledCto.executableCapabilities) === JSON.stringify(["cloudflare"]) && reconciledCto.unenforceableCapabilities.length === 0, "cto infra stage: cloudflare granted AND executable");
// KOMAA-260: CTO release/integration stage (server-derived) -> git enforced by EXISTING ctb-engineer (no new agent).
const ctoRelease = resolveEffectiveProfile({ role: "cto", currentStage: "release" }, doc, {});
const reconciledRelease = reconcileProfileWithAgent(ctoRelease, "EXECUTE");
ok(ctoRelease.eagerConnections.join(",") === "git" && reconciledRelease.agent === "ctb-engineer" && reconciledRelease.executableCapabilities.join(",") === "git" && reconciledRelease.unenforceableCapabilities.length === 0, "cto release stage: git granted AND executable via existing ctb-engineer");
const ctoIntegration = resolveEffectiveProfile({ role: "cto", currentStage: "integration" }, doc, {});
ok(ctoIntegration.eagerConnections.join(",") === "git" && reconcileProfileWithAgent(ctoIntegration, "EXECUTE").agent === "ctb-engineer", "cto integration stage: git granted via existing ctb-engineer");
// KOMAA-260: release+infra combined stays fail-closed (no silent widening): git reported unenforceable under ctb-cto-infra.
const ctoReleaseInfra = resolveEffectiveProfile({ role: "cto", currentStage: "release infra" }, doc, {});
const reconciledReleaseInfra = reconcileProfileWithAgent(ctoReleaseInfra, "EXECUTE");
ok(reconciledReleaseInfra.agent === "ctb-cto-infra" && reconciledReleaseInfra.unenforceableCapabilities.includes("git"), "cto release+infra combined: git unenforceable (separate runs required)");
// KOMAA-260 permission boundary: engineer keeps local git, ui-qa has no git, cto baseline stays empty.
ok(resolveEffectiveProfile({ role: "engineer" }, doc, {}).eagerConnections.join(",") === "git", "engineer baseline: local git retained");
ok(!resolveEffectiveProfile({ role: "ui-qa" }, doc, {}).eagerConnections.includes("git"), "ui-qa baseline: no git");
ok(resolveEffectiveProfile({ role: "cto" }, doc, {}).eagerConnections.length === 0, "cto baseline stays empty (least privilege)");
// KOMAA-260 single authority: Git Integrator company agent has no CTB role -> fail-closed, no second write authority.
const giProfile = resolveEffectiveProfile({ role: "git-integrator" }, doc, {});
const giReconciled = reconcileProfileWithAgent(giProfile, "EXECUTE");
ok(giProfile.known === false && giReconciled.agent === "ctb-executor" && giReconciled.executableCapabilities.length === 0, "git-integrator: unknown role fail-closed, zero executable capabilities");
// KOMAA-260 shell boundary without granted capability: git/gh denied, incl. push/PR/merge shapes.
for (const command of ["git push origin KOMAA-260", "gh pr create --title x", "gh pr merge 15 --squash", "gh api repos/x/y/branches/main/protection"]) {
  let denied = false;
  try { assertShellCommandAllowed([], command); } catch (error) { denied = error?.code === "CTB_SHELL_CAPABILITY_DENIED"; }
  ok(denied, `release shell denied without grant: ${command}`);
}
ok((() => { try { assertShellCommandAllowed(["git"], "git push origin KOMAA-260"); return true; } catch { return false; } })(), "release shell allowed with scoped git grant");
// Agent capability table covers exactly the known dev MCP families used by profiles.
for (const caps of Object.values(NATIVE_AGENT_CAPABILITIES)) for (const cap of caps) ok(KNOWN_DEV_MCP.includes(cap), `agent capability ${cap} is a known dev MCP`);

// ============ 3. SERVER-AUTHORITATIVE PROFILE NEGATIVES ============
// Client-supplied taskClass/currentStage must NEVER widen permissions: only server-side
// trusted inputs reach resolution. Simulate the gateway contract directly.
const requestedHint = { taskClass: "backend_runtime", currentStage: "infra" };
const designerBaseline = resolveEffectiveProfile({ role: "designer" }, doc, {});
const designerIfHintsWereTrustedButRulesDontMatch = resolveEffectiveProfile({ role: "designer", taskClass: requestedHint.taskClass, currentStage: requestedHint.currentStage }, doc, {});
ok(JSON.stringify(designerIfHintsWereTrustedButRulesDontMatch.eagerConnections) === JSON.stringify(designerBaseline.eagerConnections), "client hints cannot cross role boundaries");
// CTO without SERVER-SIDE stage data gets empty baseline even if client claims infra.
const ctoBaseline = resolveEffectiveProfile({ role: "cto" }, doc, {});
ok(ctoBaseline.eagerConnections.length === 0, "cto baseline: no cloudflare without server-side stage");
// Fake issue identifier yields no override.
ok(resolveEffectiveProfile({ role: "ui-qa", projectKey: "KOMAA-999-FAKE" }, doc, {}).eagerConnections.join(",") === "playwright", "fake projectKey adds no override");
// Unknown principal fails closed.
ok(resolveEffectiveProfile({ principalId: "intruder", taskClass: "anything", currentStage: "infra" }, doc, {}).known === false, "unknown principal fail-closed");

// ============ 4. IDEMPOTENCY REGRESSION ============
const failedAttempt = { runId: "ses_a", companyId: "co", paperclipIssueId: "iss", idempotencyKey: "k", status: "failed", finishedAt: "2026-08-20T10:00:00Z" };
const successfulRetry = { runId: "ses_b", companyId: "co", paperclipIssueId: "iss", idempotencyKey: "k", status: "completed", finishedAt: "2026-08-21T10:00:00Z" };
ok(selectIdempotentRun([failedAttempt]) === failedAttempt, "single failed attempt selected alone");
ok(selectIdempotentRun([]) === null, "no candidates -> null");
ok(selectIdempotentRun([failedAttempt, successfulRetry]).runId === "ses_b", "success wins over earlier failed attempt");
const runningRow = { runId: "ses_c", status: "running", createdAt: "2026-08-19T10:00:00Z" };
ok(selectIdempotentRun([successfulRetry, runningRow]).runId === "ses_c", "running replay wins over completed");
const olderSuccess = { runId: "ses_old", status: "completed", finishedAt: "2026-08-18T10:00:00Z" };
ok(selectIdempotentRun([olderSuccess, successfulRetry]).runId === "ses_b", "latest success wins among successes");
const processLost = { runId: "ses_d", status: "process_lost", finishedAt: "2026-08-22T10:00:00Z" };
ok(selectIdempotentRun([processLost]).status === "process_lost", "process_lost participates as retryable terminal state");

// ============ 5. SESSION OWNERSHIP ============
ok(sessionOwnershipError(null, "a|c1", "alice") === null, "uncorrelated session passes through");
const aliceRun = { runId: "ses_a1", ownerKey: "alice|client1", actor: "alice" };
ok(sessionOwnershipError(aliceRun, "alice|client1", "alice") === null, "owner may mutate own session");
ok(sessionOwnershipError(aliceRun, "bob|client2", "bob") === "CTB_SESSION_OWNERSHIP_DENIED", "different client_id denied");
ok(sessionOwnershipError(aliceRun, "bob|client1", "bob") === "CTB_SESSION_OWNERSHIP_DENIED", "same client different sub denied");
const legacyRow = { runId: "ses_legacy", actor: "operator" };
ok(sessionOwnershipError(legacyRow, "operator|any-client", "operator") === null, "legacy row: sub equality keeps compatibility");
ok(sessionOwnershipError(legacyRow, "mallory|x", "mallory") === "CTB_SESSION_OWNERSHIP_DENIED", "legacy row still denies other subs");

// ============ 6. FAIL-CLOSED REALPATH BOUNDARY ============
const ws = "C:\\definitely-nonexistent-root-xyz\\ws";
const nonexistentRootIssue = { currentExecutionWorkspace: { cwd: ws } };
ok(evaluateIssueCtbPolicyDetailed(nonexistentRootIssue, ws, "a", "b").error === "CTB_ISSUE_SCOPE_MISMATCH", "nonexistent workspace root DENIED (fail closed)");
// Broken junction: link target missing -> realpath of candidate resolves to deepest existing ancestor;
// escaping junction still denied.
const tempBase = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TEMP || ".", "ctb-hardening-")));
try {
  const realWs = path.join(tempBase, "ws");
  fs.mkdirSync(realWs, { recursive: true });
  fs.symlinkSync(path.join(tempBase, "missing-target"), path.join(realWs, "broken-link"), "junction");
  const brokenIssue = { currentExecutionWorkspace: { cwd: realWs } };
  ok(evaluateIssueCtbPolicyDetailed(brokenIssue, path.join(realWs, "plain"), "a", "b").error === null, "valid nonexistent descendant under legal root ALLOWED");
  fs.symlinkSync(tempBase, path.join(realWs, "escape-link"), "junction");
  ok(evaluateIssueCtbPolicyDetailed(brokenIssue, path.join(realWs, "escape-link", "deeper"), "a", "b").error === "CTB_ISSUE_SCOPE_MISMATCH", "escaping junction DENIED");
} finally {
  fs.rmSync(tempBase, { recursive: true, force: true });
}

// ============ 7. FALLBACK MATRIX EXTENSIONS ============
ok(isFallbackEligibleError(Object.assign(new Error("(500) UnknownError"), { code: "" })) === false, "masked 500 UnknownError does not trigger fallback");
ok(isFallbackEligibleError(Object.assign(new Error("rate limit exceeded"), { code: "" })) === true, "rate limit -> fallback retry");
ok(isFallbackEligibleError(Object.assign(new Error("provider not found"), { code: "" })) === true, "provider not found -> fallback retry");
ok(isFallbackEligibleError(Object.assign(new Error("(500) UnknownError"), { code: "CTB_ISSUE_SCOPE_MISMATCH" })) === false, "500 in message but CTB_ code -> NO fallback");
ok(isFallbackEligibleError(Object.assign(new Error("upstream said 503 service unavailable"), { code: "PAPERCLIP_AUTH_FAILED" })) === false, "Paperclip error never falls back");
ok(isFallbackEligibleError(Object.assign(new Error("validation failed"), { code: "" })) === false, "generic validation failure -> NO fallback");
ok(isFallbackEligibleError(Object.assign(new Error("model not found"), { code: "UNKNOWN_TOOL" })) === false, "unknown-tool boundary error -> NO fallback");

// ============ 8. CRASH-RECOVERY + PERSISTENT NATIVE MODE (spawned gateway) ============
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch (error) { reject(error); } }); }).on("error", reject);
  });
}
async function spawnGateway(runtimeDir, port, envExtra = {}) {
  const child = execFile(process.execPath, [path.join(here, "ctb-gateway.mjs")], { env: { ...process.env, PORT: String(port), OPENCODE_MCP_RUNTIME_DIR: runtimeDir, OPENCODE_MCP_PASSWORD: "x", OPENCODE_SERVER_PASSWORD: "y", ...envExtra }, stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await getJson(`http://127.0.0.1:${port}/health`); if (response.status === 200) return { child, port }; } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error("gateway did not become healthy");
}

const crashRuntimeDir = path.join(tempBaseHardening(), "crash-runtime");
fs.mkdirSync(crashRuntimeDir, { recursive: true });
fs.writeFileSync(path.join(crashRuntimeDir, "ctb-runs.json"), JSON.stringify({ version: 2, runs: { ses_zombie: { runId: "ses_zombie", executionId: "exec_zombie", status: "running", createdAt: new Date().toISOString(), events: [] } }, executions: { exec_zombie: { executionId: "exec_zombie", sessionId: "ses_zombie", status: "running", createdAt: new Date().toISOString() } } }));
try {
  const { child } = await spawnGateway(crashRuntimeDir, 4598);
  try {
    const health = await getJson("http://127.0.0.1:4598/health");
    ok(health.body.crashRecovery?.startupProcessLostRuns === 1, "crash-recovery marks persisted running run as process_lost at startup");
    ok(health.body.nativeAgents?.enabled === false && health.body.nativeAgents?.enforcementMode === "builtin_plan_build", "native mode off by default (persistent activation required)");
    const registry = JSON.parse(fs.readFileSync(path.join(crashRuntimeDir, "ctb-runs.json"), "utf8"));
    ok(registry.runs.ses_zombie.status === "process_lost" && registry.runs.ses_zombie.errorCode === "CTB_PROCESS_LOST", "registry row reconciled to process_lost (retryable)");
    ok(registry.executions.exec_zombie.status === "failed" && registry.executions.exec_zombie.errorCode === "CTB_PROCESS_LOST" && registry.executions.exec_zombie.retryable === true, "orphaned execution is terminalized as retryable CTB_PROCESS_LOST");
  } finally { child.kill(); }
} finally {
  fs.rmSync(crashRuntimeDir, { recursive: true, force: true });
}

// Persistent native activation + fail-closed when backend lacks ctb-* agents.
const nativeRuntimeDir = path.join(tempBaseHardening(), "native-runtime");
fs.mkdirSync(nativeRuntimeDir, { recursive: true });
fs.writeFileSync(path.join(nativeRuntimeDir, "native-agents.mode"), "on");
try {
  const { child } = await spawnGateway(nativeRuntimeDir, 4599);
  try {
    const health = await getJson("http://127.0.0.1:4599/health");
    ok(health.body.nativeAgents?.enabled === true, "native-agents.mode file persists activation across restart");
    ok(health.body.nativeAgents?.silentDowngradePossible === false, "silent downgrade impossible while native mode active");
    // The shared backend currently lacks ctb-* agents -> enforcement must be fail-closed, never builtin_plan_build.
    ok(["fail_closed_unverified", "native_enforced"].includes(health.body.nativeAgents?.enforcementMode), "enforcement mode is native or fail-closed (never silent downgrade)");
    ok(Array.isArray(health.body.models) === false && health.body.models?.fallbackRetryLimit === 1, "health exposes model contract with single fallback retry");
  } finally { child.kill(); }
} finally {
  fs.rmSync(nativeRuntimeDir, { recursive: true, force: true });
}

function tempBaseHardening() { return path.join(process.env.TEMP || ".", "ctb-hardening-spawn"); }

console.log(process.exitCode ? `\nHARDENING SUITE FAILED (${passed} passed)` : `\nALL HARDENING TESTS PASS (${passed})`);
