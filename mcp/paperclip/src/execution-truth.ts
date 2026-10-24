/**
 * Fail-closed Paperclip MCP execution evidence rules.
 *
 * Pure, dependency-free module, intentionally tested by GitHub CI even when
 * the pinned Paperclip Core packages are not available to the portable runner.
 * These rules report truth about observed execution; they DO NOT replace
 * atomic scheduler admission inside Paperclip Core.
 */
export function isNativeReviewPending(status: string, executionState: unknown): boolean {
  if (status === "in_review") return true;
  if (!executionState || typeof executionState !== "object" || Array.isArray(executionState)) return false;
  const state = executionState as Record<string, unknown>;
  return state.status === "pending" && state.currentStageType === "review";
}

export function confirmedIssueBoundRuns(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (run): run is Record<string, unknown> =>
      run !== null && typeof run === "object" && !Array.isArray(run) &&
      (run.status === "running" || run.status === "queued"),
  );
}

export function hasFalseInProgress(status: string, runs: unknown): boolean {
  return status === "in_progress" && confirmedIssueBoundRuns(runs).length === 0;
}

export function allowNativeCheckout(
  status: string,
  executionState: unknown,
  runs: unknown,
): { allowed: boolean; reason: string | null } {
  if (isNativeReviewPending(status, executionState)) return { allowed: false, reason: "review_pending_no_checkout" };
  if (hasFalseInProgress(status, runs)) return { allowed: false, reason: "false_progress_requires_reconciliation" };
  if (confirmedIssueBoundRuns(runs).length > 0) return { allowed: false, reason: "issue_already_has_live_run" };
  if (status !== "todo" && status !== "backlog") return { allowed: false, reason: "not_checkout_ready" };
  return { allowed: true, reason: null };
}

export function nativeRetryRouteMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(404|UPSTREAM_NOT_FOUND|API route not found)/i.test(message);
}

/** No executable saga driver exists beyond read-only eligibility/workspace. */
export function noDeliveryExecutorResult(executionId: string, issueId: string, steps: ReadonlyArray<Record<string, unknown>>) {
  return {
    status: "refused" as const,
    executionId,
    issueId,
    steps,
    errorCode: "delivery_executor_missing" as const,
    error: {
      code: "DELIVERY_EXECUTOR_MISSING" as const,
      category: "CONFIGURATION_MISSING" as const,
      retryable: false,
      retryRequiresChange: true,
      remediationOwner: "cto" as const,
      requiredAction: "Implement real issue-bound implement/test/git/deploy/verify/close phase drivers; use existing authorized tools with actual readback. No phases were executed.",
    },
    recoveryAction: "none" as const,
    possiblyCommitted: false,
    evidenceReference: "ledger:" + executionId,
  };
}
