import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Full dev-MCP catalog used to derive the deferred (on-demand) surface. Anything not
// eagerly connected stays available as task-scoped/on-demand where policy permits.
export const KNOWN_DEV_MCP = Object.freeze(["git", "shadcn", "storybook", "playwright", "cloudflare", "sender"]);

export function loadMcpRoleProfiles(file = path.join(here, "mcp-role-profiles.json")) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    version: doc.version,
    revision: `mcp-role-profiles-${doc.version}`,
    profiles: doc.profiles || {},
    stageRules: doc.stageRules || {},
    issueScopedOverrides: doc.issueScopedOverrides || {},
    notes: doc.notes || {},
  };
}

// Role resolution accepts ONLY the configured mapping of authenticated principals.
// A role name supplied by the model/client is never trusted.
export function resolvePrincipalRole(principalId, principalRoles) {
  const key = String(principalId ?? "").toLowerCase();
  if (!key) return null;
  for (const [candidate, role] of Object.entries(principalRoles || {})) {
    if (candidate.toLowerCase() === key) return role;
  }
  return null;
}

function matches(rule, { taskClass, currentStage }) {
  if (Array.isArray(rule.matchStages) && rule.matchStages.some((stage) => currentStage.includes(stage))) return true;
  if (Array.isArray(rule.matchTaskClasses) && rule.matchTaskClasses.some((cls) => taskClass.includes(cls))) return true;
  return false;
}

function grantList(value) { return Array.isArray(value) ? value.filter((entry) => KNOWN_DEV_MCP.includes(entry)) : []; }

// principal + role + project + taskClass + currentStage -> effective MCP profile.
// Semantics: ALLOWED != EAGER. Eager = union of the role baseline, grants from matching
// stage/taskClass rules, and issue-scoped overrides. Everything else in the catalog stays
// deferred/on-demand. Unknown principal/role/profile fails closed for dev MCP eager access.
export function resolveEffectiveProfile({ principalId = null, role = null, taskClass = "", currentStage = "", projectKey = null } = {}, doc, principalRoles) {
  const cls = String(taskClass || "").toLowerCase();
  const stage = String(currentStage || "").toLowerCase();
  const resolvedRole = role && doc.profiles[role] ? role : resolvePrincipalRole(principalId, principalRoles);
  if (!resolvedRole || !doc.profiles[resolvedRole]) {
    return { resolvedRole: resolvedRole || "unknown", known: false, eagerConnections: [], deferredConnections: [...KNOWN_DEV_MCP], eagerConnectionCount: 0, source: "fail_closed_unknown_principal_or_role" };
  }
  const eager = new Set(grantList(doc.profiles[resolvedRole]));
  let source = Object.keys(doc.profiles[resolvedRole] || {}).length || eager.size ? "role_baseline" : "role_baseline";
  const rules = doc.stageRules?.[resolvedRole] || [];
  let ruleMatched = false;
  for (const rule of rules) {
    if (!matches(rule, { taskClass: cls, currentStage: stage })) continue;
    ruleMatched = true;
    for (const entry of grantList(rule.grant)) eager.add(entry);
  }
  if (ruleMatched) source = "role_stage_rules";
  const overrideKey = projectKey != null ? String(projectKey) : null;
  const override = overrideKey && doc.issueScopedOverrides[overrideKey];
  if (override) {
    for (const entry of grantList(override)) eager.add(entry);
    source = ruleMatched ? "role_stage_rules+issue_override" : "role_baseline+issue_override";
  }
  const eagerConnections = [...eager].sort();
  return {
    resolvedRole,
    known: true,
    eagerConnections,
    deferredConnections: KNOWN_DEV_MCP.filter((entry) => !eager.has(entry)),
    eagerConnectionCount: eagerConnections.length,
    source,
  };
}
