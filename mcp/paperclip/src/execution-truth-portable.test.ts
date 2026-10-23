import { describe, expect, it } from "vitest";
import {
  allowNativeCheckout,
  confirmedIssueBoundRuns,
  hasFalseInProgress,
  isNativeReviewPending,
  nativeRetryRouteMissing,
} from "./execution-truth.js";

const pending = { status: "pending", currentStageType: "review", currentStageId: "review-1" };
const changes = { status: "changes_requested", currentStageType: "review" };

describe("KOMAA-841 portable fail-closed execution contract", () => {
  it.each([
    ["in_review", null, true],
    ["in_progress", pending, true],
    ["todo", pending, true],
    ["in_progress", changes, false],
    ["todo", null, false],
  ] as const)("detects native review pending for %s / %j", (status, execution, expected) => {
    expect(isNativeReviewPending(status, execution)).toBe(expected);
  });

  it("counts only real issue-bound queued/running run records", () => {
    const input = [
      { id: "a", status: "queued" },
      { id: "b", status: "running" },
      { id: "c", status: "failed" },
      { id: "d", status: "succeeded" },
      null,
      1,
      { status: "skipped" },
    ];
    expect(confirmedIssueBoundRuns(input).map((run) => run.id)).toEqual(["a", "b"]);
    expect(confirmedIssueBoundRuns(undefined)).toEqual([]);
    expect(confirmedIssueBoundRuns({ id: "a", status: "running" })).toEqual([]);
  });

  it.each([
    ["in_progress", [], true],
    ["in_progress", [{ status: "skipped" }], true],
    ["in_progress", [{ status: "running" }], false],
    ["in_progress", [{ status: "queued" }], false],
    ["todo", [], false],
  ] as const)("never infers execution from status alone (%s)", (status, runs, expected) => {
    expect(hasFalseInProgress(status, [...runs])).toBe(expected);
  });

  it.each([
    ["in_review", pending, [], false, "review_pending_no_checkout"],
    ["todo", pending, [], false, "review_pending_no_checkout"],
    ["in_progress", changes, [], false, "false_progress_requires_reconciliation"],
    ["blocked", null, [], false, "not_checkout_ready"],
    ["done", null, [], false, "not_checkout_ready"],
    ["todo", changes, [], true, null],
    ["todo", changes, [{ status: "queued" }], false, "issue_already_has_live_run"],
    ["backlog", null, [{ status: "running" }], false, "issue_already_has_live_run"],
    ["backlog", null, [], true, null],
  ] as const)("checks out only truly eligible work (%s)", (status, stage, runs, allowed, reason) => {
    expect(allowNativeCheckout(status, stage, [...runs])).toEqual({ allowed, reason });
  });

  it("does not treat a 403/409 or transport failure as the removed retry API", () => {
    expect(nativeRetryRouteMissing(new Error("GET /issues/X/retry-eligibility failed with 404: API route not found"))).toBe(true);
    expect(nativeRetryRouteMissing(new Error("UPSTREAM_NOT_FOUND"))).toBe(true);
    expect(nativeRetryRouteMissing(new Error("PERMISSION_DENIED HTTP 403"))).toBe(false);
    expect(nativeRetryRouteMissing(new Error("review pending HTTP 409"))).toBe(false);
    expect(nativeRetryRouteMissing(new Error("ETIMEDOUT"))).toBe(false);
  });
});
