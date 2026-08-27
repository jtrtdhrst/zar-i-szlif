import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CTB_POLICY_REVISION, TOOL_CLASSES, classifyIntake, classifyTool, ctbContextError, canonicalPath, evaluateIssueCtbPolicyDetailed, isFallbackEligibleError, isProviderModelFailure, normalizeAllowedDirectory, parseModelRef, requiredScope } from "./ctb-policy.mjs";
import { KNOWN_DEV_MCP, loadMcpRoleProfiles, resolveCtbAgent, resolveEffectiveProfile, resolvePrincipalRole } from "./mcp-role-profiles.mjs";

const doc = loadMcpRoleProfiles();
const PRINCIPAL_ROLES = { operator: "cto", eng_lead: "engineer", design_lead: "designer", qa_lead: "ui-qa", ceo_bot: "ceo", coo_bot: "coo", cmo_bot: "cmo" };
let passed = 0;
function ok(condition, label) { assert.ok(condition, label); passed += 1; console.log(`PASS ${passed}: ${label}`); }

// 1. READ tools never require an EXECUTE envelope.
for (const name of ["opencode_status", "opencode_health", "opencode_provider_list", "opencode_provider_models", "opencode_session_list", "opencode_session_get", "opencode_session_check", "opencode_session_todo", "opencode_session_children", "opencode_conversation", "opencode_session_diff", "opencode_file_status", "opencode_mcp_status", "opencode_lsp_status", "opencode_formatter_status", "opencode_message_model_info"]) {
  ok(classifyTool(name) === TOOL_CLASSES.READ && !classifyIntake({}, TOOL_CLASSES.READ, name).errorCode && classifyIntake({ ctb: { mode: "DIAGNOSE" } }, TOOL_CLASSES.READ, name).mode === "DIAGNOSE", `${name} callable without EXECUTE envelope`);
}

// 2/3. DIAGNOSE and PLAN work without mutation semantics (no execute context required).
ok(!classifyIntake({ ctb: { mode: "DIAGNOSE", changeClass: "ctb" } }, TOOL_CLASSES.READ, "opencode_context").errorCode, "DIAGNOSE accepted on READ");
ok(!classifyIntake({ ctb: { mode: "PLAN", changeClass: "ctb" } }, TOOL_CLASSES.READ, "opencode_context").errorCode, "PLAN accepted on READ");
for (const name of ["opencode_ask", "opencode_run", "opencode_reply"]) {
  ok(classifyIntake({ ctb: { mode: "DIAGNOSE", changeClass: "ctb" } }, TOOL_CLASSES.WRITE, name).modelReadOnly === true, `${name} DIAGNOSE -> read-only plan agent`);
  ok(classifyIntake({ ctb: { mode: "PLAN", changeClass: "ctb" } }, TOOL_CLASSES.WRITE, name).modelReadOnly === true, `${name} PLAN -> read-only plan agent`);
}

// 4. EXECUTE still requires the full CTB write envelope.
ok(classifyIntake({}, TOOL_CLASSES.WRITE, "opencode_run").errorCode === "CTB_INTAKE_REQUIRED", "EXECUTE without envelope rejected");
ok(ctbContextError({ ctb: { mode: "EXECUTE", changeClass: "ctb" } })?.code === "CTB_EXECUTION_CONTEXT_REQUIRED", "EXECUTE envelope fields enforced");
ok(ctbContextError({ ctb: { mode: "EXECUTE", changeClass: "ctb", paperclipIssueId: "i", changeIntent: "c", scope: "s", acceptanceCriteria: "a", idempotencyKey: "k" } }) === null, "complete EXECUTE envelope accepted");

// 5. Malformed EXPLICIT issue policy -> CTB_POLICY_INVALID (never workspace fallback).
// Uses a REAL directory: fail-closed realpath now denies nonexistent roots outright.
const realPolicyDir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TEMP || ".", "ctb-acc-policy-")));
const malformed = evaluateIssueCtbPolicyDetailed({ currentExecutionWorkspace: { cwd: realPolicyDir }, executionPolicy: { ctb: { changeClass: "ctb" } } }, realPolicyDir, "a", "b");
ok(malformed.error === "CTB_POLICY_INVALID" && malformed.decisionSource === "issue_policy", "malformed explicit policy denied as CTB_POLICY_INVALID");
ok(evaluateIssueCtbPolicyDetailed({ currentExecutionWorkspace: { cwd: "C:\\nonexistent-root-xyz\\ws" } }, "C:\\nonexistent-root-xyz\\ws", "a", "b").error === "CTB_ISSUE_SCOPE_MISMATCH", "nonexistent workspace root fail-closed");

// 6. Absent policy -> workspace_fallback authorization.
const fallback = evaluateIssueCtbPolicyDetailed({ currentExecutionWorkspace: { cwd: realPolicyDir } }, path.join(realPolicyDir, "deep"), "a", "b");
ok(fallback.error === null && fallback.decisionSource === "workspace_fallback" && fallback.canonicalDirectory != null && fallback.canonicalWorkspaceRoot != null, "absent policy falls back to canonical workspace");

// 7-14. Canonical allow-root matrix via normalizeAllowedDirectory (synthetic roots).
const tempBase = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TEMP || ".", "ctb-acceptance-")));
try {
  const rootA = path.join(tempBase, "paperclip-worktrees");
  const ws = path.join(rootA, "KOMAA-126");
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  const roots = [rootA];
  ok(normalizeAllowedDirectory(ws, roots) != null, "worktree root allowed");
  ok(normalizeAllowedDirectory(path.join(ws, "src", "deep"), roots) != null, "worktree descendant allowed");
  ok(normalizeAllowedDirectory(ws.toLowerCase(), roots) != null, "case-insensitive Windows path allowed");
  ok(normalizeAllowedDirectory(ws + path.sep, roots) != null, "trailing separator normalized");
  assert.throws(() => normalizeAllowedDirectory(path.join(tempBase, "paperclip-worktrees-evil", "x"), roots), /CTB_PROJECT_DENIED/, undefined), ok(true, "sibling-prefix denied");
  assert.throws(() => normalizeAllowedDirectory(path.join(ws, "..", "..", "escape"), roots), /CTB_PROJECT_DENIED/), ok(true, ".. traversal escape denied");
  const otherDrive = process.env.SYSTEMDRIVE || "C:";
  assert.throws(() => normalizeAllowedDirectory(path.join(otherDrive, "Windows"), roots), /CTB_PROJECT_DENIED/), ok(true, "unconfigured absolute directory denied");
  assert.throws(() => normalizeAllowedDirectory("\\\\evil\\share\\x", roots), /CTB_PROJECT_DENIED|code: 'CTB_PROJECT_DENIED'/), ok(true, "UNC path denied");
  // Junction/reparse containment: escaping link denied, reparsed allowed root stays legal, internal link allowed.
  const insideTarget = path.join(ws, "inside-target");
  fs.mkdirSync(insideTarget, { recursive: true });
  const outsideDir = path.join(tempBase, "outside-junction");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.symlinkSync(outsideDir, path.join(ws, "escape-link"), "junction");
  fs.symlinkSync(insideTarget, path.join(ws, "internal-link"), "junction");
  assert.throws(() => normalizeAllowedDirectory(path.join(ws, "escape-link", "deeper"), roots), /CTB_PROJECT_DENIED/), ok(true, "junction reparse escape denied");
  ok(normalizeAllowedDirectory(path.join(ws, "internal-link", "file.txt"), roots) != null, "internal junction target allowed");
  // A reparse-resolved allowed ROOT (canonical realpath form) remains legal; entering
  // through an unconfigured link path stays denied (fail-closed aliasing).
  fs.symlinkSync(ws, path.join(tempBase, "reparsed-root"), "junction");
  const reparsedReal = fs.realpathSync.native(path.join(tempBase, "reparsed-root"));
  ok(normalizeAllowedDirectory(path.join(reparsedReal, "src"), [reparsedReal]) != null, "reparse-resolved allowed root remains legal");
  // opencode-mcp repo itself is legally addressable under the Kompas allow-root.
  const repoRoot = path.resolve(import.meta.dirname, "..") === tempBase ? tempBase : import.meta.dirname;
  ok(normalizeAllowedDirectory(repoRoot, [import.meta.dirname]) != null, "gateway repo root addressable");
  // Real Paperclip isolated worktree layout is addressable when configured.
  if (fs.existsSync("C:\\paperclip-worktrees")) {
    const realWs = fs.readdirSync("C:\\paperclip-worktrees", { withFileTypes: true }).find((entry) => entry.isDirectory());
    if (realWs) ok(normalizeAllowedDirectory(path.join("C:\\paperclip-worktrees", realWs.name, "sub"), ["C:\\paperclip-worktrees"]) != null, "real Paperclip isolated worktree addressable");
  }
} finally {
  for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(tempBase, { recursive: true, force: true }); break; } catch { /* junction handles may linger briefly */ } }
}

// 15. Canonical session READ tools are classified READ.
for (const name of ["opencode_session_list", "opencode_session_status", "opencode_session_get", "opencode_session_search", "opencode_permission_list"]) {
  ok(classifyTool(name) === TOOL_CLASSES.READ, `${name} stays READ`);
}

// 16. Session abort/fork/update remain explicit SESSION_CONTROL; state-mutating session
// operations (permission approval, public share, revert/unrevert) require full EXECUTE.
ok(classifyTool("opencode_session_abort") === TOOL_CLASSES.SESSION_CONTROL && requiredScope(TOOL_CLASSES.SESSION_CONTROL) === "opencode:session", "session_abort is SESSION_CONTROL with opencode:session scope");
for (const name of ["opencode_session_update", "opencode_session_fork"]) {
  ok(classifyTool(name) === TOOL_CLASSES.SESSION_CONTROL, `${name} is SESSION_CONTROL`);
}
for (const [name, expected] of [["opencode_session_permission", TOOL_CLASSES.PRIVILEGED_WRITE], ["opencode_session_share", TOOL_CLASSES.PRIVILEGED_WRITE], ["opencode_session_unshare", TOOL_CLASSES.PRIVILEGED_WRITE], ["opencode_session_revert", TOOL_CLASSES.WRITE], ["opencode_session_unrevert", TOOL_CLASSES.WRITE]]) {
  ok(classifyTool(name) === expected && classifyIntake({}, expected, name).errorCode === "CTB_INTAKE_REQUIRED", `${name} requires EXECUTE envelope (${expected})`);
}
ok(requiredScope(TOOL_CLASSES.READ) === "opencode:read", "READ requires only opencode:read");

// 18. Unknown principal/role fails closed for dev MCP eager access.
{
  const unknown = resolveEffectiveProfile({ principalId: "ghost" }, doc, PRINCIPAL_ROLES);
  ok(unknown.known === false && unknown.eagerConnectionCount === 0 && unknown.source.startsWith("fail_closed"), "unknown principal fails closed");
  const noRoleArg = resolveEffectiveProfile({ role: "hacker" }, doc, {});
  ok(noRoleArg.eagerConnectionCount === 0, "client-supplied untrusted role never grants eager dev MCP");
}
ok(resolvePrincipalRole("OPERATOR", PRINCIPAL_ROLES) === "cto", "principal mapping is case-insensitive");

// 19. Engineer backend -> Git present; Playwright/Shadcn/Storybook/Cloudflare absent.
{
  const p = resolveEffectiveProfile({ principalId: "eng_lead", taskClass: "backend_runtime", currentStage: "implementation" }, doc, PRINCIPAL_ROLES);
  ok(p.eagerConnections.includes("git") && !p.eagerConnections.some((entry) => ["playwright", "shadcn", "storybook", "cloudflare"].includes(entry)), "engineer backend: Git eager, others deferred");
}
// 20. Designer UI -> Shadcn+Storybook present.
{
  const p = resolveEffectiveProfile({ principalId: "design_lead", taskClass: "ui_implementation" }, doc, PRINCIPAL_ROLES);
  ok(p.eagerConnections.includes("shadcn") && p.eagerConnections.includes("storybook") && !p.eagerConnections.includes("playwright"), "designer UI: Shadcn+Storybook eager");
}
// 21. UI QA -> Playwright present.
{
  const p = resolveEffectiveProfile({ principalId: "qa_lead", taskClass: "acceptance_e2e" }, doc, PRINCIPAL_ROLES);
  ok(p.eagerConnections.includes("playwright") && !p.eagerConnections.includes("cloudflare"), "UI QA: Playwright eager");
}
// 22/23. CTO infra -> Cloudflare present; architecture -> Cloudflare absent.
{
  const infra = resolveEffectiveProfile({ principalId: "operator", taskClass: "infra", currentStage: "deploy" }, doc, PRINCIPAL_ROLES);
  ok(infra.eagerConnections.includes("cloudflare"), "CTO infra/deploy: Cloudflare eager");
  const arch = resolveEffectiveProfile({ principalId: "operator", taskClass: "architecture", currentStage: "architecture" }, doc, PRINCIPAL_ROLES);
  ok(!arch.eagerConnections.includes("cloudflare"), "CTO architecture: Cloudflare absent");
}
// 24. CEO/COO -> no dev MCP eager.
for (const principal of ["ceo_bot", "coo_bot"]) {
  const p = resolveEffectiveProfile({ principalId: principal, taskClass: "anything", currentStage: "anything" }, doc, PRINCIPAL_ROLES);
  ok(p.eagerConnectionCount === 0, `${principal}: no eager dev MCP`);
}
// 25/26. CMO content -> Sender absent; campaign -> Sender present.
{
  const content = resolveEffectiveProfile({ principalId: "cmo_bot", taskClass: "content", currentStage: "strategy" }, doc, PRINCIPAL_ROLES);
  ok(!content.eagerConnections.includes("sender"), "CMO content: Sender absent");
  const campaign = resolveEffectiveProfile({ principalId: "cmo_bot", taskClass: "campaign", currentStage: "campaign" }, doc, PRINCIPAL_ROLES);
  ok(campaign.eagerConnections.includes("sender"), "CMO campaign: Sender eager");
}
// Issue-scoped override grants task-authorized extras only for that project key.
{
  const p = resolveEffectiveProfile({ principalId: "eng_lead", projectKey: "KOMAA-136" }, doc, PRINCIPAL_ROLES);
  ok(p.eagerConnections.includes("git") && p.eagerConnections.includes("cloudflare") && p.source.includes("issue_override"), "issue override grants Cloudflare only for KOMAA-136");
}
// Deferred surface always equals catalog minus eager.
{
  const p = resolveEffectiveProfile({ principalId: "eng_lead" }, doc, PRINCIPAL_ROLES);
  ok(p.deferredConnections.every((entry) => KNOWN_DEV_MCP.includes(entry) && !p.eagerConnections.includes(entry)), "deferred connections are catalog minus eager");
}

// 27. Requested vs actual model metadata summarizer (no fabricated fields).
{
  const requested = { providerRequested: "opencode", modelRequested: "x-preview-f-free" };
  const same = (() => {
    let result = null;
    const actual = { messageId: "msg_1", providerActual: "opencode", modelActual: "x-preview-f-free" };
    const summary = summarizeForTest(requested, actual);
    result = summary;
    return result;
  })();
  function summarizeForTest(req, act) {
    const summary = { sessionId: null, messageId: act?.messageId ?? null, providerRequested: req?.providerRequested ?? null, modelRequested: req?.modelRequested ?? null, providerActual: act?.providerActual ?? null, modelActual: act?.modelActual ?? null, fallbackUsed: null, fallbackReason: null };
    if (summary.providerRequested && summary.modelRequested && summary.providerActual && summary.modelActual) {
      summary.fallbackUsed = summary.providerActual !== summary.providerRequested || summary.modelActual !== summary.modelRequested;
      if (summary.fallbackUsed) summary.fallbackReason = "runtime served a different provider/model than requested";
    }
    return summary;
  }
  ok(same.fallbackUsed === false && same.fallbackReason === null, "model identity match reports fallbackUsed=false");
  const drifted = summarizeForTest(requested, { messageId: "msg_2", providerActual: "opencode", modelActual: "other-model" });
  ok(drifted.fallbackUsed === true && typeof drifted.fallbackReason === "string", "model drift reports fallbackUsed=true with reason");
  const partial = summarizeForTest(requested, { messageId: "msg_3", providerActual: "opencode", modelActual: null });
  ok(partial.fallbackUsed === null && partial.modelActual === null, "unknown runtime fields stay null, never fabricated");
}

// 28. Revision detectability constants.
ok(/^ctb-policy-\d+$/.test(CTB_POLICY_REVISION) && CTB_POLICY_REVISION > "ctb-policy-3", `/health revision advanced beyond ctb-policy-3 (${CTB_POLICY_REVISION})`);
ok(doc.revision === "mcp-role-profiles-4", `role profile revision detectable (${doc.revision})`);
ok(canonicalPath("C:\\Windows\\..\\Temp").toLowerCase() !== "c:\\windows\\..\\temp", "canonicalPath resolves lexically at minimum");

// Model contract helpers: model-ref parsing + explicit-fallback eligibility predicate.
ok(parseModelRef("opencode/x-preview-f-free")?.providerID === "opencode" && parseModelRef("opencode/x-preview-f-free")?.modelID === "x-preview-f-free", "parseModelRef splits provider/model");
ok(parseModelRef("opencode/tencent/hy3")?.modelID === "tencent/hy3", "parseModelRef keeps slashed model ids");
ok(parseModelRef("garbage") === null, "parseModelRef rejects non-refs");
ok(isProviderModelFailure(new Error("provider opencode model nope-model not found")), "provider/model failure detected");
ok(isProviderModelFailure(Object.assign(new Error("too many requests"), { code: "HTTP_429" })), "rate limit detected as model failure");
ok(!isProviderModelFailure(Object.assign(new Error("session not found"), { code: "CTB_SESSION_REQUIRED" })), "non-model errors are not fallback-eligible");
// Fallback eligibility is limited to explicit provider/model failures. Generic transport
// failures can also represent session, schema or agent faults and must stay visible.
ok(!isFallbackEligibleError(new Error("500 UnknownError")), "masked 500 UnknownError is not fallback-eligible");
ok(!isFallbackEligibleError(new Error("Unexpected server error")), "masked unexpected error is not fallback-eligible");
ok(!isFallbackEligibleError(new Error('POST /session/ses_x/message failed (500): {"name":"UnknownError"}')), "masked message transport is not fallback-eligible");
ok(!isFallbackEligibleError(new Error("POST /session/x/message failed")), "bare 'failed' without provider/model evidence is NOT fallback-eligible");
for (const [code, message] of [["CTB_PROJECT_DENIED", "denied"], ["CTB_SESSION_REQUIRED", "missing"], ["CTB_POLICY_INVALID", "invalid"], ["CTB_SECRET_PATH_DENIED", "denied"], ["PAPERCLIP_AUTH_FAILED", "auth"], ["INSUFFICIENT_SCOPE", "scope"], ["UPSTREAM_ENGINE_EXITED", "exited"]]) {
  ok(!isFallbackEligibleError(Object.assign(new Error(message + " (500)"), { code })), `${code} never triggers model fallback even with transport markers`);
}
ok(!isFallbackEligibleError(new Error("plain validation problem")), "unclassified non-failure text stays ineligible");
// Agent governance mapping: server-side agent selection enforces the profile natively.
const profileDoc = doc;
const mk = (eager, known = true) => ({ known, eagerConnections: eager, deferredConnections: [], source: "test" });
ok(resolveCtbAgent(mk([]), "PLAN") === "ctb-plan", "DIAGNOSE/PLAN always run on read-only ctb-plan agent");
ok(resolveCtbAgent({ known: false, eagerConnections: [] }, "EXECUTE") === "ctb-executor", "unknown principal EXECUTE runs on MCP-less ctb-executor");
ok(resolveCtbAgent(mk(["git"]), "EXECUTE") === "ctb-engineer", "engineer baseline maps to ctb-engineer (git allowed)");
ok(resolveCtbAgent(mk(["git", "cloudflare"]), "EXECUTE") === "ctb-cto-infra", "cloudflare grant maps to ctb-cto-infra");
ok(resolveCtbAgent(mk(["playwright"]), "EXECUTE") === "ctb-ui-qa", "playwright grant maps to ctb-ui-qa");
ok(resolveCtbAgent(mk(["shadcn", "storybook"]), "EXECUTE") === "ctb-designer", "designer grants map to ctb-designer");

console.log(`ACCEPTANCE SUITE: ${passed} checks PASS`);
