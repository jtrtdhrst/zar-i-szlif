import type { PaperclipMcpConfig } from "./config.js";
import { validateParentForCreate, validateParentHierarchy } from "./issue-hierarchy.js";
import {
  evaluateCheckoutWorkspaceIsolation,
  evaluateChildWorkspaceIsolation,
} from "./workspace-isolation.js";

export class PaperclipApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(input: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    message: string;
  }) {
    super(input.message);
    this.name = "PaperclipApiError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
    this.body = input.body;
  }
}

export interface JsonRequestOptions {
  body?: unknown;
  includeRunId?: boolean;
  runId?: string | null;
  // KOMAA-630: first-class operator context, alternative to runId.
  // Sent as X-Paperclip-Operator-Run-Id; backend promotes to board/user
  // authority. Never a fake heartbeat run.
  operatorRunId?: string | null;
  // P0 2026-10-17: force the caller's own key even on routes that would
  // normally be routed to the fixed server agent/board key (/agents/*).
  // Used to resolve the MCP caller's own identity (GET /agents/me).
  callerKey?: boolean;
  // User-owned agent-chat comments enqueue a conversation wake rather than
  // mutating an execution issue as an agent executor.
  chatConversation?: boolean;
}

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

// KOMAA-1415: Board-gated plugin routes that the trusted gateway may execute
// under its own enrolled Board credential for an explicitly allowlisted agent
// principal. Deliberately exact: the llm-wiki plugin data/actions namespace
// only, never another plugin and never a generic /plugins/* promotion.
const WIKI_BOARD_ROUTE = /^\/plugins\/paperclipai\.plugin-llm-wiki\/(?:data|actions)\//;
function isWikiBoardRoute(barePath: string): boolean {
  return WIKI_BOARD_ROUTE.test(barePath);
}

export type PaperclipCredentialClass = "caller" | "agent" | "board";

export interface RouteAuthContext {
  body?: unknown;
  callerAgentId?: string | null;
  runId?: string | null;
}

interface RoutePermissionRule {
  id: string;
  methods?: readonly string[];
  path: RegExp;
  credential: PaperclipCredentialClass;
  when?: (body: Record<string, unknown> | null, context: RouteAuthContext, match: RegExpMatchArray) => boolean;
}

const ROUTE_PERMISSION_MATRIX: readonly RoutePermissionRule[] = [
  { id: "agent-runtime-state", methods: ["GET", "POST"], path: /^\/agents\/[^/]+\/runtime-state(?:\/reset-session)?$/, credential: "board" },
  // Core gates the instruction bundle behind assertInstanceAdmin for agents in
  // "external" bundle mode (assertExternalInstructionsAdmin) - the agent key
  // answers 403 "Board access required" even on its own row.
  { id: "agent-instructions-bundle", path: /^\/agents\/[^/]+\/instructions-bundle(?:\/.*)?$/, credential: "board" },
  // Company/instance admin reads are Board-only in Core (assertBoard): the
  // agent key answers 403 "Board access required". Verified live 2026-10-19.
  { id: "company-list", methods: ["GET"], path: /^\/companies$/, credential: "board" },
  { id: "company-environments", path: /^\/companies\/[^/]+\/environments(?:\/.*)?$/, credential: "board" },
  { id: "company-costs", path: /^\/companies\/[^/]+\/costs(?:\/.*)?$/, credential: "board" },
  { id: "company-chats", path: /^\/companies\/[^/]+\/chats(?:\/.*)?$/, credential: "board" },
  { id: "company-tools-policies", path: /^\/companies\/[^/]+\/tools\/policies$/, credential: "board" },
  { id: "instance-scheduler-heartbeats", methods: ["GET"], path: /^\/instance\/scheduler-heartbeats$/, credential: "board" },
  { id: "agent-task-sessions", methods: ["GET"], path: /^\/agents\/[^/]+\/task-sessions$/, credential: "board" },
  { id: "agent-key-management", methods: ["GET", "POST", "DELETE"], path: /^\/agents\/[^/]+\/keys(?:\/[^/]+)?$/, credential: "board" },
  { id: "agent-clear-error", methods: ["POST"], path: /^\/agents\/[^/]+\/clear-error$/, credential: "board" },
  {
    id: "peer-agent-invocation",
    methods: ["POST"],
    path: /^\/agents\/([^/]+)\/(?:wakeup|heartbeat\/invoke)$/,
    credential: "board",
    when: (_body, context, match) => !context.callerAgentId || match[1] !== context.callerAgentId,
  },
  { id: "plugin-api", path: /^\/plugins\//, credential: "board" },
  { id: "issue-file-resources", path: /^\/issues\/[^/]+\/file-resources\//, credential: "board" },
  {
    id: "cross-agent-checkout",
    methods: ["POST"],
    path: /^\/issues\/[^/]+\/checkout$/,
    credential: "board",
    when: (body, context) => {
      const target = body?.agentId;
      return typeof target !== "string" || !context.callerAgentId || target !== context.callerAgentId;
    },
  },
  { id: "issue-document-delete", methods: ["DELETE"], path: /^\/issues\/[^/]+\/documents\/[^/]+$/, credential: "board" },
  { id: "issue-force-release", methods: ["POST"], path: /^\/issues\/[^/]+\/admin\/force-release$/, credential: "board" },
  { id: "workspace-branch-reconcile", methods: ["POST"], path: /^\/execution-workspaces\/[^/]+\/reconcile-branch$/, credential: "board" },
  {
    id: "recovery-board-outcome",
    methods: ["POST"],
    path: /^\/issues\/[^/]+\/recovery-actions\/resolve$/,
    credential: "board",
    when: (body) => body?.outcome === "false_positive" || body?.outcome === "cancelled" || body?.executionReconciliation !== undefined,
  },
  {
    id: "cancel-other-run",
    methods: ["POST"],
    path: /^\/heartbeat-runs\/([^/]+)\/cancel$/,
    credential: "board",
    when: (_body, context, match) => !context.runId || match[1] !== context.runId,
  },
  { id: "experimental-instance-settings", methods: ["GET", "PATCH"], path: /^\/instance\/settings\/experimental$/, credential: "board" },
  { id: "scheduled-retry-now", methods: ["POST"], path: /^\/issues\/[^/]+\/scheduled-retry\/retry-now$/, credential: "board" },
  { id: "stalled-review-decision", methods: ["POST"], path: /^\/issues\/[^/]+\/stalled-review-decision$/, credential: "board" },
  { id: "company-decisions-list", methods: ["GET"], path: /^\/companies\/[^/]+\/decisions(?:\/stats)?$/, credential: "board" },
  { id: "decision-approve-or-dismiss", methods: ["POST"], path: /^\/decisions\/[^/]+\/(?:decide|dismiss)$/, credential: "board" },
  { id: "approval-decision", methods: ["POST"], path: /^\/approvals\/[^/]+\/(?:approve|reject|request-revision)$/, credential: "board" },
  { id: "company-activity-create", methods: ["POST"], path: /^\/companies\/[^/]+\/activity$/, credential: "board" },
];

const AGENT_ISSUE_RUN_MATRIX: readonly RoutePermissionRule[] = [
  { id: "issue-update", methods: ["PATCH"], path: /^\/issues\/[^/]+$/, credential: "caller" },
  { id: "issue-comments", methods: ["POST"], path: /^\/issues\/[^/]+\/comments$/, credential: "caller" },
  { id: "issue-interactions", methods: ["POST"], path: /^\/issues\/[^/]+\/interactions(?:\/[^/]+\/(?:cancel|skip|accept|reject))?$/, credential: "caller" },
  { id: "issue-checkout", methods: ["POST"], path: /^\/issues\/[^/]+\/checkout$/, credential: "caller" },
  { id: "issue-release", methods: ["POST"], path: /^\/issues\/[^/]+\/release$/, credential: "caller" },
  { id: "issue-recovery-agent-outcome", methods: ["POST"], path: /^\/issues\/[^/]+\/recovery-actions\/resolve$/, credential: "caller", when: (body) => body?.outcome === "restored" || body?.outcome === "blocked" },
  // Broker parity (execution-broker.ts ROUTES): document + approval-link writes
  // are issue-scoped agent mutations like comments — they previously had NO
  // local gate and failed late with 401/403 instead of RUN_CONTEXT_REQUIRED.
  { id: "issue-document-upsert", methods: ["PUT"], path: /^\/issues\/[^/]+\/documents\/[^/]+$/, credential: "caller" },
  { id: "issue-document-restore", methods: ["POST"], path: /^\/issues\/[^/]+\/documents\/[^/]+\/revisions\/[^/]+\/restore$/, credential: "caller" },
  { id: "issue-approval-link", methods: ["POST"], path: /^\/issues\/[^/]+\/approvals$/, credential: "caller" },
  { id: "issue-approval-unlink", methods: ["DELETE"], path: /^\/issues\/[^/]+\/approvals\/[^/]+$/, credential: "caller" },
];

function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

// Stable shape of a route path: UUID segments collapse to ":id" so that a
// route is remembered once for every instance of it.
function routeShape(barePath: string): string {
  return barePath
    .split("/")
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ":id" : seg))
    .join("/");
}

/**
 * Routes that no longer exist in this Paperclip build. Probing them on every
 * call produced thousands of 404 log lines (execution-state alone: >1k).
 * Probe once per process, then answer from the cache.
 */
const REMOVED_GET_ROUTES = new Set<string>([
  "/issues/:id/execution-state",
  "/companies/:id/control-plane-revision",
]);
const removedGetRoutes = new Set<string>();

/**
 * Routes proven at runtime to need Board authority (403 under the caller's own
 * credential). Remembered so the next call goes straight to the Board key
 * instead of burning a denied request first.
 */
const promotedBoardRoutes = new Set<string>();

// Writes are promoted outside the issue namespace. Issue-scoped writes keep
// the caller's own credential: their attribution (which agent wrote what) is
// audit data, and the credential choice there is already deliberate (run
// context -> caller key, no run context -> board key).
function isPromotable(method: string, barePath: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  return !barePath.startsWith("/issues/");
}

/** Whether a denied call may be retried under the Board credential. */
export function isBoardPromotable(method: string, path: string): boolean {
  return isPromotable(method, path.split("?", 1)[0]);
}

function matchesPolicy(rule: RoutePermissionRule, method: string, barePath: string, body: Record<string, unknown> | null, context: RouteAuthContext): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  const match = barePath.match(rule.path);
  return Boolean(match && (!rule.when || rule.when(body, context, match)));
}

export function resolveCredentialClass(method: string, path: string, context: RouteAuthContext = {}): PaperclipCredentialClass {
  const m = method.toUpperCase();
  const bare = path.split("?", 1)[0];
  const body = objectBody(context.body);
  const boardRule = ROUTE_PERMISSION_MATRIX.find((rule) => matchesPolicy(rule, m, bare, body, context));
  if (boardRule) return boardRule.credential;
  return bare.startsWith("/agents/") ? "agent" : "caller";
}

export function requiresBoardAuth(method: string, path: string, body?: unknown): boolean {
  return resolveCredentialClass(method, path, { body }) === "board";
}

function requiresAgentIssueRun(method: string, path: string, body: unknown): boolean {
  const m = method.toUpperCase();
  const bare = path.split("?", 1)[0];
  const context = { body };
  return AGENT_ISSUE_RUN_MATRIX.some((rule) => matchesPolicy(rule, m, bare, objectBody(body), context));
}

function localPolicyError(code: string, message: string, remediationOwner: string, remediation: string): Error {
  const error = new Error(`${message} [errorCode=${code}]`);
  (error as unknown as Record<string, unknown>).detail = { remediationOwner, remediation };
  return error;
}

function buildErrorMessage(method: string, path: string, status: number, body: unknown): string {
  const base =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? `${method} ${path} failed with ${status}: ${body.error}`
      : `${method} ${path} failed with ${status}`;
  // KOMAA-797 (MCP layer only, no Core change): ambiguous failure after a write
  // means the commit state is unknowable here — never imply failure-to-commit.
  if (isWriteMethod(method) && [500, 502, 503, 504, 429].includes(status)) {
    return `${base} [commitState=UNKNOWN_COMMIT_STATE; write may have committed — read-back by natural key before retrying, do NOT blind-retry]`;
  }
  return base;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class PaperclipApiClient {
  constructor(private readonly config: PaperclipMcpConfig) {}

  get defaults() {
    return {
      companyId: this.config.companyId,
      agentId: this.config.agentId,
      runId: this.config.runId,
      operatorRunId: (this.config as { operatorRunId?: string | null }).operatorRunId ?? null,
      principalKind: this.config.principalKind ?? null,
    };
  }

  // P0 2026-10-17: the credential the MCP session was created with (caller's
  // own Paperclip API key). Used to resolve the caller's identity server-side
  // (GET /agents/me) for the execution-context compatibility layer.
  get callerApiKey(): string {
    return this.config.apiKey;
  }

  // Effective-authority probe for capability reporting: a Board credential
  // makes board-scoped operations reachable, an agent credential does not.
  get hasBoardCredential(): boolean {
    return Boolean(this.config.boardApiKey);
  }

  resolveCompanyId(companyId?: string | null): string {
    const resolved = companyId?.trim() || this.config.companyId;
    if (!resolved) {
      throw new Error("companyId is required because PAPERCLIP_COMPANY_ID is not set");
    }
    return resolved;
  }

  resolveAgentId(agentId?: string | null): string {
    const resolved = agentId?.trim() || this.config.agentId;
    if (!resolved) {
      throw new Error("agentId is required because PAPERCLIP_AGENT_ID is not set");
    }
    return resolved;
  }

  async requestJson<T>(method: string, path: string, options: JsonRequestOptions = {}): Promise<T> {
    if (!path.startsWith("/")) {
      throw new Error(`API path must start with "/": ${path}`);
    }

    const url = new URL(path.slice(1), `${this.config.apiUrl}/`);
    // Central route policy resolves caller/agent/Board credentials before fetch.
    // Missing required credentials or live issue context fail locally.
    const runId = options.runId ?? this.config.runId;
    const operatorRunId = options.operatorRunId ?? this.config.operatorRunId ?? null;
    const barePath = path.split("?", 1)[0];
    const shape = routeShape(barePath);
    let credentialClass = options.callerKey
      ? "caller"
      : resolveCredentialClass(method, path, { body: options.body, callerAgentId: this.config.agentId, runId });
    // The externally authenticated Board principal has no agent key. Every
    // route must use the Board credential, including /agents/:id/wakeup and
    // other agent-prefixed operations. Never pretend it is the server COO.
    if (this.config.principalKind === "board") {
      credentialClass = "board";
    }
    // A route proven at runtime to need Board authority keeps using it.
    if (!options.callerKey && promotedBoardRoutes.has(shape)) {
      credentialClass = "board";
    }
    // KOMAA-1415: the gateway's enrolled Board credential is projected only
    // for the llm-wiki plugin data/actions routes, and only when the gateway
    // passed it for an allowlisted agent principal. The key stays server-side.
    const scopedWikiBoardKey = !options.callerKey && isWikiBoardRoute(barePath)
      ? this.config.wikiBoardApiKey ?? null
      : null;
    if (scopedWikiBoardKey) {
      credentialClass = "board";
    }
    // Removed upstream routes: answer from the cache instead of a 404 per call.
    if (method.toUpperCase() === "GET" && removedGetRoutes.has(shape)) {
      throw new PaperclipApiError({
        status: 404,
        method: method.toUpperCase(),
        path,
        body: null,
        message: `${method.toUpperCase()} ${path} failed with 404: route not present in this Paperclip build (cached)`,
      });
    }
    const body = objectBody(options.body);
    const isChatConversationComment = options.chatConversation === true
      && method.toUpperCase() === "POST"
      && /^\/issues\/[^/]+\/comments$/.test(barePath)
      && typeof body?.body === "string"
      && typeof body?.clientRequestId === "string";
    if (credentialClass !== "board" && !isChatConversationComment && this.config.agentId && requiresAgentIssueRun(method, path, options.body) && !runId && !operatorRunId) {
      if (this.config.boardApiKey) {
        // Server accepts board authority for issue-scoped writes without a live
        // run (e.g. operator PATCH /issues/:id, POST .../interactions/:iid/cancel).
        // Attribute to the board instead of faking agent-run attribution — never
        // mint or reuse a foreign runId.
        credentialClass = "board";
      } else {
        throw localPolicyError(
          "RUN_CONTEXT_REQUIRED",
          `${method.toUpperCase()} ${path} requires the caller's live issue-scoped run context (own RUNNING heartbeat run bound to the issue). Board-authorized callers use the board credential path instead — never mint or reuse a foreign runId.`,
          "caller",
          "Start this operation from the assigned issue run (pass runId of your own running run), or execute under board authority where the route permits; do not invent a runId or retry under a different identity.",
        );
      }
    }

    // P0 parent-hierarchy guard (MCP layer only, no Core change): Paperclip
    // Core 2026.1012.0 does NOT validate parentId cycles, so every MCP write
    // that can change parentId is validated fail-closed BEFORE it reaches the
    // backend. The guard lives in the client choke point on purpose: it also
    // covers paperclipApiRequest / bulk updates / any future wrapper, so a
    // generic PATCH cannot bypass it. Scope: MCP gateway only - direct API
    // clients and the Paperclip UI are NOT covered (Core fix routed upstream).
    if (isWriteMethod(method)) {
      await this.assertParentHierarchyWriteAllowed(method, barePath, body);
      await this.applyWorkspaceIsolationGuard(method, barePath, body);
    }

    let apiKey: string;
    if (credentialClass === "board") {
      const boardKey = this.config.boardApiKey ?? scopedWikiBoardKey;
      if (!boardKey) {
        throw localPolicyError(
          "CONFIGURATION_MISSING",
          `${method.toUpperCase()} ${path} requires an explicitly configured Board credential`,
          "board",
          "Enroll or rotate the Board credential through the approved secret-management flow; do not retry with an agent key.",
        );
      }
      apiKey = boardKey;
    } else if (credentialClass === "agent") {
      const agentKey = this.config.agentApiKey ?? (this.config.agentId ? this.config.apiKey : null);
      if (!agentKey) {
        throw localPolicyError(
          "CONFIGURATION_MISSING",
          `${method.toUpperCase()} ${path} requires the caller's agent credential`,
          "Harness",
          "Provision the assigned agent's API key through the approved secret binding; do not use a Board key as fallback.",
        );
      }
      apiKey = agentKey;
    } else {
      apiKey = this.config.apiKey;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if ((options.includeRunId ?? isWriteMethod(method)) && runId) {
      headers["X-Paperclip-Run-Id"] = runId;
    }
    // KOMAA-630: operator session header. Explicit per-call operatorRunId wins,
    // then the session default. Sent on every request that carries it (reads
    // too: scope/audit), never gated on method.
    if (operatorRunId) {
      headers["X-Paperclip-Operator-Run-Id"] = operatorRunId;
    }

    const send = async (key: string): Promise<Response> => {
      headers.Authorization = `Bearer ${key}`;
      try {
        return await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (err) {
        // KOMAA-797 (MCP layer only): transport loss after a write — the write may
        // have committed server-side. Surface UNKNOWN_COMMIT_STATE, never a raw
        // TypeError that invites a blind retry (→ duplicates).
        if (isWriteMethod(method)) {
          throw new PaperclipApiError({
            status: 0,
            method: method.toUpperCase(),
            path,
            body: null,
            message:
              `${method.toUpperCase()} ${path} transport failed: ${err instanceof Error ? err.message : String(err)} ` +
              `[commitState=UNKNOWN_COMMIT_STATE; write may have committed — read-back by natural key before retrying, do NOT blind-retry]`,
          });
        }
        throw err;
      }
    };

    const response = await send(apiKey);
    const parsedBody = await parseResponseBody(response);

    if (!response.ok) {
      // 403 means "this credential is not enough for this route" (Core's
      // assertBoard). A denied request was not applied, so retrying it under
      // the Board credential is safe and is what makes every Board-capable
      // route reachable from the MCP. Issue-scoped writes are never promoted:
      // their credential decides who the audit records as the author.
      const retryBoardKey = this.config.boardApiKey ?? scopedWikiBoardKey;
      if (
        response.status === 403
        && credentialClass !== "board"
        && retryBoardKey
        && isPromotable(method, barePath)
      ) {
        const boardResponse = await send(retryBoardKey);
        const boardBody = await parseResponseBody(boardResponse);
        if (boardResponse.ok) {
          promotedBoardRoutes.add(shape);
          return boardBody as T;
        }
        throw new PaperclipApiError({
          status: boardResponse.status,
          method: method.toUpperCase(),
          path,
          body: boardBody,
          message:
            `${buildErrorMessage(method.toUpperCase(), path, boardResponse.status, boardBody)} ` +
            `[boardRetry=denied; callerCredential=403; route is not reachable with the configured Board credential]`,
        });
      }
      if (method.toUpperCase() === "GET" && response.status === 404 && REMOVED_GET_ROUTES.has(shape)) {
        removedGetRoutes.add(shape);
      }
      throw new PaperclipApiError({
        status: response.status,
        method: method.toUpperCase(),
        path,
        body: parsedBody,
        message: buildErrorMessage(method.toUpperCase(), path, response.status, parsedBody),
      });
    }

    return parsedBody as T;
  }

  /**
   * Fail-closed parent-hierarchy validation for every MCP write path that can
   * change `parentId`. Rejects self-parent, missing parent, cross-company
   * parent and any hierarchy cycle (A -> B -> C -> A) before the write is sent.
   */
  private async assertParentHierarchyWriteAllowed(
    method: string,
    barePath: string,
    body: Record<string, unknown> | null,
  ): Promise<void> {
    if (!body || !("parentId" in body)) return;
    const rawParent = body.parentId;
    if (rawParent === null || rawParent === undefined) return; // clearing is always safe
    if (typeof rawParent !== "string" || rawParent.trim() === "") return;
    const m = method.toUpperCase();
    if ((m === "PATCH" || m === "PUT") && /^\/issues\/[^/]+$/.test(barePath)) {
      const issueId = barePath.split("/")[2] as string;
      await validateParentHierarchy(this, { issueId, parentId: rawParent });
      return;
    }
    if (m === "POST" && /^\/companies\/[^/]+\/issues$/.test(barePath)) {
      await validateParentForCreate(this, {
        parentId: rawParent,
        companyId: this.config.companyId ?? null,
      });
      return;
    }
    // POST /issues/:id/children derives the parent from the path; a body
    // parentId is not part of that contract.
  }
  /**
   * KOMAA-468 workspace-isolation guard (MCP layer only, no Core change).
   *
   * Paperclip Core binds a child to the parent's execution workspace whenever
   * `parentId` is set and the caller passes no explicit workspace fields, so
   * every child of an isolated_workspace issue lands in the parent's worktree
   * on the parent's branch - two agents then write one tree. The guard amends
   * the create body with an explicit per-issue workspace preference, and
   * refuses a checkout into a cross-issue lease that a live run already holds.
   *
   * Scope: MCP gateway only - direct API clients and the Paperclip UI are NOT
   * covered (the Core fix is routed to the Core owner).
   */
  private async applyWorkspaceIsolationGuard(
    method: string,
    barePath: string,
    body: Record<string, unknown> | null,
  ): Promise<void> {
    if (!body) return;
    const m = method.toUpperCase();
    if (m === "POST" && /^\/companies\/[^/]+\/issues$/.test(barePath)) {
      const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
      if (!parentId) return;
      const decision = await evaluateChildWorkspaceIsolation(this, { parentId, body });
      if (decision.injected) {
        body.executionWorkspacePreference = decision.injected.executionWorkspacePreference;
        body.executionWorkspaceSettings = decision.injected.executionWorkspaceSettings;
      }
      return;
    }
    if (m === "POST" && /^\/issues\/[^/]+\/checkout$/.test(barePath)) {
      const issueId = barePath.split("/")[2] as string;
      await evaluateCheckoutWorkspaceIsolation(this, { issueId });
    }
  }


  /**
   * Read helper: only a missing resource (404) is absorbed. Denials (401/403)
   * and transport failures propagate - swallowing them turned "access denied"
   * into "no data" and made callers retry blind.
   */
  async getJsonOrNull<T>(path: string, options: JsonRequestOptions = {}): Promise<T | null> {
    try {
      return await this.requestJson<T>("GET", path, options);
    } catch (err) {
      if (err instanceof PaperclipApiError && err.status === 404) return null;
      throw err;
    }
  }
}
