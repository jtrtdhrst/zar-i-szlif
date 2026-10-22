// P0 2026-10-16 (MCP-003/MCP-004) regression: shared error taxonomy must map
// HTTP/MCP failures to stable, non-colliding categories, and remediation text
// must never point at capability removed upstream (operator-runs endpoint).
// Covers mandate cases MCP-REG-004/005/006/007/008/009/010/033/034.
import { describe, expect, it } from "vitest";
import { PaperclipApiError } from "./client.js";
import { categoryForCode, formatErrorResponse, requiredActionForCode } from "./format.js";

function envelope(error: unknown): Record<string, unknown> {
  const res = formatErrorResponse(error);
  const text = res.content[0]!.text as string;
  return JSON.parse(text) as Record<string, unknown>;
}

function apiError(status: number, method: string, message: string, body: unknown = { error: message }): PaperclipApiError {
  return new PaperclipApiError({
    status,
    method,
    path: "/x",
    body,
    message: `${method} /x failed with ${status}: ${message}`,
  });
}

describe("MCP-REG-004/005: missing resource is NOT_FOUND, never CONCURRENCY_CONFLICT", () => {
  it("MCP-REG-005: 404 getter response maps to NOT_FOUND category", () => {
    const out = envelope(apiError(404, "GET", "Issue not found"));
    expect(out.code).toBe("UPSTREAM_NOT_FOUND");
    expect(out.category).toBe("NOT_FOUND");
    expect(out.category).not.toBe("CONCURRENCY_CONFLICT");
    expect(out.remediationOwner).toBe("caller");
    expect(out.retryable).toBe(false);
    expect(out.retryRequiresChange).toBe(true);
    expect(String(out.requiredAction)).not.toMatch(/paperclipStartOperatorRun/);
  });

  it("MCP-REG-004: every getter family hits the same shared classifier", () => {
    for (const msg of ["Issue not found", "Agent not found", "Skill not found", "Routine not found", "Project not found", "Workspace not found", "Run not found"]) {
      expect(envelope(apiError(404, "GET", msg)).category).toBe("NOT_FOUND");
    }
  });

  it("categoryForCode keeps distinct terminal categories", () => {
    expect(categoryForCode("NOT_FOUND")).toBe("NOT_FOUND");
    expect(categoryForCode("UPSTREAM_NOT_FOUND")).toBe("NOT_FOUND");
    expect(categoryForCode("CAPABILITY_REMOVED")).toBe("CAPABILITY_REMOVED");
    expect(categoryForCode("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(categoryForCode("UPSTREAM_INTERNAL_ERROR")).toBe("UPSTREAM_INTERNAL_ERROR");
    expect(categoryForCode("CANCELLED")).toBe("CANCELLED");
    expect(categoryForCode("CONFIGURATION_MISSING")).toBe("CONFIGURATION_MISSING");
    expect(categoryForCode("VERSION_CONFLICT")).toBe("CONCURRENCY_CONFLICT");
  });
});

describe("MCP-REG-006/007: non-HTTP failures classified from their source", () => {
  it("MCP-REG-006: wiki missing page embed classifies NOT_FOUND (not unknown)", () => {
    const out = envelope(new Error("No such wiki page: wiki/x.md [errorCode=NOT_FOUND]"));
    expect(out.code).toBe("NOT_FOUND");
    expect(out.category).toBe("NOT_FOUND");
    expect(out.remediationOwner).toBe("caller");
  });

  it("MCP-REG-007: invalid URL rejected as INVALID_ARGUMENTS", () => {
    const out = envelope(new TypeError("Failed to parse URL from http:// ::bad::"));
    expect(out.code).toBe("INVALID_ARGUMENTS");
    expect(out.category).toBe("INVALID_ARGUMENTS");
  });

  it("MCP-REG-008: traversal classified PATH_DENIED", () => {
    const out = envelope(new Error("path traversal detected in wiki path"));
    expect(out.code).toBe("PATH_DENIED");
    expect(out.category).toBe("INVALID_ARGUMENTS");
    expect(out.retryRequiresChange).toBe(true);
  });

  it("wiki stale hash conflict is VERSION_CONFLICT (concurrency), not unknown", () => {
    const out = envelope(new Error("Wiki conflict: expectedHash abc != current def; re-read the page and retry. Nothing was written. [errorCode=VERSION_CONFLICT]"));
    expect(out.code).toBe("VERSION_CONFLICT");
    expect(out.category).toBe("CONCURRENCY_CONFLICT");
    expect(out.possiblyCommitted).toBe(false);
    expect(String(out.requiredAction)).toMatch(/[Rr]e-read/);
  });
});

describe("MCP-REG-009/010/034: removed capability never produces impossible remediation", () => {
  it("MCP-REG-009/010: CAPABILITY_REMOVED classified and owned by CTO", () => {
    const out = envelope(new Error("mutating host op requires an operator session; removed in Paperclip 2026.1012.0 [errorCode=CAPABILITY_REMOVED]"));
    expect(out.code).toBe("CAPABILITY_REMOVED");
    expect(out.category).toBe("CAPABILITY_REMOVED");
    expect(out.remediationOwner).toBe("CTO");
    expect(out.retryable).toBe(false);
  });

  it("MCP-REG-034: no terminal code advises calling the removed operator-runs tool", () => {
    const codes = [
      "CAPABILITY_REMOVED", "RUN_CONTEXT_REQUIRED", "AUTH_FAILED", "NOT_FOUND", "UPSTREAM_NOT_FOUND",
      "PERMISSION_DENIED", "CONFIGURATION_MISSING", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "CANCELLED",
    ];
    for (const code of codes) {
      expect(requiredActionForCode(code), code).not.toMatch(/paperclipStartOperatorRun/);
    }
    expect(requiredActionForCode("CAPABILITY_REMOVED")).toMatch(/CTO/);
  });
});

describe("MCP-REG-033: protocol errors stay structured with stable envelope", () => {
  it("401/403/429/504/502/500 map to their own categories", () => {
    expect(envelope(apiError(401, "GET", "unauthorized")).code).toBe("AUTHENTICATION_REQUIRED");
    expect(envelope(apiError(403, "GET", "Board access required")).category).toBe("AUTHORIZATION");
    expect(envelope(apiError(429, "GET", "slow down")).code).toBe("RATE_LIMITED");
    expect(envelope(apiError(429, "GET", "slow down")).category).toBe("RATE_LIMITED");
    expect(envelope(apiError(504, "GET", "gateway timeout")).category).toBe("TIMEOUT");
    expect(envelope(apiError(502, "GET", "bad gateway")).category).toBe("PROVIDER_UNAVAILABLE");
    expect(envelope(apiError(500, "GET", "boom")).category).toBe("UPSTREAM_INTERNAL_ERROR");
  });

  it("envelope always carries correlationId and safe flags", () => {
    const out = envelope(apiError(404, "GET", "Issue not found"));
    expect(typeof out.correlationId).toBe("string");
    expect(out.possiblyCommitted).toBe(false);
    expect(typeof out.safeHint).toBe("string");
    expect(JSON.stringify(out)).not.toMatch(/Bearer |authorization: /i);
  });

  it("409 write keeps concurrency classification and commit-unknown flag", () => {
    const out = envelope(apiError(409, "POST", "live run already active"));
    expect(out.category).toBe("CONCURRENCY_CONFLICT");
    expect(out.code).toBe("ACTIVE_RUN_CONFLICT");
  });
});

describe("KOMAA-1034: upstream 422 disposition guard is a policy rejection, not a schema failure", () => {
  const dispositionMessage =
    "invalid_issue_disposition: Agent-authored updates that move an issue to in_review must include a real review path. " +
    "This request would leave the issue in_review without anyone or anything owning the next action. " +
    "Keep working instead of moving to review, create a request_confirmation or ask_user_questions interaction, " +
    "link or request a pending approval, assign a human reviewer with assigneeUserId, set a typed executionState.currentParticipant through an execution policy, " +
    "or schedule an issue monitor for an external review/check. After creating one of those review paths, retry the status update.";
  const dispositionBody = {
    error: dispositionMessage,
    code: "invalid_issue_disposition",
    details: {
      code: "invalid_issue_disposition",
      missing: "review_path",
      validReviewPaths: [
        "pending_issue_thread_interaction",
        "linked_pending_approval",
        "human_assignee_user_id",
        "typed_execution_state_current_participant",
        "scheduled_issue_monitor",
      ],
    },
  };

  it("classifies the typed disposition guard as its own code, never INVALID_ARGUMENTS", () => {
    const out = envelope(apiError(422, "PATCH", dispositionMessage, dispositionBody));
    expect(out.code).toBe("INVALID_ISSUE_DISPOSITION");
    expect(out.code).not.toBe("INVALID_ARGUMENTS");
    expect(out.category).toBe("POLICY_DENIED");
    expect(out.remediationOwner).toBe("caller");
    expect(out.retryRequiresChange).toBe(true);
    expect(out.possiblyCommitted).toBe(false);
  });

  it("never hands the caller the ask_user_questions cancel hint for a disposition guard", () => {
    const out = envelope(apiError(422, "PATCH", dispositionMessage, dispositionBody));
    expect(String(out.requiredAction)).not.toMatch(/CancelIssueInteraction/);
    expect(String(out.safeHint)).not.toMatch(/CancelIssueInteraction/);
    expect(String(out.requiredAction)).toMatch(/review path/i);
    expect(String(out.safeHint)).toMatch(/review path/i);
  });

  it("keeps the cancel hint for the genuine interaction accept/reject rejection", () => {
    const out = envelope(apiError(422, "POST", "Interactions of kind ask_user_questions cannot be accepted"));
    expect(String(out.requiredAction)).toMatch(/CancelIssueInteraction/);
  });
});
