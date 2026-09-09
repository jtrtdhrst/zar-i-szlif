import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitiesForAgent } from "./ctb-capability.mjs";

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

// Server-side selection of a native OpenCode agent whose permission set hard-enforces the
// effective profile (downstream MCP grants are denied/allowed at the agent level, so the
// gateway never has to mutate global config and parallel sessions cannot race it).
// DIAGNOSE/PLAN always run on the read-only, MCP-less plan agent.
// taskClass/currentStage passed here MUST be server-derived (Paperclip issue metadata or
// execution policy). Client-supplied values are request hints only and must never reach
// this function as trusted inputs.
export function resolveCtbAgent(profile, mode = "EXECUTE") {
  if (mode !== "EXECUTE") return "ctb-plan";
  if (!profile?.known) return "ctb-executor";
  const eager = new Set(profile.eagerConnections || []);
  if (eager.has("cloudflare")) return "ctb-cto-infra";
  if (eager.has("playwright")) return "ctb-ui-qa";
  if (eager.has("shadcn") || eager.has("storybook")) return "ctb-designer";
  if (eager.has("git")) return "ctb-engineer";
  return "ctb-executor";
}

// Capability reconciliation: the invariant is that granted capabilities must equal
// executable capabilities. A single coarse native agent cannot hard-enforce arbitrary
// capability combinations (e.g. git+cloudflare), so the reconciled profile narrows the
// executable set to what the selected agent enforces and reports the remainder as
// unenforceable — the gateway then denies those capabilities at its own guard layer
// instead of silently widening the agent's real permissions.
export function reconcileProfileWithAgent(profile, mode = "EXECUTE") {
  const agent = resolveCtbAgent(profile, mode);
  const enforcedByAgent = capabilitiesForAgent(agent);
  const eager = mode === "EXECUTE" && profile?.known ? [...(profile.eagerConnections || [])] : [];
  const executableCapabilities = eager.filter((entry) => enforcedByAgent.includes(entry));
  const unenforceableCapabilities = eager.filter((entry) => !enforcedByAgent.includes(entry));
  return { agent, executableCapabilities, unenforceableCapabilities };
}

// Issue-scoped overrides may key by Paperclip UUID or human identifier; match both.
export function matchesProjectOverrideKey(candidateKey, overrideKey) {
  const left = String(candidateKey || "").toLowerCase();
  const right = String(overrideKey || "").toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

export function lookupIssueScopedOverride(doc, projectKey) {
  if (projectKey == null) return null;
  const key = String(projectKey);
  const direct = doc.issueScopedOverrides[key];
  if (direct) return { key, grant: grantList(direct) };
  for (const [candidate, grant] of Object.entries(doc.issueScopedOverrides || {})) {
    // "282dab95-...-bad0-438d13282eab" style UUIDs never suffix-match identifiers, but a
    // client passing "issue:KOMAA-126" or "komaa-126/sub" still resolves deterministically.
    if (key.toLowerCase().endsWith(`:${candidate.toLowerCase()}`) || key.toLowerCase().endsWith(`/${candidate.toLowerCase()}`)) return { key: candidate, grant: grantList(grant) };
  }
  return null;
}

// Semantics: ALLOWED != EAGER. Eager = union of the role baseline, grants from matching
// stage/taskClass rules, and issue-scoped overrides. Everything else in the catalog stays
// deferred/on-demand. Unknown principal/role/profile fails closed for dev MCP eager access.
// principal + role + project + taskClass + currentStage -> effective MCP profile.
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
  const overrideEntry = lookupIssueScopedOverride(doc, projectKey);
  if (overrideEntry) {
    for (const entry of overrideEntry.grant) eager.add(entry);
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
