import fs from "node:fs";
import path from "node:path";

export const TOOL_CLASSES = Object.freeze({
  READ: "READ",
  SESSION_CONTROL: "SESSION_CONTROL",
  WRITE: "WRITE",
  PRIVILEGED_WRITE: "PRIVILEGED_WRITE",
  ADMIN: "ADMIN",
});

// Detectable policy revision surfaced through /health and every telemetry event.
export const CTB_POLICY_REVISION = "ctb-policy-4";

const byClass = Object.freeze({
  [TOOL_CLASSES.READ]: [
    "opencode_setup", "opencode_status", "opencode_health", "opencode_context", "opencode_conversation",
    "opencode_sessions_overview", "opencode_check", "opencode_wait", "opencode_review_changes",
    "opencode_session_list", "opencode_session_get", "opencode_session_children", "opencode_session_status",
    "opencode_session_todo", "opencode_session_diff", "opencode_session_search", "opencode_session_check", "opencode_permission_list",
    "opencode_file_list", "opencode_file_read", "opencode_file_status", "opencode_find_file", "opencode_find_text",
    "opencode_find_symbol", "opencode_project_list", "opencode_project_current", "opencode_config_get",
    "opencode_config_providers", "opencode_provider_list", "opencode_provider_models", "opencode_provider_auth_methods",
    "opencode_command_list", "opencode_agent_list", "opencode_mcp_status", "opencode_events_poll", "opencode_path_get",
    "opencode_vcs_info", "opencode_lsp_status", "opencode_formatter_status", "opencode_tool_ids", "opencode_tool_list",
    "opencode_message_list", "opencode_message_get", "opencode_message_model_info",
  ],
  [TOOL_CLASSES.SESSION_CONTROL]: [
    "opencode_session_abort", "opencode_session_fork", "opencode_session_update", "opencode_session_share",
    "opencode_session_unshare", "opencode_session_revert", "opencode_session_unrevert", "opencode_session_permission",
  ],
  [TOOL_CLASSES.WRITE]: [
    "opencode_ask", "opencode_reply", "opencode_run", "opencode_fire", "opencode_message_send",
    "opencode_message_send_async", "opencode_shell_execute",
    "opencode_session_create", "opencode_session_summarize", "opencode_provider_test", "opencode_log",
  ],
  [TOOL_CLASSES.PRIVILEGED_WRITE]: [
    "opencode_project_init", "opencode_session_delete", "opencode_session_init", "opencode_command_execute",
    "opencode_tui_append_prompt", "opencode_tui_submit_prompt", "opencode_tui_clear_prompt", "opencode_tui_execute_command",
    "opencode_tui_show_toast", "opencode_tui_open_help", "opencode_tui_open_sessions", "opencode_tui_open_models", "opencode_tui_open_themes",
  ],
  [TOOL_CLASSES.ADMIN]: [
    "opencode_config_update", "opencode_auth_set", "opencode_provider_oauth_authorize", "opencode_provider_oauth_callback",
    "opencode_instance_dispose", "opencode_mcp_add",
  ],
});

const toolClasses = new Map(Object.entries(byClass).flatMap(([toolClass, names]) => names.map((name) => [name, toolClass])));

// Model entrypoints may execute real inference in read-only DIAGNOSE/PLAN modes
// when forced onto the read-only "plan" agent; they stay WRITE for EXECUTE.
export const MODEL_ENTRYPOINTS = new Set(["opencode_ask", "opencode_run", "opencode_reply"]);

export function classifyTool(name) { return toolClasses.get(name) || null; }
export function requiredScope(toolClass) {
  if (toolClass === TOOL_CLASSES.READ) return "opencode:read";
  if (toolClass === TOOL_CLASSES.SESSION_CONTROL) return "opencode:session";
  if (toolClass === TOOL_CLASSES.ADMIN) return "opencode:admin";
  return "opencode:ctb:execute";
}

const redirectFor = Object.freeze({ itb: "Paperclip", rtb: "Paperclip", product: "PRODUCT_DELIVERY" });
// Prefix-rooted stems so naturally inflected Polish forms match (przycisku, produkcie, searchy).
const words = {
  itb: /\b(skill|agent|prompt|heartbeat|schedul|search|token)/i,
  rtb: /\b(runbook|inciden|outag|operacj|runtime|on-call)/i,
  product: /\b(dashboard|copy|button|przycisk|ui\b|produk|zbiork|zbiórk)/i,
  ctb: /\b(ctb|gateway|polic|correlation|persisten|telemetr|opencode|mcp)/i,
};

export function classifyIntake(args = {}, toolClass = null, name = null) {
  const ctb = args?.ctb && typeof args.ctb === "object" ? args.ctb : {};
  const text = [ctb.changeIntent, ctb.scope, ctb.acceptanceCriteria, args.prompt, args.message, args.text].filter((value) => typeof value === "string").join("\n");
  const mode = ctb.mode || (toolClass === TOOL_CLASSES.READ || toolClass === TOOL_CLASSES.SESSION_CONTROL ? "DIAGNOSE" : null);
  let changeClass = ctb.changeClass || null;
  if (!changeClass) {
    if (words.itb.test(text)) changeClass = "itb";
    else if (words.rtb.test(text)) changeClass = "rtb";
    else if (words.product.test(text)) changeClass = "product";
    else if (words.ctb.test(text)) changeClass = "ctb";
  }
  if (mode && !["DIAGNOSE", "PLAN", "EXECUTE"].includes(mode)) return { errorCode: "CTB_INTAKE_INVALID" };
  if (changeClass && !["ctb", "itb", "rtb", "product"].includes(changeClass)) return { errorCode: "CTB_INTAKE_INVALID" };
  if (changeClass && changeClass !== "ctb") return { mode: mode || "DIAGNOSE", changeClass, handoffTo: redirectFor[changeClass] };
  if ((mode === "DIAGNOSE" || mode === "PLAN") && toolClass !== TOOL_CLASSES.READ && toolClass !== TOOL_CLASSES.SESSION_CONTROL) {
    // Real model inference is permitted read-only via the plan agent.
    if (name && MODEL_ENTRYPOINTS.has(name)) return { mode, changeClass: changeClass || "ctb", modelReadOnly: true };
    return { errorCode: "CTB_READ_ONLY_MODE" };
  }
  if (toolClass === TOOL_CLASSES.READ || toolClass === TOOL_CLASSES.SESSION_CONTROL) return { mode: mode || "DIAGNOSE", changeClass: changeClass || "ctb" };
  if (!mode || !changeClass) return { mode: mode || null, changeClass: changeClass || null, errorCode: "CTB_INTAKE_REQUIRED", missing: [!mode ? "mode" : null, !changeClass ? "changeClass" : null].filter(Boolean) };
  return { mode, changeClass };
}

export function ctbContextError(args) {
  const ctb = args?.ctb;
  const fields = ["paperclipIssueId", "changeIntent", "scope", "acceptanceCriteria", "idempotencyKey"];
  const missing = !ctb || ctb.mode !== "EXECUTE" || ctb.changeClass !== "ctb" ? ["mode/changeClass"] : fields.filter((field) => typeof ctb[field] !== "string" || ctb[field].trim() === "");
  return missing.length ? { code: "CTB_EXECUTION_CONTEXT_REQUIRED", missing } : null;
}

// Legacy registry rows may lack companyId; they still participate in exactly-once lookup.
export function matchesIdempotencyRun(run, companyId, issueId, key) {
  return run && (run.companyId === companyId || run.companyId == null || run.companyId === "") && run.paperclipIssueId === issueId && run.idempotencyKey === key;
}

function samePath(left, right) { return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase(); }
function isInsidePath(candidate, root) { const relative = path.relative(path.resolve(String(root)).toLowerCase(), path.resolve(String(candidate)).toLowerCase()); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
// Resolves the deepest existing ancestor through junctions/symlinks (realpath). Returns
// null when nothing up to the filesystem root exists or cannot be resolved.
function realPathOf(candidate) { let current = path.resolve(String(candidate)); while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) return null; current = parent; } try { return fs.realpathSync.native(current); } catch { return null; } }
// Lexical containment plus junction/reparse-point containment: the candidate passes only
// when its realpath target also stays inside the scope root (or the root's own realpath,
// so a legitimately reparsed workspace root does not break authorization).
function isInsideScope(candidate, root) { if (!isInsidePath(candidate, root)) return false; const real = realPathOf(candidate); const rootReal = realPathOf(root); if (real === null || rootReal === null) return true; return isInsidePath(real, root) || isInsidePath(real, rootReal); }
// Canonical (realpath-resolved) form of a path for diagnostics; never throws — returns
// the lexical resolution when the filesystem cannot be consulted.
export function canonicalPath(candidate) {
  const lexical = path.resolve(String(candidate));
  const real = realPathOf(lexical);
  return real || lexical;
}

// Issue-scoped CTB authorization with full diagnostics. Returns:
//   { error: code|null, decisionSource: "issue_policy"|"workspace_fallback"|null,
//     canonicalDirectory, canonicalWorkspaceRoot }
// Paperclip owns workspace scope: the run directory must stay inside the issue's execution
// workspace — both lexically and through any junction / reparse-point target (an escaping
// link denies; a reparsed workspace root stays allowed). An explicit executionPolicy.ctb
// tightens this further (exact roots plus intent/criteria match); its ABSENCE falls back to
// plain workspace containment, but an explicit policy that fails validation is MALFORMED and
// must be denied (fail closed): a corrupted policy must never silently widen authorization.
export function evaluateIssueCtbPolicyDetailed(issue, directory, changeIntent, acceptanceCriteria) {
  const result = { error: null, decisionSource: null, canonicalDirectory: typeof directory === "string" ? canonicalPath(directory) : null, canonicalWorkspaceRoot: null };
  const issueRoot = issue?.currentExecutionWorkspace?.cwd;
  if (typeof issueRoot !== "string" || issueRoot.trim() === "" || typeof directory !== "string") { result.error = "CTB_ISSUE_SCOPE_MISMATCH"; return result; }
  result.canonicalWorkspaceRoot = canonicalPath(issueRoot);
  if (!isInsideScope(directory, issueRoot)) { result.error = "CTB_ISSUE_SCOPE_MISMATCH"; return result; }
  const candidate = issue?.executionPolicy?.ctb || issue?.metadata?.ctb;
  // An explicitly configured policy makes issue_policy the decision source even when it
  // turns out malformed: the denial must never silently fall back to the wider workspace.
  if (!candidate) { result.decisionSource = "workspace_fallback"; return result; }
  result.decisionSource = "issue_policy";
  const policy = candidate && candidate.changeClass === "ctb" && Array.isArray(candidate.projectRoots) && Array.isArray(candidate.changeIntents) && Array.isArray(candidate.acceptanceCriteria) ? candidate : null;
  if (!policy) { result.error = "CTB_POLICY_INVALID"; return result; }
  if (!policy.projectRoots.some((root) => isInsideScope(directory, root))) { result.error = "CTB_ISSUE_SCOPE_MISMATCH"; return result; }
  if (!policy.changeIntents.includes(changeIntent) || !policy.acceptanceCriteria.includes(acceptanceCriteria)) { result.error = "CTB_ISSUE_SCOPE_MISMATCH"; return result; }
  return result;
}

export function evaluateIssueCtbPolicy(issue, directory, changeIntent, acceptanceCriteria) {
  return evaluateIssueCtbPolicyDetailed(issue, directory, changeIntent, acceptanceCriteria).error;
}

// Secret-bearing runtime files must never be reachable through tool path arguments.
const SECRET_PATH_PATTERN = /(^|[\\/])\.runtime([\\/]|$)|(^|[\\/])\.env([\\/.]|$)|credentials\.(txt|env)$|(^|[\\/])signing\.key$|refresh-tokens\.json$|oauth-sessions\.json$|(^|[\\/])clients\.json$/i;
function assertNotSecretPath(candidate) {
  if (SECRET_PATH_PATTERN.test(candidate)) throw Object.assign(new Error("CTB_SECRET_PATH_DENIED"), { code: "CTB_SECRET_PATH_DENIED" });
}

function isUnder(candidate, root) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function existingParent(candidate) { let current = candidate; while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" }); current = parent; } return fs.realpathSync.native(current); }
export function normalizeAllowedDirectory(directory, allowedRoots) {
  if (typeof directory !== "string" || directory.trim() === "") throw Object.assign(new Error("CTB_PROJECT_REQUIRED"), { code: "CTB_PROJECT_REQUIRED" });
  if (/\0|\r|\n/.test(directory) || !path.isAbsolute(directory)) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  const resolved = path.resolve(directory); const allowed = allowedRoots.map((root) => fs.realpathSync.native(root));
  if (!allowed.some((root) => isUnder(resolved, root))) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : existingParent(resolved);
  if (!allowed.some((root) => isUnder(real, root))) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  assertNotSecretPath(real);
  return resolved;
}
export function validateToolPathArguments(args, allowedRoots, defaultDirectory) { const next = { ...(args || {}) }; next.directory = normalizeAllowedDirectory(next.directory ?? defaultDirectory, allowedRoots); if (typeof next.path === "string" && path.isAbsolute(next.path)) next.path = normalizeAllowedDirectory(next.path, allowedRoots); return next; }
