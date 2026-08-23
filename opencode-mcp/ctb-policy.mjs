import fs from "node:fs";
import path from "node:path";

export const TOOL_CLASSES = Object.freeze({
  READ: "READ",
  SESSION_CONTROL: "SESSION_CONTROL",
  WRITE: "WRITE",
  PRIVILEGED_WRITE: "PRIVILEGED_WRITE",
  ADMIN: "ADMIN",
});

const READ = new Set([
  "opencode_setup", "opencode_status", "opencode_context", "opencode_conversation",
  "opencode_sessions_overview", "opencode_check", "opencode_wait", "opencode_review_changes",
  "opencode_session_list", "opencode_session_get", "opencode_session_children",
  "opencode_session_status", "opencode_session_todo", "opencode_session_diff",
  "opencode_session_search", "opencode_permission_list", "opencode_file_list",
  "opencode_file_read", "opencode_file_status", "opencode_find_file", "opencode_find_text",
  "opencode_project_list", "opencode_project_current", "opencode_config_get",
  "opencode_config_providers", "opencode_provider_list", "opencode_provider_models",
  "opencode_provider_auth", "opencode_command_list", "opencode_agent_list",
  "opencode_mcp_list", "opencode_events_poll", "opencode_path_get",
]);

const SESSION_CONTROL = new Set([
  "opencode_session_abort", "opencode_session_fork", "opencode_session_update",
  "opencode_session_share", "opencode_session_unshare", "opencode_session_revert",
  "opencode_session_unrevert", "opencode_session_permission",
]);

const ADMIN = new Set([
  "opencode_config_update", "opencode_auth_set", "opencode_auth_delete",
  "opencode_provider_auth_start", "opencode_provider_auth_callback",
  "opencode_instance_dispose", "opencode_mcp_add", "opencode_mcp_remove",
]);

const PRIVILEGED_WRITE = new Set([
  "opencode_project_init", "opencode_session_delete", "opencode_session_init",
  "opencode_command_execute", "opencode_tui_execute", "opencode_tui_start",
  "opencode_tui_stop",
]);

export function classifyTool(name) {
  if (READ.has(name)) return TOOL_CLASSES.READ;
  if (SESSION_CONTROL.has(name)) return TOOL_CLASSES.SESSION_CONTROL;
  if (ADMIN.has(name)) return TOOL_CLASSES.ADMIN;
  if (PRIVILEGED_WRITE.has(name) || name.startsWith("opencode_tui_")) return TOOL_CLASSES.PRIVILEGED_WRITE;
  return TOOL_CLASSES.WRITE;
}

export function requiredScope(toolClass) {
  if (toolClass === TOOL_CLASSES.READ) return "opencode:read";
  if (toolClass === TOOL_CLASSES.SESSION_CONTROL) return "opencode:session";
  if (toolClass === TOOL_CLASSES.ADMIN) return "opencode:admin";
  return "opencode:ctb:execute";
}

export function ctbContextError(args) {
  const ctb = args?.ctb;
  const fields = ["paperclipIssueId", "changeIntent", "scope", "acceptanceCriteria", "idempotencyKey"];
  const missing = !ctb || ctb.mode !== "EXECUTE" || ctb.changeClass !== "ctb"
    ? ["mode/changeClass"]
    : fields.filter((field) => typeof ctb[field] !== "string" || ctb[field].trim() === "");
  return missing.length ? { code: "CTB_CONTEXT_REQUIRED", missing } : null;
}

function isUnder(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function existingParent(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
    current = parent;
  }
  return fs.realpathSync.native(current);
}

export function normalizeAllowedDirectory(directory, allowedRoots) {
  if (typeof directory !== "string" || directory.trim() === "") throw Object.assign(new Error("CTB_PROJECT_REQUIRED"), { code: "CTB_PROJECT_REQUIRED" });
  if (/\0|\r|\n/.test(directory) || !path.isAbsolute(directory)) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  const resolved = path.resolve(directory);
  const allowed = allowedRoots.map((root) => fs.realpathSync.native(root));
  if (!allowed.some((root) => isUnder(resolved, root))) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  const real = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : existingParent(resolved);
  if (!allowed.some((root) => isUnder(real, root))) throw Object.assign(new Error("CTB_PROJECT_DENIED"), { code: "CTB_PROJECT_DENIED" });
  return resolved;
}

export function validateToolPathArguments(args, allowedRoots, defaultDirectory) {
  const next = { ...(args || {}) };
  const candidate = next.directory ?? defaultDirectory;
  next.directory = normalizeAllowedDirectory(candidate, allowedRoots);
  if (typeof next.path === "string" && path.isAbsolute(next.path)) {
    next.path = normalizeAllowedDirectory(next.path, allowedRoots);
  }
  return next;
}
