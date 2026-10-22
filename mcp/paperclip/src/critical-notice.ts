// Shared CRITICAL operational notices for the Paperclip MCP tool catalogue.
//
// The tool descriptions ARE the operational interface for LLM agents: an agent
// that only sees `tools/list` must still learn where each field lives, which
// operation changes it, and which errors must never be bypassed. These strings
// are therefore part of the product contract and are referenced from the real
// registration code (tools.ts / control-plane.ts / issue-fields.ts), never only
// from a README.

export const CRITICAL_NATIVE_CONFIG_NOTICE =
  "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION. Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. Parent/subtask structure, blocker dependencies, ownership and execution state are separate concepts. Always use authorized first-class operations, preserve unrelated configuration, enforce cycle and review safety, and verify the authoritative committed result. An issue status alone does not prove that work is actually running or that review is being performed.";

/**
 * KOMAA-849: the workflow-integrity contract every issue-management tool must
 * advertise. A tool that "succeeds" is not evidence that the business
 * operation happened - only the authoritative committed state is.
 */
export const CRITICAL_WORKFLOW_INTEGRITY =
  "CRITICAL WORKFLOW INTEGRITY: Issue relationships, execution policies and review stages are persisted first-class runtime controls. Do not substitute comments, arbitrary status PATCHes, generic confirmations or prompt-only instructions. Use native operations, validate authorization, perform dry-run where available, and read back authoritative committed state after writes. Reviewers must make real first-class decisions. A configured reviewer or HTTP 200 alone does not prove a functional review path. " +
  "Field semantics: `parentId` is the structural hierarchy (a subtask is not automatically blocked by its parent); `issue_relations` type=blocks is the causal dependency that gates readiness (a blocker that is cancelled is not a satisfied blocker, and dependency readiness is not task completion); `Blocking` is the reverse projection of another issue's `Blocked by` and is never written directly; the URL/PR widget is a derived projection of the description, comments and documents, so the source record is what gets edited; reviewers and approvers are typed execution-policy stages (agent participants carry `agentId`, user participants carry `userId`) and must be independent when the review policy requires it. " +
  "A monitor is a timed/external wait on one issue; a task watchdog is a native stopped-subtree detector on a meaningful root - neither replaces the other, and neither replaces active-run silence detection, ordinary execution recovery or review-decision persistence. " +
  "`dryRun=true` only proves that the request would be well-formed and locally validated: it does NOT reserve, reserve-free, commit, wake anybody, schedule anything or change any state - a dry-run success can never satisfy a real-write acceptance criterion. ";

export const CRITICAL_UPDATE_ISSUE =
  "CRITICAL: This tool modifies authoritative issue configuration. `parentId` controls hierarchy only; `blockedByIssueIds` replaces the issue's first-class blocker set; `executionPolicy.stages` controls independent review/approval; `executionPolicy.monitor` controls scheduled waiting/recovery. Use resolved UUIDs. Never assume subtask structure implies a blocking dependency. Preserve unrelated fields and existing stages. Validate cycles, authorization, execution eligibility and reviewer independence. Read the committed state and report all server-side side effects. A 403/409/422 is not permission to bypass policy. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_CREATE_ISSUE =
  "CRITICAL: Creates an issue with complete configuration in one authorized operation. Describe how to set parent (hierarchy), blockedByIssueIds (dependency), reviewPolicy, typed executionPolicy.stages (review/approval participants) and optional watchdog configuration in the same call. Creating a task with unresolved blockers requires a coherent initial status (blocked) and must not result in an immediate unauthorized wake. Parent writes are validated fail-closed by the MCP hierarchy guard (no self-parent, no cycles, no cross-company parent). " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_GET_ISSUE =
  "CRITICAL: Inspects the authoritative issue record: `parentId` (structure), `blockedBy`/`blocks` (first-class issue_relations dependency edges), `executionPolicy` (stages/monitor), `executionState` (live stage, participant, return assignee, monitor state) and the review/monitor projections. `blockedByIssueIds` on the issue row is a denormalized projection and must not be used as dependency truth — use the `blockedBy`/`blocks` relation summaries. For full children, dependency, review and configuration inspection (watchdog, links, effective editability) use paperclipGetIssueFieldDetails, and for discovery of how to change a field use paperclipDescribeIssueFields. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_RELATIONSHIPS =
  "CRITICAL: Parent and blocker graphs are different. Never create hierarchy or dependency cycles. `Blocking` is the reverse relationship of another issue's `Blocked by`. When removing one edge, preserve all unrelated edges. Resolve issue identifiers to IDs, inspect the authoritative graph, validate and confirm the committed result. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_EXECUTION_POLICY =
  "CRITICAL: Execution stages are enforced control-plane transitions, not documentation. Persist typed reviewer/approver participants (agent participants carry `agentId`, user participants carry `userId` — never send the irrelevant identity key), preserve stage ordering and independent approval requirements. Do not directly fabricate runtime `executionState` or silently downgrade governance. Use authorized review transitions and verify current participant and live reviewer status. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_MONITOR =
  "CRITICAL: Monitors are scheduled stateful recovery mechanisms. They require a valid eligible assigned issue (assigned to an agent, status in_progress or in_review) and a real scheduled condition. Creating or clearing a monitor changes execution behavior. Use valid UTC ISO timestamps, respect native authorization and eligibility, and confirm the committed scheduled/cleared state in both executionPolicy.monitor and executionState.monitor. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_WATCHDOG =
  "CRITICAL: Task watchdogs monitor stopped issue subtrees. They are not generic cron jobs. Configuration changes may trigger immediate reevaluation and agent execution. Respect fingerprint deduplication, authorization, bounded recovery, reusable watchdog issues and independent approval boundaries. Never enable a watchdog merely for a harmless field-inspection test. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_REVIEW_STATE =
  "CRITICAL: A configured reviewer and a live reviewer are different states. Inspect the current stage, participant, approval linkage and run liveness. Never report an `in_review` issue as actively progressing merely because a participant is configured. Use authorized recovery for genuinely wedged reviews and never self-approve. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_VALIDATE_DAG =
  "CRITICAL: Scope of this validator is the DEPENDENCY graph only — first-class `issue_relations` edges of type `blocks` (read from /diagnostics/subtree and /diagnostics/blockers). The parent hierarchy graph (`issues.parentId`) is a SEPARATE graph with separate invariants; a clean dependency result does NOT prove the hierarchy is acyclic. The `hierarchy` section of the response reports the independently computed parent-chain result and its scope. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;

export const CRITICAL_API_REQUEST =
  "CRITICAL: Generic API mutations obey the same security checks as the typed MCP operations. The MCP gateway validates parent-hierarchy writes (no self-parent, no hierarchy cycle, no cross-company parent) on every issue write that carries `parentId`, including PATCH /issues/{id}, POST /companies/{id}/issues and bulk updates — a raw route cannot bypass the hierarchy guard. Do not use the raw route to work around a typed tool: prefer the typed operation (paperclipManageIssueRelationships / paperclipManageIssueExecutionPolicy / paperclipManageIssueMonitor / paperclipManageIssueWatchdog / paperclipManageIssueLinks) so the mutation semantics, dryRun and read-back are enforced. Verified native watchdog routes: GET/PUT/DELETE /issues/{id}/watchdog. " +
  CRITICAL_NATIVE_CONFIG_NOTICE + " " + CRITICAL_WORKFLOW_INTEGRITY;
