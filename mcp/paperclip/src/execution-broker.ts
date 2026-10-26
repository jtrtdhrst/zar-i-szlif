// PAPERCLIP MCP — execution broker + capability registry (MCP layer only, no Core change).
//
// Single shared resolver for: which execution mode a tool call uses, which
// upstream credential/route it takes, what context it requires, and whether the
// capability is supported at all. Previously this logic was split across
// client.ts (ROUTE_PERMISSION_MATRIX + AGENT_ISSUE_RUN_MATRIX), workspace-native.ts
// (authorizeWorkspaceMutation) and effective-access.ts (needsRun/policyFor).
// Former duplicated copies drifted (e.g.
// Upsert/Restore/Link/Unlink had NO local run gate while PATCH/COMMENTS did).
//
// This module is the canonical registry. client.ts keeps its matrices (source of
// truth for fetch-time enforcement) but the matrices MUST match the table below;
// a vitest regression (execution-broker.test.ts) asserts parity. effective-access.ts
// and gateway projection consume this registry for honest capability reporting.

import { CONTROL_PLANE_TOOL_NAMES } from "./control-plane.js";
import { WORKSPACE_NATIVE_TOOL_NAMES } from "./workspace-native.js";
import { P1_GIT_TOOL_NAMES } from "./p1-git.js";
import { P1_PLATFORM_TOOL_NAMES } from "./p1-platform.js";
import { ISSUE_FIELD_TOOL_NAMES } from "./issue-fields.js";

export type ExecutionPrincipal =
  | { kind: "user"; userId: string; companyId: string; delegatedScopes: string[] }
  | { kind: "agent"; agentId: string; companyId: string; issueId?: string; runId?: string }
  | { kind: "host"; principalId: string; companyId: string; approvedCapabilities: string[] };

export type ExecutionMode = "direct" | "issue_run" | "host_supervisor";

export interface ExecutionPlan {
  toolName: string;
  requiredCapability: string;
  upstreamRoute: string;
  executionMode: ExecutionMode;
  requiresRun: boolean;
  requiresWorkspace: boolean;
  requiresHostPolicy: boolean;
  requiresBoard: boolean;
  supported: boolean;
  unsupportedReason?: string;
  idempotencyKey?: string;
  correlationId: string;
}

export interface ToolCapability {
  name: string;
  upstreamCapability: string;
  upstreamRoute: string;
  supportedExecutionModes: ExecutionMode[];
  requiresRun: boolean;
  requiresWorkspace: boolean;
  requiresHostPolicy: boolean;
  requiresBoard: boolean;
  supported: boolean;
  unsupportedReason?: string;
  sideEffectClass: "read" | "write" | "destructive";
  verificationStrategy: "readback" | "dryrun" | "probe" | "none";
}

// Canonical upstream routes for the 21 context-gated tools (+ review/board set).
// Used for capability reporting and parity tests — NOT a second enforcement path
// (enforcement stays in client.ts / workspace-native.ts).
const ROUTES: Record<string, { route: string; mode: ExecutionMode; run: boolean; ws: boolean; host: boolean; board: boolean; side: ToolCapability["sideEffectClass"] }> = {
  paperclipCreateIssue: { route: "POST /companies/:id/issues", mode: "direct", run: false, ws: false, host: false, board: false, side: "write" },
  paperclipUpdateIssue: { route: "PATCH /issues/:id", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipCheckoutIssue: { route: "POST /issues/:id/checkout", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipReleaseIssue: { route: "POST /issues/:id/release", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipAddComment: { route: "POST /issues/:id/comments", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipUpsertIssueDocument: { route: "PUT /issues/:id/documents/:key", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipRestoreIssueDocumentRevision: { route: "POST /issues/:id/documents/:key/revisions/:rev/restore", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipLinkIssueApproval: { route: "POST /issues/:id/approvals", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipUnlinkIssueApproval: { route: "DELETE /issues/:id/approvals/:approvalId", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipBulkUpdateIssues: { route: "PATCH /issues/:id (loop)", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipWorkspacePatchFile: { route: "local workspace-fs tmp+rename", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipWorkspaceExec: { route: "local jailed exec", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipWorkspaceApplyUnifiedDiff: { route: "local unified-diff apply", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipWorkspaceBatchChange: { route: "local journaled batch", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipWorkspaceRunChecks: { route: "local checks (typecheck/lint/test)", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipGitCreateBranch: { route: "local git + workspace scope", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipGitCommit: { route: "local git commit", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipGitPush: { route: "local git push origin-only", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipGitCreatePR: { route: "local gh pr create", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipGitMergePR: { route: "local gh pr merge", mode: "issue_run", run: true, ws: true, host: false, board: false, side: "write" },
  paperclipSubmitReviewDecision: { route: "POST /approvals/:id/{approve|reject|request-revision} | POST /issues/:id/stalled-review-decision", mode: "direct", run: false, ws: false, host: false, board: true, side: "write" },
  paperclipRequestReview: { route: "PATCH /issues/:id {status:in_review}", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipResolveReviewWedge: { route: "POST /issues/:id/stalled-review-decision (+ pre-reads)", mode: "direct", run: false, ws: false, host: false, board: true, side: "write" },
  paperclipAcceptInteraction: { route: "POST /issues/:id/interactions/:iid/accept", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipRejectInteraction: { route: "POST /issues/:id/interactions/:iid/reject", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipCancelIssueInteraction: { route: "POST /issues/:id/interactions/:iid/cancel", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipApprovalDecision: { route: "POST /approvals/:id/{approve|reject|request-revision|resubmit}", mode: "direct", run: false, ws: false, host: false, board: true, side: "write" },
  // P0 2026-10-20: complete issue field management (Relationships + Execution).
  paperclipGetIssueFieldDetails: { route: "GET /issues/:id (+ diagnostics/blockers, watchdog, external-objects)", mode: "direct", run: false, ws: false, host: false, board: false, side: "read" },
  paperclipDescribeIssueFields: { route: "GET /issues/:id + local capability catalog", mode: "direct", run: false, ws: false, host: false, board: false, side: "read" },
  paperclipManageIssueRelationships: { route: "PATCH /issues/:id | POST /issues/:id/children | GET /companies/:id/issues", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipManageIssueExecutionPolicy: { route: "PATCH /issues/:id {reviewPolicy,executionPolicy}", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipManageIssueMonitor: { route: "PATCH /issues/:id {executionPolicy.monitor}", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipManageIssueWatchdog: { route: "GET|PUT|DELETE /issues/:id/watchdog", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
  paperclipManageIssueLinks: { route: "POST /issues/:id/comments | PATCH /issues/:id | DELETE /issues/:id/comments/:commentId | POST /issues/:id/external-objects/refresh", mode: "issue_run", run: true, ws: false, host: false, board: false, side: "write" },
};

export function toolCapability(name: string): ToolCapability {
  const r = ROUTES[name];
  if (r) {
    return {
      name,
      upstreamCapability: r.route,
      upstreamRoute: r.route,
      supportedExecutionModes: r.mode === "direct" ? ["direct"] : r.mode === "host_supervisor" ? ["host_supervisor"] : ["issue_run", "direct"],
      requiresRun: r.run,
      requiresWorkspace: r.ws,
      requiresHostPolicy: r.host,
      requiresBoard: r.board,
      supported: true,
      sideEffectClass: r.side,
      verificationStrategy: r.side === "read" ? "probe" : r.host ? "dryrun" : "readback",
    };
  }
  // Generic fallback: reads are direct+probe, unknown mutations need a run.
  const isRead = /^(paperclip(Get|List|Me|Inbox|Heartbeat|Skill|Catalog|Verify|Denial|Effective|Capabilities|Status|Topology|Checks|MergeReadiness|ReviewState|PendingReviews|Plan|Query))/i.test(name) ||
    /List|Get|Search|Me|Inbox|Capabilities|EffectivePolicy|Status|Topology|Checks|Readiness|State|Health/i.test(name);
  return {
    name,
    upstreamCapability: "generic Paperclip API route",
    upstreamRoute: "see handler",
    supportedExecutionModes: ["direct"],
    requiresRun: false,
    requiresWorkspace: /^(paperclip(Workspace|Git))/.test(name),
    requiresHostPolicy: false,
    requiresBoard: false,
    supported: !name.startsWith("paperclipHost"),
    unsupportedReason: name.startsWith("paperclipHost") ? "retired tool; release through Coolify" : undefined,
    sideEffectClass: isRead ? "read" : "write",
    verificationStrategy: isRead ? "probe" : "readback",
  };
}

export function isUnsupportedCapability(name: string, operation?: string): boolean {
  if (!operation) return false;
  return name.startsWith("paperclipHost") || operation.startsWith("host.");
}

export function resolveExecutionPlan(toolName: string, principal: ExecutionPrincipal, correlationId: string): ExecutionPlan {
  const cap = toolCapability(toolName);
  const mode: ExecutionMode =
    cap.requiresHostPolicy ? "host_supervisor" : cap.requiresRun ? "issue_run" : "direct";
  return {
    toolName,
    requiredCapability: cap.upstreamCapability,
    upstreamRoute: cap.upstreamRoute,
    executionMode: mode,
    requiresRun: cap.requiresRun,
    requiresWorkspace: cap.requiresWorkspace,
    requiresHostPolicy: cap.requiresHostPolicy,
    requiresBoard: cap.requiresBoard,
    supported: cap.supported,
    unsupportedReason: cap.unsupportedReason,
    correlationId,
  };
}

// --- Provider-facing tool projection (128-tool fix) ---
// Full registry stays at 200. Profiles return subsets that fit model limits.
// Canonical counts (verified 2026-10-19, live gateway log): full=200,
// minimal=98, agent=116, board=125. Profiles are curated sets so counts stay
// stable as the registry grows; exact bounds asserted in
// execution-broker.test.ts (minimal<=128, agent<=128, board<=128, full=200,
// with minimal<agent<board<full). The minimal set is the read-only discovery
// set (98 entries) - it never claimed to fit in 64.
export type ToolProfile = "minimal" | "agent" | "board" | "full";

// Control-plane subset an issue executor actually needs in context (of 94).
const AGENT_CP_SUBSET: readonly string[] = [
  "paperclipBulkUpdateIssues",
  "paperclipGetReviewState",
  "paperclipRequestReview",
  "paperclipListPendingReviews",
  "paperclipListRuns",
  "paperclipListLiveRuns",
  "paperclipGetExecutionEligibility",
  "paperclipWakeIssueFresh",
  "paperclipRetryIssueFresh",
  "paperclipReconcileBlockedIssue",
  "paperclipUnblockAndWake",
  "paperclipGetRunEvents",
  "paperclipTailRunLog",
  "paperclipGetRunTranscript",
  "paperclipGetAgentEffectiveConfig",
  "paperclipGetAgentInstructions",
  "paperclipGetAgentSkillSet",
  "paperclipGetDeliveryLineage",
  "paperclipGetExecutionState",
  "paperclipListRecoveryActions",
  "paperclipResolveRecoveryAction",
  "paperclipExplainForbidden",
  "paperclipGetServerInfo",
  "paperclipGetSystemHealth",
];

// Base skills/wiki/goal mutations stay out of the agent working set (board/full).
// P0 2026-10-20: the wiki authoring, skill audit, host deployment plan and
// delivery-unit saga tools are operator/knowledge-base actions as well - they
// stay out of the agent profile so the board profile (agent + board-only)
// keeps fitting the 128-tool provider cap after the issue-field tools were
// added. The full registry still exposes every tool.
const AGENT_EXCLUDE_RE =
  /^(paperclip(CreateSkill|UpdateSkill|DeleteSkill|InstallCatalogSkill|InstallSkillUpdate|UpdateSkillFile|CreateRoutine|UpdateRoutine|RunRoutineNow|UpdateGoal|DetachGoal|UpdateFeatureFlag|ApplyControlPlaneRepair|RepairControlPlane|RunDeliveryCycle|PlanControlPlaneRepair|HostApplyDeployment|ApiRequest|WikiProposeChange|WikiApplyChange|WikiCreatePage|AuditSkill|HostPlanDeployment|ExecuteDeliveryUnit))/;

const BOARD_ONLY_RE = /ChatMessage|NewChatSession|AgentChat/i;

// Minimal = strict read-only discovery set (must stay well under 128).
const MINIMAL_READ_RE =
  /^(paperclip(Get|List|Search|Me|Inbox|Heartbeat|Tail|Validate|Explain))/;
const MINIMAL_WRITE_RE =
  /Decision|Resolve|ChatMessage|NewChatSession|AgentChat|UpdateSkillFile|DeleteSkill|Install/i;
// Non-Get/List reads that belong in the minimal discovery set.
const MINIMAL_KEEP = new Set([
  "paperclipGitAuthStatus", "paperclipGitGetRemoteTopology", "paperclipGitWaitChecks",
  "paperclipGitStatus", "paperclipGitDiff", "paperclipGitGetChecks", "paperclipGitGetMergeReadiness",
  "paperclipWorkspaceListFiles", "paperclipWorkspaceReadFile",
  "paperclipWikiList", "paperclipWikiSearch", "paperclipWikiGetPage",
  "paperclipVerifyAgentTool", "paperclipGetToolDenial",
  "paperclipVerifyLiveMCP", "paperclipMCPRunSmokeTest", "paperclipGetAgentEffectiveTools",
]);

function isReadTool(name: string): boolean {
  if (MINIMAL_KEEP.has(name)) return true;
  if (BOARD_ONLY_RE.test(name)) return false;
  return MINIMAL_READ_RE.test(name) && !MINIMAL_WRITE_RE.test(name);
}

export function profileToolNames(profile: ToolProfile, all: string[]): string[] {
  if (profile === "full") return [...all];
  if (profile === "minimal") return all.filter((n) => isReadTool(n) && !BOARD_ONLY_RE.test(n));
  if (profile === "agent") {
    // Curated executor working set: base (minus admin muts and board chats),
    // curated control-plane subset, full workspace/git/delivery, discovery.
    const cp = new Set(AGENT_CP_SUBSET);
    return all.filter((n) => {
      if (BOARD_ONLY_RE.test(n)) return false;
      if (AGENT_EXCLUDE_RE.test(n)) return false;
      if (CONTROL_PLANE_TOOL_NAMES.includes(n)) return cp.has(n);
      return true;
    });
  }
  // board: agent set + board-only chats + host intents + review decisions.
  // Skills/admin mutations stay in full (board can discover them via
  // paperclipGetAgentEffectiveTools namespaces) so the board profile fits 128.
  const agent = new Set(profileToolNames("agent", all));
  for (const n of all) {
    if (BOARD_ONLY_RE.test(n)) agent.add(n);
    if (/ApprovalDecision|SubmitReviewDecision|ResolveReviewWedge/.test(n)) agent.add(n);
  }
  return [...agent];
}

export function filterByProfile(profile: ToolProfile, all: string[], extra?: { include?: string[]; exclude?: string[] }): string[] {
  let names = profileToolNames(profile, all);
  if (extra?.include?.length) {
    const set = new Set(names);
    for (const n of extra.include) if (all.includes(n)) set.add(n);
    names = [...set];
  }
  if (extra?.exclude?.length) {
    const ex = new Set(extra.exclude);
    names = names.filter((n) => !ex.has(n));
  }
  return names;
}

// Namespaces for capability-based discovery (no unrestricted generic exec).
export const TOOL_NAMESPACES: Record<string, RegExp> = {
  issue: /^paperclip(Issue|ListIssues|GetIssue|Heartbeat|Comment|Document|Approval|Review|Interaction|Task|Question|Confirmation|Bulk)/,
  workspace: /^paperclipWorkspace/,
  git: /^paperclipGit/,
  review: /^paperclip.*(Review|Approval|Interaction)/,
  catalog: /^paperclip.*(Skill|Catalog|Wiki)/,
  access: /^paperclip(GetAgentEffective|VerifyAgent|GetToolDenial|VerifyLive|MCPRunSmoke)/,
};

export function namespaceToolNames(ns: string, all: string[]): string[] {
  const re = TOOL_NAMESPACES[ns];
  if (!re) return [];
  return all.filter((n) => re.test(n));
}

// Re-exported aggregates so gateway/projection and tests share one import.
export { CONTROL_PLANE_TOOL_NAMES, WORKSPACE_NATIVE_TOOL_NAMES, P1_GIT_TOOL_NAMES, P1_PLATFORM_TOOL_NAMES, ISSUE_FIELD_TOOL_NAMES };

