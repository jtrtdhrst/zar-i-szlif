import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PaperclipApiClient } from "./client.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { validateParentHierarchy } from "./issue-hierarchy.js";
import {
  CRITICAL_MONITOR,
  CRITICAL_RELATIONSHIPS,
  CRITICAL_REVIEW_STATE,
  CRITICAL_VALIDATE_DAG,
} from "./critical-notice.js";
import { assertTaskSessionWorkspaceIsolation } from "./workspace-isolation.js";
import {
  allowNativeCheckout,
  confirmedIssueBoundRuns,
  hasFalseInProgress,
  isNativeReviewPending,
  nativeRetryRouteMissing,
} from "./execution-truth.js";

// 1012 compat (MCP-side): /control-plane-revision was removed upstream.
// Fall back to a synthetic token derived from the company issueCounter.
// Consistent within a session for optimistic concurrency; flagged synthetic.
async function getRevisionCompat(client: PaperclipApiClient): Promise<{ revision: string; synthetic: boolean; raw: Record<string, unknown> }> {
  try {
    const rev = await client.requestJson<Record<string, unknown>>("GET", `/companies/${client.resolveCompanyId()}/control-plane-revision`);
    const r = (rev as any)?.revision;
    if (typeof r === "string" && r) return { revision: r, synthetic: false, raw: rev };
  } catch { /* 1012 removed the route; fall through to synthetic */ }
  const company = await client.requestJson<Record<string, unknown>>("GET", `/companies/${client.resolveCompanyId()}`).catch(() => ({} as Record<string, unknown>));
  const counter = (company as any)?.issueCounter ?? 0;
  const revision = `mcp1:counter:${counter}`;
  return { revision, synthetic: true, raw: { revision, synthetic: true } };
}


// Control-plane / operator tools for the Paperclip MCP server.
// Thin wrappers over existing /api endpoints plus small MCP-side compositions.
// No backend changes: where the backend has no first-class endpoint the tool
// says so in its description and implements the closest auditable equivalent.

export interface ControlPlaneToolDefinition {
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
): ControlPlaneToolDefinition {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Non-empty string field of a record, or null. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

// Only a missing resource (404) is absorbed. Denials (401/403) and transport
// failures propagate: swallowing them reported "access denied" as "no data".
async function getJsonOrNull(client: PaperclipApiClient, path: string): Promise<unknown> {
  return client.getJsonOrNull(path);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

const issueIdSchema = z.string().min(1);
const runIdSchema = z.string().guid();
const runIdOptional = z.string().guid().optional().nullable();
const operatorRunIdOptional = z.string().guid().optional().nullable(); // KOMAA-630
const limitSchema = z.number().int().positive().max(200).optional();

// KOMAA-1366: local mirror of the server's resolveIssueRecoveryActionSchema
// superRefine (packages/shared/src/validators/issue.ts:583-626). The server
// REQUIRES sourceIssueStatus and couples it to the outcome, so the gateway
// rejects a mismatched pair locally (typed error, zero upstream requests)
// instead of paying an opaque upstream 400.
const RECOVERY_OUTCOME_SOURCE_STATUS: Record<string, readonly string[]> = {
  restored: ["todo", "done", "in_review"],
  blocked: ["blocked"],
  false_positive: ["done", "in_review"],
  cancelled: ["done", "in_review"],
};

const recoveryOutcomeStatusSchema = z
  .object({
    outcome: z.enum(["restored", "blocked", "false_positive", "cancelled"]),
    sourceIssueStatus: z.enum(["todo", "done", "in_review", "blocked"]),
  })
  .superRefine((value, ctx) => {
    const allowed = RECOVERY_OUTCOME_SOURCE_STATUS[value.outcome] ?? [];
    if (!allowed.includes(value.sourceIssueStatus)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Recovery outcome "${value.outcome}" requires sourceIssueStatus to be one of ${allowed.join("|")}`,
        path: ["sourceIssueStatus"],
      });
    }
  });
const HOLD_DOCUMENT_KEY = "control-plane-execution-hold"; // server documentKeySchema: ^[a-z0-9][a-z0-9_-]*$ (no slashes)

// Reject assignment-stripping patches (mirrors the guard in tools.ts).
function assertKeepsAgentAssignee(body: unknown): void {
  if (!isRecord(body)) return;
  if (("assigneeAgentId" in body && (body.assigneeAgentId === null || body.assigneeAgentId === "")) ||
    ("assigneeUserId" in body && body.assigneeUserId !== undefined && body.assigneeUserId !== null)) {
    throw new Error("Task assignment cannot be removed or changed to a user through control-plane tools; keep an agent assignee");
  }
}

function issueStatusOf(issue: unknown): string | null {
  return isRecord(issue) && typeof issue.status === "string" ? issue.status : null;
}

function blockedByIdsOf(issue: unknown): string[] {
  if (!isRecord(issue)) return [];
  const raw = issue.blockedByIssueIds ?? issue.blockedBy;
  if (Array.isArray(raw)) {
    return raw.map((entry) => (isRecord(entry) ? String(entry.id ?? entry.issueId ?? "") : String(entry)).trim()).filter(Boolean);
  }
  return [];
}

// KOMAA-874: issue_relations is the authoritative DAG. GET /issues/:id and the
// company list carry blockedByIssueIds only as a denormalized projection that
// demonstrably diverges (null/[] while relations exist). Every DAG
// read-modify-write below must use the relational endpoints
// (/diagnostics/blockers, subtree node.blockers) and treat the projection as
// display-only. syncBlockedByIssueIds REPLACES the full edge set, so a PATCH
// computed from a diverged projection destroys real edges.
function blockerEntriesFromBlockersDiag(diag: unknown): Array<{ id: string; identifier: string | null; status: string | null }> {
  if (!isRecord(diag) || !Array.isArray(diag.blockers)) return [];
  const out: Array<{ id: string; identifier: string | null; status: string | null }> = [];
  for (const b of diag.blockers) {
    if (!isRecord(b)) continue;
    const id = typeof b.id === "string" ? b.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      identifier: typeof b.identifier === "string" ? b.identifier : null,
      status: typeof b.status === "string" ? b.status : null,
    });
  }
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

async function relationalBlockerEntries(
  client: PaperclipApiClient,
  issueId: string,
): Promise<{ entries: Array<{ id: string; identifier: string | null; status: string | null }>; unavailable: boolean }> {
  const diag = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`);
  if (!isRecord(diag) || !Array.isArray(diag.blockers)) return { entries: [], unavailable: true };
  return { entries: blockerEntriesFromBlockersDiag(diag), unavailable: false };
}

// Live (non-terminal) relational blocker UUIDs for done-edge removal. Never
// derive the surviving set from the projection: a diverged projection would
// drop live edges that the PATCH then destroys (sync replaces the full set).
async function relationalLiveBlockerIds(
  client: PaperclipApiClient,
  issueId: string,
): Promise<{ live: string[]; unavailable: boolean; truncated: boolean }> {
  const diag = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`);
  if (!isRecord(diag) || !Array.isArray(diag.blockers)) return { live: [], unavailable: true, truncated: false };
  const live: string[] = [];
  for (const b of diag.blockers) {
    if (!isRecord(b) || typeof b.id !== "string" || !b.id) continue;
    const st = typeof b.status === "string" ? b.status : "";
    if (st !== "done" && st !== "cancelled") live.push(b.id);
  }
  return { live: [...new Set(live)], unavailable: false, truncated: diag.truncated === true };
}

// Confirm "no relational blockers" before any auto-unblock from an empty
// projection. False (or unreachable diagnostics) means "unknown" — never
// unblock on unknown.
async function relationalBlockersEmpty(client: PaperclipApiClient, issueId: string): Promise<boolean> {
  const rel = await relationalBlockerEntries(client, issueId);
  return !rel.unavailable && rel.entries.length === 0;
}

// Resolve operator-supplied blocker refs (UUID or KOMAA-identifier) against
// relational entries; unresolvable tokens pass through for server validation.
function resolveBlockerRefs(
  entries: Array<{ id: string; identifier: string | null }>,
  tokens: string[],
): string[] {
  const byToken = new Map<string, string>();
  for (const e of entries) {
    byToken.set(e.id, e.id);
    if (e.identifier) byToken.set(e.identifier, e.id);
  }
  return tokens.map((t) => byToken.get(t) ?? t);
}

function resolveIssueRef(issue: unknown, ref: string): string {
  // Accept a UUID or a human identifier (KOMAA-123); relations store UUIDs.
  if (!isRecord(issue)) return ref;
  if (typeof issue.id === "string" && (issue.id === ref || ref === issue.id)) return issue.id;
  if (typeof issue.identifier === "string" && issue.identifier === ref && typeof issue.id === "string") return issue.id;
  return typeof issue.id === "string" ? issue.id : ref;
}

// Real subtree nodeResponse shape:
// { issue: {id, identifier, status, ...}, blockers: [{id, identifier, status, ...}],
//   omittedUnauthorizedBlockerCount, truncatedSections: {blockers, ...}, ... }
function subtreeNodeView(node: unknown): {
  id: string;
  identifier: string | null;
  status: string;
  blockers: Array<{ id: string; identifier: string | null; status: string | null }>;
  omittedBlockers: number;
  truncatedBlockers: boolean;
} {
  if (!isRecord(node)) return { id: "", identifier: null, status: "", blockers: [], omittedBlockers: 0, truncatedBlockers: false };
  const inner = isRecord(node.issue) ? node.issue : node;
  const id = typeof inner.id === "string" ? inner.id : (typeof node.id === "string" ? node.id : "");
  const identifier = typeof inner.identifier === "string" ? inner.identifier : (typeof node.identifier === "string" ? node.identifier : null);
  const status = typeof inner.status === "string" ? inner.status : (typeof node.status === "string" ? node.status : "");
  const rawBlockers = Array.isArray(node.blockers) ? node.blockers : [];
  const blockers: Array<{ id: string; identifier: string | null; status: string | null }> = [];
  for (const b of rawBlockers) {
    if (!isRecord(b)) continue;
    const bid = typeof b.id === "string" ? b.id : "";
    if (!bid) continue;
    blockers.push({
      id: bid,
      identifier: typeof b.identifier === "string" ? b.identifier : null,
      status: typeof b.status === "string" ? b.status : null,
    });
  }
  const omitted = typeof node.omittedUnauthorizedBlockerCount === "number" ? node.omittedUnauthorizedBlockerCount : 0;
  const truncSections = isRecord(node.truncatedSections) ? node.truncatedSections : null;
  const truncated = (truncSections?.blockers === true) || node.truncated === true;
  return { id, identifier, status, blockers, omittedBlockers: omitted, truncatedBlockers: truncated === true };
}

// Real subtree edge shape: {kind: "blocks"|"parent"|..., fromIssueId, toIssueId}.
// A blocks edge points blocker -> blocked (fromIssueId is the blocker).
function blocksEdgesFromSubtree(subtree: unknown): Array<{ from: string; to: string }> {
  if (!isRecord(subtree) || !Array.isArray(subtree.edges)) return [];
  const out: Array<{ from: string; to: string }> = [];
  for (const e of subtree.edges) {
    if (!isRecord(e)) continue;
    if (e.kind !== undefined && e.kind !== null && e.kind !== "blocks") continue;
    const from = String(e.fromIssueId ?? e.from ?? e.blockedBy ?? "");
    const to = String(e.toIssueId ?? e.to ?? e.issueId ?? "");
    if (from && to) out.push({ from, to });
  }
  return out;
}

// ---- execution-hold helpers (document-backed, independent of the blockedBy DAG) ----
//
// KOMAA-461: an execution hold used to be free text only, so it had no expiry.
// A *capacity* hold ("wait for the other Harness P0 to finish") kept blocking
// after its gate issue was done, permanently starving the queue. Holds are now
// typed. Only `capacity` holds carry a gate and only they may auto-expire; every
// other kind (safety, host, security, external, credential, unknown/legacy) is
// fail-closed and must be cleared by a human.
const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

const EXECUTION_HOLD_KINDS = ["capacity", "safety", "host", "security", "external", "credential"] as const;
type ExecutionHoldKind = (typeof EXECUTION_HOLD_KINDS)[number];

function isExecutionHoldKind(value: unknown): value is ExecutionHoldKind {
  return typeof value === "string" && (EXECUTION_HOLD_KINDS as readonly string[]).includes(value);
}

/**
 * Phrases that mark a legacy free-text hold as pure scheduling/WIP capacity.
 * Only a hold carrying one of these AND naming a gate issue is a candidate for
 * automatic expiry. Anything else stays fail-closed.
 */
const LEGACY_CAPACITY_HOLD_MARKERS = [
  "capacity hold",
  "value-first capacity",
  "serialization hold",
  "anti-churn containment",
  "one-active-run-per-agent",
  "single active",
  "scheduling/wip control",
];

/**
 * Safety markers veto expiry unconditionally. Checked *before* the capacity
 * markers so a hold that mixes "capacity" with a real safety gate stays held.
 */
const LEGACY_SAFETY_HOLD_MARKERS = [
  "safety hold",
  "safety gate",
  "host-only",
  "host state",
  "external host",
  "security",
  "credential",
  "write access",
  "do not grant",
  "immutable review freeze",
  "review freeze",
  "control-plane outage",
  "liveness",
  "provisioning",
  "do not execute",
  "do not retry",
  "superseded",
];

type ExecutionHoldView = {
  hold: Record<string, unknown>;
  kind: ExecutionHoldKind | null;
  gateIssueId: string | null;
  gateIdentifier: string | null;
  /**
   * True when the hold is capacity-only and its gate issue is already
   * done/cancelled. The hold no longer blocks, but the document still exists
   * until an apply path deletes it.
   */
  expired: boolean;
  /** True when the hold is typed non-capacity, legacy-unclassified, or unresolvable. Never auto-cleared. */
  manualOnly: boolean;
};

function identifierFromReason(reason: string): string | null {
  const match = reason.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
  return match ? match[0] : null;
}

function classifyExecutionHold(hold: Record<string, unknown>): Omit<ExecutionHoldView, "expired"> {
  const reason = typeof hold.reason === "string" ? hold.reason : "";
  const lower = reason.toLowerCase();
  // `kind` stays "execution_hold" (the document type marker, unchanged for
  // every already-written hold). `holdKind` carries the typed classification.
  const declaredKind = isExecutionHoldKind(hold.holdKind) ? hold.holdKind : null;
  const gateIssueId = typeof hold.gateIssueId === "string" && hold.gateIssueId.trim() ? hold.gateIssueId.trim() : null;
  const gateIdentifier = typeof hold.gateIssueIdentifier === "string" && hold.gateIssueIdentifier.trim()
    ? hold.gateIssueIdentifier.trim()
    : identifierFromReason(reason);

  if (declaredKind && declaredKind !== "capacity") {
    return { hold, kind: declaredKind, gateIssueId, gateIdentifier, manualOnly: true };
  }
  if (declaredKind === "capacity") {
    return { hold, kind: "capacity", gateIssueId, gateIdentifier, manualOnly: false };
  }

  // Legacy free text. A real safety gate vetoes expiry even when the wording
  // also mentions capacity/serialization.
  if (LEGACY_SAFETY_HOLD_MARKERS.some((marker) => lower.includes(marker))) {
    return { hold, kind: null, gateIssueId: null, gateIdentifier, manualOnly: true };
  }
  if (gateIdentifier && LEGACY_CAPACITY_HOLD_MARKERS.some((marker) => lower.includes(marker))) {
    return { hold, kind: "capacity", gateIssueId, gateIdentifier, manualOnly: false };
  }
  return { hold, kind: null, gateIssueId: null, gateIdentifier, manualOnly: true };
}

/**
 * One list call instead of a per-key GET. A missing key used to answer 404,
 * so every read of a hold-less issue wrote an error line into the server log
 * (5k+ of them). The list is the same projection the GET returns, plus every
 * sibling key.
 */
async function readIssueDocumentByKey(client: PaperclipApiClient, issueId: string, key: string): Promise<Record<string, unknown> | null> {
  const docs = await client.getJsonOrNull<unknown>(`/issues/${enc(issueId)}/documents?includeSystem=true`);
  if (!Array.isArray(docs)) return null;
  const hit = docs.find((doc) => isRecord(doc) && doc.key === key);
  return isRecord(hit) ? hit : null;
}

async function readExecutionHoldDocument(client: PaperclipApiClient, issueId: string): Promise<Record<string, unknown> | null> {
  const doc = await readIssueDocumentByKey(client, issueId, HOLD_DOCUMENT_KEY);
  if (!isRecord(doc)) return null;
  const body = typeof doc.body === "string" ? doc.body : null;
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : { raw: body };
  } catch {
    return { raw: body };
  }
}

/**
 * Reads the hold and resolves its gate. A capacity hold whose gate is already
 * terminal comes back with `expired: true`, which every eligibility path treats
 * as "not blocking" — the stale hold stops starving the queue immediately, even
 * before anyone runs an apply pass. Only an apply pass deletes the document.
 */
async function readExecutionHold(
  client: PaperclipApiClient,
  issueId: string,
  options: { applyExpiry?: boolean; runId?: string | null; operatorRunId?: string | null } = {}, // KOMAA-630
): Promise<ExecutionHoldView | null> {
  const raw = await readExecutionHoldDocument(client, issueId);
  if (!raw) return null;
  const view = classifyExecutionHold(raw);
  if (view.manualOnly) return { ...view, expired: false };

  const gate = await resolveGateIssue(client, view.gateIssueId, view.gateIdentifier);
  if (!gate || !TERMINAL_ISSUE_STATUSES.has(gate.status)) return { ...view, expired: false };

  if (options.applyExpiry) {
    await clearExecutionHoldDocument(client, issueId, options.runId ?? null, options.operatorRunId ?? null, {
      gateIssueId: gate.id,
      gateIdentifier: gate.identifier,
      gateStatus: gate.status,
    });
  }
  return { ...view, expired: true };
}

/** The hold only blocks while it exists and has not expired. */
function blockingHold(view: ExecutionHoldView | null): Record<string, unknown> | null {
  return view && !view.expired ? view.hold : null;
}

async function resolveGateIssue(
  client: PaperclipApiClient,
  gateIssueId: string | null,
  gateIdentifier: string | null,
): Promise<{ id: string; identifier: string | null; status: string } | null> {
  if (gateIssueId) {
    const direct = await getJsonOrNull(client, `/issues/${enc(gateIssueId)}`);
    const status = issueStatusOf(direct);
    if (!status) return null;
    return {
      id: gateIssueId,
      identifier: isRecord(direct) && typeof direct.identifier === "string" ? direct.identifier : gateIdentifier,
      status,
    };
  }
  if (!gateIdentifier) return null;
  // No by-identifier endpoint exists, so resolve through the company issue list.
  const companyId = client.resolveCompanyId();
  const list = await getJsonOrNull(client, `/companies/${companyId}/issues${qs({ limit: 200 })}`);
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (isRecord(entry) && entry.identifier === gateIdentifier && typeof entry.status === "string") {
      return { id: String(entry.id), identifier: gateIdentifier, status: entry.status };
    }
  }
  return null;
}

async function clearExecutionHoldDocument(
  client: PaperclipApiClient,
  issueId: string,
  runId: string | null,
  operatorRunId: string | null = null, // KOMAA-630
  gate: { gateIssueId: string; gateIdentifier: string | null; gateStatus: string },
): Promise<void> {
  await client.requestJson("DELETE", `/issues/${enc(issueId)}/documents/${enc(HOLD_DOCUMENT_KEY)}`, { runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // KOMAA-630
  const target = gate.gateIdentifier ?? gate.gateIssueId;
  await client
    .requestJson("POST", `/issues/${enc(issueId)}/comments`, {
      body: {
        body: `[control-plane] execution hold auto-expired: capacity gate ${target} is ${gate.gateStatus}. Hold was capacity-only; no dependency edges changed and no wake was enqueued.`,
      },
      runId: runId ?? undefined,
      operatorRunId: operatorRunId ?? undefined, // KOMAA-630
    })
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// Runs & scheduler
// ---------------------------------------------------------------------------
function runTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipListRuns",
      "List heartbeat runs for a company, newest first. Filter by agent/status; summary mode returns compact rows.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "expired"]).optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
        summary: z.boolean().optional().default(true),
      }),
      async ({ agentId, status, limit, summary }) => {
        const companyId = client.resolveCompanyId();
        const rows = await client.requestJson<unknown[]>(
          "GET",
          `/companies/${companyId}/heartbeat-runs${qs({ agentId: agentId ?? undefined, limit, summary })}`,
        );
        const list = Array.isArray(rows) ? rows : [];
        return status ? list.filter((run) => isRecord(run) && run.status === status) : list;
      },
    ),
    makeTool(
      "paperclipListLiveRuns",
      "Snapshot of queued/running runs company-wide (queue + running + slot holders). Prefer this over reconstructing scheduler state per issue.",
      z.object({ limit: z.number().int().positive().max(100).optional().default(50), minCount: z.number().int().min(0).max(100).optional().default(0) }),
      async ({ limit, minCount }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("GET", `/companies/${companyId}/live-runs${qs({ limit, minCount })}`);
      },
    ),
    makeTool(
      "paperclipGetCurrentOperatorRun",
      "Return the active PAPERCLIP_RUN_ID operator context of this MCP session (if any) plus its live run record. Use the returned runId for cross-issue writes.",
      z.object({}),
      async () => {
        const runId = client.defaults.runId;
        if (!runId) {
          return { runId: null, run: null, note: "No PAPERCLIP_RUN_ID in this MCP session; cross-issue writes will be rejected with cross_issue_influence_run_context_required." };
        }
        const run = await getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}`);
        return { runId, run };
      },
    ),
    makeTool(
      // KOMAA-1415: Paperclip 2026.1012.0 removed POST /companies/:id/operator-runs,
      // so operator sessions cannot be minted. The tool name is kept (stable
      // public tool surface) but it now RESOLVES the caller's sanctioned
      // execution context instead of advertising a dead mutation:
      //   1. the session's own live PAPERCLIP_RUN_ID, verified against the API
      //      (the run's end IS the credential's expiration), or
      //   2. the Board lane when the session carries an enrolled Board credential.
      // It never fabricates a run id and never falls back to another principal.
      "paperclipStartOperatorRun",
      "Resolve the caller's sanctioned execution context for user-directed control-plane work. Paperclip 2026.1012.0 removed operator sessions (POST /companies/:id/operator-runs), so this tool mints nothing: it returns the session's own live PAPERCLIP_RUN_ID (verified) or the Board lane, and fails closed with NO_RUN_CONTEXT when neither exists. Pass the returned runId to tools that accept one.",
      z.object({
        reason: z.string().trim().min(1).max(500),
        scopeIssueIds: z.array(z.string().min(1)).max(20).optional().default([]),
        agentId: z.string().uuid().optional(),
      }),
      async ({ reason, scopeIssueIds, agentId }) => {
        const runId = client.defaults.runId;
        if (runId) {
          const run = await getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}`);
          return {
            authority: "agent-run",
            operatorRunId: null,
            runId,
            run,
            reason,
            scopeIssueIds,
            agentId: agentId ?? client.defaults.agentId ?? null,
            usage: "Own live run context: pass this runId to tools that accept one. It is issue-bound and expires when the run ends; operator sessions are removed upstream.",
          };
        }
        if (client.hasBoardCredential) {
          return {
            authority: "board",
            operatorRunId: null,
            runId: null,
            run: null,
            reason,
            scopeIssueIds,
            agentId: agentId ?? client.defaults.agentId ?? null,
            usage: "Board lane: call board-scoped tools directly (no operatorRunId exists on 2026.1012.0). Agent-scoped tools still require the caller's own live run.",
          };
        }
        throw new Error(
          "No sanctioned execution context: this session has neither an active PAPERCLIP_RUN_ID nor an enrolled Board credential. Operator sessions were removed in Paperclip 2026.1012.0, so none can be minted. Run inside your own live heartbeat run (PAPERCLIP_RUN_ID) or use the Board-authenticated MCP lane [errorCode=NO_RUN_CONTEXT]",
        );
      },
    ),
    makeTool(
      "paperclipCancelRun",
      "Cancel/revoke a queued or running heartbeat run. MCP always uses the server board key (company-wide, any owner); recovery treats board cancels as operator stand-down.",
      z.object({ runId: runIdSchema, reason: z.string().trim().max(500).optional() , operatorRunId: operatorRunIdOptional}), // KOMAA-630
      // FIX 2026-10-14: forward operatorRunId (wczesniej gubiony -> operator nie mogl kasowac cudzych runow bez heartbeat runId).
      async ({ runId, operatorRunId }) => client.requestJson("POST", `/heartbeat-runs/${enc(runId)}/cancel`, { body: {}, runId: undefined, operatorRunId: operatorRunId ?? undefined }),
    ),
    makeTool(
      "paperclipReapStaleRuns",
      "Find stale/zombie live runs (older than maxAgeMinutes, or finished-issue holders) and optionally cancel them. Dry-run by default; set apply:true to cancel.",
      z.object({
        maxAgeMinutes: z.number().int().positive().max(10080).optional().default(120),
        apply: z.boolean().optional().default(false),
        limit: z.number().int().positive().max(100).optional().default(50),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async ({ maxAgeMinutes, apply, limit, runId, operatorRunId }) => {
        const auth = { ...(runId ? { runId } : {}), ...(operatorRunId ? { operatorRunId } : {}) }; // P1 2026-10-14
        const companyId = client.resolveCompanyId();
        const live = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/live-runs${qs({ limit })}`);
        const cutoff = Date.now() - maxAgeMinutes * 60_000;
        const stale = (Array.isArray(live) ? live : []).filter((run) => {
          if (!isRecord(run)) return false;
          const createdAt = typeof run.createdAt === "string" ? Date.parse(run.createdAt) : NaN;
          const silenceMs = isRecord(run.outputSilence) && typeof run.outputSilence.silenceMs === "number"
            ? run.outputSilence.silenceMs as number
            : 0;
          return (Number.isFinite(createdAt) && createdAt < cutoff) || silenceMs > maxAgeMinutes * 60_000;
        });
        const results: unknown[] = [];
        if (apply) {
          for (const run of stale) {
            if (!isRecord(run) || typeof run.id !== "string") continue;
            try {
              results.push({ runId: run.id, cancelled: await client.requestJson("POST", `/heartbeat-runs/${enc(run.id)}/cancel`, { body: {}, ...auth }) });
            } catch (error) {
              results.push({ runId: run.id, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        return { cutoff: new Date(cutoff).toISOString(), staleCount: stale.length, stale, applied: apply, results };
      },
    ),
    makeTool(
      "paperclipListScheduledRetries",
      "List issues with a pending scheduledRetry snapshot (retry that can absorb/coalesce future wakes). Bounded scan over recent issues.",
      z.object({ limit: z.number().int().positive().max(100).optional().default(50), status: z.string().optional() }),
      async ({ limit, status }) => {
        const companyId = client.resolveCompanyId();
        const issues = await client.requestJson<unknown[]>(
          "GET",
          `/companies/${companyId}/issues${qs({ limit, ...(status ? { status } : {}) })}`,
        );
        const withRetry = (Array.isArray(issues) ? issues : [])
          .filter((issue) => isRecord(issue) && issue.scheduledRetry != null)
          .map((issue) => {
            const rec = issue as Record<string, unknown>;
            return {
              issueId: rec.id ?? null, identifier: rec.identifier ?? null, title: rec.title ?? null,
              status: rec.status ?? null, scheduledRetry: rec.scheduledRetry,
            };
          });
        return { count: withRetry.length, retries: withRetry };
      },
    ),
    makeTool(
      "paperclipCancelScheduledRetry",
      "Invalidate a pending scheduled retry by cancelling its underlying run (if still live). Stops the retry from coalescing future wakes.",
      z.object({ issueId: issueIdSchema, runId: runIdOptional, operatorRunId: operatorRunIdOptional }),
      async ({ issueId, runId, operatorRunId }) => {
        const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const retry = isRecord(issue.scheduledRetry) ? issue.scheduledRetry : null;
        const retryRunId = retry && typeof retry.runId === "string" ? retry.runId : null;
        if (!retryRunId) return { issueId, cancelled: false, reason: "Issue has no scheduledRetry.runId" };
        try {
          const cancelled = await client.requestJson("POST", `/heartbeat-runs/${enc(retryRunId)}/cancel`, { body: {}, ...(runId ? { runId } : {}), ...(operatorRunId ? { operatorRunId } : {}) }); // P1 2026-10-14
          return { issueId, runId: retryRunId, cancelled };
        } catch (error) {
          return { issueId, runId: retryRunId, cancelled: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    ),
    makeTool(
      "paperclipWakeIssueFresh",
      "Fresh wake of an issue via checkout for the owning agent, with eligibility preflight (blockers/hold/live run). Posts an optional operator note as a comment. Set force:true to skip the blocked/hold gate (recorded). REQUIRED for agent-actor callers: pass a live runId (own live issue run where supported); operator sessions are removed in Paperclip 2026.1012.0 (CAPABILITY_REMOVED) — without a live context the call fails 403.",
      z.object({
        issueId: issueIdSchema,
        agentId: z.string().guid().optional().nullable(),
        expectedStatuses: z.array(z.enum(["backlog", "todo", "in_progress", "in_review", "blocked"])).optional(),
        note: z.string().trim().max(2000).optional(),
        force: z.boolean().optional().default(false),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      // FIX 2026-10-14 (audyt MCP 132 B): wczesniej brak operatorRunId w schemacie
      // i brak forward do checkout/comment -> 403 cross_issue_influence_run_context_required
      // przy komentarzu-note jako agent. Teraz jawny auth + fallback do defaults.
      async ({ issueId, agentId, expectedStatuses, note, force, runId, operatorRunId }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const rk = runId ?? client.defaults.runId ?? null;
        const auth = { ...(rk ? { runId: rk } : {}), ...(op ? { operatorRunId: op } : {}) };
        const [issue, blockers, holdView, liveRuns] = await Promise.all([
          client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`),
          // The wake path is the re-preflight: an expired capacity hold clears
          // here so this call produces exactly one fresh wake and nothing else.
          readExecutionHold(client, issueId, {
            applyExpiry: true,
            runId: rk,
            operatorRunId: op,
          }),
          getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
        ]);
        const blockerCount = isRecord(blockers) && Array.isArray(blockers.blockers) ? blockers.blockers.length : 0;
        const liveCount = Array.isArray(liveRuns) ? liveRuns.length : 0;
        const hold = blockingHold(holdView);
        const status = issueStatusOf(issue);
        const workflow = isRecord(issue.executionState) ? issue.executionState : null;
        // force may override dependency gating, NEVER an active native review.
        if (isNativeReviewPending(status, workflow)) {
          return { woke: false, issueId, status, reason: "review_pending_no_checkout", currentStageId: workflow?.currentStageId ?? null, verified: true };
        }
        if (hasFalseInProgress(status, liveRuns)) {
          return { woke: false, issueId, status, reason: "false_progress_requires_reconciliation", verified: true };
        }
        if (confirmedIssueBoundRuns(liveRuns).length > 0) {
          return { woke: false, issueId, status, reason: "issue_already_has_live_run", verified: true };
        }
        if (!force && (status === "blocked" || blockerCount > 0 || hold)) {
          return {
            woke: false, issueId, status: issueStatusOf(issue), blockerCount, executionHold: hold,
            reason: "Eligibility preflight failed (blocked/hold). Pass force:true to override (recorded), or clear the hold/blockers first.",
          };
        }
        const resolvedAgent = agentId ?? (typeof issue.assigneeAgentId === "string" ? issue.assigneeAgentId : null) ?? client.defaults.agentId;
        if (!resolvedAgent) throw new Error("No agent to wake: pass agentId or ensure the issue has an assigneeAgentId");
        const checkout = await client.requestJson("POST", `/issues/${enc(issueId)}/checkout`, {
          body: { agentId: resolvedAgent, expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"] },
          ...auth,
        });
        let comment: unknown = null;
        if (note) {
          comment = await client.requestJson("POST", `/issues/${enc(issueId)}/comments`, { body: { body: note }, ...auth });
        }
        // Checkout may commit in_progress while scheduler skips the wake.
        // The acknowledgement is NOT proof of an issue-bound queued/running run.
        const issueBound = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
        const confirmedRuns = confirmedIssueBoundRuns(issueBound);
        return {
          woke: confirmedRuns.length > 0, verified: confirmedRuns.length > 0,
          checkoutAccepted: true, issueId, agentId: resolvedAgent, forced: force,
          reason: confirmedRuns.length > 0 ? "issue_run_observed" : "checkout_without_confirmed_issue_run",
          liveRunsBefore: liveCount, liveRunsAfter: confirmedRuns,
          checkout, commentPosted: Boolean(comment), operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipRetryIssueFresh",
      "Board-authorized fresh retry of a stuck scheduled retry (no coalescing into the old snapshot). Uses retry-now, then reports the new state.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => {
        const result = await client.requestJson("POST", `/issues/${enc(issueId)}/scheduled-retry/retry-now`, { body: {} });
        const after = await getJsonOrNull(client, `/issues/${enc(issueId)}`);
        return { result, issueAfter: isRecord(after) ? { status: after.status, scheduledRetry: after.scheduledRetry ?? null } : after };
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Eligibility, reconcile, holds, DAG, bulk
// ---------------------------------------------------------------------------
async function getEligibility(client: PaperclipApiClient, issueId: string): Promise<Record<string, unknown>> {
  const [issue, blockers, wakes, liveRuns, activeRun, runs, holdView] = await Promise.all([
    getJsonOrNull(client, `/issues/${enc(issueId)}`),
    getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`),
    getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/wakes`),
    getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
    getJsonOrNull(client, `/issues/${enc(issueId)}/active-run`),
    getJsonOrNull(client, `/issues/${enc(issueId)}/runs`),
    // Read-only: expiry is reported, not applied, so inspecting an issue can
    // never mutate it. A stale capacity hold is reported as non-blocking.
    readExecutionHold(client, issueId),
  ]);
  const hold = blockingHold(holdView);
  // ponytail: brak issue (404 -> null) to nie "wykonywalny z brakiem powodow"
  // tylko twardy guard; inaczej automatyzacja dostaje executable:true dla ducha.
  if (!isRecord(issue) || typeof issue.id !== "string") {
    return {
      issueId, status: null, executable: false, reasons: ["issue_not_found"],
      blockerCount: 0, blockers: [],
      executionHold: null,
      executionHoldGate: null,
      liveRunCount: 0, liveRuns: [],
      activeRun: null, wakes: null,
      recentRunCount: 0,
      assigneeAgentId: null,
    };
  }
  const status = issueStatusOf(issue);
  const blockerList: unknown[] = isRecord(blockers) && Array.isArray(blockers.blockers) ? blockers.blockers : blockedByIdsOf(issue);
  const liveList: unknown[] = Array.isArray(liveRuns) ? liveRuns : [];
  const reasons: string[] = [];
  // KOMAA-841: a status label is not proof of a leased heartbeat run.
  // Never classify review-pending or stale in_progress as runnable.
  const executionState = isRecord(issue.executionState) ? issue.executionState : null;
  if (status === "blocked" && blockerList.length === 0 && !hold) reasons.push("blocked_but_zero_blockers");
  if (status === "blocked") reasons.push("status_blocked");
  if (status === "in_review") reasons.push("review_pending");
  if (isNativeReviewPending(status, executionState) && status !== "in_review") reasons.push("review_stage_pending");
  if (hasFalseInProgress(status, liveList)) reasons.push("false_progress_no_issue_run");
  if (status === "in_progress" && confirmedIssueBoundRuns(liveList).length > 0) reasons.push("already_running_issue");
  if (status !== "todo" && status !== "backlog" && status !== "in_progress" && status !== "in_review" && status !== "blocked" && status !== "done" && status !== "cancelled") reasons.push("not_executable_status");
  if (blockerList.length > 0) reasons.push(`blocked_by_${blockerList.length}`);
  if (hold) reasons.push("execution_hold");
  if (status === "done" || status === "cancelled") reasons.push(`terminal_${status}`);
  if (status === "done" && liveList.length > 0) reasons.push("done_with_live_runs");
  if (status === "blocked" && liveList.length > 0) reasons.push("blocked_with_live_runs");
  const executable = reasons.length === 0;
  return {
    issueId, status, executable, reasons,
    blockerCount: blockerList.length, blockers: blockerList,
    executionHold: hold,
    executionHoldGate: holdView
      ? { kind: holdView.kind, gateIssueId: holdView.gateIssueId, gateIdentifier: holdView.gateIdentifier, expired: holdView.expired, manualOnly: holdView.manualOnly }
      : null,
    liveRunCount: liveList.length, liveRuns: liveList,
    activeRun, wakes,
    recentRunCount: Array.isArray(runs) ? runs.length : 0,
    assigneeAgentId: isRecord(issue) ? issue.assigneeAgentId ?? null : null,
  };
}

function eligibilityTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetExecutionEligibility",
      "Preflight check the scheduler would run at claim time: status, blockers, execution hold, live/active runs, recent runs. Returns executable:true plus exact reasons when not.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => getEligibility(client, issueId),
    ),
    makeTool(
      "paperclipReconcileIssueExecution",
      "Atomically reconcile one issue: cancel live runs on terminal/blocked-hold issues, flag blocked-with-zero-blockers. Dry-run by default; apply:true executes (bounded, audited via comment).",
      z.object({ issueId: issueIdSchema, apply: z.boolean().optional().default(false), note: z.string().trim().max(1000).optional(), runId: runIdOptional, operatorRunId: operatorRunIdOptional }),
      async ({ issueId, apply, note, runId, operatorRunId }) => {
        const auth = { ...(runId ? { runId } : {}), ...(operatorRunId ? { operatorRunId } : {}) };
        const eligibility = await getEligibility(client, issueId);
        const actions: unknown[] = [];
        const liveRuns = Array.isArray(eligibility.liveRuns) ? eligibility.liveRuns : [];
        const reasons = Array.isArray(eligibility.reasons) ? (eligibility.reasons as string[]) : [];
        const shouldCancelLive = reasons.includes("terminal_done") || reasons.includes("terminal_cancelled") ||
          (eligibility.executionHold && liveRuns.length > 0);
        if (shouldCancelLive) {
          for (const run of liveRuns) {
            if (!isRecord(run) || typeof run.id !== "string") continue;
            if (!apply) {
              actions.push({ action: "would_cancel_run", runId: run.id });
              continue;
            }
            try {
              await client.requestJson("POST", `/heartbeat-runs/${enc(run.id)}/cancel`, { body: {}, ...auth });
              actions.push({ action: "cancelled_run", runId: run.id });
            } catch (error) {
              actions.push({ action: "cancel_failed", runId: run.id, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        if (reasons.includes("blocked_but_zero_blockers")) {
          actions.push({ action: apply ? "flagged" : "would_flag", finding: "blocked_but_zero_blockers", hint: "Clear the blocked status or add a real blocker via paperclipPatchDependencyGraph" });
        }
        // KOMAA-461: legacy free-text capacity holds that named a gate issue
        // which is now terminal. This is the reconciliation pass for the stale
        // holds that blocked KOMAA-436/461. Safety/host/external holds are never
        // touched here (classifyExecutionHold marks them manualOnly).
        if (isRecord(eligibility.executionHoldGate) && eligibility.executionHoldGate.expired === true) {
          const gate = eligibility.executionHoldGate as Record<string, unknown>;
          if (!apply) {
            actions.push({
              action: "would_expire_capacity_hold",
              gateIssueId: gate.gateIssueId ?? null,
              gateIdentifier: gate.gateIdentifier ?? null,
            });
          } else {
            try {
              await clearExecutionHoldDocument(client, issueId, runId ?? client.defaults.runId ?? null, operatorRunId ?? client.defaults.operatorRunId ?? null, { // P1 2026-10-14: explicit auth first
                gateIssueId: String(gate.gateIssueId ?? gate.gateIdentifier ?? "unknown"),
                gateIdentifier: (gate.gateIdentifier as string | null) ?? null,
                gateStatus: "terminal",
              });
              actions.push({
                action: "expired_capacity_hold",
                gateIssueId: gate.gateIssueId ?? null,
                gateIdentifier: gate.gateIdentifier ?? null,
              });
            } catch (error) {
              // Report the failure instead of the success, so a caller never
              // reads "expired" for a hold that is still on disk.
              actions.push({ action: "capacity_hold_expiry_failed", error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        if (apply && (actions.some((a) => isRecord(a) && (a.action === "cancelled_run" || a.action === "flagged" || a.action === "expired_capacity_hold")) || note)) {
          try {
            await client.requestJson("POST", `/issues/${enc(issueId)}/comments`, {
              body: { body: `[control-plane reconcile] ${note ?? ""} reasons=${reasons.join(",")}`.trim() },
              ...auth,
            });
            actions.push({ action: "audit_comment_posted" });
          } catch (error) {
            actions.push({ action: "audit_comment_failed", error: error instanceof Error ? error.message : String(error) });
          }
        }
        return { eligibility, applied: apply, actions };
      },
    ),
    makeTool(
      "paperclipReconcileCompanyControlPlane",
      "Global dry-run of execution invariants across issues (blocked-with-zero-blockers, terminal-with-live-runs, holds). Bounded scan; apply:true cancels stale live runs on terminal issues only. KOMAA-874: blocked findings are confirmed against authoritative issue_relations — a diverged empty projection reports blocked_projection_diverged (never auto-unblocked), never blocked_zero_blockers.",
      z.object({ limit: z.number().int().positive().max(200).optional().default(200), apply: z.boolean().optional().default(false) }),
      async ({ limit, apply }) => {
        const companyId = client.resolveCompanyId();
        // Page the whole company. `limit` used to default to 100 and there was no
        // second request, so with 556 issues this "company-wide" sweep silently
        // inspected 18% of them and any stale capacity hold past the first page
        // was unreachable. Cap the page count so a pathological company cannot
        // turn a dry run into an unbounded crawl.
        const PAGE_CAP = 25;
        const list: unknown[] = [];
        for (let page = 0; page < PAGE_CAP; page++) {
          const batch = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ limit, offset: list.length })}`);
          const rows = Array.isArray(batch) ? batch : [];
          list.push(...rows);
          if (rows.length < limit) break;
        }
        const truncated = list.length >= limit * PAGE_CAP;
        const findings: unknown[] = [];
        const staleCapacityHolds: Array<Record<string, unknown>> = [];
        for (const entry of list) {
          if (!isRecord(entry) || typeof entry.id !== "string") continue;
          const status = typeof entry.status === "string" ? entry.status : "";
          const blockers = blockedByIdsOf(entry);
          const hasRetry = entry.scheduledRetry != null;
          const holdView = await readExecutionHold(client, entry.id);
          const hold = blockingHold(holdView);
          if (status === "blocked" && blockers.length === 0) {
            // KOMAA-874: the company list projection demonstrably diverges
            // (empty while issue_relations blockers exist). Confirm against
            // the relational endpoint before claiming anything, and never
            // auto-unblock from a projection. Bounded: one extra call per
            // candidate only.
            const rel = await relationalBlockerEntries(client, entry.id);
            if (rel.unavailable) {
              findings.push({ issueId: entry.id, identifier: entry.identifier ?? null, finding: "blocked_unverifiable_projection_empty", executionHold: hold, note: "projection empty and relational blockers unavailable; NOT confirmed blockerless" });
            } else if (rel.entries.length > 0) {
              findings.push({
                issueId: entry.id, identifier: entry.identifier ?? null, finding: "blocked_projection_diverged", executionHold: hold,
                relationalBlockerIds: rel.entries.map((e) => e.id),
                note: "issue_relations blockers exist; the blockedByIssueIds projection is diverged. Do NOT clear blocked status from the projection.",
              });
            } else {
              findings.push({ issueId: entry.id, identifier: entry.identifier ?? null, finding: "blocked_zero_blockers", executionHold: hold });
            }
          }
          if ((status === "done" || status === "cancelled") && hasRetry) {
            findings.push({ issueId: entry.id, identifier: entry.identifier ?? null, finding: `${status}_with_scheduled_retry` });
          }
          if (hold && (status === "done" || status === "cancelled")) {
            findings.push({ issueId: entry.id, identifier: entry.identifier ?? null, finding: `terminal_with_hold`, executionHold: hold });
          }
          // KOMAA-461: capacity holds whose gate is already terminal. Reported
          // in the dry run so an operator can see exactly what apply:true
          // would clear. Nothing else is eligible.
          //
          // Deliberately *not* gated on the held issue's own status. A capacity
          // hold stranded on an already-terminal issue (KOMAA-451: the stale
          // post-restart serialization hold, gate KOMAA-459 done since
          // 2026-10-01) is exactly the state this fix exists to clear, and the
          // old `!TERMINAL_ISSUE_STATUSES.has(status)` guard hid it from the
          // company sweep forever. `holdView.expired` is already false for every
          // manualOnly/safety hold, so dropping the status guard cannot sweep one.
          if (holdView && holdView.expired) {
            staleCapacityHolds.push({
              issueId: entry.id,
              identifier: entry.identifier ?? null,
              gateIssueId: holdView.gateIssueId ?? null,
              gateIdentifier: holdView.gateIdentifier ?? null,
              holdReason: typeof holdView.hold.reason === "string" ? holdView.hold.reason : null,
            });
          }
        }
        const applied: unknown[] = [];
        for (const entry of staleCapacityHolds) {
          if (!apply) {
            applied.push({ issueId: entry.issueId, action: "would_expire_capacity_hold", gateIdentifier: entry.gateIdentifier ?? null });
            continue;
          }
          try {
            await clearExecutionHoldDocument(client, String(entry.issueId), client.defaults.runId ?? null, client.defaults.operatorRunId ?? null, { // KOMAA-630
              gateIssueId: String(entry.gateIssueId ?? entry.gateIdentifier ?? "unknown"),
              gateIdentifier: (entry.gateIdentifier as string | null) ?? null,
              gateStatus: "terminal",
            });
            applied.push({ issueId: entry.issueId, action: "expired_capacity_hold", gateIdentifier: entry.gateIdentifier ?? null });
          } catch (error) {
            applied.push({ issueId: entry.issueId, action: "capacity_hold_expiry_failed", error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (apply) {
          for (const finding of findings) {
            if (!isRecord(finding) || typeof finding.issueId !== "string") continue;
            if (typeof finding.finding === "string" && (finding.finding.startsWith("done_with") || finding.finding.startsWith("cancelled_with"))) {
              const sub = await getEligibility(client, finding.issueId);
              const liveRuns = Array.isArray(sub.liveRuns) ? sub.liveRuns : [];
              for (const run of liveRuns) {
                if (!isRecord(run) || typeof run.id !== "string") continue;
                try {
                  await client.requestJson("POST", `/heartbeat-runs/${enc(run.id)}/cancel`, { body: {} });
                  applied.push({ issueId: finding.issueId, action: "cancelled_run", runId: run.id });
                } catch (error) {
                  applied.push({ issueId: finding.issueId, action: "cancel_failed", runId: run.id, error: error instanceof Error ? error.message : String(error) });
                }
              }
            }
          }
        }
        return { scanned: list.length, truncated, findingCount: findings.length, findings, staleCapacityHoldCount: staleCapacityHolds.length, staleCapacityHolds, applied: apply, appliedActions: applied };
      },
    ),
    makeTool(
      "paperclipSetExecutionHold",
      "Set an execution hold on an issue, independent of the blockedBy DAG (for harness/platform outages, not product dependencies). Stored as an issue document; read by eligibility checks. kind defaults to 'safety' and never auto-expires; pass kind:'capacity' plus gateIssueId/gateIssueIdentifier for a WIP hold that clears itself once that gate issue is done or cancelled.",
      z.object({
        issueId: issueIdSchema,
        reason: z.string().trim().min(1).max(1000),
        kind: z.enum(EXECUTION_HOLD_KINDS).optional().default("safety"),
        gateIssueId: z.string().guid().optional().nullable(),
        gateIssueIdentifier: z.string().trim().max(64).optional().nullable(),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional, // KOMAA-630
      }),
      async ({ issueId, reason, kind, gateIssueId, gateIssueIdentifier, runId, operatorRunId }) => {
        if (kind === "capacity" && !gateIssueId && !gateIssueIdentifier) {
          throw new Error("capacity hold requires gateIssueId or gateIssueIdentifier; a capacity hold without a gate would never expire");
        }
        const hold = {
          kind: "execution_hold",
          holdKind: kind,
          reason,
          ...(gateIssueId ? { gateIssueId } : {}),
          ...(gateIssueIdentifier ? { gateIssueIdentifier } : {}),
          setAt: new Date().toISOString(),
          operatorRunId: operatorRunId ?? runId ?? client.defaults.operatorRunId ?? client.defaults.runId ?? null, // KOMAA-630
        };
        // Re-setting a hold is an *update*, and routes/issues.ts rejects an
        // update without baseRevisionId ("Document update requires
        // baseRevisionId"). Read the current revision first, otherwise every
        // operator attempt to tighten or replace an existing hold 409s and the
        // stale one stays in force.
        const existing = await readIssueDocumentByKey(client, issueId, HOLD_DOCUMENT_KEY);
        const baseRevisionId = isRecord(existing) && typeof existing.latestRevisionId === "string"
          ? existing.latestRevisionId
          : null;
        return client.requestJson("PUT", `/issues/${enc(issueId)}/documents/${enc(HOLD_DOCUMENT_KEY)}`, {
          body: {
            format: "markdown",
            title: "Execution hold (control-plane)",
            body: JSON.stringify(hold, null, 2),
            ...(baseRevisionId ? { baseRevisionId } : {}),
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined, // FIX 2026-10-14: wczesniej gubiony
        });
      },
    ),
    makeTool(
      "paperclipClearExecutionHold",
      "Clear the execution hold on an issue. The blockedBy DAG is untouched.",
      z.object({ issueId: issueIdSchema, runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ issueId, runId, operatorRunId }) => {
        const existing = await readExecutionHoldDocument(client, issueId);
        if (!existing) return { issueId, cleared: false, reason: "No execution hold set" };
        await client.requestJson("DELETE", `/issues/${enc(issueId)}/documents/${enc(HOLD_DOCUMENT_KEY)}`, { runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined });
        return { issueId, cleared: true, previous: existing };
      },
    ),
    makeTool(
      "paperclipGetDependencyGraph",
      CRITICAL_RELATIONSHIPS + " Whole dependency DAG context for an issue: subtree nodes/edges plus direct blocker diagnostics. Both endpoints read authoritative issue_relations; the blockedByIssueIds field on issue payloads is a denormalized projection and must not be used as graph truth. SCOPE: this is the DEPENDENCY graph only - the parent hierarchy graph (issues.parentId) is a separate graph with separate invariants, use paperclipValidateDAG for the explicitly scoped hierarchy result or paperclipGetIssueFieldDetails for the full ancestor chain.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => {
        const [subtree, blockers] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/subtree`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`),
        ]);
        return { issueId, subtree, blockers, graphScope: "dependency (issue_relations type=blocks) - hierarchy (issues.parentId) is a separate graph" };
      },
    ),
    makeTool(
      "paperclipPatchDependencyGraph",
      CRITICAL_RELATIONSHIPS + " Atomically add/remove blockedBy edges with a single PATCH (no half-state). REQUIRED for agent-actor callers: pass operatorRunId (preferred) or runId — without it the call fails 403. Validates no self-block; use validate action first for full DAG checks. KOMAA-874: the edge base is read from authoritative issue_relations (/diagnostics/blockers), never from the denormalized blockedByIssueIds projection, so diverged edges are preserved.",
      z.object({
        issueId: issueIdSchema,
        addBlockerIds: z.array(z.string().min(1)).max(50).optional().default([]),
        removeBlockerIds: z.array(z.string().min(1)).max(50).optional().default([]),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional, // KOMAA-630
      }),
      async ({ issueId, addBlockerIds, removeBlockerIds, runId, operatorRunId }) => {
        const [issue, rel] = await Promise.all([
          client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`),
          relationalBlockerEntries(client, issueId),
        ]);
        const selfUuid = typeof issue.id === "string" ? issue.id : issueId;
        const byToken = new Map<string, string>();
        for (const e of rel.entries) {
          byToken.set(e.id, e.id);
          if (e.identifier) byToken.set(e.identifier, e.id);
        }
        byToken.set(issueId, selfUuid);
        if (typeof issue.identifier === "string") byToken.set(issue.identifier, selfUuid);
        const norm = (token: string): string => byToken.get(token) ?? token;
        if (addBlockerIds.some((token) => norm(token) === selfUuid)) {
          throw new Error("Self-blocker rejected: an issue cannot block itself");
        }
        const before = rel.unavailable ? [...new Set(blockedByIdsOf(issue))].sort() : rel.entries.map((e) => e.id).sort();
        const current = new Set(before);
        for (const token of removeBlockerIds) {
          current.delete(token);
          current.delete(norm(token));
        }
        for (const token of addBlockerIds) current.add(norm(token));
        const next = [...current].sort();
        assertKeepsAgentAssignee({ blockedByIssueIds: next });
        const updated = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
          body: { blockedByIssueIds: next },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined, // P1 2026-10-14: gubiony -> 403 dla agent-actora
        });
        return { issueId, before, after: next, relationalBase: !rel.unavailable, projectionFallback: rel.unavailable, updated };
      },
    ),
    makeTool(
      "paperclipValidateDAG",
      CRITICAL_VALIDATE_DAG + " Detect DAG anomalies for an issue subtree: cycles, self-blockers, blocked-with-zero-blockers, blockers already done/cancelled, redundant (transitive) edges, relational/projection divergence. KOMAA-874: reads authoritative issue_relations (subtree kind=blocks edges with fromIssueId/toIssueId plus per-node blockers, cross-checked against /diagnostics/blockers) — never the denormalized blockedByIssueIds projection.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => {
        const [subtree, rootDiag] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/subtree`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`),
        ]);
        const anomalies: unknown[] = [];
        if (!isRecord(subtree)) return { issueId, anomalies, note: "Subtree diagnostics unavailable" };
        const views = (Array.isArray(subtree.nodes) ? subtree.nodes.filter(isRecord) : [])
          .map(subtreeNodeView)
          .filter((v) => v.id);
        // Blocks edges point blocker -> blocked (fromIssueId is the blocker).
        const edges = blocksEdgesFromSubtree(subtree);
        const incoming = new Map<string, Set<string>>();
        const adj = new Map<string, string[]>();
        for (const e of edges) {
          adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
          if (!incoming.has(e.to)) incoming.set(e.to, new Set());
          incoming.get(e.to)?.add(e.from);
        }
        for (const e of edges) {
          if (e.from === e.to) anomalies.push({ kind: "self_blocker", issueId: e.from });
        }
        // cycle detection (DFS)
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const stack: string[] = [];
        const visit = (id: string): void => {
          if (visited.has(id)) return;
          if (visiting.has(id)) {
            anomalies.push({ kind: "cycle", path: [...stack.slice(stack.indexOf(id)), id] });
            return;
          }
          visiting.add(id);
          stack.push(id);
          for (const next of adj.get(id) ?? []) visit(next);
          stack.pop();
          visiting.delete(id);
          visited.add(id);
        };
        for (const id of adj.keys()) visit(id);
        const rootView = views.find((v) => v.id === issueId || v.identifier === issueId) ?? null;
        const rootRelIds = blockerEntriesFromBlockersDiag(rootDiag).map((b) => b.id);
        const subtreeBlockerIdsOf = (v: { id: string; blockers: Array<{ id: string }> }): Set<string> =>
          new Set([...(incoming.get(v.id) ?? []), ...v.blockers.map((b) => b.id)]);
        const relationalBlockerIdsOf = (v: { id: string; identifier: string | null; blockers: Array<{ id: string }> }): Set<string> =>
          new Set([...subtreeBlockerIdsOf(v),
            // The root's /diagnostics/blockers read is authoritative: when the
            // subtree view omits a real edge, the zero-check must not fire a
            // contradictory blocked_zero_blockers next to the divergence flag.
            ...(rootView !== null && (v.id === rootView.id || (v.identifier !== null && v.identifier === rootView.identifier)) ? rootRelIds : [])]);
        for (const v of views) {
          const blockerIds = relationalBlockerIdsOf(v);
          // Only flag zero when the subtree view is complete for this node:
          // authz-omitted or truncated blockers mean "unknown", not "none".
          if (v.status === "blocked" && blockerIds.size === 0 && v.omittedBlockers === 0 && !v.truncatedBlockers) {
            anomalies.push({ kind: "blocked_zero_blockers", issueId: v.id });
          }
          for (const b of v.blockers) {
            if ((b.status === "done" || b.status === "cancelled") && v.status === "blocked") {
              anomalies.push({ kind: "done_dependency", issueId: v.id, blockerId: b.id, blockerStatus: b.status });
            }
          }
        }
        // redundant edges: direct edge a->c where a->b->c exists
        const reachable = (from: string, skipDirect: string): Set<string> => {
          const seen = new Set<string>();
          const queue = (adj.get(from) ?? []).filter((x) => x !== skipDirect);
          while (queue.length > 0) {
            const cur = queue.pop() as string;
            if (seen.has(cur)) continue;
            seen.add(cur);
            for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) queue.push(nx);
          }
          return seen;
        };
        for (const e of edges) {
          if (reachable(e.from, e.to).has(e.to)) anomalies.push({ kind: "redundant_edge", from: e.from, to: e.to });
        }
        // Root cross-check: relational blockers missing from the subtree view
        // mean the validator (or any projection reader) would silently
        // under-report. Reported as its own anomaly, never silently dropped.
        if (rootView) {
          if (rootRelIds.length > 0) {
            const seen = subtreeBlockerIdsOf(rootView);
            const missingInSubtree = rootRelIds.filter((id) => !seen.has(id));
            if (missingInSubtree.length > 0) {
              anomalies.push({
                kind: "relational_projection_diverged",
                issueId: rootView.id,
                relationalBlockerIds: rootRelIds,
                subtreeBlockerIds: [...seen],
                missingInSubtree,
                note: "issue_relations blockers exist that the subtree view does not show; the denormalized blockedByIssueIds projection is likely diverged. Repair with paperclipPatchDependencyGraph (relational base).",
              });
            }
          }
        }
        // Hierarchy graph (issues.parentId) is a SEPARATE graph: the dependency
        // anomalies above say nothing about it. Report an explicit, scoped
        // hierarchy result so nobody reads a clean dependency run as proof of
        // an acyclic parent chain.
        let hierarchy: Record<string, unknown>;
        try {
          const rootIssue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
          const rootId = typeof rootIssue.id === "string" ? rootIssue.id : issueId;
          const parentId = typeof rootIssue.parentId === "string" ? rootIssue.parentId : null;
          const validation = await validateParentHierarchy(client, { issueId: rootId, parentId });
          hierarchy = {
            valid: true,
            scope: "root parent chain only (the subtree view is dependency-derived, so a subtree-wide hierarchy proof is NOT performed here)",
            chain: validation.chain,
            guardScope: validation.scope,
          };
        } catch (err) {
          const e = err as { code?: string; message?: string; chain?: unknown; status?: number };
          hierarchy = {
            valid: false,
            // An upstream read failure is "unverifiable", not "invalid": the
            // hierarchy is reported separately from the dependency anomalies
            // on purpose, so a dependency run stays a dependency run.
            code: e.code ?? "PARENT_HIERARCHY_UNVERIFIABLE",
            reason: e.message ?? "parent hierarchy could not be verified",
            chain: e.chain ?? [],
            scope: "root parent chain only (the subtree view is dependency-derived, so a subtree-wide hierarchy proof is NOT performed here)",
            guardScope: "mcp-gateway-only",
          };
        }
        return {
          issueId,
          nodeCount: views.length,
          edgeCount: edges.length,
          anomalyCount: anomalies.length,
          anomalies,
          relationalSource: "issue_relations",
          validatedGraph: "dependency (issue_relations type=blocks)",
          hierarchy,
          scope: {
            dependencyGraph: "fully validated for the returned subtree nodes/edges",
            hierarchyGraph: "root parent chain only - not a subtree-wide hierarchy proof",
          },
        };
      },
    ),
    makeTool(
      "paperclipBulkUpdateIssues",
      CRITICAL_RELATIONSHIPS + " Bounded batch PATCH over explicit issue list with continuation cursor. Sequential (no half-state surprises); stops on first error unless continueOnError:true. Pass runId for cross-issue writes. Every patched issue goes through the same guards as a single PATCH, including the fail-closed parent-hierarchy validation (a parent write that would create a cycle is rejected for that item, not silently applied).",
      z.object({
        items: z.array(z.object({ issueId: z.string().min(1), patch: z.record(z.string(), z.unknown()) })).min(1).max(50),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional, // KOMAA-630
        continueOnError: z.boolean().optional().default(false),
        startIndex: z.number().int().min(0).optional().default(0),
      }),
      async ({ items, runId, operatorRunId, continueOnError, startIndex }) => {
        const results: unknown[] = [];
        let cursor = startIndex;
        for (let i = startIndex; i < items.length; i += 1) {
          const item = items[i] as { issueId: string; patch: Record<string, unknown> };
          assertKeepsAgentAssignee(item.patch);
          try {
            const updated = await client.requestJson("PATCH", `/issues/${enc(item.issueId)}`, { body: item.patch, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // FIX 2026-10-14
            results.push({ issueId: item.issueId, ok: true, updated });
          } catch (error) {
            results.push({ issueId: item.issueId, ok: false, error: error instanceof Error ? error.message : String(error) });
            if (!continueOnError) {
              cursor = i + 1;
              return { completed: false, nextCursor: cursor, results };
            }
          }
          cursor = i + 1;
        }
        return { completed: true, nextCursor: cursor, results };
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Recovery, decisions, workspaces, review
// ---------------------------------------------------------------------------
function recoveryDecisionTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipListRecoveryActions",
      "List active recovery actions: per issue, or company-wide via bounded scan (recovery-observability + per-issue expansion).",
      z.object({ issueId: issueIdSchema.optional(), limit: limitSchema }),
      async ({ issueId, limit }) => {
        if (issueId) return client.requestJson("GET", `/issues/${enc(issueId)}/recovery-actions`);
        const companyId = client.resolveCompanyId();
        const [observability, issues] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/recovery-observability`),
          client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ limit: limit ?? 50 })}`),
        ]);
        const actives: unknown[] = [];
        for (const entry of Array.isArray(issues) ? issues : []) {
          if (!isRecord(entry) || typeof entry.id !== "string") continue;
          const rec = await getJsonOrNull(client, `/issues/${enc(entry.id)}/recovery-actions`);
          if (isRecord(rec) && rec.active) actives.push({ issueId: entry.id, identifier: entry.identifier ?? null, active: rec.active });
        }
        return { observability, activeCount: actives.length, actives };
      },
    ),
    makeTool(
      "paperclipResolveRecoveryAction",
      "Resolve an issue recovery action: restored / blocked / false_positive / cancelled. Board-only outcomes (false_positive, cancelled) require board auth. sourceIssueStatus is REQUIRED and must be one of todo|done|in_review|blocked, and it must match the outcome: restored -> todo|done|in_review, blocked -> blocked, false_positive|cancelled -> done|in_review. A mismatched pair, a missing value or a value outside the enum is rejected locally with a typed error and no upstream request. outcome=blocked additionally requires an unresolved first-class blocker on the source issue (the server answers 422 otherwise) - never synthesize blocker relations to satisfy it. A run scope is required: pass operatorRunId (preferred) or runId.",
      z.object({
        issueId: issueIdSchema,
        actionId: z.string().guid().optional().nullable(),
        outcome: z.enum(["restored", "blocked", "false_positive", "cancelled"]),
        // KOMAA-1366: the server requires this field (no default, strict object),
        // so the gateway advertises and forwards it the same way.
        sourceIssueStatus: z.enum(["todo", "done", "in_review", "blocked"]),
        resolutionNote: z.string().trim().max(2000).optional(),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional, // KOMAA-630
      }),
      async ({ issueId, actionId, outcome, sourceIssueStatus, resolutionNote, runId, operatorRunId }) => {
        // KOMAA-1366: enforce the server's outcome<->sourceIssueStatus coupling
        // before a single request leaves the gateway.
        const coupling = recoveryOutcomeStatusSchema.safeParse({ outcome, sourceIssueStatus });
        if (!coupling.success) throw coupling.error;
        return client.requestJson("POST", `/issues/${enc(issueId)}/recovery-actions/resolve`, {
          body: { ...(actionId ? { actionId } : {}), outcome, sourceIssueStatus, ...(resolutionNote ? { resolutionNote } : {}) },
          // KOMAA-630: dropping the per-call operator id left the request with no
          // run scope, and the resolve route answers an unscoped agent caller with
          // 401 `Agent run id required` - the operator could not retire a recovery
          // card at all without lying about the source issue status.
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        });
      },
    ),
    makeTool(
      "paperclipListDecisions",
      "List board decisions for a company (the Decisions section in UI). Filter by status/target/origin.",
      z.object({
        status: z.enum(["open", "decided", "expired", "cancelled"]).optional(),
        targetIssueId: z.string().guid().optional().nullable(),
        originAgentId: z.string().guid().optional().nullable(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      async ({ status, targetIssueId, originAgentId, limit }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson(
          "GET",
          `/companies/${companyId}/decisions${qs({ status, targetIssueId: targetIssueId ?? undefined, originAgentId: originAgentId ?? undefined, limit })}`,
        );
      },
    ),
    makeTool(
      "paperclipGetDecision",
      "Get one decision with its outcome.",
      z.object({ decisionId: z.string().guid() }),
      async ({ decisionId }) => client.requestJson("GET", `/decisions/${enc(decisionId)}`),
    ),
    makeTool(
      "paperclipResolveDecision",
      "Execute a board decision: decide (optionId + rationale), dismiss, or cancel. Board auth required.",
      z.object({
        decisionId: z.string().guid(),
        action: z.enum(["decide", "dismiss", "cancel"]),
        optionId: z.string().min(1).optional(),
        choiceId: z.string().min(1).optional(),
        rationale: z.string().trim().max(2000).optional(),
        reason: z.string().trim().max(2000).optional(),
      }),
      async ({ decisionId, action, optionId, choiceId, rationale, reason }) => {
        if (action === "decide") {
          // ponytail: backend decideSchema wymaga optionId (nie choiceId);
          // choiceId zostaje jako alias dla starych callerow.
          const resolved = optionId ?? choiceId;
          if (!resolved) throw new Error("decide requires optionId (choiceId accepted as alias)");
          return client.requestJson("POST", `/decisions/${enc(decisionId)}/decide`, { body: { optionId: resolved, ...(rationale ? { rationale } : {}) } });
        }
        if (action === "dismiss") {
          return client.requestJson("POST", `/decisions/${enc(decisionId)}/dismiss`, { body: { ...(reason ? { reason } : {}) } });
        }
        return client.requestJson("POST", `/decisions/${enc(decisionId)}/cancel`, { body: {} });
      },
    ),
  ];
}

function workspaceTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipListWorkspaces",
      "List execution workspaces (state, branch, owner, freshness). Filter by project/issue/status.",
      z.object({
        projectId: z.string().guid().optional().nullable(),
        issueId: z.string().guid().optional().nullable(),
        status: z.string().optional(),
        summary: z.boolean().optional(),
      }),
      async ({ projectId, issueId, status, summary }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson(
          "GET",
          `/companies/${companyId}/execution-workspaces${qs({ projectId: projectId ?? undefined, issueId: issueId ?? undefined, status, summary })}`,
        );
      },
    ),
    makeTool(
      "paperclipGetWorkspace",
      "Get one execution workspace: cwd, base SHA, branch, dirty state, owner, locks.",
      z.object({ workspaceId: z.string().guid() }),
      async ({ workspaceId }) => {
        const [workspace, operations] = await Promise.all([
          client.requestJson("GET", `/execution-workspaces/${enc(workspaceId)}`),
          getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/workspace-operations`),
        ]);
        return { workspace, operations };
      },
    ),
    makeTool(
      "paperclipGetWorkspaceLocks",
      "Who holds a workspace: close-readiness, live runs on the owning issue, runtime services. No dedicated locks endpoint exists; this synthesizes holders from live state.",
      z.object({ workspaceId: z.string().guid(), issueId: issueIdSchema.optional() }),
      async ({ workspaceId, issueId }) => {
        const [readiness, workspace] = await Promise.all([
          getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/close-readiness`),
          getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}`),
        ]);
        let issueHolders: unknown = null;
        const ownerIssue = issueId ?? (isRecord(workspace) && typeof workspace.issueId === "string" ? workspace.issueId as string : null);
        if (ownerIssue) {
          const [liveRuns, activeRun] = await Promise.all([
            getJsonOrNull(client, `/issues/${enc(ownerIssue)}/live-runs`),
            getJsonOrNull(client, `/issues/${enc(ownerIssue)}/active-run`),
          ]);
          issueHolders = { issueId: ownerIssue, liveRuns, activeRun };
        }
        return { workspaceId, closeReadiness: readiness, workspace, holders: issueHolders };
      },
    ),
    makeTool(
      "paperclipProvisionWorkspace",
      "Ensure a fresh isolated workspace for an issue via checkout (the backend provisions on checkout). Optionally pins branch reconciliation afterwards. No standalone provision endpoint exists.",
      z.object({
        issueId: issueIdSchema,
        agentId: z.string().guid().optional().nullable(),
        expectedStatuses: z.array(z.enum(["backlog", "todo", "in_progress", "in_review", "blocked"])).optional(),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional,
      }),
      async ({ issueId, agentId, expectedStatuses, runId, operatorRunId }) => {
        const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const resolvedAgent = agentId ?? (typeof issue.assigneeAgentId === "string" ? issue.assigneeAgentId : null) ?? client.defaults.agentId;
        if (!resolvedAgent) throw new Error("No agent: pass agentId or ensure the issue has an assigneeAgentId");
        const checkout = await client.requestJson("POST", `/issues/${enc(issueId)}/checkout`, {
          body: { agentId: resolvedAgent, expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"] },
          runId: runId ?? undefined, // P1 2026-10-14
          operatorRunId: operatorRunId ?? undefined,
        });
        const context = await getJsonOrNull(client, `/issues/${enc(issueId)}/heartbeat-context`);
        return { checkout, currentExecutionWorkspace: isRecord(context) ? context.currentExecutionWorkspace ?? null : null };
      },
    ),
    makeTool(
      "paperclipDetachWorkspace",
      "Safely detach a zombie/busy workspace: stop its runtime services, release the issue checkout, report close-readiness. Releases leases so reviewers and next runs are unblocked.",
      z.object({ workspaceId: z.string().guid(), issueId: issueIdSchema.optional(), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ workspaceId, issueId, runId, operatorRunId }) => {
        // III etap 2026-10-14: dla nieistniejacego workspace zwracalismy nieme
        // nulle (bledy 404 polyane przez getJsonOrNull). Najpierw jawny rekord.
        const workspace = await getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}`);
        if (!isRecord(workspace) || typeof workspace.id !== "string") {
          return { workspaceId, found: false, error: "Workspace not found", priorOperations: null, checkoutReleased: null, closeReadiness: null };
        }
        const stopped = await getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/workspace-operations`);
        let released: unknown = null;
        if (issueId) {
          try {
            released = await client.requestJson("POST", `/issues/${enc(issueId)}/release`, { body: {}, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // P1 2026-10-14
          } catch (error) {
            released = { error: error instanceof Error ? error.message : String(error) };
          }
        }
        const readiness = await getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/close-readiness`);
        return { workspaceId, priorOperations: stopped, checkoutReleased: released, closeReadiness: readiness };
      },
    ),
    makeTool(
      "paperclipResetWorkspace",
      "Reset a workspace branch to a known state (forward / override / quarantine_restore). Override-class modes are destructive; reason is required by the server for override.",
      z.object({
        workspaceId: z.string().guid(),
        mode: z.enum(["forward", "override", "quarantine_restore"]),
        reason: z.string().trim().max(500).optional(),
      }),
      async ({ workspaceId, mode, reason }) =>
        client.requestJson("POST", `/execution-workspaces/${enc(workspaceId)}/reconcile-branch`, {
          body: mode === "forward" ? { mode, ...(reason ? { reason } : {}) } : { mode, reason },
        }),
    ),
    makeTool(
      "paperclipGetWorkspaceCloseReadiness",
      "Close-readiness of a workspace (delivery state, blocking conditions).",
      z.object({ workspaceId: z.string().guid() }),
      async ({ workspaceId }) => client.requestJson("GET", `/execution-workspaces/${enc(workspaceId)}/close-readiness`),
    ),
  ];
}

// Review liveness classification (P0 2026-10-20). The previous implementation
// reported `wedged: true` for EVERY issue in status in_review, because it only
// compared the issue status with the presence of any live run - it could not
// tell a configured-but-never-scheduled reviewer from an actively running one.
// The states below are mutually exclusive and each one names the responsible
// owner and the authorized recovery path.
type ReviewLivenessInput = {
  status: string | null;
  executionState: Record<string, unknown> | null;
  participantAgentId: string | null;
  participantRuns: Array<Record<string, unknown>>;
  pendingApprovalCount: number;
  hasScheduledRetry: boolean;
  hasExecutionBlocker: boolean;
  deniedApprovalCount: number;
};

function classifyReviewLiveness(input: ReviewLivenessInput): {
  state: string;
  detail: string;
  liveParticipantRuns: number;
  recoveryGuidance: string | null;
  responsibleOwner: string | null;
} {
  const {
    status,
    executionState,
    participantAgentId,
    participantRuns,
    pendingApprovalCount,
    hasScheduledRetry,
    hasExecutionBlocker,
    deniedApprovalCount,
  } = input;
  const liveParticipantRuns = participantRuns.length;
  const queued = participantRuns.some((r) => r.status === "queued");
  const running = participantRuns.some((r) => r.status === "running");
  const execStatus = executionState && typeof executionState.status === "string" ? executionState.status : null;
  const base = { liveParticipantRuns };

  // KOMAA-1094 (2026-10-20): a terminal status can land WITHOUT a persisted
  // review decision - the server applied status=done while executionState kept
  // a pending stage, lastDecisionId=null, lastDecisionOutcome=null and
  // completedStageIds=[]. Reporting that as a finished review hides a broken
  // audit chain and invites downstream delivery on a false acceptance.
  if ((status === "done" || status === "cancelled") && (execStatus === "pending" || execStatus === "changes_requested")) {
    const recordedOutcome = executionState && typeof executionState.lastDecisionOutcome === "string" ? executionState.lastDecisionOutcome : null;
    const completedStageIds = executionState && Array.isArray(executionState.completedStageIds) ? (executionState.completedStageIds as string[]) : [];
    return {
      ...base,
      state: "terminal_without_persisted_decision",
      detail: `the issue is ${status} but the execution review stage is still ${execStatus} (lastDecisionOutcome=${recordedOutcome ?? "none"}, completedStageIds=${JSON.stringify(completedStageIds)}) - the terminal state is not backed by a persisted decision`,
      recoveryGuidance: "A terminal state was applied without a persisted review decision. Re-open the review through the authorized path (the stage, its evidence and the original executor are preserved) - do not treat the issue as accepted and do not fabricate a verdict.",
      responsibleOwner: "assignee agent / operator / Board",
    };
  }

  if (status !== "in_review") {
    // KOMAA-849 (MCP layer only, no Core change): Paperclip Core's issue
    // checkout writes status="in_progress" unconditionally, so a reviewer that
    // checks out an issue demotes it out of in_review while the review stage
    // stays pending. Reporting "not_in_review" there is factually wrong: it
    // hides a live review and invites a second reviewer run. The review is
    // reported as live-with-drifted-status instead.
    if (execStatus === "pending" && participantAgentId) {
      const runState = running ? "reviewer_running" : queued ? "reviewer_queued" : "no_live_reviewer_run";
      return {
        ...base,
        state: "review_pending_status_drifted",
        detail: `executionState.status=pending for the active ${executionState && typeof executionState.currentStageType === "string" ? executionState.currentStageType : "review"} stage, but the issue status is ${status ?? "unknown"} (${runState}) - the review is live and the status projection was demoted`,
        recoveryGuidance: "Submit the decision through paperclipSubmitReviewDecision (native issue transition). Do not request a new review, do not clear the review policy and do not force a status - the demotion is a known Paperclip Core checkout defect (KOMAA-849).",
        responsibleOwner: "assignee agent / operator",
      };
    }
    return { ...base, state: "not_in_review", detail: `issue status is ${status ?? "unknown"} - no review is expected here`, recoveryGuidance: null, responsibleOwner: null };
  }
  if (execStatus === "completed") {
    return {
      ...base,
      state: "completed_stale_projection",
      detail: "executionState.status=completed while the issue is still in_review - the status projection is stale, the review is not running",
      recoveryGuidance: "Read the committed executionState and reconcile the issue status; do not start a second reviewer run.",
      responsibleOwner: "assignee agent / operator",
    };
  }
  if (deniedApprovalCount > 0) {
    return {
      ...base,
      state: "denied_by_authorization",
      detail: "a linked approval was rejected or denied",
      recoveryGuidance: "Resolve the denied approval through paperclipListApprovals / paperclipApprovalDecision - never bypass the independent-review requirement.",
      responsibleOwner: "Board",
    };
  }
  if (liveParticipantRuns > 1) {
    return {
      ...base,
      state: "concurrent_reviewer_transition",
      detail: "several live runs exist for the configured reviewer participant",
      recoveryGuidance: "Let the transition settle, then re-read the state; cancel duplicate runs only through the authorized run controls.",
      responsibleOwner: "operator",
    };
  }
  if (running) {
    return { ...base, state: "reviewer_running", detail: "the configured reviewer has a live running run on this issue", recoveryGuidance: null, responsibleOwner: null };
  }
  if (queued) {
    return { ...base, state: "reviewer_queued", detail: "the configured reviewer has a queued run that has not started yet", recoveryGuidance: null, responsibleOwner: null };
  }
  if (hasScheduledRetry) {
    return {
      ...base,
      state: "awaiting_scheduled_retry",
      detail: "a scheduled retry is pending - the review resumes at the scheduled time",
      recoveryGuidance: "Read the scheduled retry (paperclipListScheduledRetries) instead of forcing a new reviewer run.",
      responsibleOwner: "operator",
    };
  }
  if (hasExecutionBlocker) {
    return {
      ...base,
      state: "awaiting_external_dependency",
      detail: "the issue is blocked by an external dependency (executionBlocker present)",
      recoveryGuidance: "Resolve the execution blocker first; the review starts once the dependency is satisfied.",
      responsibleOwner: "assignee agent / operator",
    };
  }
  if (pendingApprovalCount > 0) {
    return {
      ...base,
      state: "awaiting_decision",
      detail: "a linked formal approval is pending - the review is legitimately waiting for a decision",
      recoveryGuidance: "The pending approval owner must decide (paperclipApprovalDecision); do not self-approve.",
      responsibleOwner: "approval owner",
    };
  }
  if (!participantAgentId) {
    return {
      ...base,
      state: "reviewer_not_configured",
      detail: "the issue is in_review but no reviewer participant is configured in executionPolicy.stages",
      recoveryGuidance: "Configure a reviewer stage with paperclipManageIssueExecutionPolicy, then re-request the review.",
      responsibleOwner: "assignee agent / operator",
    };
  }
  return {
    ...base,
    state: "wedged",
    detail: "the issue is in_review, a reviewer participant is configured, but no live reviewer run exists and nothing explains the wait",
    recoveryGuidance: "Use paperclipResolveReviewWedge (Board authority) or wake the configured reviewer; never approve on the reviewer's behalf.",
    responsibleOwner: "Board / reviewer agent",
  };
}

function reviewTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetReviewState",
      CRITICAL_REVIEW_STATE + " Reports the current review stage, the configured participant, the live-run liveness of that participant, linked formal approvals, work products and the watchdog configuration, and classifies WHY a review is not progressing (reviewer_not_configured | reviewer_queued | reviewer_running | awaiting_external_dependency | awaiting_scheduled_retry | awaiting_decision | completed_stale_projection | concurrent_reviewer_transition | denied_by_authorization | terminal_without_persisted_decision | wedged).",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => {
        // P0: primary issue uses requestJson so 404/403 surfaces as an MCP error
        // (isError + UPSTREAM_NOT_FOUND/PERMISSION_DENIED), never success-nulls.
        const issue = await client.requestJson<Record<string, unknown>>(`GET`, `/issues/${enc(issueId)}`);
        const [approvals, workProducts, liveRuns, activeRun] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/work-products`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/active-run`),
        ]);
        const status = issueStatusOf(issue);
        const liveCount = Array.isArray(liveRuns) ? liveRuns.length : 0;
        const executionState = isRecord(issue.executionState) ? issue.executionState : null;
        const participant = isRecord(executionState?.currentParticipant) ? executionState.currentParticipant : null;
        const participantAgentId = participant && typeof participant.agentId === "string" ? participant.agentId : null;
        const runs = (Array.isArray(liveRuns) ? liveRuns : []).filter(isRecord);
        const participantRuns = participantAgentId ? runs.filter((r) => r.agentId === participantAgentId) : [];
        const approvalList = (Array.isArray(approvals) ? approvals : []).filter(isRecord);
        const pendingApprovals = approvalList.filter((a) => a.status === "pending");
        const liveness = classifyReviewLiveness({
          status,
          executionState,
          participantAgentId,
          participantRuns,
          pendingApprovalCount: pendingApprovals.length,
          hasScheduledRetry: Boolean(isRecord(issue.scheduledRetry)),
          hasExecutionBlocker: Boolean(isRecord(issue.executionBlocker)),
          deniedApprovalCount: approvalList.filter((a) => a.status === "rejected" || a.status === "denied").length,
        });
        return {
          issueId,
          status,
          approvals,
          workProducts,
          liveRuns,
          activeRun,
          wedged: liveness.state === "wedged",
          liveness,
          // KOMAA-1094: a terminal issue whose review stage was never decided
          // is a false acceptance. Expose it as an explicit boolean so callers
          // never read `status=done` as "review completed".
          terminalWithoutPersistedDecision: liveness.state === "terminal_without_persisted_decision",
          currentStage: {
            currentStageId: executionState && typeof executionState.currentStageId === "string" ? executionState.currentStageId : null,
            currentStageIndex: executionState && typeof executionState.currentStageIndex === "number" ? executionState.currentStageIndex : null,
            currentStageType: executionState && typeof executionState.currentStageType === "string" ? executionState.currentStageType : null,
            currentParticipant: participant,
            returnAssignee: isRecord(executionState?.returnAssignee) ? executionState.returnAssignee : null,
            reviewRequest: isRecord(executionState?.reviewRequest) ? executionState.reviewRequest : null,
          },
          recoveryGuidance: liveness.recoveryGuidance,
          responsibleOwner: liveness.responsibleOwner,
        };
      },
    ),
    makeTool(
      "paperclipSubmitReviewDecision",
      CRITICAL_REVIEW_STATE + " First-class review decision on an ACTIVE review or approval stage. Issue mode uses the native issue transition (PATCH /issues/:id with the decision status and the decision comment in the SAME request): approve -> status=done, request_changes/send_back -> status=in_progress, which the server records as a first-class decision row (stage id, participant, outcome, decision comment, run attribution) and advances or returns the task to the original executor. The decision comment is mandatory and must be sent with the transition - a comment posted earlier is never the decision. " +
        "Approval mode decides a separate formal approval record (approve | reject | requestRevision). " +
        "Never self-approve, never approve by clearing the review policy, never force status=done without a decision comment, and never fall back to a bare status change when the decision is refused - a refused decision must fail closed.",
      z.object({
        issueId: issueIdSchema.optional(),
        approvalId: z.string().guid().optional().nullable(),
        action: z.enum(["approve", "request_changes", "send_back", "reject", "requestRevision"]),
        note: z.string().trim().max(4000).optional(),
        runId: runIdOptional,
        operatorRunId: operatorRunIdOptional, // KOMAA-630
      }),
      async ({ issueId, approvalId, action, note, runId, operatorRunId }) => {
        if (approvalId) {
          const path = action === "approve"
            ? `/approvals/${enc(approvalId)}/approve`
            : action === "reject"
              ? `/approvals/${enc(approvalId)}/reject`
              : action === "requestRevision"
                ? `/approvals/${enc(approvalId)}/request-revision`
                : null;
          if (!path) throw new Error(`Action ${action} is issue-mode only; approval mode supports approve|reject|requestRevision`);
          return client.requestJson("POST", path, { body: { ...(note ? { decisionNote: note } : {}) }, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // P1 2026-10-14
        }
        if (!issueId) throw new Error("Provide issueId (issue mode) or approvalId (approval mode)");
        if (action === "reject" || action === "requestRevision") throw new Error(`Action ${action} is approval-mode only; issue mode supports approve|request_changes|send_back`);
        // KOMAA-849 (MCP layer only, no Core change): the previous implementation
        // always used POST /issues/:id/stalled-review-decision, which is
        // Board-only and only applies to WEDGED reviews. The active reviewer
        // therefore had no working decision path: the call returned
        // 409 REVIEW_STATE_CONFLICT and the review silently looped. The native
        // issue transition is the official decision mechanism - use it whenever
        // a review/approval stage is actually active.
        const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const executionState = isRecord(issue.executionState) ? issue.executionState : null;
        const execStatus = str(executionState?.status);
        const stageType = str(executionState?.currentStageType);
        const participant = isRecord(executionState?.currentParticipant) ? executionState.currentParticipant : null;
        const activeStage = execStatus === "pending" && (stageType === "review" || stageType === "approval") && participant !== null;

        if (!activeStage) {
          // The stage is gone or already decided. Never fall through to a
          // write: an already-completed stage is not a wedged review.
          if (execStatus === "completed" || str(issue.status) === "done" || str(issue.status) === "cancelled") {
            throw new Error(
              `This issue has no pending review stage (executionState.status=${execStatus ?? "none"}, issue status=${str(issue.status) ?? "unknown"}). The decision is already recorded or the issue is terminal - re-read the state instead of retrying. [errorCode=REVIEW_STAGE_NOT_PENDING]`,
            );
          }
          // No live review stage: this is a wedged review, which only the Board
          // may resolve through the stalled-review endpoint.
          const result = await client.requestJson("POST", `/issues/${enc(issueId)}/stalled-review-decision`, {
            body: { action, ...(note ? { note } : {}) },
            runId: runId ?? undefined,
            operatorRunId: operatorRunId ?? undefined, // P1 2026-10-14
          });
          const after = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
          return {
            mode: "stalled_review",
            issueId,
            committed: true,
            result,
            committedState: {
              status: str(after.status),
              executionState: isRecord(after.executionState) ? after.executionState : null,
            },
          };
        }

        // The decision comment is part of the transition, never a prior comment.
        const decisionNote = (note ?? "").trim();
        if (!decisionNote) {
          throw new Error(
            "A review decision requires a decision comment. Send it with the transition - a comment posted earlier is not the decision. [errorCode=REVIEW_DECISION_COMMENT_REQUIRED]",
          );
        }

        const requestedStatus = action === "approve" ? "done" : "in_progress";
        // KOMAA-1094 (2026-10-20): the server can apply the status transition
        // WITHOUT persisting a decision row (a non-participant actor is
        // re-pended, but the status write still lands). The issue then ends up
        // terminal (done) with lastDecisionId=null, lastDecisionOutcome=null and
        // completedStageIds=[] - a false-positive terminal state and a broken
        // audit chain, with the decision note posted as a comment that reads
        // like an approval. Remember the pre-decision status so that a
        // non-recorded decision can never leave a terminal state behind.
        const preDecisionStatus = str(issue.status) ?? null;
        const stageId = str(executionState?.currentStageId);
        // KOMAA-849 (CTO CHANGES 2026-10-21, second round): the server exposes
        // NO compare-and-set for issue updates (PATCH /issues/:id carries no
        // version or precondition field), so a compensating write can never be
        // made indivisible with its precondition: a decision or status that
        // another actor commits between the guard read and the rollback would
        // be overwritten by the stale pre-decision status. The MCP therefore
        // performs EXACTLY ONE write and never compensates. The write is
        // admitted only when the server itself persists the decision (its
        // participant path commits the status and the decision row in one
        // transaction), so the decision attempt is atomic by construction.
        const policy = isRecord(issue.executionPolicy) ? issue.executionPolicy : null;
        const policyStages = policy && Array.isArray(policy.stages) ? (policy.stages as unknown[]) : null;
        const participantAgentId = participant?.type === "agent" ? str(participant?.agentId) : null;
        const callerAgentId = client.defaults.agentId ?? null;
        const stageInPolicy =
          policyStages === null ||
          (stageId !== null && policyStages.some((stage) => isRecord(stage) && str(stage.id) === stageId));
        if (!stageInPolicy) {
          // Without the stage in the persisted policy the server applies the
          // status transition WITHOUT persisting a decision (it clears the
          // execution state instead) - the exact false-positive terminal of
          // KOMAA-1094. Refuse BEFORE writing anything.
          throw new Error(
            `The pending review stage is not part of the issue's persisted execution policy, so the server would apply the status transition without persisting a decision. Nothing was written. [errorCode=REVIEW_STAGE_NOT_IN_POLICY] [stageId=${stageId ?? "unknown"}] [currentStatus=${preDecisionStatus ?? "unknown"}] [policyStages=${policyStages === null ? "unknown" : String(policyStages.length)}]`,
          );
        }
        const callerIsParticipant =
          participantAgentId !== null && callerAgentId !== null && participantAgentId === callerAgentId;
        if (preDecisionStatus !== "in_review" && participantAgentId !== null && !callerIsParticipant) {
          // The issue status drifted away from in_review while the stage is
          // still pending (the reviewer-checkout demotion). In that state the
          // server does NOT reject a foreign writer - it applies the status
          // without persisting a decision. Refuse BEFORE writing anything.
          throw new Error(
            `The issue status drifted away from in_review (current=${preDecisionStatus ?? "unknown"}) while review stage ${stageId ?? "unknown"} is still pending for reviewer ${participantAgentId}, so the server would apply a status transition without persisting a decision. Nothing was written - repair the status drift first (Paperclip Core checkout / terminal-enforcement gate). [errorCode=REVIEW_STATUS_DRIFTED] [stageId=${stageId ?? "unknown"}] [currentStatus=${preDecisionStatus ?? "unknown"}] [reviewerAgentId=${participantAgentId}]`,
          );
        }
        const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(issueId)}`, {
          body: { status: requestedStatus, comment: decisionNote },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        });
        // Commit evidence comes from the WRITE RESPONSE: the server applied the
        // transition and the decision row in one transaction, so the response is
        // the authoritative commit record. A separate read can be served by a
        // lagging replica and would make the MCP roll back a REAL decision.
        let afterState = isRecord(updated.executionState) ? updated.executionState : null;
        let evidenceSource = "write_response";
        if (!afterState) {
          const readback = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
          afterState = isRecord(readback.executionState) ? readback.executionState : null;
          evidenceSource = "readback";
        }
        const completedStageIds = Array.isArray(afterState?.completedStageIds)
          ? (afterState.completedStageIds as string[])
          : [];
        const recordedOutcome = str(afterState?.lastDecisionOutcome);
        const recordedDecisionId = str(afterState?.lastDecisionId);
        // KOMAA-849: the transition can be REJECTED silently by the server
        // (a non-participant actor is re-pended instead of deciding). The
        // decision is only real when the server persisted a decision record,
        // so verify the committed state instead of trusting the HTTP 200.
        const decisionRecorded =
          recordedOutcome === (action === "approve" ? "approved" : "changes_requested") &&
          (action !== "approve" || completedStageIds.includes(stageId ?? ""));
        if (!decisionRecorded) {
          // The server applied the transition but persisted no decision. The MCP
          // does NOT compensate: without a server-side compare-and-set a
          // rollback write can overwrite a decision or status that another
          // actor committed in the meantime - exactly the data-loss race this
          // path must not have. The authoritative state is left exactly as the
          // server applied it and the missing decision is reported for the
          // Paperclip Core terminal-enforcement repair path.
          const observedStatus = str(updated.status) ?? null;
          const partialStatusMutation =
            preDecisionStatus !== null && observedStatus !== null && observedStatus !== preDecisionStatus;
          const terminalWithoutPersistedDecision = observedStatus === "done" || observedStatus === "cancelled";
          throw new Error(
            `The review decision was not recorded. The server did not persist a decision for stage ${stageId ?? "unknown"} (executionState.lastDecisionOutcome=${recordedOutcome ?? "none"}, completedStageIds=${JSON.stringify(completedStageIds)}). Only the active participant can decide this stage - re-read the state and act as the configured participant. No rollback was issued: the server exposes no compare-and-set for issue updates, so a compensating status write could overwrite a concurrent decision. The status the server applied was left untouched and the missing decision is reported for the Core terminal-enforcement repair path. [errorCode=REVIEW_DECISION_NOT_RECORDED] [noDecisionCommitted=true] [partialStatusMutation=${partialStatusMutation}] [observedStatus=${observedStatus ?? "unknown"}] [compensatedTo=none] [compensationSkipped=not_attempted_no_server_compare_and_set] [rollbackNotAttempted=true] [terminalWithoutPersistedDecision=${terminalWithoutPersistedDecision}] [evidenceSource=${evidenceSource}] [currentStageId=${stageId ?? "unknown"}] [currentStageStatus=${str(afterState?.status) ?? "unknown"}] [currentDecisionId=${recordedDecisionId ?? "none"}] [currentDecisionOutcome=${recordedOutcome ?? "none"}]`,
          );
        }
        return {
          mode: "active_stage_transition",
          issueId,
          action,
          committed: true,
          decision: {
            stageId,
            stageType,
            outcome: action === "approve" ? "approved" : "changes_requested",
            comment: decisionNote,
            decisionId: str(afterState?.lastDecisionId),
          },
          committedState: {
            status: str(updated.status),
            executionState: afterState,
            completedStageIds,
            lastDecisionId: str(afterState?.lastDecisionId),
            lastDecisionOutcome: recordedOutcome,
            currentParticipant: isRecord(afterState?.currentParticipant) ? afterState.currentParticipant : null,
            returnAssignee: isRecord(afterState?.returnAssignee) ? afterState.returnAssignee : null,
          },
          updated,
        };
      },
    ),
    makeTool(
      "paperclipRequestReview",
      CRITICAL_REVIEW_STATE + " Safe executor-to-reviewer handoff: moves the issue to in_review with an audit comment. Revokes executor authority via status transition (no stale running executor).",
      z.object({ issueId: issueIdSchema, note: z.string().trim().max(2000).optional(), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ issueId, note, runId, operatorRunId }) => {
        // KOMAA-1094 (2026-10-20): a scheduled retry left over from the
        // previous attempt can fire the recovery path AFTER the new review
        // stage is armed and demote the pending stage to blocked with zero
        // first-class blockers. Invalidate the stale retry BEFORE the handoff.
        // Best effort: a refused cancel must never strand the handoff itself.
        let retryRunId: string | null = null;
        let staleRetryInvalidated = false;
        let staleRetryError: string | null = null;
        try {
          const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
          const retry = isRecord(before.scheduledRetry) ? before.scheduledRetry : null;
          retryRunId = retry && typeof retry.runId === "string" ? retry.runId : null;
        } catch (readError) {
          staleRetryError = readError instanceof Error ? readError.message : String(readError);
        }
        if (retryRunId) {
          try {
            await client.requestJson("POST", `/heartbeat-runs/${enc(retryRunId)}/cancel`, {
              body: {},
              ...(runId ? { runId } : {}),
              ...(operatorRunId ? { operatorRunId } : {}),
            });
            staleRetryInvalidated = true;
          } catch (cancelError) {
            staleRetryError = cancelError instanceof Error ? cancelError.message : String(cancelError);
          }
        }
        const result = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
          body: { status: "in_review", ...(note ? { comment: `[review handoff] ${note}` } : {}) },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined, // P1 2026-10-14
        });
        return retryRunId
          ? { ...(isRecord(result) ? result : { result }), staleRetryInvalidated, staleRetryRunId: retryRunId, staleRetryError }
          : result;
      },
    ),
    makeTool(
      "paperclipListPendingReviews",
      "Issues in review with their real liveness (approvals, live runs, wedged flag). Bounded scan.",
      z.object({ limit: z.number().int().positive().max(100).optional().default(50) }),
      async ({ limit }) => {
        const companyId = client.resolveCompanyId();
        const issues = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ status: "in_review", limit })}`);
        const pending: unknown[] = [];
        for (const entry of Array.isArray(issues) ? issues : []) {
          if (!isRecord(entry) || typeof entry.id !== "string") continue;
          const [approvals, liveRuns, activeRun] = await Promise.all([
            getJsonOrNull(client, `/issues/${enc(entry.id)}/approvals`),
            getJsonOrNull(client, `/issues/${enc(entry.id)}/live-runs`),
            getJsonOrNull(client, `/issues/${enc(entry.id)}/active-run`),
          ]);
          const liveCount = Array.isArray(liveRuns) ? liveRuns.length : 0;
          pending.push({
            issueId: entry.id, identifier: entry.identifier ?? null, title: entry.title ?? null,
            approvals, liveRunCount: liveCount, activeRun, wedged: !activeRun && liveCount === 0,
          });
        }
        return { count: pending.length, pending };
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Run telemetry, scheduler, provider, preflight
// ---------------------------------------------------------------------------
function telemetryTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetRunEvents",
      "Full heartbeat-run events with pagination (stage, tool, lifecycle, seq). The brutal-debug view over GetRunDetail stages.",
      z.object({
        runId: runIdSchema,
        afterSeq: z.number().int().min(0).optional().default(0),
        limit: z.number().int().positive().max(1000).optional().default(200),
      }),
      async ({ runId, afterSeq, limit }) =>
        client.requestJson("GET", `/heartbeat-runs/${enc(runId)}/events${qs({ afterSeq, limit })}`),
    ),
    makeTool(
      "paperclipTailRunLog",
      "stdout/stderr/log chunks for a run from an offset. Proves 'zero output' vs silence; inspect PID/exit via events.",
      z.object({
        runId: runIdSchema,
        offset: z.number().int().min(0).optional().default(0),
        limitBytes: z.number().int().positive().max(1_000_000).optional().default(65536),
      }),
      async ({ runId, offset, limitBytes }) =>
        client.requestJson("GET", `/heartbeat-runs/${enc(runId)}/log${qs({ offset, limitBytes })}`),
    ),
    makeTool(
      "paperclipGetRunTranscript",
      "Redacted transcript synthesis for a run: detail summary + full events + log tail + linked issues. Secrets are never included (server-redacted).",
      z.object({
        runId: runIdSchema,
        logBytes: z.number().int().positive().max(1_000_000).optional().default(65536),
        eventLimit: z.number().int().positive().max(1000).optional().default(500),
      }),
      async ({ runId, logBytes, eventLimit }) => {
        // P0: primary run throws on 404 (no success-nulls); attachments stay best-effort.
        const run = await client.requestJson(`GET`, `/heartbeat-runs/${enc(runId)}`);
        const [events, log, issues, operations] = await Promise.all([
          getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}/events${qs({ afterSeq: 0, limit: eventLimit })}`),
          getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}/log${qs({ offset: 0, limitBytes: logBytes })}`),
          getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}/issues`),
          getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}/workspace-operations`),
        ]);
        return { runId, run, events, log, linkedIssues: issues, workspaceOperations: operations };
      },
    ),
    makeTool(
      "paperclipGetSchedulerState",
      "Scheduler snapshot: live runs, per-agent scheduler heartbeats, recent run outcomes. Shows slot holders vs maxConcurrentRuns.",
      z.object({ liveLimit: z.number().int().positive().max(100).optional().default(50), recentLimit: z.number().int().positive().max(200).optional().default(50) }),
      async ({ liveLimit, recentLimit }) => {
        const companyId = client.resolveCompanyId();
        const [liveRuns, heartbeats, recent] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/live-runs${qs({ limit: liveLimit })}`),
          getJsonOrNull(client, "/instance/scheduler-heartbeats"),
          getJsonOrNull(client, `/companies/${companyId}/heartbeat-runs${qs({ limit: recentLimit, summary: true })}`),
        ]);
        return { liveRuns, schedulerHeartbeats: heartbeats, recentRuns: recent };
      },
    ),
    makeTool(
      "paperclipGetProviderHealth",
      "Model/provider/auth/quota/cooldown per agent before launching: quota windows plus agent runtime state and configuration model.",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const companyId = client.resolveCompanyId();
        const resolved = agentId ?? client.defaults.agentId;
        const [quotaWindows, runtimeState, configuration] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/costs/quota-windows`),
          resolved ? getJsonOrNull(client, `/agents/${enc(resolved)}/runtime-state`) : Promise.resolve(null),
          resolved ? getJsonOrNull(client, `/agents/${enc(resolved)}/configuration`) : Promise.resolve(null),
        ]);
        return { agentId: resolved, quotaWindows, runtimeState, configuration };
      },
    ),
    makeTool(
      "paperclipGetRuntimePreflight",
      "Preflight before burning a run: agent configuration + runtime state, issue workspace + close-readiness, company environments list. Catches pnpm-missing / bad-PWD / workspace-busy class failures early.",
      z.object({ issueId: issueIdSchema, agentId: z.string().guid().optional().nullable() }),
      async ({ issueId, agentId }) => {
        const companyId = client.resolveCompanyId();
        // P0: primary issue throws on 404/403 (no success-nulls); context stays best-effort.
        const issue = await client.requestJson<Record<string, unknown>>(`GET`, `/issues/${enc(issueId)}`);
        const context = await getJsonOrNull(client, `/issues/${enc(issueId)}/heartbeat-context`);
        const resolvedAgent = agentId ?? (isRecord(issue) && typeof issue.assigneeAgentId === "string" ? issue.assigneeAgentId as string : null) ?? client.defaults.agentId;
        const workspace = isRecord(context) ? (context.currentExecutionWorkspace as Record<string, unknown> | null) ?? null : null;
        const workspaceId = workspace && typeof workspace.id === "string" ? workspace.id : null;
        // KOMAA-468 (MCP layer, no Core change): the preflight is the last
        // place an agent learns which tree it is about to write. Fail closed
        // when the task session resolves a foreign per-issue worktree that a
        // live run already holds; report an uncontended foreign binding
        // instead of hiding it.
        // The issue id may be a display identifier ("KOMAA-468"). Workspace
        // ownership is compared against the authoritative UUID, so resolve the
        // identifier first: the same issue must produce the same diagnostic in
        // both forms.
        const resolvedIssueId =
          isRecord(issue) && typeof issue.id === "string" ? issue.id : issueId;
        const workspaceIsolation = await assertTaskSessionWorkspaceIsolation(client, {
          issueId: resolvedIssueId,
          resolvedWorkspaceId: workspaceId,
        });
        const [configuration, runtimeState, readiness, environments] = await Promise.all([
          resolvedAgent ? getJsonOrNull(client, `/agents/${enc(resolvedAgent)}/configuration`) : Promise.resolve(null),
          resolvedAgent ? getJsonOrNull(client, `/agents/${enc(resolvedAgent)}/runtime-state`) : Promise.resolve(null),
          workspaceId ? getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/close-readiness`) : Promise.resolve(null),
          getJsonOrNull(client, `/companies/${companyId}/environments`),
        ]);
        return { issueId: resolvedIssueId, requestedIssueId: issueId, agentId: resolvedAgent, agentConfiguration: configuration, agentRuntimeState: runtimeState, currentExecutionWorkspace: workspace, closeReadiness: readiness, environments, workspaceIsolation };
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Agents, routines, goals, search, metrics, artifacts, candidate, system
// ---------------------------------------------------------------------------
const FORBIDDEN_MAP: Array<{ match: RegExp; requires: string; sanctionedPath: string }> = [
  { match: /cross_issue_influence_run_context_required/i, requires: "Active heartbeat runId (X-Paperclip-Run-Id) bound to the target issue", sanctionedPath: "paperclipGetCurrentOperatorRun -> pass runId explicitly, or run inside the owning agent run" },
  { match: /agent can only cancel its own heartbeat run/i, requires: "Board auth or owning agent/run", sanctionedPath: "paperclipCancelRun already uses the server board key; if this still 403s the board key is missing/invalid (remote-mcp-board-key)" },
  { match: /board access required|board_or_agent|assertBoard/i, requires: "Board authentication", sanctionedPath: "Use the board-keyed MCP path (any non-/agents route); /agents/* routes use the agent key and will 401/403" },
  { match: /only the origin agent may/i, requires: "Origin agent identity", sanctionedPath: "Have the origin agent act, or escalate to a board decision via paperclipResolveDecision" },
  { match: /agents can only assign routines to themselves/i, requires: "Self-assignment for agent actors", sanctionedPath: "Board assigns any agent; agents only themselves" },
  { match: /company_scope:read|outside this actor's authorization boundary/i, requires: "Company-scope read grant for the agent", sanctionedPath: "Board actor, or grant company_scope:read to the agent" },
  { match: /only board-authenticated callers can manage instructions/i, requires: "Board authentication for instructions path/bundle writes", sanctionedPath: "Use the board-keyed MCP path; agent-key callers get 403 on instructions writes" },
  { match: /only ceo can manage permissions|assertCanUpdateAgent/i, requires: "CEO role or board agent-management rights", sanctionedPath: "Have the CEO agent act, or use board auth; paperclipGetAgentEffectiveConfig shows the caller role" },
  { match: /skills\.(edit|test|create|update)/i, requires: "Matching skills.* policy grant for the caller", sanctionedPath: "paperclipGetAgentEffectiveConfig -> configuration grants; missing grant must be added by board/CEO, the routine cannot self-grant" },
];

// ---------------------------------------------------------------------------
// Agent control plane: instructions, runtime config, skills, revisions,
// permissions, economics, skill evaluation.
// Thin wrappers over existing /api endpoints (no backend changes). These close
// the read/write gap: previously only reportsTo/capabilities were writable via
// paperclipUpdateAgent while instructions/skills/runtime required raw ApiRequest.
// ---------------------------------------------------------------------------
function diffLineCounts(before: string, after: string): { added: number; removed: number } {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = after.split("\n");
  let added = 0;
  for (const line of afterLines) if (!beforeLines.has(line)) added += 1;
  const afterSet = new Set(afterLines);
  let removed = 0;
  for (const line of beforeLines) if (!afterSet.has(line)) removed += 1;
  return { added, removed };
}

function skillKeyOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (isRecord(entry) && typeof entry.key === "string" && entry.key.trim()) return entry.key.trim();
  return null;
}

const desiredSkillSelectionSchema = z.union([
  z.string().trim().min(1),
  z.object({ key: z.string().trim().min(1), versionId: z.string().guid().nullable() }),
]);

function agentControlTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetAgentInstructions",
      "READ exact current instructions bundle (mode, rootPath, entryFile, files). First step of READ -> DIFF -> MUTATE -> TEST -> COMPARE -> KEEP/REVERT.",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("GET", `/agents/${enc(resolved)}/instructions-bundle`);
      },
    ),
    makeTool(
      "paperclipGetAgentInstructionsFile",
      "READ one instructions file (default AGENTS.md entry). Returns path, size and content.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        path: z.string().trim().min(1).max(256).optional().default("AGENTS.md"),
      }),
      async ({ agentId, path }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("GET", `/agents/${enc(resolved)}/instructions-bundle/file${qs({ path })}`);
      },
    ),
    makeTool(
      "paperclipUpdateAgentInstructionsFile",
      "MUTATE one instructions fragment (PUT file). Returns before/after sizes plus added/removed line counts. 403 on agent-key callers -> board auth required (see paperclipExplainForbidden).",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        path: z.string().trim().min(1).max(256).optional().default("AGENTS.md"),
        content: z.string().min(1).max(524288),
        clearLegacyPromptTemplate: z.boolean().optional(),
      }),
      async ({ agentId, path, content, clearLegacyPromptTemplate }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        const before = await getJsonOrNull(client, `/agents/${enc(resolved)}/instructions-bundle/file${qs({ path })}`);
        const beforeContent = isRecord(before) && typeof before.content === "string" ? before.content as string : "";
        const file = await client.requestJson("PUT", `/agents/${enc(resolved)}/instructions-bundle/file`, {
          body: { path, content, ...(clearLegacyPromptTemplate !== undefined ? { clearLegacyPromptTemplate } : {}) },
        });
        const stat = diffLineCounts(beforeContent, content);
        return {
          agentId: resolved, path, file,
          beforeSize: beforeContent.length, afterSize: content.length,
          changed: beforeContent !== content,
          addedLines: stat.added, removedLines: stat.removed,
        };
      },
    ),
    makeTool(
      "paperclipPatchAgentInstructionsBundle",
      "PATCH bundle routing (mode managed|external, rootPath, entryFile). For content edits use paperclipUpdateAgentInstructionsFile.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        mode: z.enum(["managed", "external"]).optional(),
        rootPath: z.string().trim().min(1).nullable().optional(),
        entryFile: z.string().trim().min(1).optional(),
        clearLegacyPromptTemplate: z.boolean().optional(),
      }).refine((v) => v.mode !== undefined || v.rootPath !== undefined || v.entryFile !== undefined,
        { message: "Provide mode, rootPath or entryFile" }),
      async ({ agentId, ...body }) =>
        client.requestJson("PATCH", `/agents/${enc(agentId ?? client.defaults.agentId ?? "")}/instructions-bundle`, { body }),
    ),
    makeTool(
      "paperclipDeleteAgentInstructionsFile",
      "DELETE one instructions file. Returns the remaining bundle.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        path: z.string().trim().min(1).max(256),
      }),
      async ({ agentId, path }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("DELETE", `/agents/${enc(resolved)}/instructions-bundle/file${qs({ path })}`);
      },
    ),
    makeTool(
      "paperclipPatchAgentRuntimeConfig",
      "ATOMIC patch of agent runtime (model/profile/timeout/concurrency/adapter/tool policy/context) WITHOUT rewriting the whole object. Only provided keys are sent. Use paperclipUpdateAgentPermissions for permissions (server rejects them here with 422).",
      z.object({
        agentId: z.string().guid(),
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        title: z.string().nullable().optional(),
        capabilities: z.string().nullable().optional(),
        reportsTo: z.string().guid().nullable().optional(),
        adapterType: z.string().min(1).optional(),
        adapterConfig: z.record(z.string(), z.unknown()).optional(),
        runtimeConfig: z.record(z.string(), z.unknown()).optional(),
        desiredSkills: z.array(desiredSkillSelectionSchema).optional(),
        defaultEnvironmentId: z.string().guid().nullable().optional(),
        budgetMonthlyCents: z.number().int().nonnegative().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
        status: z.string().min(1).optional(),
        replaceAdapterConfig: z.boolean().optional(),
      }).strict().refine((v) => Object.keys(v).filter((k) => k !== "agentId").length > 0,
        { message: "Provide at least one field besides agentId" }),
      async ({ agentId, ...body }) =>
        client.requestJson("PATCH", `/agents/${enc(agentId)}`, { body }),
    ),
    makeTool(
      "paperclipGetAgentSkillSet",
      "Effective skills for an agent: desired keys + resolved entries (state, origin, managed) + warnings + sync mode. Use for cost/context attribution before attach/detach.",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("GET", `/agents/${enc(resolved)}/skills`);
      },
    ),
    makeTool(
      "paperclipSyncAgentSkills",
      "ATTACH/DETACH skills: mode add (attach listed), remove (detach listed), replace (set exact list). Rejects duplicate keys client-side with a clear error instead of a silent no-op.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        mode: z.enum(["add", "remove", "replace"]),
        desiredSkills: z.array(desiredSkillSelectionSchema).min(1).max(100),
      }),
      async ({ agentId, mode, desiredSkills }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        const keys = desiredSkills.map(skillKeyOf).filter((k): k is string => k !== null);
        const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
        if (dupes.length > 0) throw new Error(`Duplicate skill keys: ${[...new Set(dupes)].join(", ")}`);
        return client.requestJson("POST", `/agents/${enc(resolved)}/skills/sync`, { body: { mode, desiredSkills } });
      },
    ),
    makeTool(
      "paperclipListAgentConfigRevisions",
      "Version history of an agent config (revision ids, source, author). Pair with Rollback for KEEP/REVERT.",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("GET", `/agents/${enc(resolved)}/config-revisions`);
      },
    ),
    makeTool(
      "paperclipGetAgentConfigRevision",
      "One config revision (before/after diff source).",
      z.object({ agentId: z.string().guid().optional().nullable(), revisionId: z.string().guid() }),
      async ({ agentId, revisionId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("GET", `/agents/${enc(resolved)}/config-revisions/${enc(revisionId)}`);
      },
    ),
    makeTool(
      "paperclipRollbackAgentConfig",
      "REVERT agent config to a prior revision (automatic rollback for failed before/after experiments).",
      z.object({ agentId: z.string().guid().optional().nullable(), revisionId: z.string().guid() }),
      async ({ agentId, revisionId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        return client.requestJson("POST", `/agents/${enc(resolved)}/config-revisions/${enc(revisionId)}/rollback`, { body: {} });
      },
    ),
    makeTool(
      "paperclipUpdateAgentPermissions",
      "Update agent permission grants (CEO role or board auth only). Does NOT self-grant: a routine without rights gets a 403 naming the missing grant (surface it via paperclipExplainForbidden instead of retrying).",
      z.object({
        agentId: z.string().guid(),
        canCreateAgents: z.boolean(),
        canAssignTasks: z.boolean(),
        canCreateSkills: z.boolean().optional(),
        trustPreset: z.string().min(1).optional(),
        authorizationPolicy: z.record(z.string(), z.unknown()).optional(),
      }),
      async ({ agentId, ...body }) =>
        client.requestJson("PATCH", `/agents/${enc(agentId)}/permissions`, { body }),
    ),
    makeTool(
      "paperclipGetEconomicsMetrics",
      "Economics per agent/issue/run: Paperclip cost ledgers (summary, by-agent, by-model, by-provider, issue tree) PLUS run usage snapshot (tokens cached/uncached, events, outcome). NOTE: costCents=0 / billingType=unknown means the ledger has no price data - use Langfuse MCP queryMetrics/listObservations for token-level truth (wasted tokens, retries, TTFU).",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        issueId: issueIdSchema.optional(),
        runId: runIdSchema.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      async ({ agentId, issueId, runId, from, to }) => {
        const companyId = client.resolveCompanyId();
        const range = qs({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
        const [summary, byAgent, byProvider, byModel, issueSummary, run, runEvents] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/costs/summary${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-agent${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-provider${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-agent-model${range}`),
          issueId ? getJsonOrNull(client, `/issues/${enc(issueId)}/cost-summary`) : Promise.resolve(null),
          runId ? getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}`) : Promise.resolve(null),
          runId ? getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}/events${qs({ afterSeq: 0, limit: 200 })}`) : Promise.resolve(null),
        ]);
        const events = Array.isArray(runEvents) ? runEvents : (isRecord(runEvents) && Array.isArray(runEvents.events) ? runEvents.events as unknown[] : []);
        return {
          agentId: agentId ?? null, issueId: issueId ?? null, runId: runId ?? null,
          costs: { summary, byAgent, byProvider, byModel, issueCostSummary: issueSummary },
          run: run ? { detail: run, eventCount: events.length } : null,
          billingCaveat: "costCents=0 / billingType=unknown = no price data in ledger; token-level deltas (cached vs uncached, wasted, retries, TTFU) come from Langfuse MCP (queryMetrics/listObservations), not from this ledger.",
        };
      },
    ),
    makeTool(
      "paperclipCreateSkillTestRun",
      "EVALUATE a skill revision: start a harness test run (baseline vs candidate skillVersionId). Requires skills.test grant. Returns the run; poll with paperclipGetSkillTestRun. Prompt A/B lives in Langfuse MCP (createTextPrompt new version + dataset runs), not here.",
      z.object({
        skillId: z.string().min(1),
        agentId: z.string().guid(),
        inputId: z.string().guid().nullable().optional(),
        content: z.string().min(1).nullable().optional(),
        templateId: z.string().min(1).nullable().optional(),
        skillVersionId: z.string().guid().nullable().optional(),
      }).refine((v) => Boolean(v.inputId) || Boolean(v.content?.trim()),
        { message: "inputId or content is required" }),
      async ({ skillId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId()}/skills/${enc(skillId)}/test-runs`, { body }),
    ),
    makeTool(
      "paperclipGetSkillTestRun",
      "READ a skill test-run result (PASS/FAIL, token delta source). Run twice (baseline version vs candidate version) and COMPARE before KEEP/REVERT.",
      z.object({ skillId: z.string().min(1), runId: z.string().min(1) }),
      async ({ skillId, runId }) =>
        client.requestJson("GET", `/companies/${client.resolveCompanyId()}/skills/${enc(skillId)}/test-runs/${enc(runId)}`),
    ),
  ];
}

function miscTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetAgentEffectiveConfig",
      "Effective agent config: record + resolved configuration + runtime state (model, profile, heartbeat, concurrency, workspace policy).",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        const [agent, configuration, runtimeState] = await Promise.all([
          getJsonOrNull(client, `/agents/${enc(resolved)}`),
          getJsonOrNull(client, `/agents/${enc(resolved)}/configuration`),
          getJsonOrNull(client, `/agents/${enc(resolved)}/runtime-state`),
        ]);
        return { agentId: resolved, agent, configuration, runtimeState };
      },
    ),
    makeTool(
      "paperclipGetAgentPermissions",
      "Agent record plus instructions bundle pointer and company role context. NOTE: no GET /agents/:id/permissions endpoint exists; effective grants come from the agent record + configuration.",
      z.object({ agentId: z.string().guid().optional().nullable() }),
      async ({ agentId }) => {
        const resolved = agentId ?? client.defaults.agentId;
        if (!resolved) throw new Error("No agent: pass agentId or set PAPERCLIP_AGENT_ID");
        const [agent, configuration] = await Promise.all([
          getJsonOrNull(client, `/agents/${enc(resolved)}`),
          getJsonOrNull(client, `/agents/${enc(resolved)}/configuration`),
        ]);
        return { agentId: resolved, agent, configuration, permissionEndpointNote: "GET /agents/:id/permissions does not exist (PATCH only); grants are embedded above." };
      },
    ),
    makeTool(
      "paperclipExplainForbidden",
      "Explain a 403/forbidden error: required scope/actor/run-context plus the sanctioned path. No API call; pure policy map. Pass the raw error text.",
      z.object({ errorText: z.string().min(1).max(4000), operation: z.string().trim().max(200).optional() }),
      async ({ errorText, operation }) => {
        const hits = FORBIDDEN_MAP.filter((entry) => entry.match.test(errorText));
        return {
          operation: operation ?? null,
          matched: hits.length > 0,
          explanations: hits.length > 0 ? hits : [{ requires: "Unknown policy gate", sanctionedPath: "Re-run with board auth, or fetch paperclipGetExecutionEligibility for the target issue first" }],
        };
      },
    ),
    makeTool(
      "paperclipListRoutines",
      "List company routines (prompt, agent, schedule, policy).",
      z.object({}),
      async () => client.requestJson("GET", `/companies/${client.resolveCompanyId()}/routines`),
    ),
    makeTool(
      "paperclipGetRoutine",
      "Get one routine with revisions and triggers.",
      z.object({ routineId: z.string().guid() }),
      async ({ routineId }) => {
        const [routine, revisions] = await Promise.all([
          client.requestJson("GET", `/routines/${enc(routineId)}`),
          getJsonOrNull(client, `/routines/${enc(routineId)}/revisions`),
        ]);
        return { routine, revisions };
      },
    ),
    makeTool(
      "paperclipCreateRoutine",
      "Create a routine (title/prompt, agent, schedule, policy). Server validates; assignee rules mirror task creation (agents may only self-assign).",
      z.object({ body: z.record(z.string(), z.unknown()), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ body, runId, operatorRunId }) => {
        if (isRecord(body.assigneeAgentId) || body.assigneeAgentId === "") throw new Error("Routine creation requires a non-empty assigneeAgentId");
        return client.requestJson("POST", `/companies/${client.resolveCompanyId()}/routines`, { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // FIX 2026-10-14
      },
    ),
    makeTool(
      "paperclipUpdateRoutine",
      "Update a routine (including status active/paused for enable/disable). Activating or reassigning requires board assign rights.",
      z.object({ routineId: z.string().guid(), body: z.record(z.string(), z.unknown()), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ routineId, body, runId, operatorRunId }) =>
        client.requestJson("PATCH", `/routines/${enc(routineId)}`, { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }), // FIX 2026-10-14
    ),
    makeTool(
      "paperclipRunRoutineNow",
      "Manually trigger a routine run (manual source). Returns the created run/issue linkage.",
      z.object({ routineId: z.string().guid(), body: z.record(z.string(), z.unknown()).optional(), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ routineId, body, runId, operatorRunId }) =>
        client.requestJson("POST", `/routines/${enc(routineId)}/run`, { body: { source: "manual", ...(body ?? {}) }, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }), // FIX 2026-10-14
    ),
    makeTool(
      "paperclipListRoutineRuns",
      "History of a routine's runs (actual output, not just schedule count).",
      z.object({ routineId: z.string().guid(), limit: z.number().int().positive().max(100).optional().default(20) }),
      async ({ routineId, limit }) => client.requestJson("GET", `/routines/${enc(routineId)}/runs${qs({ limit })}`),
    ),
    makeTool(
      "paperclipGetRoutineMetrics",
      "Routine effectiveness: run counts by status, no-op rate proxy (runs without linked issues), latest runs. Token/cost rollup comes from paperclipGetCostMetrics.",
      z.object({ routineId: z.string().guid(), limit: z.number().int().positive().max(100).optional().default(50) }),
      async ({ routineId, limit }) => {
        const runs = await client.requestJson<unknown[]>("GET", `/routines/${enc(routineId)}/runs${qs({ limit })}`);
        const list = Array.isArray(runs) ? runs : [];
        const byStatus: Record<string, number> = {};
        let withoutIssues = 0;
        for (const run of list) {
          if (!isRecord(run)) continue;
          const status = typeof run.status === "string" ? run.status : "unknown";
          byStatus[status] = (byStatus[status] ?? 0) + 1;
          if (run.issueId == null && run.issueCount === undefined) withoutIssues += 1;
        }
        return { routineId, runCount: list.length, byStatus, runsWithoutLinkedIssue: withoutIssues, runs: list.slice(0, 10) };
      },
    ),
    makeTool(
      "paperclipUpdateGoal",
      "Update a goal (title/description/status).",
      z.object({ goalId: z.string().guid(), body: z.record(z.string(), z.unknown()), runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ goalId, body, runId, operatorRunId }) => client.requestJson("PATCH", `/goals/${enc(goalId)}`, { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }), // FIX 2026-10-14
    ),
    makeTool(
      "paperclipDetachGoal",
      "Detach a goal from an issue (PATCH issue goalId:null). The goal itself is kept.",
      z.object({ issueId: issueIdSchema, runId: runIdOptional, operatorRunId: operatorRunIdOptional }), // KOMAA-630
      async ({ issueId, runId, operatorRunId }) => {
        const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const updated = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: { goalId: null }, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined }); // FIX 2026-10-14
        return { issueId, goalBefore: before.goalId ?? null, updated };
      },
    ),
    makeTool(
      "paperclipSearchActivity",
      "Company activity timeline with filters (the operator-visible event stream).",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
      }),
      async ({ agentId, entityType, entityId, limit }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson(
          "GET",
          `/companies/${companyId}/activity${qs({ agentId: agentId ?? undefined, entityType, entityId, limit })}`,
        );
      },
    ),
    makeTool(
      "paperclipSearchLogs",
      "Closest thing to global log grep: company search hits plus sampled run-log tails for the top live/recent runs matching the query. Bounded (maxRuns, bytesPerRun).",
      z.object({
        query: z.string().trim().min(2).max(200),
        maxRuns: z.number().int().positive().max(10).optional().default(3),
        bytesPerRun: z.number().int().positive().max(262144).optional().default(16384),
      }),
      async ({ query, maxRuns, bytesPerRun }) => {
        const companyId = client.resolveCompanyId();
        const [search, liveRuns] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/search${qs({ q: query, limit: 20 })}`),
          getJsonOrNull(client, `/companies/${companyId}/live-runs${qs({ limit: maxRuns })}`),
        ]);
        const runs = (Array.isArray(liveRuns) ? liveRuns : []).slice(0, maxRuns);
        const logs: unknown[] = [];
        for (const run of runs) {
          if (!isRecord(run) || typeof run.id !== "string") continue;
          const log = await getJsonOrNull(client, `/heartbeat-runs/${enc(run.id)}/log${qs({ offset: 0, limitBytes: bytesPerRun })}`);
          logs.push({ runId: run.id, status: run.status ?? null, log });
        }
        return { query, search, sampledRunLogs: logs };
      },
    ),
    makeTool(
      "paperclipGetDeliveryMetrics",
      "Delivery truth: issue counts by status, blocked/stale/in-review queues, reopen proxy. Bounded scan. KOMAA-874: blocked_empty_projection is UNVERIFIED (projection-only) — confirm via paperclipGetExecutionEligibility before treating any entry as blockerless.",
      z.object({ limit: z.number().int().positive().max(200).optional().default(100) }),
      async ({ limit }) => {
        const companyId = client.resolveCompanyId();
        const issues = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ limit })}`);
  const list = (Array.isArray(issues) ? issues : [])
    .filter(isRecord);
        const byStatus: Record<string, number> = {};
        const queues: Record<string, unknown[]> = { blocked: [], in_review: [], blocked_empty_projection: [] };
        const now = Date.now();
        for (const issue of list) {
          const rec = issue as Record<string, unknown>;
          const status = typeof rec.status === "string" ? rec.status : "unknown";
          byStatus[status] = (byStatus[status] ?? 0) + 1;
          const short = { issueId: rec.id, identifier: rec.identifier ?? null, title: rec.title ?? null, updatedAt: rec.updatedAt ?? null };
          if (status === "blocked") {
            queues.blocked.push(short);
            if (blockedByIdsOf(rec).length === 0) queues.blocked_empty_projection.push(short);
          }
          if (status === "in_review") queues.in_review.push(short);
          void now;
        }
        return { scanned: list.length, byStatus, queueCounts: { blocked: queues.blocked.length, in_review: queues.in_review.length, blocked_empty_projection: queues.blocked_empty_projection.length }, queues, projectionNote: "blocked_empty_projection reads the denormalized projection only; relational truth is per-issue /diagnostics/blockers (see paperclipGetExecutionEligibility)" };
      },
    ),
    makeTool(
      "paperclipGetCostMetrics",
      "Cost truth: company summary, by-agent, by-provider, by-model, plus optional per-issue tree summary.",
      z.object({ issueId: issueIdSchema.optional(), from: z.string().optional(), to: z.string().optional() }),
      async ({ issueId, from, to }) => {
        const companyId = client.resolveCompanyId();
        const range = qs({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
        const [summary, byAgent, byProvider, byModel, issueSummary] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/costs/summary${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-agent${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-provider${range}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/by-agent-model${range}`),
          issueId ? getJsonOrNull(client, `/issues/${enc(issueId)}/cost-summary`) : Promise.resolve(null),
        ]);
        return { summary, byAgent, byProvider, byModel, issueCostSummary: issueSummary };
      },
    ),
    makeTool(
      "paperclipListArtifacts",
      "Company artifacts (candidates, builds, evidence) plus optional per-issue work products.",
      z.object({ issueId: issueIdSchema.optional() }),
      async ({ issueId }) => {
        const companyId = client.resolveCompanyId();
        const [artifacts, workProducts] = await Promise.all([
          getJsonOrNull(client, `/companies/${companyId}/artifacts`),
          issueId ? getJsonOrNull(client, `/issues/${enc(issueId)}/work-products`) : Promise.resolve(null),
        ]);
        return { artifacts, issueWorkProducts: workProducts };
      },
    ),
    makeTool(
      "paperclipGetCandidateState",
      "Candidate truth for an issue: work products, close-readiness/delivery state, workspace branch vs base, review validity proxy (approvals). Distinguishes stale vs fresh candidates.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => {
        const [issue, workProducts, approvals, context] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/work-products`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/heartbeat-context`),
        ]);
        const workspace = isRecord(context) ? (context.currentExecutionWorkspace as Record<string, unknown> | null) ?? null : null;
        const workspaceId = workspace && typeof workspace.id === "string" ? workspace.id : null;
        const readiness = workspaceId ? await getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/close-readiness`) : null;
        return { issueId, issue, workProducts, approvals, currentExecutionWorkspace: workspace, closeReadiness: readiness };
      },
    ),
    makeTool(
      "paperclipGetServerInfo",
      "Paperclip version, build SHA, deployment mode (from /health). Local patches/flags come from GetSystemHealth + ListFeatureFlags.",
      z.object({}),
      async () => client.requestJson("GET", "/health"),
    ),
    makeTool(
      "paperclipListFeatureFlags",
      "Experimental feature flags and their source (instance settings).",
      z.object({}),
      async () => client.requestJson("GET", "/instance/settings/experimental"),
    ),
    makeTool(
      "paperclipUpdateFeatureFlag",
      "Update an experimental flag (board-only). Partial body merged by the server.",
      z.object({ body: z.record(z.string(), z.unknown()) }),
      async ({ body }) => client.requestJson("PATCH", "/instance/settings/experimental", { body }),
    ),
    makeTool(
      "paperclipGetSystemHealth",
      "One-call sanity: server health + live runs + scheduler heartbeats + workspace overview summary. Run before any operation.",
      z.object({}),
      async () => {
        const companyId = client.resolveCompanyId();
        const [health, liveRuns, heartbeats, overview] = await Promise.all([
          getJsonOrNull(client, "/health"),
          getJsonOrNull(client, `/companies/${companyId}/live-runs${qs({ limit: 20 })}`),
          getJsonOrNull(client, "/instance/scheduler-heartbeats"),
          getJsonOrNull(client, `/companies/${companyId}/workspace-overview`),
        ]);
        return { health, liveRuns, schedulerHeartbeats: heartbeats, workspaceOverview: overview };
      },
    ),
    makeTool(
      "paperclipListMonitors",
      CRITICAL_MONITOR + " Watchdogs/monitors visibility: per issue, or bounded scan over filtered issues returning non-null watchdogs with triggers. NOTE: this lists WATCHDOG configurations, not the issue monitor (executionPolicy.monitor) - use paperclipManageIssueMonitor(operation=read) for the scheduled monitor state and paperclipManageIssueWatchdog(operation=read) for a single watchdog configuration.",
      z.object({ issueId: issueIdSchema.optional(), status: z.string().optional(), limit: z.number().int().positive().max(50).optional().default(20) }),
      async ({ issueId, status, limit }) => {
        if (issueId) return { monitors: [{ issueId, watchdog: await getJsonOrNull(client, `/issues/${enc(issueId)}/watchdog`) }] };
        const companyId = client.resolveCompanyId();
        const issues = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ limit, ...(status ? { status } : {}) })}`);
        const monitors: unknown[] = [];
        for (const entry of Array.isArray(issues) ? issues : []) {
          if (!isRecord(entry) || typeof entry.id !== "string") continue;
          const watchdog = await getJsonOrNull(client, `/issues/${enc(entry.id)}/watchdog`);
          if (watchdog) monitors.push({ issueId: entry.id, identifier: entry.identifier ?? null, watchdog });
        }
        return { scanned: Array.isArray(issues) ? issues.length : 0, monitorCount: monitors.length, monitors };
      },
    ),
  ];
}

// KOMAA-630 operator composites (appended before the Registry section).
// High-level board/operator actions so ChatGPT never hand-assembles 8 low-level
// calls for one semantic operation. Every mutation accepts operatorRunId
// (preferred) or runId, and returns post-state: before/after/changed,
// newly eligible issues, runs cancelled/started, blockers removed, warnings.

function pickIssueShort(issue: unknown): Record<string, unknown> | null {
  if (!isRecord(issue)) return null;
  return {
    id: issue.id ?? null,
    identifier: issue.identifier ?? null,
    title: issue.title ?? null,
    status: issue.status ?? null,
    blockedByIssueIds: issue.blockedByIssueIds ?? issue.blockedBy ?? null,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    unblockDescriptor: issue.unblockDescriptor ?? null,
    updatedAt: issue.updatedAt ?? null,
  };
}

function changedFields(before: unknown, after: unknown): string[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

function opAuth(operatorRunId: string | null | undefined, runId: string | null | undefined): {
  operatorRunId?: string;
  runId?: string;
} {
  const out: { operatorRunId?: string; runId?: string } = {};
  if (operatorRunId) out.operatorRunId = operatorRunId;
  if (runId) out.runId = runId;
  return out;
}

async function listDependentsBlockedBy(
  client: PaperclipApiClient,
  issueId: string,
): Promise<Array<Record<string, unknown>>> {
  // KOMAA-874: dependents are reverse issue_relations edges. The subtree
  // fallback used to read the denormalized blockedByIssueIds projection off
  // nodeResponses that do not even carry that field, so it always returned [].
  // Scan the relational per-node blockers instead, and union with /dependents
  // (when the route exists) rather than trusting either source alone.
  const found = new Map<string, Record<string, unknown>>();
  const direct = await getJsonOrNull(client, `/issues/${enc(issueId)}/dependents`);
  if (isRecord(direct) && Array.isArray(direct.dependents)) {
    for (const n of direct.dependents) {
      if (!isRecord(n) || typeof n.id !== "string" || n.id === issueId) continue;
      found.set(n.id, n);
    }
  }
  const subtree = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/subtree`);
  let subtreeTruncated = false;
  if (isRecord(subtree) && Array.isArray(subtree.nodes)) {
    for (const n of subtree.nodes) {
      if (!isRecord(n)) continue;
      const view = subtreeNodeView(n);
      if (!view.id || view.id === issueId) continue;
      if (view.truncatedBlockers) subtreeTruncated = true;
      const blocksThis = view.blockers.some((b) => b.id === issueId || b.identifier === issueId) ||
        (Array.isArray(subtree.edges) && subtree.edges.some((e) =>
          isRecord(e) && (e.kind === undefined || e.kind === null || e.kind === "blocks") &&
          String(e.fromIssueId ?? e.from ?? "") === issueId &&
          String(e.toIssueId ?? e.to ?? "") === view.id));
      if (blocksThis && !found.has(view.id)) found.set(view.id, { ...n, id: view.id });
    }
  }
  const out: Array<Record<string, unknown>> = [];
  for (const n of [...found.values()].slice(0, 20)) {
    if (typeof n.id !== "string") continue;
    // Re-read the full issue for a fresh projection; the relational base is
    // re-read per dependent at write time (TOCTOU-safe-ish, fail closed).
    const full = await getJsonOrNull(client, `/issues/${enc(n.id)}`);
    out.push(isRecord(full) ? full : n);
  }
  if (subtreeTruncated) {
    out.push({ id: "__truncated__", warning: "subtree truncated blocker sections; dependent list may be incomplete — verify with paperclipValidateDAG before relying on repointed[]" } as Record<string, unknown>);
  }
  return out;
}

async function checkoutWake(
  client: PaperclipApiClient,
  issueId: string,
  auth: { operatorRunId?: string; runId?: string },
): Promise<Record<string, unknown>> {
  const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
  const agent = typeof issue.assigneeAgentId === "string" && issue.assigneeAgentId
    ? issue.assigneeAgentId
    : client.defaults.agentId;
  if (!agent) return { woke: false, issueId, reason: "no assigneeAgentId and no session agent" };
  const workflow = isRecord(issue.executionState) ? issue.executionState : null;
  const status = issueStatusOf(issue);
  const checkoutGate = allowNativeCheckout(status, workflow, null);
  if (!checkoutGate.allowed) {
    return { woke: false, issueId, reason: checkoutGate.reason, status };
  }
  const liveBefore = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
  if (confirmedIssueBoundRuns(liveBefore).length > 0) {
    return { woke: false, issueId, reason: "issue_already_has_live_run", status };
  }
  try {
    const checkout = await client.requestJson("POST", `/issues/${enc(issueId)}/checkout`, {
      // checkout is board-routed server-side; operator header carries authority
      body: { agentId: agent, expectedStatuses: ["todo", "backlog"] },
      ...auth,
    });
    const live = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
    const confirmed = confirmedIssueBoundRuns(live);
    return {
      woke: confirmed.length > 0, verified: confirmed.length > 0,
      checkoutAccepted: true, issueId, agentId: agent, checkout,
      reason: confirmed.length > 0 ? "issue_run_observed" : "checkout_without_confirmed_issue_run",
      liveRunsAfter: confirmed,
    };
  } catch (error) {
    return { woke: false, issueId, error: error instanceof Error ? error.message : String(error) };
  }
}

function operatorCompositeTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipOperatorSnapshot",
      "One revisioned control-plane snapshot: health, live/queued runs, READY vs blocked vs reviews vs decisions vs holds vs retries, workspaces, provider health. Pass operatorRunId for audit scope.",
      z.object({ operatorRunId: operatorRunIdOptional }),
      async ({ operatorRunId }) => {
        const companyId = client.resolveCompanyId();
        const auth = opAuth(operatorRunId ?? client.defaults.operatorRunId ?? null, null);
        void auth;
        const revision = new Date().toISOString();
        const [health, liveRuns, ready, blocked, inReview, decisions, workspaces, quota, flags] = await Promise.all([
          getJsonOrNull(client, "/health"),
          getJsonOrNull(client, `/companies/${companyId}/live-runs${qs({ limit: 50 })}`),
          getJsonOrNull(client, `/companies/${companyId}/issues${qs({ status: "todo", limit: 50 })}`),
          getJsonOrNull(client, `/companies/${companyId}/issues${qs({ status: "blocked", limit: 50 })}`),
          getJsonOrNull(client, `/companies/${companyId}/issues${qs({ status: "in_review", limit: 50 })}`),
          getJsonOrNull(client, `/companies/${companyId}/decisions${qs({ status: "open", limit: 20 })}`),
          getJsonOrNull(client, `/companies/${companyId}/execution-workspaces${qs({ summary: true })}`),
          getJsonOrNull(client, `/companies/${companyId}/costs/quota-windows`),
          getJsonOrNull(client, "/instance/settings/experimental"),
        ]);
        const short = (list: unknown) =>
          Array.isArray(list)
            ? list.slice(0, 50).map((e) => (isRecord(e) ? { id: e.id ?? null, identifier: e.identifier ?? null, title: e.title ?? null, status: e.status ?? null } : e))
            : list;
        return {
          revision,
          operatorRunId: operatorRunId ?? client.defaults.operatorRunId ?? null,
          health, liveRuns,
          ready: short(ready), blocked: short(blocked), inReview: short(inReview),
          decisions, workspaces, quotaWindows: quota, featureFlags: flags,
        };
      },
    ),
    makeTool(
      "paperclipReconcileBlockedIssue",
      "Classify a blocked issue (real_dependency | execution_hold | human_wait | external_wait | stale_descriptor | done_blocker | invalid_blocked) and with apply:true repair it: drop done blockers, clear stale descriptor/hold, move invalid blocked back to todo. Never wakes a still-blocked issue.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        apply: z.boolean().optional().default(false),
      }),
      async ({ issueId, operatorRunId, runId, apply }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const [blockers, holdView, approvals] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`),
          readExecutionHold(client, issueId),
          getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
        ]);
        const hold = blockingHold(holdView);
        const blockerList: unknown[] = isRecord(blockers) && Array.isArray(blockers.blockers) ? blockers.blockers : [];
        const liveBlockers = blockerList.filter((b) => {
          const st = isRecord(b) ? String(b.status ?? "") : "";
          return st !== "done" && st !== "cancelled";
        });
        const doneBlockers = blockerList.filter((b) => {
          const st = isRecord(b) ? String(b.status ?? "") : "";
          return st === "done" || st === "cancelled";
        });
        const descriptor = isRecord(before.unblockDescriptor) ? before.unblockDescriptor : null;
        const status = issueStatusOf(before);
        let classification = "invalid_blocked";
        if (status !== "blocked") classification = "not_blocked";
        else if (liveBlockers.length > 0) classification = "real_dependency";
        else if (hold) classification = "execution_hold";
        else if (descriptor) classification = (doneBlockers.length > 0 || blockerList.length === 0) ? "stale_descriptor" : "human_wait";
        else if (doneBlockers.length > 0) classification = "done_blocker";
        else if (Array.isArray(approvals) && approvals.length > 0) classification = "human_wait";
        const actions: unknown[] = [{ classification, liveBlockers: liveBlockers.length, doneBlockers: doneBlockers.length, hasHold: Boolean(hold), hasDescriptor: Boolean(descriptor) }];
        let after: unknown = before;
        if (apply && status === "blocked") {
          if (doneBlockers.length > 0 || (liveBlockers.length === 0 && blockerList.length > 0)) {
            // KOMAA-874: surviving set is relational. A diverged projection
            // would drop live edges the PATCH then destroys.
            const relLive = await relationalLiveBlockerIds(client, issueId);
            if (relLive.unavailable || relLive.truncated) {
              actions.push({ action: "removed_done_blocker_edges_skipped", reason: relLive.unavailable ? "relational_unavailable" : "relational_truncated" });
            } else {
              const next = [...relLive.live].sort();
              after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
                body: { blockedByIssueIds: next },
                ...auth,
              });
              actions.push({ action: "removed_done_blocker_edges", before: blockedByIdsOf(before), after: next, relationalBase: true });
            }
          }
          const cur = isRecord(after) ? after : before;
          const stillBlockedBy = blockedByIdsOf(cur);
          const curDescriptor = isRecord(cur.unblockDescriptor) ? cur.unblockDescriptor : null;
          // KOMAA-874: never clear/unblock from a possibly-diverged projection
          // alone; confirm relational emptiness first (bounded: only when the
          // projection already reads empty).
          const confirmedEmpty = stillBlockedBy.length === 0 ? await relationalBlockersEmpty(client, issueId) : false;
          if (stillBlockedBy.length === 0 && confirmedEmpty && !blockingHold(holdView) && curDescriptor) {
            after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
              body: { unblockDescriptor: null },
              ...auth,
            });
            actions.push({ action: "cleared_stale_descriptor" });
          }
          const cur2 = isRecord(after) ? after : before;
          if (
            stillBlockedBy.length === 0 &&
            confirmedEmpty &&
            !blockingHold(holdView) &&
            !isRecord(cur2.unblockDescriptor) &&
            issueStatusOf(cur2) === "blocked"
          ) {
            after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
              body: { status: "todo", comment: "[control-plane reconcile] blocked with zero blockers, no hold, no descriptor, no wait: returning to todo. Operator session audited." },
              ...auth,
            });
            actions.push({ action: "blocked_to_todo" });
          }
        }
        return {
          issueId, classification, applied: apply, actions,
          before: pickIssueShort(before), after: pickIssueShort(after),
          changedFields: changedFields(pickIssueShort(before), pickIssueShort(after)),
          operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipRepairIssue",
      "Repair invalid control-plane state on one issue: stale done-blocker edges, blocked_zero_blockers, terminal live runs, stale scheduled retry, stale execution hold, invalid review state, stale workspace lease (release checkout). Bounded and audited. Returns post-state. KOMAA-874: edge removal uses authoritative issue_relations; blocked->todo only on relationally confirmed emptiness, never on a diverged projection.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        apply: z.boolean().optional().default(true),
      }),
      async ({ issueId, operatorRunId, runId, apply }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const actions: unknown[] = [];
        let after: unknown = before;
        const cur = (): Record<string, unknown> => (isRecord(after) ? after : before);
        // 1. terminal live runs
        const liveRuns = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
        const liveList = Array.isArray(liveRuns) ? liveRuns.filter(isRecord) : [];
        const st = issueStatusOf(cur());
        if ((st === "done" || st === "cancelled") && liveList.length > 0 && apply) {
          for (const r of liveList) {
            const id = (r as Record<string, unknown>).id;
            if (typeof id !== "string") continue;
            try {
              await client.requestJson("POST", `/heartbeat-runs/${enc(id)}/cancel`, { body: {}, ...auth });
              actions.push({ action: "cancelled_run", runId: id });
            } catch (error) {
              actions.push({ action: "cancel_failed", runId: id, error: error instanceof Error ? error.message : String(error) });
            }
          }
        } else if (liveList.length > 0) {
          actions.push({ action: "live_runs_present", count: liveList.length, terminal: st === "done" || st === "cancelled" });
        }
        // 2. stale scheduled retry on terminal
        if ((st === "done" || st === "cancelled") && cur().scheduledRetry != null && apply) {
          const retry = isRecord(cur().scheduledRetry) ? cur().scheduledRetry as Record<string, unknown> : null;
          const rid = retry && typeof retry.runId === "string" ? retry.runId : null;
          if (rid) {
            try {
              await client.requestJson("POST", `/heartbeat-runs/${enc(rid)}/cancel`, { body: {}, ...auth });
              actions.push({ action: "cancelled_scheduled_retry_run", runId: rid });
            } catch (error) {
              actions.push({ action: "retry_cancel_failed", error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        // 3. expired capacity hold expiry (report; clearing is a separate audited call)
        const holdView = await readExecutionHold(client, issueId);
        if (holdView?.expired && apply) {
          try {
            await clearExecutionHoldDocument(client, issueId, runId ?? null, op ?? null, {
              gateIssueId: String(holdView.gateIssueId ?? holdView.gateIdentifier ?? "unknown"),
              gateIdentifier: holdView.gateIdentifier ?? null,
              gateStatus: "terminal",
            });
            actions.push({ action: "expired_capacity_hold" });
          } catch (error) {
            actions.push({ action: "hold_expiry_failed", error: error instanceof Error ? error.message : String(error) });
          }
        }
        // 4. done-blocker edges
        const blockers = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`);
        const blist: unknown[] = isRecord(blockers) && Array.isArray(blockers.blockers) ? blockers.blockers : [];
        const hasDone = blist.some((b) => isRecord(b) && (b.status === "done" || b.status === "cancelled"));
        if (hasDone && apply) {
          // KOMAA-874: surviving set is relational; skip when truncated.
          if (!isRecord(blockers) || blockers.truncated === true) {
            actions.push({ action: "removed_done_blocker_edges_skipped", reason: "relational_truncated" });
          } else {
            const next = blist
              .filter((b) => isRecord(b) && b.status !== "done" && b.status !== "cancelled")
              .map((b) => (isRecord(b) && typeof b.id === "string" ? b.id as string : "")).filter(Boolean);
            after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
              body: { blockedByIssueIds: [...new Set(next)].sort() },
              ...auth,
            });
            actions.push({ action: "removed_done_blocker_edges", after: next, relationalBase: true });
          }
        }
        // 5. invalid blocked -> todo (KOMAA-874: confirm relational emptiness;
        // never auto-unblock from a possibly-diverged projection).
        if (issueStatusOf(cur()) === "blocked" && blockedByIdsOf(cur()).length === 0 && !blockingHold(holdView) && !isRecord(cur().unblockDescriptor) && apply && await relationalBlockersEmpty(client, issueId)) {
          after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
            body: { status: "todo", comment: "[control-plane repair] invalid blocked (zero blockers, no hold/descriptor): returning to todo." },
            ...auth,
          });
          actions.push({ action: "blocked_to_todo" });
        }
        // 6. stale workspace lease: release checkout when terminal or wedged
        if ((st === "done" || st === "cancelled") && apply) {
          try {
            const released = await client.requestJson("POST", `/issues/${enc(issueId)}/release`, { body: {}, ...auth });
            actions.push({ action: "released_checkout", released });
          } catch (error) {
            actions.push({ action: "release_note", error: error instanceof Error ? error.message : String(error) });
          }
        }
        after = await getJsonOrNull(client, `/issues/${enc(issueId)}`).then((v) => (isRecord(v) ? v : after));
        return {
          issueId, applied: apply, actions,
          before: pickIssueShort(before), after: pickIssueShort(after),
          changedFields: changedFields(pickIssueShort(before), pickIssueShort(after)),
          operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipCloseIssueWithEvidence",
      "First-class external-evidence acceptance: save evidence (comment + document), verify no live executor corruption, terminalize (done | in_review | cancelled), clear obsolete unblockDescriptor, remove this issue as blocker from dependents, recalc eligibility, optionally wake newly eligible nodes (exactly one wake each). A run scope IS required: pass operatorRunId (preferred) or runId; the session run id (PAPERCLIP_RUN_ID) is used as the fallback scope, and the call fails closed when no run scope exists at all.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        evidence: z.string().trim().min(1).max(20000),
        disposition: z.enum(["done", "in_review", "cancelled"]).default("done"),
        acceptanceChecks: z.array(z.string().trim().min(1).max(500)).max(20).optional().default([]),
        resolvedBlockerIds: z.array(z.string().min(1)).max(20).optional().default([]),
        wakeDependents: z.boolean().optional().default(true),
      }),
      async ({ issueId, operatorRunId, runId, evidence, disposition, acceptanceChecks, resolvedBlockerIds, wakeDependents }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        // KOMAA-1364: the session already carries its own run scope
        // (PAPERCLIP_RUN_ID) and requestJson uses it for the run header, so
        // requiring the caller to repeat it turned a valid in-session call
        // into INVALID_ARGUMENTS before a single request was sent.
        const scope = runId ?? client.defaults.runId ?? null;
        if (!op && !scope) throw new Error("operatorRunId (preferred, no heartbeat needed) or runId is required");
        const auth = opAuth(op, scope);
        const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        const warnings: unknown[] = [];
        const liveRuns = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
        const liveCount = Array.isArray(liveRuns) ? liveRuns.length : 0;
        if (liveCount > 0 && disposition === "done") {
          warnings.push({ code: "live_executor_present", liveCount, note: "Live runs will be cancelled by the terminal transition (server) and reported below." });
        }
        const checks = (acceptanceChecks ?? []).map((c) => `- [x] ${c}`).join("\n");
        const body = `[operator evidence] disposition=${disposition}\noperatorRunId=${op ?? "(run context)"}\n\n${evidence}\n${checks ? `\nAcceptance:\n${checks}\n` : ""}`;
        await client.requestJson("POST", `/issues/${enc(issueId)}/comments`, { body: { body }, ...auth });
        try {
          await client.requestJson("PUT", `/issues/${enc(issueId)}/documents/acceptance-evidence`, {
            body: { format: "markdown", title: "Acceptance evidence (operator)", body },
            ...auth,
          });
        } catch (error) {
          warnings.push({ code: "evidence_document_fallback", error: error instanceof Error ? error.message : String(error) });
        }
        const patch: Record<string, unknown> = { status: disposition };
        if (isRecord(before.unblockDescriptor)) patch.unblockDescriptor = null;
        if (resolvedBlockerIds.length > 0) {
          // KOMAA-874: relational base — a diverged projection must not wipe edges.
          const beforeRel = await relationalBlockerEntries(client, issueId);
          const beforeBase = beforeRel.unavailable ? blockedByIdsOf(before) : beforeRel.entries.map((e) => e.id);
          const resolvedSet = new Set(resolvedBlockerIds);
          patch.blockedByIssueIds = beforeBase.filter((id) => !resolvedSet.has(id) &&
            !beforeRel.entries.some((e) => e.id === id && e.identifier !== null && resolvedSet.has(e.identifier)));
          if (beforeRel.unavailable) patch.projectionFallbackNote = "relational blockers unavailable; base is the denormalized projection";
        }
        let after: unknown = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: patch, ...auth });
        // dependents: remove this issue as blocker where resolved
        const dependents = await listDependentsBlockedBy(client, issueId);
        const blockersRemoved: unknown[] = [];
        const newlyEligible: unknown[] = [];
        const wakes: unknown[] = [];
        for (const dep of dependents) {
          const depId = String(dep.id);
          if (depId === "__truncated__") {
            blockersRemoved.push({ dependentId: depId, skipped: "truncated_discovery_verify_manually" });
            continue;
          }
          const depRel = await relationalBlockerEntries(client, depId);
          if (depRel.unavailable) {
            blockersRemoved.push({ dependentId: depId, error: "relational blockers unavailable; skipped with no write (fail closed)" });
            continue;
          }
          const next = depRel.entries.map((e) => e.id).filter((id) => id !== issueId &&
            !(depRel.entries.some((e) => e.id === id && e.identifier !== null && e.identifier === issueId)));
          try {
            const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(depId)}`, {
              body: { blockedByIssueIds: next },
              ...auth,
            });
            blockersRemoved.push({ dependentId: depId, identifier: dep.identifier ?? null, removedBlocker: issueId });
            const diag = await getJsonOrNull(client, `/issues/${enc(depId)}/diagnostics/blockers`);
            const remaining = isRecord(diag) && Array.isArray(diag.blockers) ? diag.blockers.length : next.length;
            if (remaining === 0) {
              newlyEligible.push({ dependentId: depId, identifier: dep.identifier ?? null, status: updated.status ?? null });
              if (wakeDependents && (updated.status === "todo" || updated.status === "backlog" || updated.status === "blocked")) {
                wakes.push(await checkoutWake(client, depId, auth));
              }
            }
          } catch (error) {
            blockersRemoved.push({ dependentId: depId, error: error instanceof Error ? error.message : String(error) });
          }
        }
        after = await getJsonOrNull(client, `/issues/${enc(issueId)}`).then((v) => (isRecord(v) ? v : after));
        const cancelledRuns: unknown[] = [];
        if (Array.isArray(liveRuns)) {
          for (const r of liveRuns) {
            if (isRecord(r) && typeof r.id === "string") cancelledRuns.push({ runId: r.id, status: r.status ?? null });
          }
        }
        return {
          issueId, disposition, applied: true,
          before: pickIssueShort(before), after: pickIssueShort(after),
          changedFields: changedFields(pickIssueShort(before), pickIssueShort(after)),
          blockersRemoved, newlyEligible, wakes, runsObservedAtClose: cancelledRuns,
          warnings, operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipUnblockAndWake",
      "Atomic unblock+eligibility+wake: remove/resolve blocker edges, change status when appropriate, run the canonical eligibility gate, mint exactly one wake when executable. Never wakes a still-blocked issue. KOMAA-874: removal base is authoritative issue_relations (UUID or KOMAA-identifier refs accepted); the blocked->todo inference only fires on relationally confirmed emptiness.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        removeBlockerIds: z.array(z.string().min(1)).max(50).optional().default([]),
        setStatus: z.enum(["todo", "backlog", "in_progress", "in_review", "blocked", "done", "cancelled"]).optional(),
        note: z.string().trim().max(2000).optional(),
      }),
      async ({ issueId, operatorRunId, runId, removeBlockerIds, setStatus, note }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const [before, beforeRel] = await Promise.all([
          client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`),
          relationalBlockerEntries(client, issueId),
        ]);
        // Native pending review is an independent stage. Do not demote it with
        // any combination of manual status, dependency patch, or wake.
        if (isNativeReviewPending(issueStatusOf(before), before.executionState)) {
          return {
            issueId, woke: false, reason: "review_pending_no_manual_status_or_wake",
            before: pickIssueShort(before),
          };
        }
        const removeResolved = resolveBlockerRefs(beforeRel.entries, removeBlockerIds);
        const removeSet = new Set([...removeBlockerIds, ...removeResolved]);
        const base = beforeRel.unavailable ? blockedByIdsOf(before) : beforeRel.entries.map((e) => e.id);
        const baseIds = new Set(base);
        const next = base.filter((id) => !removeSet.has(id) &&
          !beforeRel.entries.some((e) => e.id === id && e.identifier !== null && removeSet.has(e.identifier)));
        const patch: Record<string, unknown> = {};
        if (removeBlockerIds.length > 0) patch.blockedByIssueIds = next;
        // Never manufacture in_progress/in_review with a PATCH. They require a
        // real native checkout/run or first-class review transition respectively.
        if (setStatus === "in_progress" || setStatus === "in_review") {
          return { issueId, woke: false, reason: "native_execution_transition_required", requestedStatus: setStatus, before: pickIssueShort(before) };
        }
        if (setStatus) patch.status = setStatus;
        // Auto-todo is an inference from emptiness: only on relational truth.
        else if (removeBlockerIds.length > 0 && before.status === "blocked" && next.length === 0 && !beforeRel.unavailable) patch.status = "todo";
        if (note) patch.comment = `[operator unblock] ${note}`;
        let after: unknown = before;
        if (Object.keys(patch).length > 0) {
          after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: patch, ...auth });
        }
        const eligibility = await getEligibility(client, issueId);
        let wake: unknown = { woke: false, reason: "not_eligible", eligibility };
        if ((eligibility as Record<string, unknown>).executable === true) {
          wake = await checkoutWake(client, issueId, auth);
        }
        after = await getJsonOrNull(client, `/issues/${enc(issueId)}`).then((v) => (isRecord(v) ? v : after));
        return {
          issueId,
          before: pickIssueShort(before), after: pickIssueShort(after),
          changedFields: changedFields(pickIssueShort(before), pickIssueShort(after)),
          blockersRemoved: removeBlockerIds, relationalBase: !beforeRel.unavailable,
          unlistedBaseIds: beforeRel.unavailable ? [] : [...baseIds].filter((id) => !blockedByIdsOf(before).includes(id)),
          eligibility, wake, operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipResolveReviewWedge",
      CRITICAL_REVIEW_STATE + " Resolve a wedged review (in_review with no reviewer/approval/live run): auto-route (comment + handoff), send back to todo, or approve/reject when the operator has authority. Fail-closed: if stalled-review-decision rejects (e.g. 409 no longer stalled) or is unavailable, refreshes and returns the canonical review state with NO status mutation, never a bare 409 and never a silent demotion to todo. Use paperclipGetReviewState first: a configured reviewer is not a live reviewer.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        action: z.enum(["route", "send_back", "approve", "request_changes"]).default("route"),
        note: z.string().trim().max(2000).optional(),
      }),
      async ({ issueId, operatorRunId, runId, action, note }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const [issue, approvals, liveRuns, activeRun] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/active-run`),
        ]);
        const status = issueStatusOf(issue);
        const liveCount = Array.isArray(liveRuns) ? liveRuns.length : 0;
        const wedged = status === "in_review" && !activeRun && liveCount === 0;
        let result: unknown = null;
        if (action === "send_back" || (action === "route" && wedged)) {
          try {
            result = await client.requestJson("POST", `/issues/${enc(issueId)}/stalled-review-decision`, {
              body: { action: "send_back", ...(note ? { note } : {}) },
              ...auth,
            });
          } catch (error) {
            // KOMAA-849: NEVER fall back to PATCH status=todo here. A 409
            // "no longer a stalled review" is a TOCTOU race signal: the review
            // state changed under us (valid reviewer path appeared, or the
            // issue left in_review). Any error therefore reconciles by
            // refreshing canonical state and returning it with no mutation.
            const message = error instanceof Error ? error.message : String(error);
            const notStalled = /409|no longer a stalled review/i.test(message);
            const [refIssue, refApprovals, refLiveRuns, refActiveRun] = await Promise.all([
              getJsonOrNull(client, `/issues/${enc(issueId)}`),
              getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
              getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
              getJsonOrNull(client, `/issues/${enc(issueId)}/active-run`),
            ]);
            const refLiveCount = Array.isArray(refLiveRuns) ? refLiveRuns.length : 0;
            result = {
              action: "route",
              note: notStalled
                ? "stalled-review-decision reports the issue is no longer stalled; refreshed canonical state instead of demoting. No status mutation performed."
                : "stalled-review-decision unavailable; fail-closed with refreshed canonical state. No status mutation performed.",
              error: message,
              noMutation: true,
              canonicalState: {
                status: issueStatusOf(refIssue),
                approvals: refApprovals,
                liveRunCount: refLiveCount,
                activeRun: refActiveRun,
              },
            };
          }
        } else if (action === "approve" || action === "request_changes") {
          try {
            result = await client.requestJson("POST", `/issues/${enc(issueId)}/stalled-review-decision`, {
              body: { action: action === "approve" ? "approve" : "request_changes", ...(note ? { note } : {}) },
              ...auth,
            });
          } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error), canonicalState: { status, approvals, liveRunCount: liveCount, activeRun } };
          }
        } else {
          result = { action: "route", note: "review path present; no wedge action taken", canonicalState: { status, approvals, liveRunCount: liveCount, activeRun } };
        }
        const after = await getJsonOrNull(client, `/issues/${enc(issueId)}`);
        return {
          issueId, wedged, actionTaken: action, result,
          before: pickIssueShort(issue), after: pickIssueShort(after),
          changedFields: changedFields(pickIssueShort(issue), pickIssueShort(after)),
          operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipSupersedeIssue",
      "Atomic supersede: terminalize the old issue (cancelled), clear holds, cancel retry/live runs, release checkout, repoint dependents blockedBy old->new, wake newly eligible nodes (one wake each). KOMAA-874: dependent discovery and the repoint base read authoritative issue_relations (never the diverged blockedByIssueIds projection); a repeated supersede is idempotent (already-repointed dependents are skipped with no duplicate write/wake). Fails closed on self-supersede, cross-company pairs, or a terminal replacement.",
      z.object({
        oldIssueId: issueIdSchema,
        newIssueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        note: z.string().trim().max(2000).optional(),
      }),
      async ({ oldIssueId, newIssueId, operatorRunId, runId, note }) => {
        // III etap 2026-10-14: self-supersede (old == new) przechodzilo i robilo
        // bezsensowna petle (cancel + repoint na siebie). Odrzucamy wprost.
        if (oldIssueId === newIssueId) throw new Error("Refusing self-supersede: oldIssueId and newIssueId must differ");
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const [beforeOld, beforeNew] = await Promise.all([
          client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(oldIssueId)}`),
          client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(newIssueId)}`),
        ]);
        if (typeof beforeOld.id === "string" && beforeOld.id === newIssueId) {
          throw new Error("Refusing self-supersede: newIssueId resolves to the old issue");
        }
        // KOMAA-874: validate the pair BEFORE any mutation. Relations store
        // UUIDs, so resolve human identifiers (KOMAA-123) to UUIDs first.
        const oldUuid = resolveIssueRef(beforeOld, oldIssueId);
        const newUuid = resolveIssueRef(beforeNew, newIssueId);
        if (oldUuid === newUuid) throw new Error("Refusing self-supersede: oldIssueId and newIssueId resolve to the same issue");
        if (typeof beforeOld.companyId === "string" && typeof beforeNew.companyId === "string" &&
          beforeOld.companyId !== beforeNew.companyId) {
          throw new Error("Refusing cross-company supersede: old and new issues belong to different companies");
        }
        if (typeof beforeNew.status === "string" && (beforeNew.status === "done" || beforeNew.status === "cancelled")) {
          throw new Error(`Refusing supersede onto a terminal replacement (new issue status=${beforeNew.status}); dependents would strand`);
        }
        const [liveRuns, holdDoc] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(oldIssueId)}/live-runs`),
          readIssueDocumentByKey(client, oldIssueId, HOLD_DOCUMENT_KEY),
        ]);
        const actions: unknown[] = [];
        const afterOld = await client.requestJson("PATCH", `/issues/${enc(oldIssueId)}`, {
          body: { status: "cancelled", comment: `[superseded] by ${newIssueId}. ${note ?? ""}`.trim() },
          ...auth,
        });
        actions.push({ action: "terminalized_old", status: "cancelled" });
        if (Array.isArray(liveRuns)) {
          for (const r of liveRuns) {
            if (!isRecord(r) || typeof r.id !== "string") continue;
            try {
              await client.requestJson("POST", `/heartbeat-runs/${enc(r.id)}/cancel`, { body: {}, ...auth });
              actions.push({ action: "cancelled_run", runId: r.id });
            } catch (error) {
              actions.push({ action: "cancel_failed", runId: r.id, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        if (holdDoc) {
          try {
            await client.requestJson("DELETE", `/issues/${enc(oldIssueId)}/documents/control-plane-execution-hold`, { ...auth });
            actions.push({ action: "cleared_hold" });
          } catch (error) {
            actions.push({ action: "hold_clear_note", error: error instanceof Error ? error.message : String(error) });
          }
        }
        try {
          await client.requestJson("POST", `/issues/${enc(oldIssueId)}/release`, { body: {}, ...auth });
          actions.push({ action: "released_checkout" });
        } catch (error) {
          actions.push({ action: "release_note", error: error instanceof Error ? error.message : String(error) });
        }
        const dependents = await listDependentsBlockedBy(client, oldIssueId);
        const repointed: unknown[] = [];
        const wakes: unknown[] = [];
        const warnings: unknown[] = [];
        for (const dep of dependents) {
          const depId = String(dep.id);
          if (depId === "__truncated__") {
            warnings.push(dep.warning ?? "dependent discovery truncated; repointed[] may be incomplete");
            continue;
          }
          // KOMAA-874: repoint base is the relational edge set. A diverged
          // (empty) projection must never delete real edges, and an already
          // repointed dependent must not be rewritten or re-woken.
          const rel = await relationalBlockerEntries(client, depId);
          if (rel.unavailable) {
            repointed.push({ dependentId: depId, error: "relational blockers unavailable; skipped with no write (fail closed)" });
            continue;
          }
          const relIds = rel.entries.map((e) => e.id);
          if (!relIds.includes(oldUuid) && !relIds.includes(oldIssueId)) {
            repointed.push({ dependentId: depId, skipped: "already_repointed", relationalBlockerIds: relIds });
            continue;
          }
          const next = [...new Set(relIds.map((id) => (id === oldUuid || id === oldIssueId ? newUuid : id)))].sort();
          try {
            await client.requestJson("PATCH", `/issues/${enc(depId)}`, { body: { blockedByIssueIds: next }, ...auth });
            repointed.push({ dependentId: depId, from: oldUuid, to: newUuid, relationalBase: relIds });
            const diag = await getJsonOrNull(client, `/issues/${enc(depId)}/diagnostics/blockers`);
            const remaining = isRecord(diag) && Array.isArray(diag.blockers) ? diag.blockers.length : next.length;
            if (remaining === 0) wakes.push(await checkoutWake(client, depId, auth));
          } catch (error) {
            repointed.push({ dependentId: depId, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return {
          oldIssueId, newIssueId, actions, repointed, wakes, warnings,
          before: pickIssueShort(beforeOld), after: pickIssueShort(afterOld),
          changedFields: changedFields(pickIssueShort(beforeOld), pickIssueShort(afterOld)),
          operatorRunId: op,
        };
      },
    ),
  ];
}

// KOMAA-797 / 2026.1012.0 compat: native GET /issues/:id/execution-state was a
// custom backend patch of the pre-1012 image and is absent in official builds.
// Projection from supported read sources only; uncertainty is explicit, never READY.
async function getExecutionStateCompat(client: PaperclipApiClient, issueId: string): Promise<Record<string, unknown>> {
  try {
    const native = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/execution-state`);
    if (isRecord(native)) return native;
  } catch { /* route absent in 2026.1012.0 - projection below */ }
  const [hc, live, approvals, interactions, recovery] = await Promise.all([
    client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/heartbeat-context`).catch(() => null),
    client.requestJson<unknown[]>("GET", `/issues/${enc(issueId)}/live-runs`).catch(() => null),
    client.requestJson<unknown[]>("GET", `/issues/${enc(issueId)}/approvals`).catch(() => null),
    client.requestJson<unknown[]>("GET", `/issues/${enc(issueId)}/interactions`).catch(() => null),
    client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/recovery-actions`).catch(() => null),
  ]);
  const hcIssue = isRecord(hc) && isRecord((hc as Record<string, unknown>).issue) ? ((hc as Record<string, unknown>).issue as Record<string, unknown>) : null;
  let issueRec: Record<string, unknown> | null = hcIssue;
  if (!issueRec) {
    const direct = await getJsonOrNull(client, `/issues/${enc(issueId)}`);
    if (isRecord(direct)) issueRec = direct;
    else throw Object.assign(new Error(`issue ${issueId} not found (native execution-state route absent in 2026.1012.0; projection sources also empty)`), { code: "not_found" });
  }
  const status = String(issueRec.status ?? "");
  const liveList = Array.isArray(live) ? (live.filter(isRecord) as Record<string, unknown>[]) : [];
  const running = liveList.filter((r) => r.status === "running").length;
  const queued = liveList.filter((r) => r.status === "queued").length;
  const pendingOf = (arr: unknown): number | null => Array.isArray(arr)
    ? arr.filter((x) => isRecord(x) && /pending|requested|awaiting/i.test(String((x as Record<string, unknown>).status ?? ""))).length
    : null;
  const pendingApprovals = pendingOf(approvals);
  const pendingInteractions = pendingOf(interactions);
  const blockedByRaw = Array.isArray(issueRec.blockedBy) ? issueRec.blockedBy : null;
  const workflow = isRecord(issueRec.executionState) ? issueRec.executionState : null;
  const reviewPending = isNativeReviewPending(status, workflow);
  const warnings: string[] = ["native /issues/:id/execution-state route absent in Paperclip 2026.1012.0; projection from heartbeat-context/live-runs/approvals/interactions/recovery-actions"];
  let unresolvedBlockerCount: number | null = null;
  if (blockedByRaw === null) warnings.push("blockedBy projection absent on issue record; unresolvedBlockerCount unverified");
  else if (blockedByRaw.every((b) => isRecord(b))) {
    unresolvedBlockerCount = blockedByRaw.filter((b) => {
      const st = String((b as Record<string, unknown>).status ?? "");
      return !(st === "done" || st === "cancelled");
    }).length;
  } else {
    unresolvedBlockerCount = blockedByRaw.length;
    warnings.push("blockedBy entries lack status shape; treated as unresolved (conservative)");
  }
  const scheduledRetry = issueRec.scheduledRetry ?? null;
  const reviewAttention = issueRec.reviewAttention ?? null;
  const blockerAttention = issueRec.blockerAttention ?? null;
  const activeRecovery = issueRec.activeRecoveryAction ?? null;
  const reasons: string[] = [];
  let state: string;
  if (status === "done" || status === "cancelled") state = "TERMINAL";
  else if (running > 0) { state = "RUNNING"; reasons.push(`${running} running run(s)`); }
  else if (queued > 0) { state = "RUNNING"; reasons.push(`${queued} queued run(s), none running`); }
  else if (status === "in_review") { state = "WAITING_REVIEW"; reasons.push(`assigneeAgentId=${String(issueRec.assigneeAgentId ?? "none")}`); }
  else if (reviewPending && status !== "in_review") {
    state = "INCONSISTENT";
    reasons.push("review_pending_status_drifted");
    warnings.push("Native review stage is pending but visible issue status is not in_review; do not checkout/wake or infer active work");
  }
  else if (status === "blocked") {
    if (unresolvedBlockerCount === null) { state = "UNVERIFIED"; reasons.push("blocked with unverifiable blocker projection"); }
    else if (unresolvedBlockerCount > 0) { state = "WAITING_DEPENDENCY"; reasons.push(`${unresolvedBlockerCount} unresolved blocker(s)`); }
    else { state = "INCONSISTENT"; reasons.push("status=blocked with zero projected unresolved blockers (possible hold or projection divergence - see KOMAA-874)"); }
  }
  else if (scheduledRetry) { state = "RETRYABLE_FAILURE"; reasons.push("scheduledRetry present"); }
  else if ((pendingApprovals ?? 0) > 0) { state = "HUMAN_ACTION_REQUIRED"; reasons.push(`${pendingApprovals} pending approval(s)`); }
  else if ((pendingInteractions ?? 0) > 0) { state = "WAITING_EXTERNAL"; reasons.push(`${pendingInteractions} pending interaction(s)`); }
  else if (status === "todo") state = "READY";
  else if (status === "in_progress") {
    state = "INCONSISTENT";
    reasons.push("false_progress_no_issue_run");
    warnings.push("Status in_progress has no issue-bound queued/running run; status must not be treated as execution proof");
  }
  else state = "INCONSISTENT";
  if (activeRecovery !== null && activeRecovery !== undefined) reasons.push("activeRecoveryAction present");
  const executable = state === "READY" && (unresolvedBlockerCount ?? 0) === 0 && (activeRecovery === null || activeRecovery === undefined);
  void recovery;
  return {
    state, executable,
    unresolvedBlockerCount,
    hasExecutionHold: null,
    reasons, warnings,
    reviewAttention, blockerAttention, scheduledRetry,
    activeRecoveryAction: activeRecovery ?? null,
    liveRuns: { running, queued },
    issueId: String(issueRec.id ?? issueId),
    issueStatus: status,
    source: "mcp-compat-projection",
    authority: "projection (native route absent in this build)",
    possiblyCommitted: false,
  };
}

// KOMAA-631 part A: canonical state, revision, causal retry, lineage tools.
function deliveryCycleToolsPartA(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipGetExecutionState",
      "Canonical execution state for an issue (READY | RUNNING | WAITING_DEPENDENCY | WAITING_REVIEW | WAITING_EXTERNAL | HUMAN_ACTION_REQUIRED | RETRYABLE_FAILURE | TERMINAL | INCONSISTENT | UNVERIFIED) with reasons and evidence links. Native /execution-state is absent in Paperclip 2026.1012.0, so this returns a marked read-only projection (source=mcp-compat-projection, authority=projection) with explicit warnings; it never reports READY when blockers or holds cannot be verified.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => getExecutionStateCompat(client, issueId),
    ),
    makeTool(
      "paperclipGetControlPlaneRevision",
      "Company control-plane revision token (counts digest + latest change + live runs). Pass as expectedRevision to plan/apply and delivery-cycle calls; a mismatch answers stale_plan instead of acting on stale state.",
      z.object({}),
      async () => getRevisionCompat(client),
    ),
    makeTool(
      "paperclipRetryWithCausalGate",
      "Retry gated on causality, not hope. Checks retry-eligibility (failure fingerprint + execution-input delta); identical-state retries are refused with circuit_open and mint zero runs. First retry per fingerprint, or any real delta (blockers/assignee/runs/hold/descriptor/status), proceeds via checkout and records the attempt. Board force:true bypasses with audit.",
      z.object({
        issueId: issueIdSchema,
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        force: z.boolean().optional().default(false),
        note: z.string().trim().max(2000).optional(),
      }),
      async ({ issueId, operatorRunId, runId, force, note }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
        let elig: Record<string, unknown>;
        try {
          elig = await client.requestJson<Record<string, unknown>>(
            "GET",
            `/issues/${enc(issueId)}/retry-eligibility${qs(force ? { force: "1" } : {})}`,
          );
        } catch (error) {
          // Removed in Paperclip 2026.1012.0. Fail closed, never blind-retry,
          // and do not mistake a compatibility 404 for an eligible retry.
          if (!nativeRetryRouteMissing(error)) throw error;
          return { issueId, retried: false, circuitOpen: true, retryReason: "native_retry_eligibility_unavailable", nativeRouteAbsent: true, before: pickIssueShort(before), operatorRunId: op };
        }
        if (elig.retryEligible !== true) {
          return {
            issueId, retried: false,
            previousFailureFingerprint: elig.previousFailureFingerprint ?? null,
            causalDelta: elig.causalDelta ?? [],
            retryReason: elig.retryReason ?? "circuit_open_identical_state",
            circuitOpen: true,
            note: "No run minted. Change an execution input (resolve a blocker, change assignee/config, clear the hold, new SHA) or use board force:true.",
            before: pickIssueShort(before), operatorRunId: op,
          };
        }
        const wake = await checkoutWake(client, issueId, auth);
        if (note) {
          await client.requestJson("POST", `/issues/${enc(issueId)}/comments`, {
            body: { body: `[operator retry] fingerprint=${String(elig.previousFailureFingerprint ?? "none")} delta=${JSON.stringify(elig.causalDelta ?? [])}${force ? " force=true(board)" : ""}${note ? ` ${note}` : ""}` },
            ...auth,
          }).catch(() => null);
        }
        try {
          await client.requestJson("POST", `/issues/${enc(issueId)}/retry-attempts`, {
            body: {
              fingerprint: String(elig.previousFailureFingerprint ?? "no_prior_failure"),
              components: (elig.liveComponents ?? {}) as Record<string, unknown>,
              forced: force,
            },
            ...auth,
          });
        } catch { /* circuit record best-effort */ }
        const after = await getJsonOrNull(client, `/issues/${enc(issueId)}`);
        return {
          issueId, retried: true, forced: force,
          previousFailureFingerprint: elig.previousFailureFingerprint ?? null,
          causalDelta: elig.causalDelta ?? [],
          retryReason: elig.retryReason ?? null,
          wake,
          before: pickIssueShort(before),
          after: pickIssueShort(isRecord(after) ? after : before),
          changedFields: changedFields(pickIssueShort(before), pickIssueShort(isRecord(after) ? after : before)),
          operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipGetDeliveryLineage",
      "Full delivery lineage for an issue: issue -> runs (live + linked recent) -> workspace/branch/commit -> work products/artifacts -> review/approvals -> acceptance evidence. Returns lineageValid plus gaps[] naming every unverifiable hop, so a reviewer never has to guess which artifact was actually accepted.",
      z.object({ issueId: issueIdSchema, recentRunLimit: z.number().int().positive().max(50).optional().default(20) }),
      async ({ issueId, recentRunLimit }) => {
        const companyId = client.resolveCompanyId();
        const [issue, context, workProducts, approvals, liveRuns, activeRun, evidenceDoc] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/heartbeat-context`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/work-products`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/approvals`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/active-run`),
          getJsonOrNull(client, `/issues/${enc(issueId)}/documents/acceptance-evidence`),
        ]);
        const workspace = isRecord(context) ? (context.currentExecutionWorkspace as Record<string, unknown> | null) ?? null : null;
        const workspaceId = workspace && typeof workspace.id === "string" ? workspace.id : null;
        const readiness = workspaceId ? await getJsonOrNull(client, `/execution-workspaces/${enc(workspaceId)}/close-readiness`) : null;
        // linked runs: recent company runs whose linked-issues include this issue (bounded)
        const linkedRuns: unknown[] = [];
        const recent = await getJsonOrNull(client, `/companies/${companyId}/heartbeat-runs${qs({ limit: recentRunLimit })}`);
        const recentList = Array.isArray(recent) ? recent.slice(0, recentRunLimit) : [];
        for (const r of recentList) {
          if (!isRecord(r) || typeof r.id !== "string") continue;
          const linked = await getJsonOrNull(client, `/heartbeat-runs/${enc(r.id)}/issues`);
          const hits = Array.isArray(linked) ? linked.filter((e) => isRecord(e) && (e.issueId === issueId || e.id === issueId)) : [];
          if (hits.length > 0) {
            linkedRuns.push({
              runId: r.id, status: r.status ?? null, agentId: r.agentId ?? null,
              createdAt: r.createdAt ?? null, finishedAt: r.finishedAt ?? null,
              errorCode: isRecord(r) ? r.errorCode ?? null : null,
            });
          }
          if (linkedRuns.length >= 10) break;
        }
        const gaps: string[] = [];
        if (!issue) gaps.push("issue_not_found");
        if (!workspace) gaps.push("no_execution_workspace");
        if (!Array.isArray(workProducts) || workProducts.length === 0) gaps.push("no_work_products");
        if (!Array.isArray(approvals) || approvals.length === 0) gaps.push("no_approvals");
        if (!evidenceDoc) gaps.push("no_acceptance_evidence");
        if (!isRecord(issue) || (issue.status !== "done" && issue.status !== "in_review")) gaps.push("not_accepted_status");
        // immutable review tuple check: approval should reference the workspace candidate SHA
        const shas = new Set(
          (Array.isArray(workProducts) ? workProducts : [])
            .filter(isRecord)
            .map((w) => String((w as Record<string, unknown>).commitSha ?? (w as Record<string, unknown>).sha ?? ""))
            .filter(Boolean),
        );
        const approvalShas = new Set(
          (Array.isArray(approvals) ? approvals : [])
            .filter(isRecord)
            .map((a) => String((a as Record<string, unknown>).candidateSha ?? (a as Record<string, unknown>).sha ?? ""))
            .filter(Boolean),
        );
        let shaMatch: boolean | null = null;
        if (shas.size > 0 && approvalShas.size > 0) {
          shaMatch = [...approvalShas].some((s) => shas.has(s));
          if (!shaMatch) gaps.push("approval_sha_mismatch");
        }
        return {
          issueId,
          issue: pickIssueShort(issue),
          runs: { live: liveRuns, active: activeRun, linked: linkedRuns },
          workspace,
          closeReadiness: readiness,
          workProducts,
          approvals,
          acceptanceEvidence: evidenceDoc ? { present: true } : { present: false },
          candidateShas: [...shas],
          approvalShas: [...approvalShas],
          shaMatch,
          lineageValid: gaps.length === 0,
          gaps,
        };
      },
    ),
  ];
}

// KOMAA-631 part B: plan/apply, repair sweep, delivery cycle.
type CycleActionKind =
  | "repair"
  | "cancel_runs"
  | "causal_retry"
  | "wake"
  | "unblock_wake"
  | "close_with_evidence"
  | "resolve_review"
  | "reconcile";

type CycleAction = {
  kind: CycleActionKind;
  issueId: string;
  reason: string;
  risk?: string;
  params?: Record<string, unknown>;
};

type CycleAuth = { operatorRunId?: string; runId?: string };

/**
 * True when the only thing explaining this wait is an unblock descriptor: no DAG
 * blocker and no execution hold.
 *
 * A scheduled external-service monitor is the current causal disposition, so such a
 * descriptor is truthful rather than stale — clearing it would drop the very wait the
 * monitor is re-checking.
 */
function isDescriptorOnlyWait(st: Record<string, unknown>): boolean {
  if (st.state !== "WAITING_EXTERNAL" && st.state !== "HUMAN_ACTION_REQUIRED") return false;
  if (st.hasUnblockDescriptor !== true) return false;
  if (Number(st.unresolvedBlockerCount ?? 1) !== 0) return false;
  if (st.hasExecutionHold === true) return false;
  if (st.hasScheduledMonitor === true) return false;
  return true;
}

async function execRepairStep(
  client: PaperclipApiClient,
  issueId: string,
  auth: CycleAuth,
): Promise<{ ok: boolean; detail: unknown; touched: boolean }> {
  const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
  const actions: unknown[] = [];
  let touched = false;
  const st = await getExecutionStateCompat(client, issueId).catch(() => null);
  const state = isRecord(st) ? String(st.state ?? "") : "";
  // terminal live/queued/retry runs, plus QUEUED runs on inconsistent
  // non-terminal issues (never executed: safe to cancel). RUNNING runs are
  // never killed silently — they may predate the block; flagged instead.
  const live = await getJsonOrNull(client, `/issues/${enc(issueId)}/live-runs`);
  const liveList = Array.isArray(live) ? live.filter(isRecord) : [];
  const queuedOnly = liveList.filter((r) => (r as Record<string, unknown>).status === "queued");
  if ((before.status === "done" || before.status === "cancelled") && liveList.length > 0) {
    for (const r of liveList) {
      const id = (r as Record<string, unknown>).id;
      if (typeof id !== "string") continue;
      try {
        await client.requestJson("POST", `/heartbeat-runs/${enc(id)}/cancel`, { body: {}, ...auth });
        actions.push({ action: "cancelled_run", runId: id });
        touched = true;
      } catch (error) {
        actions.push({ action: "cancel_failed", runId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  if (state === "INCONSISTENT" && queuedOnly.length > 0) {
    for (const r of queuedOnly) {
      const id = (r as Record<string, unknown>).id;
      if (typeof id !== "string") continue;
      try {
        await client.requestJson("POST", `/heartbeat-runs/${enc(id)}/cancel`, { body: {}, ...auth });
        actions.push({ action: "cancelled_run", runId: id, reason: "queued_on_inconsistent_issue" });
        touched = true;
      } catch (error) {
        actions.push({ action: "cancel_failed", runId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  // done-blocker edges (KOMAA-874: surviving set is relational; a diverged
  // projection would drop live edges the PATCH then destroys).
  if (isRecord(st) && Number(st.doneBlockerEdgeCount ?? 0) > 0) {
    const relLive = await relationalLiveBlockerIds(client, issueId);
    if (relLive.unavailable || relLive.truncated) {
      actions.push({ action: "removed_done_blocker_edges_skipped", reason: relLive.unavailable ? "relational_unavailable" : "relational_truncated" });
    } else {
      const next = [...relLive.live].sort();
      await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: { blockedByIssueIds: next }, ...auth });
      actions.push({ action: "removed_done_blocker_edges", after: next, relationalBase: true });
      touched = true;
    }
  }
  // expired capacity hold
  const holdView = await readExecutionHold(client, issueId);
  if (holdView?.expired) {
    try {
      await clearExecutionHoldDocument(client, issueId, auth.runId ?? null, auth.operatorRunId ?? null, {
        gateIssueId: String(holdView.gateIssueId ?? holdView.gateIdentifier ?? "unknown"),
        gateIdentifier: holdView.gateIdentifier ?? null,
        gateStatus: "terminal",
      });
      actions.push({ action: "expired_capacity_hold" });
      touched = true;
    } catch (error) {
      actions.push({ action: "hold_expiry_failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  // invalid blocked -> todo (canonical state must agree, re-read after edge work)
  const cur = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`).catch(() => before);
  const curState = await getExecutionStateCompat(client, issueId).catch(() => null);
  if (isRecord(curState) && curState.state === "INCONSISTENT" && (curState.reasons as string[])?.includes("blocked_zero_blockers")) {
    await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
      body: { status: "todo", comment: "[delivery-cycle repair] invalid blocked (zero blockers, no hold/descriptor): returning to todo." },
      ...auth,
    });
    actions.push({ action: "blocked_to_todo" });
    touched = true;
  }
  // stale checkout lease on terminal
  if ((cur.status === "done" || cur.status === "cancelled") && (cur.checkoutRunId || cur.executionRunId)) {
    try {
      await client.requestJson("POST", `/issues/${enc(issueId)}/release`, { body: {}, ...auth });
      actions.push({ action: "released_checkout" });
      touched = true;
    } catch (error) {
      actions.push({ action: "release_note", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: true, detail: { state, actions }, touched };
}

/**
 * Settle a dependent after one of its blockers terminalized: drop the
 * resolved edge, clear the unblockDescriptor only when its wait names the
 * just-closed issue (identifier or "waiting on" with zero remaining
 * blockers), then report eligibility. Never clears a descriptor whose wait
 * is still real. KOMAA-631.
 */
async function settleDependentAfterBlockerDone(
  client: PaperclipApiClient,
  dep: Record<string, unknown>,
  closedIssueId: string,
  closedIdentifier: string | null,
  auth: CycleAuth,
): Promise<Record<string, unknown>> {
  const depId = String(dep.id);
  if (depId === "__truncated__") return { dependentId: depId, skipped: "truncated_discovery_verify_manually" };
  // KOMAA-874: settle base is the relational edge set. A diverged (empty)
  // projection must never wipe real edges nor flip status to todo.
  const rel = await relationalBlockerEntries(client, depId);
  const relIds = rel.entries.map((e) => e.id);
  const namesClosedEntry = (id: string): boolean => {
    if (id === closedIssueId) return true;
    if (closedIdentifier && rel.entries.some((e) => e.id === id && e.identifier === closedIdentifier)) return true;
    return false;
  };
  const depNext = (rel.unavailable ? blockedByIdsOf(dep) : relIds)
    .filter((id) => id !== closedIssueId && !namesClosedEntry(id));
  const relationalBase = !rel.unavailable;
  const desc = isRecord(dep.unblockDescriptor) ? (dep.unblockDescriptor as Record<string, unknown>) : null;
  const action = String(desc?.action ?? "");
  const namesClosed = closedIdentifier
    ? action.toUpperCase().includes(closedIdentifier.toUpperCase())
    : false;
  const waitingOn = /waiting on/i.test(action);
  const patch: Record<string, unknown> = { blockedByIssueIds: depNext };
  let clearedDescriptor = false;
  if (desc && (namesClosed || (waitingOn && depNext.length === 0))) {
    const live = await getExecutionStateCompat(client, depId).catch(() => null);
    if (isRecord(live) && Number(live.unresolvedBlockerCount ?? 1) === 0 && live.hasExecutionHold !== true) {
      patch.unblockDescriptor = null;
      if (dep.status === "blocked" && depNext.length === 0) patch.status = "todo";
      clearedDescriptor = true;
    }
  } else if (dep.status === "blocked" && depNext.length === 0 && !desc) {
    patch.status = "todo";
  }
  const updated = await client.requestJson<Record<string, unknown>>("PATCH", `/issues/${enc(depId)}`, { body: patch, ...auth });
  const st = await getExecutionStateCompat(client, depId).catch(() => null);
  let wake: unknown = null;
  if (isRecord(st) && st.executable === true) wake = await checkoutWake(client, depId, auth);
  return { dependentId: depId, edgeDropped: true, clearedDescriptor, relationalBase, after: pickIssueShort(updated), executable: isRecord(st) ? st.executable ?? null : null, wake };
}

async function execCycleAction(
  client: PaperclipApiClient,
  action: CycleAction,
  auth: CycleAuth,
): Promise<{ ok: boolean; detail: unknown; woke?: boolean; closed?: boolean }> {
  const { issueId } = action;
  switch (action.kind) {
    case "repair":
    case "cancel_runs": {
      const r = await execRepairStep(client, issueId, auth);
      return { ok: r.ok, detail: r.detail };
    }
    case "causal_retry":
    case "wake": {
      if (action.kind === "causal_retry") {
        const elig = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/retry-eligibility`);
        if (elig.retryEligible !== true) {
          return { ok: false, detail: { circuitOpen: true, retryReason: elig.retryReason ?? null, causalDelta: elig.causalDelta ?? [] } };
        }
      } else {
        const st = await getExecutionStateCompat(client, issueId).catch(() => null);
        if (!isRecord(st) || (st.state !== "READY" && st.state !== "RETRYABLE_FAILURE")) {
          return { ok: false, detail: { skipped: true, state: isRecord(st) ? st.state ?? null : null, reason: "not wakeable right now" } };
        }
      }
      const w = await checkoutWake(client, issueId, auth);
      if (action.kind === "causal_retry" && (w as Record<string, unknown>).woke === true) {
        const elig = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/retry-eligibility`).catch(() => null);
        try {
          await client.requestJson("POST", `/issues/${enc(issueId)}/retry-attempts`, {
            body: {
              fingerprint: String((isRecord(elig) ? elig.previousFailureFingerprint : null) ?? "unknown"),
              components: ((isRecord(elig) ? elig.liveComponents : {}) ?? {}) as Record<string, unknown>,
            },
            ...auth,
          });
        } catch { /* best-effort */ }
      }
      return { ok: (w as Record<string, unknown>).woke === true, detail: w, woke: (w as Record<string, unknown>).woke === true };
    }
    case "unblock_wake": {
      const [before, beforeRel] = await Promise.all([
        client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`),
        relationalBlockerEntries(client, issueId),
      ]);
      const remove = Array.isArray(action.params?.removeBlockerIds) ? (action.params!.removeBlockerIds as string[]) : [];
      // KOMAA-874: relational base with identifier-aware removal. The
      // blocked->todo inference only fires on relationally confirmed
      // emptiness; on unavailable diagnostics the status is left untouched.
      const removeResolved = resolveBlockerRefs(beforeRel.entries, remove);
      const removeSet = new Set([...remove, ...removeResolved]);
      const base = beforeRel.unavailable ? blockedByIdsOf(before) : beforeRel.entries.map((e) => e.id);
      const next = base.filter((id) => !removeSet.has(id) &&
        !beforeRel.entries.some((e) => e.id === id && e.identifier !== null && removeSet.has(e.identifier)));
      const patch: Record<string, unknown> = { blockedByIssueIds: next };
      if (before.status === "blocked" && next.length === 0 && !beforeRel.unavailable) patch.status = "todo";
      await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: patch, ...auth });
      const st = await getExecutionStateCompat(client, issueId).catch(() => null);
      if (isRecord(st) && st.executable === true) {
        const w = await checkoutWake(client, issueId, auth);
        return { ok: true, detail: { unblocked: true, wake: w }, woke: (w as Record<string, unknown>).woke === true };
      }
      return { ok: true, detail: { unblocked: true, wake: null } };
    }
    case "close_with_evidence": {
      const p = action.params ?? {};
      const evidence = String(p.evidence ?? "");
      const disposition = (p.disposition as string) === "cancelled" || (p.disposition as string) === "in_review" ? (p.disposition as string) : "done";
      if (!evidence) return { ok: false, detail: { error: "close_with_evidence requires params.evidence" } };
      const before = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
      // KOMAA-640: the evidence comment is what wakes the assignee. Re-running the
      // cycle on an issue already at the target disposition must not re-comment,
      // or comment -> in_progress -> terminal-run recovery -> blocked -> close
      // loops forever (four `[delivery-cycle evidence]` comments on KOMAA-639 in
      // four minutes). The PATCH + dependent settle below stay: they are
      // idempotent and do not wake.
      const atTarget = String(before.status ?? "") === disposition;
      // KOMAA-642: KOMAA-640's guard misses the interleaved shape on KOMAA-639,
      // where the woken run ends cancelled and terminal-run recovery leaves the
      // issue `blocked` before the next pass reads it -- `blocked` !== `done`, so
      // the comment posts again and the loop never closes. `blocked` is overloaded
      // (it also covers real blocks), so only the pathless flavour is silenced:
      // zero unresolved blockers, no execution hold, and no unblock descriptor.
      // All three matter. Live board check on the eight blocked issues: every one
      // has unresolved blockers or a descriptor, so none is silenced; KOMAA-427
      // and KOMAA-446 are HUMAN_ACTION_REQUIRED with zero blocker edges and keep
      // their comment thanks to the descriptor check. A genuine block never loses
      // its record; the recovery block has no execution path left, so a comment
      // there can only re-open work. Evidence for a silenced close is not dropped
      // -- it rides back in `evidenceComment` and the cycle's `suppressedEvidence`.
      let suppressed: string | null = null;
      if (!atTarget && String(before.status ?? "") === "blocked") {
        const rec = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/execution-state`).catch(() => null);
        // Same predicate `reconcile` already trusts for a stale descriptor, plus
        // the descriptor check: a descriptor-only wait has zero blocker edges too.
        if (isRecord(rec) && Number(rec.unresolvedBlockerCount ?? 1) === 0 && rec.hasExecutionHold !== true && rec.hasUnblockDescriptor !== true) {
          suppressed = "blocked_no_execution_path";
        }
      }
      if (!atTarget && suppressed === null) {
        await client.requestJson("POST", `/issues/${enc(issueId)}/comments`, {
          body: { body: `[delivery-cycle evidence] disposition=${disposition}\n\n${evidence}` },
          ...auth,
        });
      }
      const evidenceComment = suppressed === null
        ? { posted: !atTarget, reason: null as string | null, evidence: null as string | null }
        : { posted: false, reason: suppressed, evidence };
      const patch: Record<string, unknown> = { status: disposition };
      if (isRecord(before.unblockDescriptor)) patch.unblockDescriptor = null;
      const after = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: patch, ...auth });
      const dependents = await listDependentsBlockedBy(client, issueId);
      const closedIdentifier = isRecord(after) && typeof after.identifier === "string" ? (after.identifier as string) : null;
      const unblocked: unknown[] = [];
      for (const dep of dependents) {
        if (!isRecord(dep)) continue;
        try {
          unblocked.push(await settleDependentAfterBlockerDone(client, dep, issueId, closedIdentifier, auth));
        } catch (error) {
          unblocked.push({ dependentId: String((dep as Record<string, unknown>).id ?? "?"), error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { ok: true, detail: { before: pickIssueShort(before), after: pickIssueShort(after), dependentsUnblocked: unblocked, evidenceComment }, closed: true };
    }
    case "reconcile": {
      const rec = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/execution-state`).catch(() => null);
      if (!isRecord(rec) || Number(rec.unresolvedBlockerCount ?? 1) !== 0 || rec.hasExecutionHold === true) {
        return { ok: false, detail: { skipped: true, reason: "real blockers or hold present; not a stale descriptor" } };
      }
      const tgt = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
      // drop already-terminal blocker edges first (same rule as repair).
      // KOMAA-874: base is relational (execution-state above already proved
      // zero unresolved blockers); a diverged projection is not consulted.
      const diag0 = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`);
      const bl0: unknown[] = isRecord(diag0) && Array.isArray(diag0.blockers) ? diag0.blockers : [];
      const next0 = bl0
        .filter((b) => isRecord(b) && b.status !== "done" && b.status !== "cancelled")
        .map((b) => (isRecord(b) && typeof b.id === "string" ? b.id as string : "")).filter(Boolean);
      if (isRecord(diag0) && diag0.truncated === true) {
        return { ok: false, detail: { skipped: true, reason: "relational blockers truncated; refusing edge rewrite" } };
      }
      const cur0 = blockedByIdsOf(tgt);
      if (cur0.length !== next0.length || cur0.some((id) => !next0.includes(id))) {
        await client.requestJson("PATCH", `/issues/${enc(issueId)}`, { body: { blockedByIssueIds: [...new Set(next0)].sort() }, ...auth });
      }
      const desc = isRecord(tgt.unblockDescriptor) ? tgt.unblockDescriptor as Record<string, unknown> : null;
      if (!desc) return { ok: false, detail: { skipped: true, reason: "no descriptor to reconcile" } };
      const staleWord = /stale/i.test(String(desc.action ?? ""));
      if (!staleWord && Number(rec.pendingInteractionCount ?? 1) > 0) {
        return { ok: false, detail: { skipped: true, reason: "descriptor without stale marker and pending interactions exist" } };
      }
      const patched = await client.requestJson("PATCH", `/issues/${enc(issueId)}`, {
        body: {
          unblockDescriptor: null,
          ...(tgt.status === "blocked" ? { status: "todo" as const } : {}),
          comment: `[delivery-cycle reconcile] stale unblockDescriptor cleared${staleWord ? " (marked stale)" : " (zero blockers, no hold, no wait)"}; returning to todo.`,
        },
        ...auth,
      });
      return { ok: true, detail: { clearedStaleDescriptor: true, after: pickIssueShort(patched) } };
    }
    case "resolve_review": {
      const st = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}/execution-state`).catch(() => null);
      if (!isRecord(st) || st.wedgedReview !== true) {
        return { ok: false, detail: { skipped: true, reason: "review no longer wedged" } };
      }
      try {
        const r = await client.requestJson("POST", `/issues/${enc(issueId)}/stalled-review-decision`, {
          body: { action: "send_back", note: "[delivery-cycle] wedged review (no live path): returning to todo for re-route." },
          ...auth,
        });
        return { ok: true, detail: r };
      } catch (error) {
        // KOMAA-849: NEVER fall back to PATCH status=todo here. A 409
        // "no longer a stalled review" is a TOCTOU race signal (valid reviewer
        // path appeared, or the issue left in_review under us). Any error
        // therefore reconciles by refreshing canonical state and returning it
        // with no mutation — fail-closed, no silent demotion, no wake of the
        // original executor.
        const message = error instanceof Error ? error.message : String(error);
        const notStalled = /409|no longer a stalled review/i.test(message);
        const [refIssue, refState] = await Promise.all([
          getJsonOrNull(client, `/issues/${enc(issueId)}`),
          getExecutionStateCompat(client, issueId).catch(() => null),
        ]);
        return {
          ok: false,
          detail: {
            skipped: true,
            noDemotion: true,
            stale409: notStalled,
            reason: notStalled
              ? "stalled-review decision returned 409 (no longer stalled): refreshed canonical state, no todo fallback patch applied"
              : "stalled-review decision failed: fail-closed with refreshed canonical state, no todo fallback patch applied",
            error: message,
            canonicalState: { status: issueStatusOf(refIssue), executionState: refState, after: pickIssueShort(refIssue) },
          },
        };
      }
    }
  }
}

async function scanActionableStates(
  client: PaperclipApiClient,
  limit: number,
  scopeIssueIds?: string[],
): Promise<{ revision: string; states: Array<Record<string, unknown>> }> {
  const companyId = client.resolveCompanyId();
  const rev = (await getRevisionCompat(client)).raw;
  const issues = await client.requestJson<unknown[]>("GET", `/companies/${companyId}/issues${qs({ limit })}`);
  // KOMAA-631: a scope allowlist reads issues directly — the company list is
  // paginated and newest issues may sit past the page boundary.
  if (scopeIssueIds && scopeIssueIds.length > 0) {
    const direct: Array<Record<string, unknown>> = [];
    for (const sid of scopeIssueIds.slice(0, Math.min(limit, 50))) {
      const got = await getJsonOrNull(client, `/issues/${enc(sid)}`);
      if (isRecord(got) && typeof got.id === "string") direct.push(got);
    }
    const states2: Array<Record<string, unknown>> = [];
    for (const entry of direct) {
      const st = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(entry.id as string)}/execution-state`).catch(() => null);
      if (isRecord(st) && st.state !== "RUNNING" && st.state !== "TERMINAL") states2.push(st);
    }
    const rank = (s: string): number => s === "INCONSISTENT" ? 0 : s === "WAITING_DEPENDENCY" ? 1 : s === "WAITING_REVIEW" ? 2 : s === "RETRYABLE_FAILURE" ? 3 : s === "READY" ? 4 : 5;
    states2.sort((a, b) => rank(String(a.state)) - rank(String(b.state)));
    return { revision: String((await getRevisionCompat(client)).revision ?? ""), states: states2 };
  }
  const list = (Array.isArray(issues) ? issues : []).filter(isRecord); // KOMAA-631
  // Triage order: terminal-inconsistent first, then blocked repairs, wedged reviews, failures, ready.
  const priority = (s: string): number =>
    s === "INCONSISTENT" ? 0 : s === "WAITING_DEPENDENCY" ? 1 : s === "WAITING_REVIEW" ? 2 : s === "RETRYABLE_FAILURE" ? 3 : s === "READY" ? 4 : 5;
  const states: Array<Record<string, unknown>> = [];
  for (const entry of list.slice(0, limit)) {
    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== "string") continue;
    const st = await getExecutionStateCompat(client, id).catch(() => null);
    if (isRecord(st) && st.state !== "RUNNING" && st.state !== "TERMINAL") states.push(st);
  }
  states.sort((a, b) => priority(String(a.state)) - priority(String(b.state)));
  return { revision: String(rev.revision ?? ""), states };
}

function deliveryCycleToolsPartB(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    makeTool(
      "paperclipPlanControlPlaneRepair",
      "Plan a bounded control-plane repair: snapshot revision + ranked proposed mutations (tool/args/reason/risk). Nothing is executed. Feed actions + snapshotRevision into paperclipApplyControlPlaneRepair.",
      z.object({
        operatorRunId: operatorRunIdOptional,
        scope: z.enum(["actionable", "company"]).optional().default("actionable"),
        limit: z.number().int().positive().max(100).optional().default(50),
        maxActions: z.number().int().positive().max(20).optional().default(10),
        scopeIssueIds: z.array(z.string().min(1)).max(50).optional().default([]), // KOMAA-631: blast-radius allowlist
      }),
      async ({ scope, limit, maxActions, scopeIssueIds }) => {
        const { revision, states } = await scanActionableStates(client, limit, scopeIssueIds);
        const actions: CycleAction[] = [];
        for (const st of states) {
          if (actions.length >= maxActions) break;
          const issueId = String(st.issueId);
          const reasons = Array.isArray(st.reasons) ? (st.reasons as string[]) : [];
          if (st.state === "INCONSISTENT") {
            actions.push({ kind: "repair", issueId, reason: `INCONSISTENT: ${reasons.join(",") || "contradictory state"}`, risk: "low: cancels zombies, drops done edges, clears stale holds" });
          } else if ((st.state === "WAITING_DEPENDENCY" || st.state === "READY") && Number(st.doneBlockerEdgeCount ?? 0) > 0) {
            actions.push({ kind: "repair", issueId, reason: `stale done-blocker edges (${st.doneBlockerEdgeCount})`, risk: "low: edge cleanup only" });
          } else if (st.state === "WAITING_REVIEW" && st.wedgedReview === true) {
            actions.push({ kind: "resolve_review", issueId, reason: "wedged review, no live path", risk: "low: send-back to todo" });
          } else if (isDescriptorOnlyWait(st)) {
            actions.push({ kind: "reconcile", issueId, reason: "descriptor-only wait with zero blockers, no hold: stale-descriptor candidate", risk: "low: clears only provably stale descriptors" });
          } else if (st.state === "RETRYABLE_FAILURE" && scope === "company") {
            actions.push({ kind: "causal_retry", issueId, reason: `retryable failure ${st.lastFailureFingerprint ?? ""} (gate re-checked at apply)`, risk: "medium: mints one run" });
          }
        }
        return {
          planId: randomUUID(),
          snapshotRevision: revision,
          generatedAt: new Date().toISOString(),
          scope,
          proposedMutations: actions,
          note: "Apply with paperclipApplyControlPlaneRepair {actions, expectedRevision: snapshotRevision}. Stale revisions are refused, never executed.",
        };
      },
    ),
    makeTool(
      "paperclipApplyControlPlaneRepair",
      "Apply a repair plan with optimistic concurrency. Re-reads the revision; on mismatch returns 409-style stale_plan with the current revision and executes nothing. Each action is re-validated against live execution-state and skipped when already resolved.",
      z.object({
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        actions: z.array(z.object({
          kind: z.enum(["repair", "cancel_runs", "causal_retry", "wake", "unblock_wake", "close_with_evidence", "resolve_review", "reconcile"]),
          issueId: z.string().min(1),
          reason: z.string().optional(),
          params: z.record(z.string(), z.unknown()).optional(),
        })).min(1).max(20),
        expectedRevision: z.string().min(1),
        maxActions: z.number().int().positive().max(20).optional().default(10),
      }),
      async ({ operatorRunId, runId, actions, expectedRevision, maxActions }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const companyId = client.resolveCompanyId();
        const rev = (await getRevisionCompat(client)).raw;
        if (String(rev.revision ?? "") !== expectedRevision) {
          return {
            code: "stale_plan",
            applied: false,
            expectedRevision,
            currentRevision: rev.revision ?? null,
            changedEntities: "unknown (revision digest changed since plan) — re-run paperclipPlanControlPlaneRepair",
            retryable: true,
            sanctionedTool: "paperclipPlanControlPlaneRepair",
          };
        }
        const applied: unknown[] = [];
        const skipped: unknown[] = [];
        const failed: unknown[] = [];
        for (const a of actions.slice(0, maxActions)) {
          try {
            const r = await execCycleAction(client, { kind: a.kind, issueId: a.issueId, reason: a.reason ?? "apply", params: a.params as Record<string, unknown> | undefined }, auth);
            if (r.ok) applied.push({ ...a, result: r.detail });
            else skipped.push({ ...a, result: r.detail });
          } catch (error) {
            failed.push({ ...a, error: error instanceof Error ? error.message : String(error) });
          }
        }
        const after = (await getRevisionCompat(client)).raw;
        return { applied: true, appliedCount: applied.length, appliedActions: applied, skipped, failed, beforeRevision: expectedRevision, afterRevision: after.revision ?? null, operatorRunId: op };
      },
    ),
    makeTool(
      "paperclipRepairControlPlane",
      "Company-wide repair sweep for the scheduled operator: terminal+live runs, blocked-zero-blockers, stale done edges, stale checkouts, orphan retries, wedged reviews, stale holds. Bounded (limit scan, maxActions apply). wakePolicy none: this tool never wakes execution; use the delivery cycle for that.",
      z.object({
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        apply: z.boolean().optional().default(true),
        scope: z.enum(["actionable", "company"]).optional().default("actionable"),
        limit: z.number().int().positive().max(100).optional().default(50),
        maxActions: z.number().int().positive().max(20).optional().default(10),
        scopeIssueIds: z.array(z.string().min(1)).max(50).optional().default([]), // KOMAA-631
      }),
      async ({ operatorRunId, runId, apply, scope, limit, maxActions, scopeIssueIds }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const { revision, states } = await scanActionableStates(client, limit, scopeIssueIds);
        const findings = states.filter((s) =>
          s.state === "INCONSISTENT" ||
          ((s.state === "WAITING_DEPENDENCY" || s.state === "READY") && Number(s.doneBlockerEdgeCount ?? 0) > 0) ||
          (s.state === "WAITING_REVIEW" && s.wedgedReview === true) ||
          isDescriptorOnlyWait(s) ||
          (scope === "company" && s.state === "RETRYABLE_FAILURE"),
        );
        const repaired: unknown[] = [];
        const skipped: unknown[] = [];
        if (apply) {
          for (const f of findings.slice(0, maxActions)) {
            const issueId = String(f.issueId);
            try {
              if (f.state === "WAITING_REVIEW") {
                const r = await execCycleAction(client, { kind: "resolve_review", issueId, reason: "wedged" }, auth);
                (r.ok ? repaired : skipped).push({ issueId, state: f.state, result: r.detail });
              } else if (f.state === "WAITING_EXTERNAL" || f.state === "HUMAN_ACTION_REQUIRED") {
                const r = await execCycleAction(client, { kind: "reconcile", issueId, reason: "descriptor-only wait" }, auth);
                (r.ok ? repaired : skipped).push({ issueId, state: f.state, result: r.detail });
              } else if (f.state === "RETRYABLE_FAILURE") {
                skipped.push({ issueId, state: f.state, reason: "retries mint runs: delivery-cycle only, never silent repair" });
              } else {
                const r = await execRepairStep(client, issueId, auth);
                (r.touched ? repaired : skipped).push({ issueId, state: f.state, result: r.detail });
              }
            } catch (error) {
              skipped.push({ issueId, state: f.state, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        const after = apply
          ? (await getRevisionCompat(client)).raw
          : null;
        return {
          revision, applied: apply, scanned: states.length,
          findingCount: findings.length, findings: findings.map((f) => ({ issueId: f.issueId, identifier: f.identifier ?? null, state: f.state, reasons: f.reasons ?? [] })),
          repaired, skipped, afterRevision: isRecord(after) ? after.revision ?? null : null,
          wakePolicy: "none", operatorRunId: op,
        };
      },
    ),
    makeTool(
      "paperclipRunDeliveryCycle",
      "One atomic scheduled-operator cycle: revision check -> repair (max 3, never wakes) -> optional evidence closures -> unblock/wake eligible (capped) -> verify. Exactly one disposition: DELIVERED | REPAIRED_CONTROL_PLANE | ADVANCED | HUMAN_BLOCKED | EXTERNAL_WAIT | NO_ACTIONABLE_WORK | FAILED. Never ends on bare analysis when a safe mutation existed.",
      z.object({
        operatorRunId: operatorRunIdOptional,
        runId: runIdOptional,
        mode: z.enum(["repair_and_deliver", "repair_only", "deliver_only"]).optional().default("repair_and_deliver"),
        maxActions: z.number().int().positive().max(20).optional().default(6),
        expectedRevision: z.string().min(1).optional(),
        allowWakes: z.boolean().optional().default(true),
        maxWakes: z.number().int().min(0).max(5).optional().default(2),
        closeRequests: z.array(z.object({
          issueId: issueIdSchema,
          evidence: z.string().trim().min(1).max(20000),
          disposition: z.enum(["done", "in_review", "cancelled"]).default("done"),
        })).max(5).optional().default([]),
        scopeIssueIds: z.array(z.string().min(1)).max(50).optional().default([]), // KOMAA-631: blast-radius allowlist
        wakePolicy: z.enum(["none", "limited"]).optional().default("limited"), // KOMAA-631: none = repairs only
      }),
      async ({ operatorRunId, runId, mode, maxActions, expectedRevision, allowWakes, maxWakes, closeRequests, scopeIssueIds, wakePolicy }) => {
        const op = operatorRunId ?? client.defaults.operatorRunId ?? null;
        const auth = opAuth(op, runId ?? null);
        const companyId = client.resolveCompanyId();
        const before = (await getRevisionCompat(client)).raw;
        const beforeRevision = String(before.revision ?? "");
        if (expectedRevision && expectedRevision !== beforeRevision) {
          return {
            code: "stale_plan", applied: false, disposition: "FAILED",
            expectedRevision, currentRevision: beforeRevision,
            noOpReason: "snapshot moved since plan; replan, never execute stale",
            retryable: true, sanctionedTool: "paperclipPlanControlPlaneRepair",
          };
        }
        const actions: unknown[] = [];
        const repaired: unknown[] = [];
        const closed: unknown[] = [];
        const unblocked: unknown[] = [];
        const woken: unknown[] = [];
        const cancelledRuns: unknown[] = [];
        const requiresHuman: unknown[] = [];
        const acceptedDeliverables: unknown[] = [];
        const suppressedEvidence: unknown[] = [];
        let wakesUsed = 0;
        let budget = maxActions;
        const wakesAllowed = allowWakes && wakePolicy !== "none";
        const errors: unknown[] = [];

        if (mode !== "deliver_only") {
          const { states } = await scanActionableStates(client, 50, scopeIssueIds);
          for (const st of states) {
            if (budget <= 0) break;
            const isDescriptorOnly = isDescriptorOnlyWait(st);
            if (st.state !== "INCONSISTENT" && !((st.state === "WAITING_DEPENDENCY" || st.state === "READY") && Number(st.doneBlockerEdgeCount ?? 0) > 0) && !(st.state === "WAITING_REVIEW" && st.wedgedReview === true) && !isDescriptorOnly) continue;
            if (repaired.length >= 3) break;
            const issueId = String(st.issueId);
            try {
              const r = st.state === "WAITING_REVIEW"
                ? await execCycleAction(client, { kind: "resolve_review", issueId, reason: "cycle repair" }, auth)
                : isDescriptorOnly
                  ? await execCycleAction(client, { kind: "reconcile", issueId, reason: "cycle repair" }, auth)
                  : await execRepairStep(client, issueId, auth).then((x) => ({ ok: x.ok, detail: x.detail, touched: x.touched }));
              budget -= 1;
              actions.push({ kind: "repair", issueId, ok: r.ok });
              if (r.ok && (r as { touched?: boolean }).touched !== false) repaired.push({ issueId, identifier: st.identifier ?? null, state: st.state });
              if (Array.isArray((r.detail as Record<string, unknown>)?.actions)) {
                for (const a of ((r.detail as Record<string, unknown>).actions) as Array<Record<string, unknown>>) {
                  if (isRecord(a) && a.action === "cancelled_run") cancelledRuns.push({ issueId, runId: a.runId ?? null });
                }
              }
            } catch (error) {
              errors.push({ kind: "repair", issueId, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }

        if (mode !== "repair_only") {
          for (const c of closeRequests) {
            if (budget <= 0) break;
            try {
              const r = await execCycleAction(client, { kind: "close_with_evidence", issueId: c.issueId, reason: "cycle close", params: { evidence: c.evidence, disposition: c.disposition } }, auth);
              budget -= 1;
              actions.push({ kind: "close_with_evidence", issueId: c.issueId, ok: r.ok });
              if (r.ok) {
                closed.push({ issueId: c.issueId, disposition: c.disposition });
                acceptedDeliverables.push({ issueId: c.issueId, evidence: c.evidence.slice(0, 500), disposition: c.disposition });
                // KOMAA-642: a silenced evidence comment must not vanish. The
                // cycle's own return is the delivery-cycle log, so the full
                // evidence rides back there instead of on the issue thread.
                const ec = (r.detail as Record<string, unknown>)?.evidenceComment;
                if (isRecord(ec) && ec.posted === false && typeof ec.evidence === "string") {
                  suppressedEvidence.push({ issueId: c.issueId, disposition: c.disposition, reason: ec.reason ?? null, evidence: ec.evidence });
                }
                const settled = (r.detail as Record<string, unknown>)?.dependentsUnblocked;
                if (Array.isArray(settled)) {
                  for (const s of settled) {
                    if (!isRecord(s)) continue;
                    unblocked.push({ issueId: String(s.dependentId ?? "?"), viaClose: c.issueId, clearedDescriptor: s.clearedDescriptor ?? false });
                    const w = (s as Record<string, unknown>).wake as Record<string, unknown> | null;
                    if (w && w.woke === true && wakesAllowed && wakesUsed < maxWakes) {
                      woken.push({ issueId: String(s.dependentId ?? "?"), viaClose: c.issueId });
                      wakesUsed += 1;
                    }
                  }
                }
              }
            } catch (error) {
              errors.push({ kind: "close_with_evidence", issueId: c.issueId, error: error instanceof Error ? error.message : String(error) });
            }
          }
          // RUNNING-on-nonexecutable: never kill silently (may predate the
          // block). One explicit entry with the sanctioned one-click repair.
          try {
            const { states: flagStates } = await scanActionableStates(client, 30, scopeIssueIds);
            for (const fs of flagStates) {
              if (Number(fs.liveRunCount ?? 0) === 0) continue;
              if (fs.state === "RUNNING" || fs.state === "TERMINAL" || fs.executable === true) continue;
              const reasons = Array.isArray(fs.reasons) ? (fs.reasons as string[]) : [];
              if (!reasons.some((r) => /running_while|live_runs/.test(r))) continue;
              requiresHuman.push({
                issueId: String(fs.issueId), identifier: fs.identifier ?? null,
                state: fs.state, reasons,
                humanAction: "decide whether to cancel the leaked running run (it may predate the block)",
                evidenceWhy: reasons.join(","),
                canOperatorResolve: true,
                sanctionedTool: "paperclipCancelRun",
                repairArgs: { note: "runId: see live-runs for the issue" },
              });
            }
          } catch { /* flagging best-effort */ }
          if (wakesAllowed && wakesUsed < maxWakes && budget > 0) {
            const { states } = await scanActionableStates(client, 30, scopeIssueIds);
            for (const st of states) {
              if (budget <= 0 || wakesUsed >= maxWakes) break;
              const issueId = String(st.issueId);
              if (st.state === "READY" && st.assigneeAgentId) {
                try {
                  const w = await checkoutWake(client, issueId, auth);
                  budget -= 1;
                  actions.push({ kind: "wake", issueId, ok: (w as Record<string, unknown>).woke === true });
                  if ((w as Record<string, unknown>).woke === true) { woken.push({ issueId, identifier: st.identifier ?? null }); wakesUsed += 1; }
                } catch (error) {
                  errors.push({ kind: "wake", issueId, error: error instanceof Error ? error.message : String(error) });
                }
              } else if (st.state === "WAITING_DEPENDENCY" && Number(st.unresolvedBlockerCount ?? 1) === 0 && Number(st.doneBlockerEdgeCount ?? 0) > 0) {
                try {
                  const beforeIssue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
                  const diag = await getJsonOrNull(client, `/issues/${enc(issueId)}/diagnostics/blockers`);
                  const blist: unknown[] = isRecord(diag) && Array.isArray(diag.blockers) ? diag.blockers : [];
                  const doneIds = new Set(
                    blist.filter((b) => isRecord(b) && (b.status === "done" || b.status === "cancelled"))
                      .map((b) => (isRecord(b) && typeof b.id === "string" ? b.id as string : "")).filter(Boolean),
                  );
                  const r = await execCycleAction(client, { kind: "unblock_wake", issueId, reason: "cycle deliver", params: { removeBlockerIds: [...doneIds] } }, auth);
                  void beforeIssue;
                  budget -= 1;
                  actions.push({ kind: "unblock_wake", issueId, ok: r.ok });
                  if (r.ok) unblocked.push({ issueId, identifier: st.identifier ?? null });
                  if ((r as { woke?: boolean }).woke === true && wakesUsed < maxWakes) { woken.push({ issueId, identifier: st.identifier ?? null }); wakesUsed += 1; }
                } catch (error) {
                  errors.push({ kind: "unblock_wake", issueId, error: error instanceof Error ? error.message : String(error) });
                }
              } else if (st.state === "HUMAN_ACTION_REQUIRED" || st.state === "WAITING_EXTERNAL") {
                const reasons = Array.isArray(st.reasons) ? (st.reasons as string[]) : [];
                const text = reasons.join(" ").toLowerCase();
                const humanAction = /oauth/.test(text) ? "interactive OAuth/user session" : /approval|decision/.test(text) ? "board approval decision" : /secret|credential/.test(text) ? "missing secret value (human must supply)" : /host|external/.test(text) ? "physical host action outside tools" : "human review of external wait";
                requiresHuman.push({
                  issueId, identifier: st.identifier ?? null, state: st.state, reasons,
                  humanAction, evidenceWhy: reasons.join(",") || String(st.state),
                  canOperatorResolve: false,
                });
              }
            }
          }
        }

        const after = (await getRevisionCompat(client)).raw;
        const remainingBlockers = requiresHuman;
        let disposition = "NO_ACTIONABLE_WORK";
        let noOpReason: string | null = null;
        if (errors.length > 0 && actions.length === 0) disposition = "FAILED";
        else if (closed.length > 0) disposition = "DELIVERED";
        else if (repaired.length > 0) disposition = "REPAIRED_CONTROL_PLANE";
        else if (unblocked.length > 0 || woken.length > 0) disposition = "ADVANCED";
        else if (requiresHuman.length > 0) disposition = (/oauth|secret|credential|host|external|approval|decision|"canoperatorresolve":true/.test(JSON.stringify(requiresHuman).toLowerCase()) && repaired.length === 0) ? "HUMAN_BLOCKED" : "EXTERNAL_WAIT";
        else { disposition = "NO_ACTIONABLE_WORK"; noOpReason = "no INCONSISTENT, closable, or wakeable work found in scope"; }
        if (disposition === "HUMAN_BLOCKED" && repaired.length === 0 && unblocked.length === 0 && closed.length === 0 && woken.length === 0) {
          noOpReason = noOpReason ?? null;
        }
        return {
          disposition,
          beforeRevision, afterRevision: after.revision ?? null,
          actions, repaired, closed, unblocked, woken, cancelledRuns,
          remainingBlockers, requiresHuman, acceptedDeliverables,
          acceptedDeliverablesDelta: acceptedDeliverables.length,
          suppressedEvidence: suppressedEvidence.length > 0 ? suppressedEvidence : undefined,
          noOpReason, errors: errors.length > 0 ? errors : undefined,
          wakePolicy: wakesAllowed ? `limited(${wakesUsed}/${maxWakes})` : "none",
          operatorRunId: op,
        };
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export function createControlPlaneTools(client: PaperclipApiClient): ControlPlaneToolDefinition[] {
  return [
    ...runTools(client),
    ...eligibilityTools(client),
    ...recoveryDecisionTools(client),
    ...workspaceTools(client),
    ...reviewTools(client),
    ...telemetryTools(client),
    ...agentControlTools(client),
    ...miscTools(client),
    ...operatorCompositeTools(client), // KOMAA-630
    ...deliveryCycleToolsPartA(client), // KOMAA-631
    ...deliveryCycleToolsPartB(client), // KOMAA-631
  ];
}

export const CONTROL_PLANE_TOOL_NAMES: string[] = [
  "paperclipListRuns",
  "paperclipListLiveRuns",
  "paperclipGetCurrentOperatorRun",
  "paperclipStartOperatorRun",
  "paperclipCancelRun",
  "paperclipReapStaleRuns",
  "paperclipListScheduledRetries",
  "paperclipCancelScheduledRetry",
  "paperclipWakeIssueFresh",
  "paperclipRetryIssueFresh",
  "paperclipGetExecutionEligibility",
  "paperclipReconcileIssueExecution",
  "paperclipReconcileCompanyControlPlane",
  "paperclipSetExecutionHold",
  "paperclipClearExecutionHold",
  "paperclipGetDependencyGraph",
  "paperclipPatchDependencyGraph",
  "paperclipValidateDAG",
  "paperclipBulkUpdateIssues",
  "paperclipListRecoveryActions",
  "paperclipResolveRecoveryAction",
  "paperclipListDecisions",
  "paperclipGetDecision",
  "paperclipResolveDecision",
  "paperclipListWorkspaces",
  "paperclipGetWorkspace",
  "paperclipGetWorkspaceLocks",
  "paperclipProvisionWorkspace",
  "paperclipDetachWorkspace",
  "paperclipResetWorkspace",
  "paperclipGetWorkspaceCloseReadiness",
  "paperclipGetReviewState",
  "paperclipSubmitReviewDecision",
  "paperclipRequestReview",
  "paperclipListPendingReviews",
  "paperclipGetRunEvents",
  "paperclipTailRunLog",
  "paperclipGetRunTranscript",
  "paperclipGetSchedulerState",
  "paperclipGetProviderHealth",
  "paperclipGetRuntimePreflight",
  "paperclipGetAgentEffectiveConfig",
  "paperclipGetAgentInstructions",
  "paperclipGetAgentInstructionsFile",
  "paperclipUpdateAgentInstructionsFile",
  "paperclipPatchAgentInstructionsBundle",
  "paperclipDeleteAgentInstructionsFile",
  "paperclipPatchAgentRuntimeConfig",
  "paperclipGetAgentSkillSet",
  "paperclipSyncAgentSkills",
  "paperclipListAgentConfigRevisions",
  "paperclipGetAgentConfigRevision",
  "paperclipRollbackAgentConfig",
  "paperclipUpdateAgentPermissions",
  "paperclipGetEconomicsMetrics",
  "paperclipCreateSkillTestRun",
  "paperclipGetSkillTestRun",
  "paperclipGetAgentPermissions",
  "paperclipExplainForbidden",
  "paperclipListRoutines",
  "paperclipGetRoutine",
  "paperclipCreateRoutine",
  "paperclipUpdateRoutine",
  "paperclipRunRoutineNow",
  "paperclipListRoutineRuns",
  "paperclipGetRoutineMetrics",
  "paperclipUpdateGoal",
  "paperclipDetachGoal",
  "paperclipSearchActivity",
  "paperclipSearchLogs",
  "paperclipGetDeliveryMetrics",
  "paperclipGetCostMetrics",
  "paperclipListArtifacts",
  "paperclipGetCandidateState",
  "paperclipGetServerInfo",
  "paperclipListFeatureFlags",
  "paperclipUpdateFeatureFlag",
  "paperclipGetSystemHealth",
  "paperclipListMonitors",
  // KOMAA-630 operator composites
  "paperclipOperatorSnapshot",
  "paperclipReconcileBlockedIssue",
  "paperclipRepairIssue",
  "paperclipCloseIssueWithEvidence",
  "paperclipUnblockAndWake",
  "paperclipResolveReviewWedge",
  "paperclipSupersedeIssue",
  // KOMAA-631 scheduled delivery control plane
  "paperclipGetExecutionState",
  "paperclipGetControlPlaneRevision",
  "paperclipRetryWithCausalGate",
  "paperclipGetDeliveryLineage",
  "paperclipPlanControlPlaneRepair",
  "paperclipApplyControlPlaneRepair",
  "paperclipRepairControlPlane",
  "paperclipRunDeliveryCycle",
];
