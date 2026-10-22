import { randomUUID } from "node:crypto";
import { PaperclipApiError } from "./client.js";

type McpTextResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function formatTextResponse(value: unknown): McpTextResponse {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function isRunContextError(message: string): boolean {
  return /run.?context|cross_issue_influence_run_context_required|operator.?run|X-Paperclip-Run-Id|X-Paperclip-Operator-Run-Id|heartbeat run/i.test(message);
}

// P1-D unified error contract: every code maps to a stable category,
// a remediation owner, and a required action. Categories:
// AUTHENTICATION | AUTHORIZATION | POLICY_DENIED | CONFIGURATION_MISSING |
// PROVIDER_UNAVAILABLE | RUNTIME_UNAVAILABLE | NETWORK_ERROR | COMMAND_DENIED |
// CONCURRENCY_CONFLICT | IDEMPOTENCY_CONFLICT | INVALID_ARGUMENTS | NOT_FOUND |
// CAPABILITY_REMOVED | RATE_LIMITED | UPSTREAM_INTERNAL_ERROR | CANCELLED |
// BUILD_FAILED | TEST_FAILED | DEPLOY_FAILED | VERIFICATION_FAILED |
// TIMEOUT | UNKNOWN
// P0 2026-10-16 (MCP-003): 404 must never be CONCURRENCY_CONFLICT; missing
// resource is NOT_FOUND, removed capability is CAPABILITY_REMOVED, rate limit
// is RATE_LIMITED, 5xx is UPSTREAM_INTERNAL_ERROR — not UNKNOWN.
export function categoryForCode(code: string): string {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
    case "GITHUB_AUTH_MISSING":
      return "AUTHENTICATION";
    case "PERMISSION_DENIED":
    case "RUN_CONTEXT_REQUIRED":
    case "AUTH_FAILED":
      return "AUTHORIZATION";
    case "POLICY_DENIED":
    case "NOT_ALLOWLISTED":
    case "REFUSED":
      return "POLICY_DENIED";
    case "CONFIGURATION_MISSING":
      return "CONFIGURATION_MISSING";
    case "CAPABILITY_REMOVED":
      return "CAPABILITY_REMOVED";
    case "UPSTREAM_UNAVAILABLE":
      return "PROVIDER_UNAVAILABLE";
    case "RUNTIME_UNAVAILABLE":
      return "RUNTIME_UNAVAILABLE";
    case "TRANSPORT_DISCONNECTED":
      return "NETWORK_ERROR";
    case "COMMAND_DENIED":
      return "COMMAND_DENIED";
    case "ACTIVE_RUN_CONFLICT":
    case "ISSUE_STATE_CONFLICT":
    case "REVIEW_STATE_CONFLICT":
    case "DEPENDENCY_UNSATISFIED":
    case "VERSION_CONFLICT":
      return "CONCURRENCY_CONFLICT";
    case "NOT_FOUND":
    case "UPSTREAM_NOT_FOUND":
      return "NOT_FOUND";
    case "IDEMPOTENCY_CONFLICT":
      return "IDEMPOTENCY_CONFLICT";
    case "INVALID_ISSUE_DISPOSITION":
      return "POLICY_DENIED";
    case "INVALID_ARGUMENTS":
    case "PATH_DENIED":
    case "SECRET_DENIED":
      return "INVALID_ARGUMENTS";
    // P0 2026-10-20: fail-closed parent-hierarchy rejections are argument
    // rejections, not upstream failures.
    case "PARENT_SELF_REFERENCE":
    case "PARENT_NOT_FOUND":
    case "PARENT_CROSS_COMPANY":
    case "PARENT_CYCLE":
    case "PARENT_CHAIN_UNREADABLE":
    case "PARENT_CHAIN_TRUNCATED":
    case "TARGET_ISSUE_UNREADABLE":
      return "INVALID_ARGUMENTS";
    case "BUILD_FAILED":
      return "BUILD_FAILED";
    case "TEST_FAILED":
      return "TEST_FAILED";
    case "DEPLOY_FAILED":
      return "DEPLOY_FAILED";
    case "VERIFICATION_FAILED":
      return "VERIFICATION_FAILED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "UPSTREAM_INTERNAL_ERROR":
      return "UPSTREAM_INTERNAL_ERROR";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

export function remediationOwnerForCode(code: string, detailOwner?: unknown): string {
  if (typeof detailOwner === "string" && detailOwner.length > 0) {
    const up = detailOwner.toUpperCase();
    if (["CTO", "OWNER", "BOARD", "CALLER", "OPERATOR"].includes(up)) return up;
    return detailOwner;
  }
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
    case "GITHUB_AUTH_MISSING":
      return "CTO";
    case "PERMISSION_DENIED":
    case "RUN_CONTEXT_REQUIRED":
    case "AUTH_FAILED":
      return "caller";
    case "POLICY_DENIED":
    case "NOT_ALLOWLISTED":
    case "REFUSED":
    case "COMMAND_DENIED":
      return "owner";
    case "CONFIGURATION_MISSING":
    case "CAPABILITY_REMOVED":
      return "CTO";
    case "UPSTREAM_UNAVAILABLE":
    case "RUNTIME_UNAVAILABLE":
    case "TRANSPORT_DISCONNECTED":
      return "owner";
    case "IDEMPOTENCY_CONFLICT":
    case "INVALID_ISSUE_DISPOSITION":
    case "INVALID_ARGUMENTS":
    case "PATH_DENIED":
    case "SECRET_DENIED":
    case "PARENT_SELF_REFERENCE":
    case "PARENT_NOT_FOUND":
    case "PARENT_CROSS_COMPANY":
    case "PARENT_CYCLE":
    case "PARENT_CHAIN_UNREADABLE":
    case "PARENT_CHAIN_TRUNCATED":
    case "TARGET_ISSUE_UNREADABLE":
    case "NOT_FOUND":
    case "UPSTREAM_NOT_FOUND":
    case "VERSION_CONFLICT":
    case "CANCELLED":
      return "caller";
    case "ACTIVE_RUN_CONFLICT":
    case "ISSUE_STATE_CONFLICT":
    case "REVIEW_STATE_CONFLICT":
    case "DEPENDENCY_UNSATISFIED":
      return "operator";
    default:
      return "owner";
  }
}

export function requiredActionForCode(code: string): string {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return "Re-authenticate the MCP session (check PAPERCLIP_API_KEY / agent key)";
    case "GITHUB_AUTH_MISSING":
      return "Configure approved GitHub authentication (GitHub App installation or GH_TOKEN via CTO)";
    case "PERMISSION_DENIED":
      return "Use the sanctioned path for this actor; do not retry blindly or escalate to a Board key";
    case "RUN_CONTEXT_REQUIRED":
      return "Pass the runId of your current heartbeat run (legacy operatorRunId accepted as an alias; PAPERCLIP_RUN_ID applies automatically in agent sessions) — never mint or reuse run IDs";
    case "AUTH_FAILED":
      return "No live run context owned by the caller: pass the runId of your current heartbeat run (PAPERCLIP_RUN_ID applies automatically); do not retry terminal, expired, or foreign runs";
    case "POLICY_DENIED":
    case "NOT_ALLOWLISTED":
    case "REFUSED":
      return "Request a CTO-owned policy pin for this target; do not bypass the supervisor";
    case "COMMAND_DENIED":
      return "Use an allowlisted binary/subcommand from the tool description; denied subcommands never execute";
    case "CONFIGURATION_MISSING":
      return "Provision the missing configuration (staging DB, canary target, GitHub App) via its owner";
    case "CAPABILITY_REMOVED":
      return "Do not retry: removed upstream in Paperclip 2026.1012.0. Use runId-based tools (live run context) where supported; restoring operator sessions is a CTO-owned upstream decision";
    case "IDEMPOTENCY_CONFLICT":
      return "Retry with a fresh requestId; the original payload/ledger outcome is preserved";
    case "INVALID_ISSUE_DISPOSITION":
      return "The review-admission guard rejected this transition: create a real review path on the issue (pending issue-thread interaction, linked pending approval, human reviewer via assigneeUserId, typed executionState.currentParticipant through an execution policy, or a scheduled issue monitor), then retry the same status update";
    case "INVALID_ARGUMENTS":
    case "PATH_DENIED":
      return "Fix arguments per the tool input schema and retry once";
    case "PARENT_SELF_REFERENCE":
    case "PARENT_CYCLE":
    case "PARENT_CROSS_COMPANY":
    case "PARENT_NOT_FOUND":
    case "PARENT_CHAIN_UNREADABLE":
    case "PARENT_CHAIN_TRUNCATED":
    case "TARGET_ISSUE_UNREADABLE":
      return "The requested parent relationship is invalid or unverifiable. Pick a parent outside the issue's own descendant chain (or clear parentId) and retry once. The MCP guard protects MCP traffic only - a global fix needs the Paperclip Core owner.";
    case "NOT_FOUND":
    case "UPSTREAM_NOT_FOUND":
      return "Verify the referenced resource identifier (list or search first) and retry only with a corrected reference; 404 is not a concurrency conflict — never blind-retry";
    case "VERSION_CONFLICT":
      return "Re-read the resource for the current version/hash, then retry once with the fresh reference (optimistic concurrency); nothing was committed";
    case "CANCELLED":
      return "Operation was cancelled; re-issue only if still required, after a read-back";
    case "SECRET_DENIED":
      return "Remove secret material from the payload; secrets never enter the repo or logs";
    case "TIMEOUT":
      return "Outcome uncertain: read-back by natural key before retrying; never blind-retry a write";
    case "TRANSPORT_DISCONNECTED":
      return "Reconnect the MCP session and read-back by natural key before retrying a write";
    case "UPSTREAM_UNAVAILABLE":
      return "Upstream temporarily unavailable: retry reads once; read-back writes before retrying";
    default:
      return "See error detail; retry reads once, never blind-retry writes without read-back";
  }
}

function safeHintFor(code: string, status: number): string {
  const action = requiredActionForCode(code);
  if (code === "RUN_CONTEXT_REQUIRED") return `${action}. Do not invent IDs or reuse another actor's run.`;
  if (code === "PERMISSION_DENIED") return `${action}.`;
  if (code === "INVALID_ISSUE_DISPOSITION") {
    return "Not an argument error: the review-admission guard denied the transition. Create one of the listed review paths, then retry the same status update.";
  }
  if (code === "UPSTREAM_NOT_FOUND" || code === "NOT_FOUND") {
    return "Entity not found: verify the ID/identifier and retry only with a corrected reference.";
  }
  return action;
}

// Extract [errorCode=xxx] embedded by MCP-layer err() helpers (BUG-08 fix:
// a denied subcommand must surface COMMAND_DENIED, never UPSTREAM_INTERNAL_ERROR).
export function extractEmbeddedCode(message: string): string | null {
  const m = /\[errorCode=([A-Za-z_]+)\]/.exec(message);
  return m ? m[1] : null;
}

function normalizeEmbeddedCode(raw: string): string {
  const up = raw.toUpperCase();
  const alias: Record<string, string> = {
    AUTH_FAILED: "AUTH_FAILED",
    COMMAND_DENIED: "COMMAND_DENIED",
    NOT_ALLOWLISTED: "POLICY_DENIED",
    REFUSED: "POLICY_DENIED",
    POLICY_DENIED: "POLICY_DENIED",
    INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
    PATH_DENIED: "PATH_DENIED",
    SECRET_DENIED: "SECRET_DENIED",
    NOT_FOUND: "NOT_FOUND",
    UPSTREAM_NOT_FOUND: "NOT_FOUND",
    VERSION_CONFLICT: "VERSION_CONFLICT",
    ISSUE_STATE_CONFLICT: "ISSUE_STATE_CONFLICT",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    IDEMPOTENCY_PROBE: "IDEMPOTENCY_CONFLICT",
    PERMISSION_DENIED: "PERMISSION_DENIED",
    CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
    GITHUB_AUTH_MISSING: "GITHUB_AUTH_MISSING",
    TIMEOUT: "TIMEOUT",
    BUILD_FAILED: "BUILD_FAILED",
    TEST_FAILED: "TEST_FAILED",
    DEPLOY_FAILED: "DEPLOY_FAILED",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
    INTERNAL: "UPSTREAM_INTERNAL_ERROR",
  };
  return alias[up] ?? up;
}

function embeddedDetail(error: unknown): Record<string, unknown> | null {
  if (error instanceof Error) {
    const d = (error as unknown as Record<string, unknown>).detail;
    if (d && typeof d === "object") return d as Record<string, unknown>;
  }
  return null;
}

// KOMAA-1034: read the upstream typed error code from the response body so
// a server-side fail-closed guard keeps its own identity in the envelope.
function upstreamBodyCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

// P0 error-contract normalization (MCP layer only, no upstream change):
// stable code + category + retryable + retryRequiresChange + correlationId +
// safeHint + remediationOwner + requiredAction + possiblyCommitted,
// upstream status/method/path/body preserved verbatim.
export function formatErrorResponse(error: unknown): McpTextResponse {
  const correlationId = randomUUID();
  if (error instanceof PaperclipApiError) {
    const status = error.status;
    const method = error.method.toUpperCase();
    const msg = error.message;
    const write = isWriteMethod(method);
    let code = "UPSTREAM_INTERNAL_ERROR";
    let retryable = false;
    let retryRequiresChange = false;
    // Upstream fail-closed review-admission guard (server routes/issues.ts,
    // code invalid_issue_disposition). It is a policy rejection with a
    // machine-readable validReviewPaths list, not an argument error.
    const isDispositionGuard =
      status === 422 && upstreamBodyCode(error.body) === "invalid_issue_disposition";
    // ask_user_questions has no accept/reject path: retrying with fixed args
    // can never succeed — the only sanctioned closer is cancel. Match the
    // server's real wording ("Interactions of kind <kind> cannot be
    // accepted/rejected") so a message that only *mentions* ask_user_questions
    // (e.g. the disposition guard remediation list) never inherits this hint.
    const askUserCancel = !isDispositionGuard && (status === 400 || status === 422) &&
      /kind\s+[a-z_]+\s+cannot be (accepted|rejected)/i.test(msg);
    if (status === 0) {
      code = "TRANSPORT_DISCONNECTED";
      retryable = !write;
    } else if (status === 400 || status === 422) {
      code = isDispositionGuard ? "INVALID_ISSUE_DISPOSITION" : "INVALID_ARGUMENTS";
      retryRequiresChange = true;
    } else if (status === 401) {
      code = "AUTHENTICATION_REQUIRED";
      retryRequiresChange = true;
    } else if (status === 403) {
      code = isRunContextError(msg) ? "RUN_CONTEXT_REQUIRED" : "PERMISSION_DENIED";
      retryRequiresChange = true;
    } else if (status === 404) {
      code = "UPSTREAM_NOT_FOUND";
      retryRequiresChange = true;
    } else if (status === 409) {
      code = /review|approval/i.test(msg)
        ? "REVIEW_STATE_CONFLICT"
        : /live.?run|checkout|active.?run|already/i.test(msg)
          ? "ACTIVE_RUN_CONFLICT"
          : /depend|dag|blocker/i.test(msg)
            ? "DEPENDENCY_UNSATISFIED"
            : "ISSUE_STATE_CONFLICT";
      retryable = true;
      retryRequiresChange = true;
    } else if (status === 429) {
      code = "RATE_LIMITED";
      retryable = !write;
      retryRequiresChange = false;
    } else if (status === 408 || status === 504) {
      code = "TIMEOUT";
      retryable = !write;
      retryRequiresChange = false;
    } else if (status === 502 || status === 503) {
      code = "UPSTREAM_UNAVAILABLE";
      retryable = !write;
      retryRequiresChange = false;
    } else if (status >= 500) {
      code = "UPSTREAM_INTERNAL_ERROR";
      retryable = !write;
      retryRequiresChange = false;
    }
    // Write + ambiguous outcome (transport/429/5xx/timeout): commit unknown.
    const possiblyCommitted = write && (status === 0 || [429, 500, 502, 503, 504, 408].includes(status));
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              code,
              category: categoryForCode(code),
              error: msg,
              status,
              method,
              path: error.path,
              body: error.body,
              retryable,
              retryRequiresChange,
              remediationOwner: remediationOwnerForCode(code),
              requiredAction: askUserCancel
                ? "This interaction kind (ask_user_questions) has no accept/reject path — close it with paperclipCancelIssueInteraction; do not retry accept/reject"
                : requiredActionForCode(code),
              correlationId,
              safeHint: askUserCancel
                ? "Not an argument error: accept/reject can never succeed here. Use paperclipCancelIssueInteraction."
                : safeHintFor(code, status),
              possiblyCommitted,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const detail = embeddedDetail(error);
  const embedded = extractEmbeddedCode(message);
  if (embedded) {
    const code = normalizeEmbeddedCode(embedded);
    const category = categoryForCode(code);
    const retryRequiresChange = !["UPSTREAM_INTERNAL_ERROR", "TIMEOUT", "TRANSPORT_DISCONNECTED", "UPSTREAM_UNAVAILABLE"].includes(code);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              code,
              category,
              error: message,
              retryable: false,
              retryRequiresChange,
              remediationOwner: remediationOwnerForCode(code, detail?.remediationOwner),
              requiredAction: typeof detail?.remediation === "string" ? detail.remediation : requiredActionForCode(code),
              correlationId,
              safeHint: safeHintFor(code, 0),
              possiblyCommitted: false,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const looksUrlParse = error instanceof TypeError && /parse url|invalid url/i.test(message);
  const looksTraversal = /path traversal|escapes the (workspace|wiki|root)|outside the workspace root|must look like "wiki\//i.test(message);
  const looksValidation = /invalid (arguments|input|option)|expected |requir|zod/i.test(message);
  const code = looksUrlParse
    ? "INVALID_ARGUMENTS"
    : looksTraversal
      ? "PATH_DENIED"
      : looksValidation
        ? "INVALID_ARGUMENTS"
        : "UPSTREAM_INTERNAL_ERROR";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            code,
            category: categoryForCode(code),
            error: message,
            retryable: false,
            retryRequiresChange: looksValidation || looksTraversal || looksUrlParse,
            remediationOwner: remediationOwnerForCode(code),
            requiredAction: requiredActionForCode(code),
            correlationId,
            safeHint: safeHintFor(code, 0),
            possiblyCommitted: false,
          },
          null,
          2,
        ),
      },
    ],
  };
}
