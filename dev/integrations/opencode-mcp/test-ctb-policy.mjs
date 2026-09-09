import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MODEL_ENTRYPOINTS, TOOL_CLASSES, classifyIntake, classifyTool, evaluateIssueCtbPolicy, matchesIdempotencyRun } from "./ctb-policy.mjs";

for (const name of ["opencode_health", "opencode_mcp_status", "opencode_vcs_info", "opencode_lsp_status", "opencode_formatter_status", "opencode_context", "opencode_provider_list", "opencode_provider_models", "opencode_events_poll"]) {
  assert.equal(classifyTool(name), TOOL_CLASSES.READ, `${name} must be READ`);
}
assert.equal(classifyIntake({ prompt: "Przeanalizuj architekturę Paperclip MCP. Nie zmieniaj plików." }, TOOL_CLASSES.READ).mode, "DIAGNOSE");
assert.equal(classifyIntake({ ctb: { mode: "PLAN", changeClass: "ctb" } }, TOOL_CLASSES.READ).mode, "PLAN");
assert.equal(classifyIntake({ prompt: "Zmień copy przycisku dashboardu produktu." }, TOOL_CLASSES.WRITE).changeClass, "product");
// Inflected Polish forms must classify identically to their base stems.
assert.equal(classifyIntake({ prompt: "Zmień tekst przycisku w produkcie." }, TOOL_CLASSES.WRITE).changeClass, "product");
assert.equal(classifyIntake({ prompt: "Engineer robi za dużo searchy. Popraw jego bieżący skill." }, TOOL_CLASSES.WRITE).handoffTo, "Paperclip");
assert.equal(classifyIntake({ prompt: "Przebuduj mechanizm run persistence Paperclip/OpenCode." }, TOOL_CLASSES.WRITE).changeClass, "ctb");
assert.equal(classifyIntake({ ctb: { mode: "DIAGNOSE", changeClass: "ctb" } }, TOOL_CLASSES.WRITE).errorCode, "CTB_READ_ONLY_MODE");
// Model entrypoints allow real read-only inference in DIAGNOSE/PLAN.
for (const name of ["opencode_ask", "opencode_run", "opencode_reply"]) {
  assert.ok(MODEL_ENTRYPOINTS.has(name));
  const intake = classifyIntake({ ctb: { mode: "DIAGNOSE", changeClass: "ctb" } }, TOOL_CLASSES.WRITE, name);
  assert.equal(intake.modelReadOnly, true, `${name} must support read-only model inference`);
  const plan = classifyIntake({ ctb: { mode: "PLAN", changeClass: "ctb" } }, TOOL_CLASSES.WRITE, name);
  assert.equal(plan.modelReadOnly, true);
}
assert.equal(classifyIntake({}, TOOL_CLASSES.WRITE, "opencode_ask").errorCode, "CTB_INTAKE_REQUIRED");
// Legacy registry rows without companyId still participate in exactly-once lookup.
assert.equal(matchesIdempotencyRun({ paperclipIssueId: "iss1", idempotencyKey: "k1" }, "companyA", "iss1", "k1"), true);
assert.equal(matchesIdempotencyRun({ companyId: "companyA", paperclipIssueId: "iss1", idempotencyKey: "k1" }, "companyB", "iss1", "k1"), false);

// CTB_ISSUE_SCOPE_MISMATCH regression: workspace containment without explicit ctb policy.
const WORKSPACE = "C:\\paperclip-worktrees\\KOMAA-126";
const issueNoPolicy = { currentExecutionWorkspace: { cwd: WORKSPACE } };
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, WORKSPACE, "hardening", "tests pass"), null);
// Subdirectories of the issue workspace stay authorized (case-insensitive on Windows).
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, "c:\\paperclip-worktrees\\komaa-126\\sub\\dir", "hardening", "tests pass"), null);
// Outside the workspace is denied even without a policy.
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, "C:\\Kompas Zbiórek", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy({}, WORKSPACE, "x", "y"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, undefined, "x", "y"), "CTB_ISSUE_SCOPE_MISMATCH");
// Explicit executionPolicy.ctb still tightens scope when present.
const issueWithPolicy = {
  currentExecutionWorkspace: { cwd: WORKSPACE },
  executionPolicy: { ctb: { changeClass: "ctb", projectRoots: [WORKSPACE], changeIntents: ["hardening"], acceptanceCriteria: ["tests pass"] } },
};
assert.equal(evaluateIssueCtbPolicy(issueWithPolicy, path.join(WORKSPACE, "src"), "hardening", "tests pass"), null);
assert.equal(evaluateIssueCtbPolicy(issueWithPolicy, WORKSPACE, "wrong-intent", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy(issueWithPolicy, WORKSPACE, "hardening", "wrong-criteria"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy(issueWithPolicy, "C:\\elsewhere", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
// Malformed EXPLICIT policy fails closed instead of widening authorization.
assert.equal(evaluateIssueCtbPolicy({ currentExecutionWorkspace: { cwd: WORKSPACE }, metadata: { ctb: { changeClass: "ctb" } } }, WORKSPACE, "a", "b"), "CTB_POLICY_INVALID");
assert.equal(evaluateIssueCtbPolicy({ currentExecutionWorkspace: { cwd: WORKSPACE }, executionPolicy: { ctb: { changeClass: "ctb", projectRoots: WORKSPACE, changeIntents: [], acceptanceCriteria: [] } } }, WORKSPACE, "a", "b"), "CTB_POLICY_INVALID");
// Missing policy configuration still falls back to plain workspace containment.
assert.equal(evaluateIssueCtbPolicy({ currentExecutionWorkspace: { cwd: WORKSPACE }, metadata: {} }, WORKSPACE, "a", "b"), null);

// Path-escape regressions (fail closed).
// Sibling-prefix directory must never match the workspace prefix.
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, "C:\\paperclip-worktrees-evil\\x", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy(issueWithPolicy, "C:\\paperclip-worktrees-evil\\x", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
// Parent traversal via `..` escapes the workspace.
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, path.join(WORKSPACE, "..", "sibling-issue"), "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
// Other volume and UNC paths are denied.
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, "D:\\paperclip-worktrees\\KOMAA-126", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
assert.equal(evaluateIssueCtbPolicy(issueNoPolicy, "\\\\evil\\share\\KOMAA-126", "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");

// Junction/reparse-point escape (fully synthetic workspace): a link inside the workspace
// pointing outside is denied; a link pointing back inside stays authorized.
const tempBase = fs.mkdtempSync(path.join(process.env.TEMP || ".", "ctb-policy-"));
try {
  const ws = path.join(tempBase, "ws");
  const insideDir = path.join(ws, "inside-junction-target");
  fs.mkdirSync(insideDir, { recursive: true });
  const outsideDir = path.join(tempBase, "outside");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.symlinkSync(outsideDir, path.join(ws, "escape-link"), "junction");
  fs.symlinkSync(insideDir, path.join(ws, "internal-link"), "junction");
  const issueJunction = { currentExecutionWorkspace: { cwd: ws } };
  assert.equal(evaluateIssueCtbPolicy(issueJunction, path.join(ws, "plain-sub"), "hardening", "tests pass"), null);
  assert.equal(evaluateIssueCtbPolicy(issueJunction, path.join(ws, "internal-link", "deep"), "hardening", "tests pass"), null);
  assert.equal(evaluateIssueCtbPolicy(issueJunction, path.join(ws, "escape-link"), "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
  assert.equal(evaluateIssueCtbPolicy(issueJunction, path.join(ws, "escape-link", "deeper"), "hardening", "tests pass"), "CTB_ISSUE_SCOPE_MISMATCH");
} finally {
  fs.rmSync(tempBase, { recursive: true, force: true });
}

// Canonical role -> MCP surface profile must stay valid and least-privilege.
const roleProfiles = JSON.parse(fs.readFileSync(new URL("./mcp-role-profiles.json", import.meta.url), "utf8"));
assert.ok(roleProfiles.version >= 2, "role profiles v2 with stage rules required");
const KNOWN_ROLES = new Set(["engineer", "designer", "ui-qa", "cto", "ceo", "coo", "cmo"]);
for (const [role, servers] of Object.entries(roleProfiles.profiles)) {
  assert.ok(KNOWN_ROLES.has(role), `unknown role ${role}`);
  assert.ok(Array.isArray(servers), `${role} profile must be an array`);
}
for (const role of ["ceo", "coo"]) assert.equal(roleProfiles.profiles[role].length, 0, `${role} must have no eager dev MCP`);
console.log("CTB intake and read classification: PASS");
console.log("Issue scope policy + role MCP profiles: PASS");
