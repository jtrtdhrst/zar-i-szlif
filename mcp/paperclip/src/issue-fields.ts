// Paperclip MCP — complete issue field management (MCP layer only, no Paperclip Core change).
//
// Covers the issue fields rendered by the Paperclip UI under "Relationships"
// and "Execution" with a real authorized read/write path:
//   Relationships: Parent, Blocked by, Blocking, Subtasks, URL
//   Execution: Approvals policy, Reviewers, Approvers, Current execution,
//               Monitor, Watchdog
//
// Design rules honoured here:
//   * derived fields are reported as derived - they are never faked by writing
//     a lookalike column;
//   * every mutation is a read-modify-write against the AUTHORITATIVE value
//     (issue_relations for blockers, issues.parentId for hierarchy) so unrelated
//     configuration is never erased;
//   * omitted = preserve, explicit null = clear, empty array = remove all,
//     add/remove = membership change, replace = full set;
//   * every write returns the committed state read back from the server - a
//     receipt is never invented.

import { z } from "zod";
import { PaperclipApiError, type PaperclipApiClient } from "./client.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { validateParentHierarchy } from "./issue-hierarchy.js";
import {
  CRITICAL_EXECUTION_POLICY,
  CRITICAL_MONITOR,
  CRITICAL_RELATIONSHIPS,
  CRITICAL_WATCHDOG,
  CRITICAL_WORKFLOW_INTEGRITY,
} from "./critical-notice.js";

export interface IssueFieldToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): IssueFieldToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

const issueIdSchema = z.string().min(1);
const runIdOptional = z.string().guid().optional().nullable();
const operatorRunIdOptional = z.string().guid().optional().nullable();
const dryRunDefault = z.boolean().optional().default(false);

function enc(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function notFound(what: string): Error {
  return new Error(`${what} not found [errorCode=NOT_FOUND]`);
}

function invalid(message: string): Error {
  return new Error(`${message} [errorCode=INVALID_ARGUMENTS]`);
}

async function readIssue(client: PaperclipApiClient, ref: string): Promise<Record<string, unknown> | null> {
  try {
    const row = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(ref)}`);
    return isRecord(row) ? row : null;
  } catch (err) {
    if (err instanceof PaperclipApiError && err.status === 404) return null;
    throw err;
  }
}

async function requireIssue(client: PaperclipApiClient, ref: string): Promise<Record<string, unknown>> {
  const row = await readIssue(client, ref);
  if (!row || typeof row.id !== "string") throw notFound(`Issue ${ref}`);
  return row;
}

/** Resolve an issue reference (UUID or identifier such as KOMAA-992) to its UUID. */
async function resolveIssueId(client: PaperclipApiClient, ref: string): Promise<string> {
  const row = await readIssue(client, ref);
  if (!row || typeof row.id !== "string") throw notFound(`Issue ${ref}`);
  return row.id;
}

function summarizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: str(row.id),
    identifier: str(row.identifier),
    title: str(row.title),
    status: str(row.status),
    parentId: str(row.parentId),
    assigneeAgentId: str(row.assigneeAgentId),
    assigneeUserId: str(row.assigneeUserId),
  };
}

function relationSummaries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((r) => ({
    id: str(r.id),
    identifier: str(r.identifier),
    title: str(r.title),
    status: str(r.status),
    assigneeAgentId: str(r.assigneeAgentId),
    assigneeUserId: str(r.assigneeUserId),
  }));
}

/** Authoritative first-class blocker set (issue_relations), never the projection. */
async function authoritativeBlockerIds(client: PaperclipApiClient, issueId: string): Promise<{ ids: string[]; source: string; unavailable: boolean }> {
  const diag = await client.getJsonOrNull<Record<string, unknown>>(`/issues/${enc(issueId)}/diagnostics/blockers`);
  if (isRecord(diag) && Array.isArray(diag.blockers)) {
    const ids = diag.blockers
      .filter(isRecord)
      .map((b) => str(b.id))
      .filter((v): v is string => Boolean(v));
    return { ids: [...new Set(ids)], source: "issue_relations (diagnostics/blockers)", unavailable: false };
  }
  const issue = await readIssue(client, issueId);
  const ids = relationSummaries(issue?.blockedBy)
    .map((b) => str(b.id))
    .filter((v): v is string => Boolean(v));
  return { ids: [...new Set(ids)], source: "issue_relations (issue relation summaries)", unavailable: false };
}

async function listChildren(
  client: PaperclipApiClient,
  parentUuid: string,
  limit: number,
  offset = 0,
): Promise<Record<string, unknown>[]> {
  const companyId = client.resolveCompanyId();
  const params = new URLSearchParams({ parentId: parentUuid, limit: String(limit), offset: String(offset) });
  const rows = await client.requestJson<unknown>("GET", `/companies/${enc(companyId)}/issues?${params.toString()}`);
  const list = Array.isArray(rows) ? rows : isRecord(rows) && Array.isArray(rows.issues) ? rows.issues : [];
  return list.filter(isRecord);
}

async function listDescendants(
  client: PaperclipApiClient,
  rootUuid: string,
  limit: number,
  maxDepth = 10,
): Promise<{ descendants: Record<string, unknown>[]; truncated: boolean; maxDepthReached: boolean }> {
  const descendants: Record<string, unknown>[] = [];
  let truncated = false;
  let maxDepthReached = false;
  let frontier = [rootUuid];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const parentUuid of frontier) {
      const children = await listChildren(client, parentUuid, 100, 0);
      for (const child of children) {
        if (descendants.length >= limit) {
          truncated = true;
          break;
        }
        descendants.push(child);
        const id = str(child.id);
        if (id) next.push(id);
      }
      if (truncated) break;
    }
    if (truncated) break;
    if (next.length === 0) break;
    if (depth === maxDepth - 1) maxDepthReached = true;
    frontier = next;
  }
  return { descendants, truncated, maxDepthReached };
}

function monitorView(issue: Record<string, unknown>, policy: Record<string, unknown> | null, state: Record<string, unknown> | null) {
  const policyMonitor = isRecord(policy?.monitor) ? policy.monitor : null;
  const stateMonitor = isRecord(state?.monitor) ? state.monitor : null;
  return {
    policy: policyMonitor,
    nextCheckAt: str(issue.monitorNextCheckAt) ?? str(policyMonitor?.nextCheckAt),
    lastTriggeredAt: str(issue.monitorLastTriggeredAt) ?? str(stateMonitor?.lastTriggeredAt),
    attemptCount: num(issue.monitorAttemptCount) ?? num(stateMonitor?.attemptCount) ?? 0,
    notes: str(issue.monitorNotes) ?? str(policyMonitor?.notes) ?? str(stateMonitor?.notes),
    scheduledBy: str(issue.monitorScheduledBy) ?? str(policyMonitor?.scheduledBy) ?? str(stateMonitor?.scheduledBy),
    kind: str(policyMonitor?.kind) ?? str(stateMonitor?.kind),
    serviceName: str(policyMonitor?.serviceName) ?? str(stateMonitor?.serviceName),
    externalRef: str(policyMonitor?.externalRef) ?? str(stateMonitor?.externalRef),
    timeoutAt: str(policyMonitor?.timeoutAt) ?? str(stateMonitor?.timeoutAt),
    maxAttempts: num(policyMonitor?.maxAttempts) ?? num(stateMonitor?.maxAttempts),
    recoveryPolicy: str(policyMonitor?.recoveryPolicy) ?? str(stateMonitor?.recoveryPolicy),
    state: stateMonitor,
    scheduled: Boolean(policyMonitor) || Boolean(issue.monitorNextCheckAt),
  };
}

function stageView(policy: Record<string, unknown> | null) {
  const stages = Array.isArray(policy?.stages) ? policy.stages.filter(isRecord) : [];
  return stages.map((stage, index) => ({
    index,
    id: str(stage.id),
    type: str(stage.type),
    approvalsNeeded: num(stage.approvalsNeeded) ?? 1,
    participants: (Array.isArray(stage.participants) ? stage.participants : []).filter(isRecord).map((p) =>
      str(p.type) === "user"
        ? { type: "user", id: str(p.id), userId: str(p.userId) }
        : { type: "agent", id: str(p.id), agentId: str(p.agentId) },
    ),
  }));
}

/** Stable identity key of a stage participant (never the generated id). */
function participantIdentity(participant: Record<string, unknown>): string {
  return str(participant.type) === "user"
    ? `user:${str(participant.userId) ?? ""}`
    : `agent:${str(participant.agentId) ?? ""}`;
}

/** Stable identity key of a stage, used to match a rewritten stage to the stored one. */
function stageIdentity(stage: Record<string, unknown>): string {
  const participants = (Array.isArray(stage.participants) ? stage.participants : []).filter(isRecord);
  return [
    str(stage.type) ?? "",
    participants.map(participantIdentity).join(","),
  ].join("|");
}

/**
 * Serialize a stage for the write path. The backend schema is
 * `id?: guid`, `type`, `approvalsNeeded: 1`, `participants: [{id?: guid, type, agentId|userId}]`
 * - an explicit `id: null` or a participant without its identity key is
 * rejected, so the payload is rebuilt instead of forwarded as-is.
 *
 * KOMAA-849 (MCP layer only, no Core change): the participant `id` MUST be
 * preserved when the caller did not supply one. Paperclip Core
 * (`normalizeIssueExecutionPolicy`) keeps `participant.id ?? randomUUID()`, so
 * dropping the id made every policy write regenerate participant uuids. That
 * churned the persisted reviewer identity, made the stored
 * `executionState.currentStageId` unresolvable against the rewritten policy
 * (which silently clears a live review cycle) and re-armed the reviewer wake.
 */
function stageForWrite(stage: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: stage.type,
    approvalsNeeded: num(stage.approvalsNeeded) ?? 1,
    participants: (Array.isArray(stage.participants) ? stage.participants : []).filter(isRecord).map((p) => {
      const participant: Record<string, unknown> =
        str(p.type) === "user"
          ? { type: "user", userId: str(p.userId) }
          : { type: "agent", agentId: str(p.agentId) };
      if (typeof p.id === "string" && p.id.length > 0) participant.id = p.id;
      return participant;
    }),
  };
  if (typeof stage.id === "string" && stage.id.length > 0) out.id = stage.id;
  for (const participant of out.participants as Array<Record<string, unknown>>) {
    if (participant.type === "user" && !participant.userId) {
      throw invalid("Execution stage participant of type user requires a userId");
    }
    if (participant.type === "agent" && !participant.agentId) {
      throw invalid("Execution stage participant of type agent requires an agentId");
    }
  }
  return out;
}

/**
 * KOMAA-849 (MCP layer only, no Core change): keep the identity of unchanged
 * stages and participants when a policy is rewritten. The caller may hand back
 * a stage list that was re-serialized without ids; the stored stage/participant
 * ids are then re-attached by identity so an unrelated edit (add/remove one
 * stage) never regenerates the uuids of the stages it did not touch.
 */
function preserveStageIdentity(
  currentStages: Array<Record<string, unknown>>,
  nextStages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const used = new Set<number>();
  return nextStages.map((stage) => {
    const stageId = str(stage.id);
    const participants = (Array.isArray(stage.participants) ? stage.participants : []).filter(isRecord);
    let matchIndex = -1;
    if (stageId) {
      matchIndex = currentStages.findIndex((c, index) => !used.has(index) && str(c.id) === stageId);
    }
    if (matchIndex < 0) {
      const identity = stageIdentity(stage);
      matchIndex = currentStages.findIndex((c, index) => !used.has(index) && stageIdentity(c) === identity);
    }
    if (matchIndex < 0) return stage;
    used.add(matchIndex);
    const current = currentStages[matchIndex];
    const currentParticipants = (Array.isArray(current.participants) ? current.participants : []).filter(isRecord);
    const merged = { ...stage };
    if (!str(merged.id) && str(current.id)) merged.id = str(current.id);
    merged.participants = participants.map((participant) => {
      const next = { ...participant };
      if (str(next.id)) return next;
      const identity = participantIdentity(participant);
      const match = currentParticipants.find((c) => participantIdentity(c) === identity);
      if (match && str(match.id)) next.id = str(match.id);
      return next;
    });
    return merged;
  });
}

/** KOMAA-849: canonical comparison of two monitor policies. */
function canonicalMonitor(monitor: Record<string, unknown> | null | undefined): string {
  if (!monitor) return "null";
  return JSON.stringify({
    nextCheckAt: str(monitor.nextCheckAt) ?? null,
    notes: str(monitor.notes) ?? null,
    scheduledBy: str(monitor.scheduledBy) ?? "assignee",
    kind: str(monitor.kind) ?? null,
    serviceName: str(monitor.serviceName) ?? null,
    externalRef: str(monitor.externalRef) ?? null,
    timeoutAt: str(monitor.timeoutAt) ?? null,
    maxAttempts: num(monitor.maxAttempts) ?? null,
    recoveryPolicy: str(monitor.recoveryPolicy) ?? null,
  });
}

/**
 * KOMAA-849 (MCP layer only, no Core change): canonical comparison of two
 * execution policies. Paperclip Core normalizes the stored policy
 * (`commentRequired` is always true, `approvalsNeeded` is always 1, the
 * irrelevant participant identity key is null), so a byte-wise JSON comparison
 * would report a difference for a semantically identical policy. The canonical
 * form mirrors the server normalization exactly.
 */
function canonicalPolicy(policy: Record<string, unknown> | null): string {
  const stages = (Array.isArray(policy?.stages) ? policy.stages : []).filter(isRecord).map((stage) => ({
    id: str(stage.id) ?? null,
    type: str(stage.type) ?? null,
    approvalsNeeded: 1,
    participants: (Array.isArray(stage.participants) ? stage.participants : []).filter(isRecord).map((p) => ({
      id: str(p.id) ?? null,
      type: str(p.type) ?? null,
      agentId: str(p.type) === "agent" ? str(p.agentId) ?? null : null,
      userId: str(p.type) === "user" ? str(p.userId) ?? null : null,
    })),
  }));
  const canonical: Record<string, unknown> = {
    mode: str(policy?.mode) ?? "normal",
    commentRequired: typeof policy?.commentRequired === "boolean" ? policy.commentRequired : true,
    stages,
  };
  if (policy?.monitor !== undefined && policy.monitor !== null) canonical.monitor = policy.monitor;
  if (policy?.maxReviewRounds !== undefined && policy.maxReviewRounds !== null) {
    canonical.maxReviewRounds = policy.maxReviewRounds;
  }
  if (policy?.reviewPreset !== undefined && policy.reviewPreset !== null) canonical.reviewPreset = policy.reviewPreset;
  if (policy?.authorizationPolicy !== undefined && policy.authorizationPolicy !== null) {
    canonical.authorizationPolicy = policy.authorizationPolicy;
  }
  return JSON.stringify(canonical);
}

function executionStateView(state: Record<string, unknown> | null) {
  if (!state) return null;
  return {
    status: str(state.status),
    currentStageId: str(state.currentStageId),
    currentStageIndex: num(state.currentStageIndex),
    currentStageType: str(state.currentStageType),
    currentParticipant: isRecord(state.currentParticipant)
      ? {
          type: str(state.currentParticipant.type),
          agentId: str(state.currentParticipant.agentId),
          userId: str(state.currentParticipant.userId),
        }
      : null,
    returnAssignee: isRecord(state.returnAssignee)
      ? {
          type: str(state.returnAssignee.type),
          agentId: str(state.returnAssignee.agentId),
          userId: str(state.returnAssignee.userId),
        }
      : null,
    reviewRequest: isRecord(state.reviewRequest) ? state.reviewRequest : null,
    completedStageIds: Array.isArray(state.completedStageIds) ? state.completedStageIds : [],
    lastDecisionId: str(state.lastDecisionId),
    lastDecisionOutcome: str(state.lastDecisionOutcome),
    changesRequestedCount: num(state.changesRequestedCount) ?? 0,
  };
}

interface ActorContext {
  actorType: "agent" | "board" | "unknown";
  agentId: string | null;
  companyId: string | null;
  hasLiveRunContext: boolean;
  hasBoardCredential: boolean;
  isAssignee: boolean;
  status: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  issueReadable: boolean;
}

function actorContext(client: PaperclipApiClient, issue: Record<string, unknown> | null): ActorContext {
  const agentId = client.defaults.agentId ?? null;
  const assigneeAgentId = issue ? str(issue.assigneeAgentId) : null;
  return {
    actorType: agentId ? "agent" : client.hasBoardCredential ? "board" : "unknown",
    agentId,
    companyId: client.defaults.companyId ?? null,
    hasLiveRunContext: Boolean(client.defaults.runId || client.defaults.operatorRunId),
    hasBoardCredential: client.hasBoardCredential,
    isAssignee: Boolean(agentId && assigneeAgentId && agentId === assigneeAgentId),
    status: issue ? str(issue.status) : null,
    assigneeAgentId,
    assigneeUserId: issue ? str(issue.assigneeUserId) : null,
    issueReadable: issue !== null,
  };
}

interface FieldSpec {
  field: string;
  uiSection: "Relationships" | "Execution";
  sourceOfTruth: string;
  derived: boolean;
  allowedOperations: string[];
  mutationTool: string;
  requiredPermission: string;
  requiresRunContext: boolean;
  constraints: string[];
  recommendedAction: string;
}

const FIELD_SPECS: FieldSpec[] = [
  {
    field: "parent",
    uiSection: "Relationships",
    sourceOfTruth: "issues.parentId (structure graph)",
    derived: false,
    allowedOperations: ["get", "set", "replace", "clear", "validate", "inspect_ancestors"],
    mutationTool: "paperclipManageIssueRelationships",
    requiredPermission: "issue:mutate on the target issue (assignee agent with a live run context, or Board authority)",
    requiresRunContext: true,
    constraints: [
      "no self-parent",
      "parent must not be a descendant of the issue (hierarchy cycle)",
      "parent must belong to the same company",
      "parent must exist and be readable by the actor",
    ],
    recommendedAction: "paperclipManageIssueRelationships(operation=set_parent) then paperclipGetIssueFieldDetails(sections=relationships) to read the committed chain back",
  },
  {
    field: "blockedBy",
    uiSection: "Relationships",
    sourceOfTruth: "issue_relations type=blocks (dependency graph); the blockedByIssueIds field on issue payloads is only a denormalized projection",
    derived: false,
    allowedOperations: ["get", "add", "remove", "replace", "clear", "validate"],
    mutationTool: "paperclipManageIssueRelationships",
    requiredPermission: "issue:mutate on the target issue (assignee agent with a live run context, or Board authority)",
    requiresRunContext: true,
    constraints: [
      "no self-blocking",
      "no dependency cycle",
      "no cross-company edges",
      "add/remove must preserve every unrelated edge (backend replaces the full set)",
    ],
    recommendedAction: "paperclipManageIssueRelationships(operation=add_blocker|remove_blocker) then read back the committed blockedBy relation summaries",
  },
  {
    field: "blocks",
    uiSection: "Relationships",
    sourceOfTruth: "reverse of the first-class issue_relations 'blocks' edges of other issues",
    derived: true,
    allowedOperations: ["get", "add", "remove", "validate"],
    mutationTool: "paperclipManageIssueRelationships (on the blocking issue)",
    requiredPermission: "issue:mutate on the OTHER issue (the one that would carry the blocker)",
    requiresRunContext: true,
    constraints: [
      "Blocking is not a writable column: it changes when another issue's blockedBy set changes",
      "removing one Blocking edge must preserve the target's other blockers",
    ],
    recommendedAction: "paperclipManageIssueRelationships(issueId=<blocking issue>, operation=remove_blocker, blockerIssueIds=[<this issue>])",
  },
  {
    field: "subtasks",
    uiSection: "Relationships",
    sourceOfTruth: "child issues through issues.parentId (structure graph)",
    derived: true,
    allowedOperations: ["get", "paginate", "create", "attach", "detach", "reparent", "inspect_tree"],
    mutationTool: "paperclipManageIssueRelationships",
    requiredPermission: "issue:mutate on the parent (create) and on the child (attach/detach/reparent)",
    requiresRunContext: true,
    constraints: [
      "a child is NOT automatically blocked by its parent",
      "reparenting must not create a hierarchy cycle",
      "subtask status/assignee/dependencies are preserved unless explicitly changed",
    ],
    recommendedAction: "paperclipManageIssueRelationships(operation=list_children|list_descendants|attach_child|detach_child|move_child)",
  },
  {
    field: "url",
    uiSection: "Relationships",
    sourceOfTruth: "derived projection: the built-in 'url' external-object detector scans the issue description, comments and documents; Paperclip has NO writable issue.url column",
    derived: true,
    allowedOperations: ["get", "add", "update", "remove", "inspect_source", "inspect_resolution"],
    mutationTool: "paperclipManageIssueLinks",
    requiredPermission: "issue:mutate / comment write on the issue",
    requiresRunContext: true,
    constraints: [
      "the URL is stored in its source record (description, comment or document) - not in a dedicated column",
      "removal deletes/edits the source record, which also removes any other content in it",
      "a Docker-internal address is not invalid just because it is not resolvable from the current network namespace",
    ],
    recommendedAction: "paperclipManageIssueLinks(operation=list|add|update|remove) and read the refreshed external objects back",
  },
  {
    field: "reviewPolicy",
    uiSection: "Execution",
    sourceOfTruth: "issues.reviewPolicy (anyone | not_creator | human_only)",
    derived: false,
    allowedOperations: ["get", "set"],
    mutationTool: "paperclipManageIssueExecutionPolicy",
    requiredPermission: "issue:mutate (governance relaxation is denied by the server with 403 review_policy_denied)",
    requiresRunContext: true,
    constraints: [
      "relaxing not_creator/human_only is refused by the server - that is a security control, not a bug",
      "never approve work by clearing the policy or forcing status=done",
    ],
    recommendedAction: "paperclipManageIssueExecutionPolicy(operation=set_review_policy) and confirm the committed reviewPolicy",
  },
  {
    field: "reviewers",
    uiSection: "Execution",
    sourceOfTruth: "issues.executionPolicy.stages[] where type=review (participants carry agentId or userId)",
    derived: false,
    allowedOperations: ["get", "add", "replace", "remove", "reorder"],
    mutationTool: "paperclipManageIssueExecutionPolicy",
    requiredPermission: "issue:mutate (assignee agent with live run context, or Board authority)",
    requiresRunContext: true,
    constraints: [
      "a configured reviewer is NOT a live reviewer - liveness is proven by paperclipGetReviewState / live runs",
      "the executor must not be configured as the independent reviewer when the policy forbids it",
      "stage order is meaningful: preserve the order of unrelated stages",
    ],
    recommendedAction: "paperclipManageIssueExecutionPolicy(operation=add_stage|replace_stages|remove_stage) then paperclipGetReviewState",
  },
  {
    field: "approvers",
    uiSection: "Execution",
    sourceOfTruth: "issues.executionPolicy.stages[] where type=approval, plus separate formal approval records (paperclipListApprovals / paperclipLinkIssueApproval)",
    derived: false,
    allowedOperations: ["get", "add", "replace", "remove", "inspect_approval_type"],
    mutationTool: "paperclipManageIssueExecutionPolicy (stage) / paperclipLinkIssueApproval (formal approval record)",
    requiredPermission: "issue:mutate (stage) / approval link write (formal record)",
    requiresRunContext: true,
    constraints: [
      "an execution-policy approval stage is NOT a formal Board approval record",
      "self-approval is rejected by the server",
    ],
    recommendedAction: "paperclipManageIssueExecutionPolicy(operation=add_stage with type=approval) and inspect the linked formal approvals separately",
  },
  {
    field: "currentExecution",
    uiSection: "Execution",
    sourceOfTruth: "issues.executionState (runtime projection) produced by first-class workflow transitions",
    derived: true,
    allowedOperations: ["inspect", "transition", "decide", "recover"],
    mutationTool: "paperclipRequestReview / paperclipSubmitReviewDecision / paperclipResolveReviewWedge",
    requiredPermission: "workflow transition authority (reviewer participant, or Board for recovery)",
    requiresRunContext: true,
    constraints: [
      "never fabricate executionState - it is written by the server on authorized transitions",
      "a configured stage does not prove a reviewer started",
    ],
    recommendedAction: "paperclipGetReviewState (liveness) and the authorized workflow tools above",
  },
  {
    field: "monitor",
    uiSection: "Execution",
    sourceOfTruth: "issues.executionPolicy.monitor (policy) + issues.monitor* columns + issues.executionState.monitor (runtime state)",
    derived: false,
    allowedOperations: ["get", "schedule", "update", "cancel", "clear", "inspect_attempts"],
    mutationTool: "paperclipManageIssueMonitor",
    requiredPermission: "assignee agent of the issue, or a Board user (server: 'Only the assignee agent or a board user can manage issue monitors')",
    requiresRunContext: true,
    constraints: [
      "eligibility: assigned to an agent and status in_progress or in_review",
      "nextCheckAt must be a valid UTC ISO timestamp in the future",
      "clearing must be confirmed in both executionPolicy.monitor and executionState.monitor",
    ],
    recommendedAction: "paperclipManageIssueMonitor(operation=schedule|update|clear) and read the committed monitor state back",
  },
  {
    field: "watchdog",
    uiSection: "Execution",
    sourceOfTruth: "native task-watchdog configuration (GET/PUT/DELETE /issues/{id}/watchdog)",
    derived: false,
    allowedOperations: ["get", "create", "update", "remove", "inspect_triggers", "inspect_stop_fingerprints"],
    mutationTool: "paperclipManageIssueWatchdog",
    requiredPermission: "issue mutation authority on the watched issue (server asserts agent issue mutation + low-trust policy)",
    requiresRunContext: true,
    constraints: [
      "PUT/DELETE queue a watchdog evaluation and can start agent execution",
      "an active watchdog configuration is not an active watchdog run",
      "configuration changes re-evaluate the fingerprint - do not suppress that",
    ],
    recommendedAction: "paperclipManageIssueWatchdog(operation=read) before changing, and read back after the change",
  },
];

function fieldEditability(spec: FieldSpec, actor: ActorContext): { editable: boolean; denialReason: string | null } {
  if (!actor.issueReadable) {
    return { editable: false, denialReason: "issue is not readable for this actor - effective authorization cannot be established" };
  }
  if (spec.field === "currentExecution") {
    return {
      editable: false,
      denialReason: "derived runtime projection - change it through authorized workflow transitions, never by writing executionState",
    };
  }
  if (spec.field === "monitor") {
    if (!actor.assigneeAgentId || actor.assigneeUserId) {
      return { editable: false, denialReason: "monitor eligibility requires an issue assigned to an agent (no user assignee)" };
    }
    if (actor.status !== "in_progress" && actor.status !== "in_review") {
      return {
        editable: false,
        denialReason: `monitor eligibility requires status in_progress or in_review (current status: ${actor.status ?? "unknown"})`,
      };
    }
  }
  if (actor.hasBoardCredential) return { editable: true, denialReason: null };
  if (actor.isAssignee && actor.hasLiveRunContext) return { editable: true, denialReason: null };
  return {
    editable: false,
    denialReason: actor.isAssignee
      ? "no live issue-scoped run context for the assignee agent and no Board credential in this MCP session"
      : "actor is not the assignee agent of this issue and no Board credential is configured in this MCP session",
  };
}

function fieldValue(spec: FieldSpec, ctx: {
  issue: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  state: Record<string, unknown> | null;
  blockedBy: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  children: Array<Record<string, unknown>>;
  links: unknown;
  watchdog: unknown;
}): unknown {
  const issue = ctx.issue;
  switch (spec.field) {
    case "parent":
      return issue ? { parentId: str(issue.parentId), ancestors: Array.isArray(issue.ancestors) ? issue.ancestors.length : 0 } : null;
    case "blockedBy":
      return ctx.blockedBy;
    case "blocks":
      return ctx.blocks;
    case "subtasks":
      return { directChildren: ctx.children.map(summarizeRow) };
    case "url":
      return ctx.links;
    case "reviewPolicy":
      return issue ? str(issue.reviewPolicy) : null;
    case "reviewers":
      return stageView(ctx.policy).filter((s) => s.type === "review");
    case "approvers":
      return stageView(ctx.policy).filter((s) => s.type === "approval");
    case "currentExecution":
      return executionStateView(ctx.state);
    case "monitor":
      return monitorView(issue ?? {}, ctx.policy, ctx.state);
    case "watchdog":
      return ctx.watchdog;
    default:
      return null;
  }
}

export const ISSUE_FIELD_TOOL_NAMES: string[] = [
  "paperclipGetIssueFieldDetails",
  "paperclipDescribeIssueFields",
  "paperclipManageIssueRelationships",
  "paperclipManageIssueExecutionPolicy",
  "paperclipManageIssueMonitor",
  "paperclipManageIssueWatchdog",
  "paperclipManageIssueLinks",
];

export function createIssueFieldTools(client: PaperclipApiClient): IssueFieldToolDefinition[] {
  return [
    makeTool(
      "paperclipGetIssueFieldDetails",
      "CRITICAL: Expanded, authoritative inspection of one issue's Relationships and Execution configuration: parent + full ancestor chain, direct children (and optionally the whole descendant tree), first-class blockedBy/blocks relations, unresolved blockers, dependency readiness, reviewPolicy, executionPolicy with ordered typed stages and participants, the live executionState (current stage, participant, return assignee, review request), linked formal approvals, monitor (policy + runtime state + attempt count), native watchdog configuration and the derived URL/link objects - each with its source of truth, effective editability and the available mutation operations. Use this instead of guessing from a single issue read: `blockedByIssueIds` is a denormalized projection, `Blocking` is the reverse of another issue's `Blocked by`, and the URL field has no dedicated column (it is derived from description/comments/documents). " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema.describe("Issue UUID or identifier (e.g. KOMAA-992)"),
        sections: z
          .array(z.enum(["relationships", "execution", "monitor", "watchdog", "links", "all"]))
          .optional()
          .describe("Sections to expand; omit for all"),
        includeDescendants: z.boolean().optional().default(false).describe("Traverse the full descendant tree (bounded)"),
        descendantLimit: z.number().int().min(1).max(500).optional().default(200),
        childLimit: z.number().int().min(1).max(200).optional().default(50),
        includeCapabilities: z.boolean().optional().default(false).describe("Include per-field editability metadata"),
      }),
      async ({ issueId, sections, includeDescendants, descendantLimit, childLimit, includeCapabilities }) => {
        const issue = await requireIssue(client, issueId);
        const issueUuid = str(issue.id) as string;
        const wanted = new Set<string>(sections && sections.length ? sections : ["relationships", "execution", "monitor", "watchdog", "links"]);
        if (wanted.has("all")) {
          for (const s of ["relationships", "execution", "monitor", "watchdog", "links"]) wanted.add(s);
        }
        const policy = isRecord(issue.executionPolicy) ? issue.executionPolicy : null;
        const state = isRecord(issue.executionState) ? issue.executionState : null;
        const actor = actorContext(client, issue);

        const out: Record<string, unknown> = {
          issueId: issueUuid,
          identifier: str(issue.identifier),
          title: str(issue.title),
          status: str(issue.status),
          companyId: str(issue.companyId),
          sections: [...wanted],
          actor,
        };

        if (wanted.has("relationships")) {
          const parentId = str(issue.parentId);
          const parent = parentId ? await readIssue(client, parentId) : null;
          const children = await listChildren(client, issueUuid, childLimit, 0);
          const descendants = includeDescendants
            ? await listDescendants(client, issueUuid, descendantLimit)
            : null;
          const blockedBy = relationSummaries(issue.blockedBy);
          const blocks = relationSummaries(issue.blocks);
          let hierarchy: Record<string, unknown>;
          try {
            const validation = await validateParentHierarchy(client, { issueId: issueUuid, parentId });
            hierarchy = { valid: true, chain: validation.chain, scope: validation.scope };
          } catch (err) {
            const e = err as { code?: string; message?: string; chain?: unknown };
            hierarchy = {
              valid: false,
              code: e.code ?? "PARENT_HIERARCHY_VALIDATION_FAILED",
              reason: e.message ?? "parent hierarchy could not be verified",
              chain: e.chain ?? [],
              scope: "mcp-gateway-only",
            };
          }
          out.relationships = {
            sourceOfTruth: {
              hierarchy: "issues.parentId",
              dependency: "issue_relations type=blocks",
              projectionWarning: "blockedByIssueIds on the issue row is a denormalized projection and can diverge from issue_relations",
            },
            parent: parent ? summarizeRow(parent) : null,
            ancestors: (Array.isArray(issue.ancestors) ? issue.ancestors : []).filter(isRecord).map(summarizeRow),
            directChildren: children.map(summarizeRow),
            descendants: descendants ? descendants.descendants.map(summarizeRow) : null,
            descendantTraversal: descendants ? { truncated: descendants.truncated, maxDepthReached: descendants.maxDepthReached } : null,
            blockedBy,
            blocks,
            unresolvedBlockers: blockedBy.filter((b) => b.status !== "done" && b.status !== "cancelled"),
            dependencyReadiness: {
              allBlockersDone: blockedBy.every((b) => b.status === "done" || b.status === "cancelled"),
              isDependencyReady: blockedBy.every((b) => b.status === "done" || b.status === "cancelled"),
              unresolvedBlockerCount: blockedBy.filter((b) => b.status !== "done" && b.status !== "cancelled").length,
            },
            hierarchyValidation: hierarchy,
            availableMutations: [
              "paperclipManageIssueRelationships(operation=set_parent|clear_parent)",
              "paperclipManageIssueRelationships(operation=add_blocker|remove_blocker|replace_blockers|clear_blockers)",
              "paperclipManageIssueRelationships(operation=list_children|list_descendants|attach_child|detach_child|move_child)",
            ],
          };
        }

        if (wanted.has("execution") || wanted.has("monitor")) {
          const approvals = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/approvals`);
          const monitor = monitorView(issue, policy, state);
          out.execution = {
            reviewPolicy: str(issue.reviewPolicy),
            executionPolicy: policy,
            stages: stageView(policy),
            mode: str(policy?.mode),
            commentRequired: typeof policy?.commentRequired === "boolean" ? policy.commentRequired : null,
            maxReviewRounds: num(policy?.maxReviewRounds),
            currentExecution: executionStateView(state),
            reviewRequest: isRecord(state?.reviewRequest) ? state.reviewRequest : null,
            linkedFormalApprovals: approvals,
            monitor: wanted.has("monitor") ? monitor : undefined,
            reviewLivenessNote: "a configured reviewer is not a live reviewer - verify with paperclipGetReviewState",
            availableMutations: [
              "paperclipManageIssueExecutionPolicy(operation=set_review_policy|replace_stages|add_stage|remove_stage)",
              "paperclipManageIssueMonitor(operation=schedule|update|clear)",
              "paperclipRequestReview / paperclipSubmitReviewDecision / paperclipResolveReviewWedge for workflow transitions",
            ],
          };
          if (wanted.has("monitor")) out.monitor = monitor;
        }

        if (wanted.has("watchdog")) {
          const watchdog = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/watchdog`);
          out.watchdog = {
            configuration: watchdog,
            activeConfiguration: Boolean(watchdog),
            note: "an active configuration is not an active watchdog run; PUT/DELETE queue a watchdog evaluation",
            availableMutations: ["paperclipManageIssueWatchdog(operation=create|update|remove)"],
          };
        }

        if (wanted.has("links")) {
          const objects = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-objects`);
          const summary = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-object-summary`);
          out.links = {
            sourceOfTruth: "derived projection: external_objects rows produced by the built-in 'url' detector over description/comments/documents; Paperclip has no writable issue.url column",
            externalObjects: objects,
            summary,
            availableMutations: ["paperclipManageIssueLinks(operation=list|add|update|remove)"],
          };
        }

        if (includeCapabilities) {
          const blockedBy = relationSummaries(issue.blockedBy);
          const blocks = relationSummaries(issue.blocks);
          const children = await listChildren(client, issueUuid, childLimit, 0);
          const links = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-objects`);
          const watchdog = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/watchdog`);
          out.capabilities = FIELD_SPECS.map((spec) => {
            const editability = fieldEditability(spec, actor);
            return {
              field: spec.field,
              uiSection: spec.uiSection,
              sourceOfTruth: spec.sourceOfTruth,
              derived: spec.derived,
              editable: editability.editable,
              allowedOperations: spec.allowedOperations,
              requiredPermission: spec.requiredPermission,
              requiresRunContext: spec.requiresRunContext,
              mutationTool: spec.mutationTool,
              constraints: spec.constraints,
              denialReason: editability.denialReason,
              recommendedAction: spec.recommendedAction,
              value: fieldValue(spec, { issue, policy, state, blockedBy, blocks, children, links, watchdog }),
            };
          });
        }

        return out;
      },
    ),

    makeTool(
      "paperclipDescribeIssueFields",
      "CRITICAL: Field capability discovery. Answers \"which fields can this actor inspect and edit on this issue, and exactly how?\" for every Relationships and Execution field: current value, source of truth, whether the field is derived or directly writable, the exact mutation tool + operation, allowed operations, required permission, whether a live run context is needed, the invariants that must hold, the effective denial reason for the current actor, and the recommended follow-up call. Effective editability is evaluated against the real actor/issue state (assignee, status, run context, Board credential) - a tool existing in the catalogue does NOT mean this actor may use it. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema.optional().describe("Issue UUID or identifier; omit for a catalogue-only answer without effective authorization"),
      }),
      async ({ issueId }) => {
        let issue: Record<string, unknown> | null = null;
        if (issueId) issue = await readIssue(client, issueId);
        const policy = isRecord(issue?.executionPolicy) ? issue.executionPolicy : null;
        const state = isRecord(issue?.executionState) ? issue.executionState : null;
        const actor = actorContext(client, issue);
        const blockedBy = relationSummaries(issue?.blockedBy);
        const blocks = relationSummaries(issue?.blocks);
        const children = issue ? await listChildren(client, str(issue.id) as string, 50, 0) : [];
        const links = issue ? await client.getJsonOrNull<unknown>(`/issues/${enc(str(issue.id) as string)}/external-objects`) : null;
        const watchdog = issue ? await client.getJsonOrNull<unknown>(`/issues/${enc(str(issue.id) as string)}/watchdog`) : null;

        return {
          issueId: issue ? str(issue.id) : null,
          identifier: issue ? str(issue.identifier) : null,
          status: issue ? str(issue.status) : null,
          evaluation: issue
            ? "effective authorization evaluated for this actor and this issue"
            : "catalogue only - pass issueId for effective editability, current values and denial reasons",
          actor,
          fields: FIELD_SPECS.map((spec) => {
            const editability = fieldEditability(spec, actor);
            return {
              field: spec.field,
              uiSection: spec.uiSection,
              sourceOfTruth: spec.sourceOfTruth,
              derived: spec.derived,
              editable: editability.editable,
              allowedOperations: spec.allowedOperations,
              requiredPermission: spec.requiredPermission,
              requiresRunContext: spec.requiresRunContext,
              mutationTool: spec.mutationTool,
              constraints: spec.constraints,
              denialReason: editability.denialReason,
              recommendedAction: spec.recommendedAction,
              value: fieldValue(spec, { issue, policy, state, blockedBy, blocks, children, links, watchdog }),
            };
          }),
        };
      },
    ),

    makeTool(
      "paperclipManageIssueRelationships",
      "CRITICAL: Parent and blocker graphs are different. Never create hierarchy or dependency cycles. `Blocking` is the reverse relationship of another issue's `Blocked by`. When removing one edge, preserve all unrelated edges. Resolve issue identifiers to IDs, inspect the authoritative graph, validate and confirm the committed result. " +
        "Operations: set_parent / clear_parent (hierarchy, issues.parentId), add_blocker / remove_blocker / replace_blockers / clear_blockers (dependency, first-class issue_relations), list_children / list_descendants (subtask tree), attach_child / detach_child / move_child (subtask structure). add/remove change only the requested members; replace_blockers replaces the complete set; empty array removes all blockers. Every parent write is validated fail-closed by the MCP hierarchy guard (no self-parent, no cycle, no cross-company parent) BEFORE it is sent. dryRun validates and previews without persisting. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema.describe("Target issue (UUID or identifier)"),
        operation: z.enum([
          "set_parent",
          "clear_parent",
          "add_blocker",
          "remove_blocker",
          "replace_blockers",
          "clear_blockers",
          "list_children",
          "list_descendants",
          "attach_child",
          "detach_child",
          "move_child",
        ]),
        parentIssueId: z.string().min(1).optional().describe("New parent (set_parent) - resolved to its UUID"),
        blockerIssueIds: z.array(z.string().min(1)).max(100).optional().describe("Blockers to add/remove/replace (UUIDs or identifiers)"),
        childIssueId: z.string().min(1).optional().describe("Child issue (detach_child / move_child)"),
        newParentIssueId: z.string().min(1).optional().describe("Target parent for move_child"),
        childTitle: z.string().trim().min(1).max(240).optional().describe("Title for a newly created subtask"),
        childDescription: z.string().max(20000).optional(),
        childAssigneeAgentId: z.string().guid().optional().describe("Required agent owner of a newly created subtask"),
        limit: z.number().int().min(1).max(200).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
        dryRun: dryRunDefault,
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async (input) => {
        const { issueId, operation, dryRun } = input;
        const issue = await requireIssue(client, issueId);
        const issueUuid = str(issue.id) as string;

        if (operation === "list_children") {
          const children = await listChildren(client, issueUuid, input.limit, input.offset);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            directChildren: children.map(summarizeRow),
            count: children.length,
            pagination: { limit: input.limit, offset: input.offset },
            sourceOfTruth: "issues.parentId",
          };
        }

        if (operation === "list_descendants") {
          const result = await listDescendants(client, issueUuid, input.limit);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            descendants: result.descendants.map(summarizeRow),
            count: result.descendants.length,
            truncated: result.truncated,
            maxDepthReached: result.maxDepthReached,
            sourceOfTruth: "issues.parentId",
          };
        }

        if (operation === "set_parent" || operation === "clear_parent") {
          const parentUuid = operation === "clear_parent" ? null : await resolveIssueId(client, input.parentIssueId as string);
          if (operation === "set_parent" && parentUuid === issueUuid) {
            throw invalid("An issue cannot be its own parent");
          }
          if (operation === "set_parent") {
            // Fail-closed hierarchy validation BEFORE the write (also enforced
            // centrally in the MCP client for every write path).
            await validateParentHierarchy(client, { issueId: issueUuid, parentId: parentUuid });
          }
          if (dryRun) {
            return {
              issueId: issueUuid,
              operation,
              dryRun: true,
              committed: false,
              planned: { parentId: parentUuid },
              sourceOfTruth: "issues.parentId",
            };
          }
          const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
            body: { parentId: parentUuid },
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const committed = await readIssue(client, issueUuid);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            committed: true,
            appliedChanges: { parentId: { from: str(issue.parentId), to: parentUuid } },
            committedValues: { parentId: str(committed?.parentId) },
            sourceOfTruth: "issues.parentId",
            updated,
          };
        }

        if (operation === "add_blocker" || operation === "remove_blocker" || operation === "replace_blockers" || operation === "clear_blockers") {
          const current = await authoritativeBlockerIds(client, issueUuid);
          const requested: string[] = [];
          for (const ref of input.blockerIssueIds ?? []) {
            requested.push(await resolveIssueId(client, ref));
          }
          if (requested.includes(issueUuid)) {
            throw invalid("Self-blocker rejected: an issue cannot block itself");
          }
          let next: string[];
          if (operation === "replace_blockers") next = [...new Set(requested)];
          else if (operation === "clear_blockers") next = [];
          else if (operation === "add_blocker") next = [...new Set([...current.ids, ...requested])];
          else next = current.ids.filter((id) => !requested.includes(id));
          if (dryRun) {
            return {
              issueId: issueUuid,
              operation,
              dryRun: true,
              committed: false,
              relationalBase: current.source,
              before: current.ids,
              after: next,
            };
          }
          const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
            body: { blockedByIssueIds: next },
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const after = await authoritativeBlockerIds(client, issueUuid);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            committed: true,
            appliedChanges: { blockedByIssueIds: { from: current.ids, to: next } },
            committedValues: { blockedByIssueIds: after.ids },
            relationalBase: current.source,
            sourceOfTruth: "issue_relations type=blocks",
            updated,
          };
        }

        if (operation === "attach_child") {
          const assignee = input.childAssigneeAgentId ?? client.resolveAgentId(null);
          if (!input.childTitle) throw invalid("attach_child requires childTitle");
          const body: Record<string, unknown> = {
            title: input.childTitle,
            assigneeAgentId: assignee,
          };
          if (input.childDescription) body.description = input.childDescription;
          if (dryRun) {
            return { issueId: issueUuid, operation, dryRun: true, committed: false, planned: { parentId: issueUuid, ...body } };
          }
          const created = await client.requestJson<Record<string, unknown>>("POST", `/issues/${enc(issueUuid)}/children`, {
            body,
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const createdId = str(created.id);
          const children = await listChildren(client, issueUuid, input.limit, 0);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            committed: true,
            appliedChanges: { childCreated: createdId },
            committedValues: { directChildren: children.map(summarizeRow) },
            sourceOfTruth: "issues.parentId",
            created,
          };
        }

        if (operation === "detach_child" || operation === "move_child") {
          const childUuid = await resolveIssueId(client, input.childIssueId as string);
          const parentUuid = operation === "move_child" ? await resolveIssueId(client, input.newParentIssueId as string) : null;
          if (parentUuid === childUuid) throw invalid("An issue cannot be its own parent");
          if (parentUuid) {
            await validateParentHierarchy(client, { issueId: childUuid, parentId: parentUuid });
          }
          if (dryRun) {
            return {
              issueId: issueUuid,
              operation,
              dryRun: true,
              committed: false,
              planned: { childIssueId: childUuid, parentId: parentUuid },
            };
          }
          const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(childUuid)}`, {
            body: { parentId: parentUuid },
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const child = await readIssue(client, childUuid);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation,
            committed: true,
            appliedChanges: { childIssueId: childUuid, parentId: { to: parentUuid } },
            committedValues: { childParentId: str(child?.parentId) },
            sourceOfTruth: "issues.parentId",
            updated,
          };
        }

        throw invalid(`Unsupported operation ${operation}`);
      },
    ),

    makeTool(
      "paperclipManageIssueExecutionPolicy",
      "CRITICAL: Execution stages are enforced control-plane transitions, not documentation. Persist typed reviewer/approver participants (agent participants carry `agentId`, user participants carry `userId` — never send the irrelevant identity key), preserve stage ordering and independent approval requirements. Do not directly fabricate runtime `executionState` or silently downgrade governance. Use authorized review transitions and verify current participant and live reviewer status. " +
        "Operations: read, set_review_policy, replace_stages, add_stage, remove_stage, set_mode, set_comment_required. add_stage/remove_stage modify only the requested stage; replace_stages replaces the complete stage list. Unrelated stages, mode, commentRequired, monitor and maxReviewRounds are preserved. A policy relaxation (not_creator/human_only -> anyone) is refused by the server with 403 - that is a security control and must not be bypassed. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema,
        operation: z.enum([
          "read",
          "set_review_policy",
          "replace_stages",
          "add_stage",
          "remove_stage",
          "set_mode",
          "set_comment_required",
        ]),
        reviewPolicy: z.enum(["anyone", "not_creator", "human_only"]).optional(),
        stages: z
          .array(
            z.object({
              id: z.string().guid().optional(),
              type: z.enum(["review", "approval"]),
              approvalsNeeded: z.literal(1).optional(),
              participants: z
                .array(
                  z.object({
                    type: z.enum(["agent", "user"]),
                    agentId: z.string().guid().optional(),
                    userId: z.string().min(1).optional(),
                  }),
                )
                .default([]),
            }),
          )
          .optional()
          .describe("Complete stage list (replace_stages) or the stage to add (add_stage)"),
        stageId: z.string().guid().optional().describe("Stage to remove (remove_stage)"),
        mode: z.enum(["normal", "auto"]).optional(),
        commentRequired: z.boolean().optional(),
        maxReviewRounds: z.number().int().positive().max(50).optional(),
        dryRun: dryRunDefault,
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async (input) => {
        const issue = await requireIssue(client, input.issueId);
        const issueUuid = str(issue.id) as string;
        const currentPolicy = isRecord(issue.executionPolicy) ? issue.executionPolicy : {};
        const currentStages = stageView(currentPolicy);
        const state = isRecord(issue.executionState) ? issue.executionState : null;

        if (input.operation === "read") {
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            reviewPolicy: str(issue.reviewPolicy),
            executionPolicy: currentPolicy,
            stages: currentStages,
            currentExecution: executionStateView(state),
            sourceOfTruth: "issues.reviewPolicy + issues.executionPolicy",
            availableMutations: [
              "paperclipManageIssueExecutionPolicy(operation=set_review_policy)",
              "paperclipManageIssueExecutionPolicy(operation=replace_stages|add_stage|remove_stage)",
            ],
          };
        }

        const body: Record<string, unknown> = {};
        if (input.operation === "set_review_policy") {
          if (!input.reviewPolicy) throw invalid("set_review_policy requires reviewPolicy");
          body.reviewPolicy = input.reviewPolicy;
        }

        let nextStages: Array<Record<string, unknown>> | null = null;
        if (input.operation === "replace_stages") {
          if (!input.stages) throw invalid("replace_stages requires stages");
          nextStages = input.stages.map((s) => stageForWrite(s as unknown as Record<string, unknown>));
        } else if (input.operation === "add_stage") {
          if (!input.stages || input.stages.length !== 1) throw invalid("add_stage requires exactly one stage");
          nextStages = [...currentStages.map((s) => stageForWrite(s)), stageForWrite(input.stages[0] as unknown as Record<string, unknown>)];
        } else if (input.operation === "remove_stage") {
          if (!input.stageId) throw invalid("remove_stage requires stageId");
          nextStages = currentStages.filter((s) => s.id !== input.stageId).map((s) => stageForWrite(s));
          if (nextStages.length === currentStages.length) {
            throw invalid(`No stage with id ${input.stageId} on this issue`);
          }
        }

        const nextPolicy: Record<string, unknown> = {
          mode: input.mode ?? (currentPolicy.mode as string) ?? "normal",
          commentRequired: input.commentRequired ?? (typeof currentPolicy.commentRequired === "boolean" ? currentPolicy.commentRequired : true),
          stages: nextStages ?? currentStages.map((s) => stageForWrite(s)),
        };
        if (currentPolicy.monitor !== undefined) nextPolicy.monitor = currentPolicy.monitor;
        if (currentPolicy.maxReviewRounds !== undefined && currentPolicy.maxReviewRounds !== null) {
          nextPolicy.maxReviewRounds = currentPolicy.maxReviewRounds;
        }
        if (input.maxReviewRounds !== undefined) nextPolicy.maxReviewRounds = input.maxReviewRounds;
        if (currentPolicy.reviewPreset !== undefined) nextPolicy.reviewPreset = currentPolicy.reviewPreset;
        if (currentPolicy.authorizationPolicy !== undefined) nextPolicy.authorizationPolicy = currentPolicy.authorizationPolicy;
        // Re-attach the stored stage/participant ids for stages the caller did
        // not name explicitly, so an unrelated edit never regenerates them.
        nextPolicy.stages = preserveStageIdentity(currentStages, nextPolicy.stages as Array<Record<string, unknown>>);
        body.executionPolicy = nextPolicy;

        if (input.dryRun) {
          return {
            issueId: issueUuid,
            operation: input.operation,
            dryRun: true,
            committed: false,
            planned: body,
            currentStages,
          };
        }

        // KOMAA-849 (MCP layer only, no Core change): a semantically identical
        // write must have NO side effect. Paperclip Core treats any policy
        // PATCH that arrives while a review stage is pending as a workflow
        // mutation: it re-pends the stage, moves the issue back to in_review
        // and re-wakes the reviewer. A no-op (set_comment_required on an
        // already-set value, set_review_policy to the current policy, or a
        // replace_stages with the same stages) must therefore never be sent.
        const policyUnchanged = canonicalPolicy(nextPolicy) === canonicalPolicy(currentPolicy);
        const reviewPolicyUnchanged =
          body.reviewPolicy === undefined || body.reviewPolicy === str(issue.reviewPolicy);
        if (policyUnchanged && reviewPolicyUnchanged) {
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            committed: false,
            noOp: true,
            reason: "requested execution policy is semantically identical to the committed policy - no write was sent",
            appliedChanges: {},
            committedValues: {
              reviewPolicy: str(issue.reviewPolicy),
              stages: stageView(currentPolicy),
              executionPolicy: currentPolicy,
            },
            currentExecution: executionStateView(state),
            sourceOfTruth: "issues.reviewPolicy + issues.executionPolicy",
          };
        }

        const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
          body,
          runId: input.runId ?? undefined,
          operatorRunId: input.operatorRunId ?? undefined,
        });
        const committed = await readIssue(client, issueUuid);
        const committedPolicy = isRecord(committed?.executionPolicy) ? committed.executionPolicy : null;
        return {
          issueId: issueUuid,
          identifier: str(issue.identifier),
          operation: input.operation,
          committed: true,
          appliedChanges: body,
          committedValues: {
            reviewPolicy: str(committed?.reviewPolicy),
            stages: stageView(committedPolicy),
            executionPolicy: committedPolicy,
          },
          currentExecution: executionStateView(isRecord(committed?.executionState) ? committed.executionState : null),
          sourceOfTruth: "issues.reviewPolicy + issues.executionPolicy",
          updated,
        };
      },
    ),

    makeTool(
      "paperclipManageIssueMonitor",
      "CRITICAL: Monitors are scheduled stateful recovery mechanisms. They require a valid eligible assigned issue (assigned to an agent, status in_progress or in_review) and a real scheduled condition. Creating or clearing a monitor changes execution behavior. Use valid UTC ISO timestamps, respect native authorization and eligibility, and confirm the committed scheduled/cleared state in both executionPolicy.monitor and executionState.monitor. " +
        "Operations: read (policy + runtime state + attempt count + last trigger), schedule, update (merge into the existing monitor policy), clear (monitor=null - verify the committed executionState.monitor is cleared and no scheduled wake remains). The server rejects ineligible issues with 'Monitor can only be scheduled on issues assigned to an agent in in_progress or in_review' - that message must be surfaced, never worked around by fabricating a status. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema,
        operation: z.enum(["read", "schedule", "update", "clear"]),
        nextCheckAt: z.string().datetime().optional().describe("UTC ISO timestamp of the next check (required for schedule)"),
        notes: z.string().max(500).optional().nullable(),
        kind: z.enum(["external_service"]).optional().nullable(),
        serviceName: z.string().trim().min(1).max(120).optional().nullable(),
        externalRef: z.string().trim().min(1).max(500).optional().nullable(),
        timeoutAt: z.string().datetime().optional().nullable(),
        maxAttempts: z.number().int().positive().max(100).optional().nullable(),
        recoveryPolicy: z.enum(["wake_owner", "create_recovery_issue", "escalate_to_board"]).optional().nullable(),
        scheduledBy: z.enum(["assignee", "board"]).optional().describe("Server derives this from the actor; provided for explicit board scheduling"),
        dryRun: dryRunDefault,
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async (input) => {
        const issue = await requireIssue(client, input.issueId);
        const issueUuid = str(issue.id) as string;
        const currentPolicy = isRecord(issue.executionPolicy) ? issue.executionPolicy : {};
        const currentState = isRecord(issue.executionState) ? issue.executionState : null;

        if (input.operation === "read") {
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            monitor: monitorView(issue, currentPolicy, currentState),
            sourceOfTruth: "issues.executionPolicy.monitor + issues.monitor* columns + issues.executionState.monitor",
          };
        }

        const nextPolicy: Record<string, unknown> = {
          mode: (currentPolicy.mode as string) ?? "normal",
          commentRequired: typeof currentPolicy.commentRequired === "boolean" ? currentPolicy.commentRequired : true,
          stages: Array.isArray(currentPolicy.stages) ? currentPolicy.stages : [],
        };
        if (currentPolicy.maxReviewRounds !== undefined && currentPolicy.maxReviewRounds !== null) {
          nextPolicy.maxReviewRounds = currentPolicy.maxReviewRounds;
        }
        if (currentPolicy.reviewPreset !== undefined) nextPolicy.reviewPreset = currentPolicy.reviewPreset;
        if (currentPolicy.authorizationPolicy !== undefined) nextPolicy.authorizationPolicy = currentPolicy.authorizationPolicy;

        if (input.operation === "clear") {
          nextPolicy.monitor = null;
          if (input.dryRun) {
            return { issueId: issueUuid, operation: input.operation, dryRun: true, committed: false, planned: { monitor: null } };
          }
          // KOMAA-849 (MCP layer only, no Core change): clearing a monitor that
          // is not scheduled is a no-op - it must not write, wake or re-pend a
          // pending review stage.
          if (!isRecord(currentPolicy.monitor) && !isRecord(currentState?.monitor)) {
            return {
              issueId: issueUuid,
              identifier: str(issue.identifier),
              operation: input.operation,
              committed: false,
              noOp: true,
              reason: "no monitor is scheduled on this issue - no write was sent",
              appliedChanges: {},
              committedValues: { monitor: monitorView(issue, currentPolicy, currentState) },
              sourceOfTruth: "issues.executionPolicy.monitor + issues.executionState.monitor",
            };
          }
          const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
            body: { executionPolicy: nextPolicy },
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const committed = await readIssue(client, issueUuid);
          const committedPolicy = isRecord(committed?.executionPolicy) ? committed.executionPolicy : null;
          const committedState = isRecord(committed?.executionState) ? committed.executionState : null;
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            committed: true,
            appliedChanges: { monitor: { from: isRecord(currentPolicy.monitor) ? currentPolicy.monitor : null, to: null } },
            committedValues: { monitor: monitorView(committed ?? {}, committedPolicy, committedState) },
            sourceOfTruth: "issues.executionPolicy.monitor + issues.executionState.monitor",
            updated,
          };
        }

        const existing = isRecord(currentPolicy.monitor) ? currentPolicy.monitor : {};
        const nextCheckAt = input.nextCheckAt ?? (str(existing.nextCheckAt) ?? undefined);
        if (!nextCheckAt) throw invalid("schedule requires nextCheckAt (UTC ISO timestamp)");
        const monitor: Record<string, unknown> = {
          nextCheckAt,
          notes: input.notes !== undefined ? input.notes : (existing.notes ?? null),
          scheduledBy: input.scheduledBy ?? (existing.scheduledBy ?? "assignee"),
          kind: input.kind !== undefined ? input.kind : (existing.kind ?? null),
          serviceName: input.serviceName !== undefined ? input.serviceName : (existing.serviceName ?? null),
          externalRef: input.externalRef !== undefined ? input.externalRef : (existing.externalRef ?? null),
          timeoutAt: input.timeoutAt !== undefined ? input.timeoutAt : (existing.timeoutAt ?? null),
          maxAttempts: input.maxAttempts !== undefined ? input.maxAttempts : (existing.maxAttempts ?? null),
          recoveryPolicy: input.recoveryPolicy !== undefined ? input.recoveryPolicy : (existing.recoveryPolicy ?? null),
        };
        nextPolicy.monitor = monitor;

        if (input.dryRun) {
          return { issueId: issueUuid, operation: input.operation, dryRun: true, committed: false, planned: { monitor } };
        }
        // KOMAA-849 (MCP layer only, no Core change): re-applying the same
        // monitor configuration must not write, wake or re-pend a review stage.
        if (canonicalMonitor(monitor) === canonicalMonitor(existing)) {
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            committed: false,
            noOp: true,
            reason: "requested monitor is identical to the committed monitor - no write was sent",
            appliedChanges: {},
            committedValues: { monitor: monitorView(issue, currentPolicy, currentState) },
            sourceOfTruth: "issues.executionPolicy.monitor + issues.executionState.monitor",
          };
        }
        const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
          body: { executionPolicy: nextPolicy },
          runId: input.runId ?? undefined,
          operatorRunId: input.operatorRunId ?? undefined,
        });
        const committed = await readIssue(client, issueUuid);
        const committedPolicy = isRecord(committed?.executionPolicy) ? committed.executionPolicy : null;
        const committedState = isRecord(committed?.executionState) ? committed.executionState : null;
        return {
          issueId: issueUuid,
          identifier: str(issue.identifier),
          operation: input.operation,
          committed: true,
          appliedChanges: { monitor: { from: existing, to: monitor } },
          committedValues: { monitor: monitorView(committed ?? {}, committedPolicy, committedState) },
          sourceOfTruth: "issues.executionPolicy.monitor + issues.monitor* columns + issues.executionState.monitor",
          updated,
        };
      },
    ),

    makeTool(
      "paperclipManageIssueWatchdog",
      "CRITICAL: Task watchdogs monitor stopped issue subtrees. They are not generic cron jobs. Configuration changes may trigger immediate reevaluation and agent execution. Respect fingerprint deduplication, authorization, bounded recovery, reusable watchdog issues and independent approval boundaries. Never enable a watchdog merely for a harmless field-inspection test. " +
        "Wraps the native endpoints GET/PUT/DELETE /issues/{id}/watchdog. Operations: read (active configuration incl. triggers/fingerprints), create (PUT with agentId + optional instructions), update (PUT - changes the agent or instructions), remove (DELETE - disables the watchdog). An active configuration is not an active watchdog run. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema,
        operation: z.enum(["read", "create", "update", "remove"]),
        agentId: z.string().guid().optional().describe("Watchdog owner agent (required for create/update)"),
        instructions: z.string().max(20000).optional().nullable().describe("Watchdog instructions; null clears them"),
        dryRun: dryRunDefault,
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async (input) => {
        const issue = await requireIssue(client, input.issueId);
        const issueUuid = str(issue.id) as string;

        if (input.operation === "read") {
          const watchdog = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/watchdog`);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            watchdog,
            activeConfiguration: Boolean(watchdog),
            sourceOfTruth: "native task-watchdog configuration (GET /issues/{id}/watchdog)",
            note: "an active configuration is not an active watchdog run",
          };
        }

        if (input.operation === "remove") {
          if (input.dryRun) {
            return { issueId: issueUuid, operation: input.operation, dryRun: true, committed: false, planned: { disabled: true } };
          }
          const result = await client.requestJson<unknown>("DELETE", `/issues/${enc(issueUuid)}/watchdog`, {
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          const after = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/watchdog`);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            committed: true,
            appliedChanges: { watchdog: { to: null } },
            committedValues: { watchdog: after },
            result,
            note: "DELETE queues a watchdog evaluation - confirm no orphaned recovery run remains",
          };
        }

        const agentId = input.agentId ?? client.resolveAgentId(null);
        const body: Record<string, unknown> = { agentId };
        if (input.instructions !== undefined) body.instructions = input.instructions;
        if (input.dryRun) {
          return { issueId: issueUuid, operation: input.operation, dryRun: true, committed: false, planned: body };
        }
        const result = await client.requestJson<unknown>("PUT", `/issues/${enc(issueUuid)}/watchdog`, {
          body,
          runId: input.runId ?? undefined,
          operatorRunId: input.operatorRunId ?? undefined,
        });
        const after = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/watchdog`);
        return {
          issueId: issueUuid,
          identifier: str(issue.identifier),
          operation: input.operation,
          committed: true,
          appliedChanges: body,
          committedValues: { watchdog: after },
          result,
          note: "a watchdog configuration change queues an evaluation and may start agent execution",
        };
      },
    ),

    makeTool(
      "paperclipManageIssueLinks",
      "CRITICAL — URL / LINK FIELD: the Paperclip UI URL row is a DERIVED PROJECTION. There is no writable `issue.url` column: the built-in 'url' external-object detector scans the issue description, comments and documents and materializes external_objects rows. This tool therefore edits the ACTUAL source record and reports the source type and source record id - it never claims to write a native field that does not exist. " +
        "Operations: list (external objects + summary + source record), add (append the URL to the chosen source: comment (default, additive) or description), update (replace an existing URL text in the source), remove (delete the source comment, or remove the URL text from the description). After a write the external objects are refreshed so the derived projection is re-derived. Distinguish Docker-internal addresses (e.g. http://plasmic-mcp:8091/mcp) from publicly resolvable DNS - an address that is not resolvable from the current network namespace is NOT invalid. " +
        "CRITICAL — NATIVE PAPERCLIP ISSUE CONFIGURATION: Relationships and Execution fields directly control DAG correctness, agent ownership, delivery eligibility, independent review, dependency wakeups and recovery. Never approximate native relationships or execution configuration using issue descriptions or comments. " +
        " " + CRITICAL_WORKFLOW_INTEGRITY,
      z.object({
        issueId: issueIdSchema,
        operation: z.enum(["list", "add", "update", "remove"]),
        url: z.string().url().optional().describe("URL to add/replace"),
        existingUrl: z.string().optional().describe("URL text to replace or remove (update/remove)"),
        source: z.enum(["comment", "description"]).optional().default("comment").describe("Which source record holds the URL"),
        sourceCommentId: z.string().guid().optional().describe("Source comment to update/remove (discovered via operation=list)"),
        dryRun: dryRunDefault,
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async (input) => {
        const issue = await requireIssue(client, input.issueId);
        const issueUuid = str(issue.id) as string;

        if (input.operation === "list") {
          const objects = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-objects`);
          const summary = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-object-summary`);
          return {
            issueId: issueUuid,
            identifier: str(issue.identifier),
            operation: input.operation,
            sourceOfTruth: "derived projection over issue description/comments/documents (external_objects, providerKey 'url')",
            writableNativeField: false,
            externalObjects: objects,
            summary,
            availableMutations: ["paperclipManageIssueLinks(operation=add|update|remove)"],
          };
        }

        if (!input.url && input.operation !== "remove") {
          throw invalid(`${input.operation} requires url`);
        }
        if (input.operation === "remove" && !input.existingUrl && !input.sourceCommentId) {
          throw invalid("remove requires existingUrl (text to drop) or sourceCommentId (comment to delete)");
        }

        const source = input.source ?? "comment";
        if (input.dryRun) {
          return {
            issueId: issueUuid,
            operation: input.operation,
            dryRun: true,
            committed: false,
            planned: { source, url: input.url ?? null, existingUrl: input.existingUrl ?? null, sourceCommentId: input.sourceCommentId ?? null },
          };
        }

        let writeDetail: Record<string, unknown>;
        if (source === "description") {
          const description = typeof issue.description === "string" ? issue.description : "";
          let next: string;
          if (input.operation === "add") {
            next = description.trim() ? `${description}\n${input.url}` : String(input.url);
          } else if (input.operation === "update") {
            if (!input.existingUrl) throw invalid("update requires existingUrl");
            if (!description.includes(input.existingUrl)) throw invalid("existingUrl was not found in the issue description");
            next = description.split(input.existingUrl).join(String(input.url));
          } else {
            if (!input.existingUrl) throw invalid("remove requires existingUrl");
            if (!description.includes(input.existingUrl)) throw invalid("existingUrl was not found in the issue description");
            next = description.split(input.existingUrl).join("").replace(/\n{3,}/g, "\n\n").trim();
          }
          const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueUuid)}`, {
            body: { description: next },
            runId: input.runId ?? undefined,
            operatorRunId: input.operatorRunId ?? undefined,
          });
          writeDetail = { source: "description", updated };
        } else {
          if (input.operation === "remove") {
            if (!input.sourceCommentId) throw invalid("remove on a comment source requires sourceCommentId");
            const deleted = await client.requestJson<unknown>("DELETE", `/issues/${enc(issueUuid)}/comments/${enc(input.sourceCommentId)}`, {
              runId: input.runId ?? undefined,
              operatorRunId: input.operatorRunId ?? undefined,
            });
            writeDetail = { source: "comment", sourceCommentId: input.sourceCommentId, deleted };
          } else if (input.operation === "update") {
            if (!input.existingUrl) throw invalid("update requires existingUrl");
            if (!input.sourceCommentId) {
              throw invalid("update on a comment source requires sourceCommentId (comments are immutable - use source=description or delete and re-add)");
            }
            const comments = await client.requestJson<unknown>("GET", `/issues/${enc(issueUuid)}/comments?limit=500`);
            const list = Array.isArray(comments) ? comments : isRecord(comments) && Array.isArray(comments.comments) ? comments.comments : [];
            const target = list.filter(isRecord).find((c) => str(c.id) === input.sourceCommentId);
            if (!target) throw notFound(`Comment ${input.sourceCommentId}`);
            const body = typeof target.body === "string" ? target.body : "";
            if (!body.includes(input.existingUrl as string)) throw invalid("existingUrl was not found in the source comment");
            const deleted = await client.requestJson<unknown>("DELETE", `/issues/${enc(issueUuid)}/comments/${enc(input.sourceCommentId)}`, {
              runId: input.runId ?? undefined,
              operatorRunId: input.operatorRunId ?? undefined,
            });
            const created = await client.requestJson<Record<string, unknown>>("POST", `/issues/${enc(issueUuid)}/comments`, {
              body: { body: body.split(input.existingUrl as string).join(String(input.url)) },
              runId: input.runId ?? undefined,
              operatorRunId: input.operatorRunId ?? undefined,
            });
            writeDetail = { source: "comment", sourceCommentId: created.id, deleted, created };
          } else {
            const created = await client.requestJson<Record<string, unknown>>("POST", `/issues/${enc(issueUuid)}/comments`, {
              body: { body: String(input.url) },
              runId: input.runId ?? undefined,
              operatorRunId: input.operatorRunId ?? undefined,
            });
            writeDetail = { source: "comment", sourceCommentId: created.id, created };
          }
        }

        const refresh = await client.requestJson<unknown>("POST", `/issues/${enc(issueUuid)}/external-objects/refresh`, {
          body: {},
          runId: input.runId ?? undefined,
          operatorRunId: input.operatorRunId ?? undefined,
        }).catch(() => null);
        const objects = await client.getJsonOrNull<unknown>(`/issues/${enc(issueUuid)}/external-objects`);

        return {
          issueId: issueUuid,
          identifier: str(issue.identifier),
          operation: input.operation,
          committed: true,
          sourceOfTruth: "derived projection over issue description/comments/documents (external_objects, providerKey 'url')",
          writableNativeField: false,
          appliedChanges: writeDetail,
          committedValues: { externalObjects: objects },
          refresh,
        };
      },
    ),
  ];
}
