// REST projections for GitHub check-runs and pull requests.
//
// The fine-grained credential bound to this runtime can read commit-scoped
// REST (`repos/:o/:r/commits/:sha/check-runs`) while `gh pr checks` /
// `gh pr view --json statusCheckRollup` fail with
// "Resource not accessible by personal access token" because statusCheckRollup
// needs the commit-status scope. These pure projections keep the same
// fail-closed contract: an unreadable or ambiguous payload is UNVERIFIED,
// never green.

export type CheckRunsState = "success" | "failure" | "pending" | "unverified";

export interface CheckRunSummary {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface CheckRunsEvaluation {
  state: CheckRunsState;
  total: number;
  checks: CheckRunSummary[];
  failures: string[];
  reason?: string;
}

const FAIL_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);
const PASS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export function evaluateCheckRunsPayload(raw: unknown): CheckRunsEvaluation {
  const unverified = (reason: string): CheckRunsEvaluation => ({
    state: "unverified",
    total: 0,
    checks: [],
    failures: [],
    reason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return unverified("check-runs payload is unreadable (not a JSON object)");
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.check_runs)) {
    return unverified("check-runs payload has no check_runs array");
  }
  const checks: CheckRunSummary[] = body.check_runs.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const run = entry as Record<string, unknown>;
    const name = typeof run.name === "string" ? run.name : "";
    if (!name) return [];
    return [{
      name,
      status: typeof run.status === "string" ? run.status : "",
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    }];
  });
  const total = typeof body.total_count === "number" && Number.isFinite(body.total_count)
    ? body.total_count
    : checks.length;
  if (total === 0 || checks.length === 0) {
    return unverified("GitHub reported no check runs for this commit");
  }
  const failures = checks
    .filter((run) => run.conclusion !== null && FAIL_CONCLUSIONS.has(run.conclusion))
    .map((run) => `✗ ${run.name} (${run.conclusion})`);
  if (failures.length > 0) return { state: "failure", total, checks, failures };
  const pending = checks.filter((run) => run.status !== "completed" || run.conclusion === null);
  if (pending.length > 0) return { state: "pending", total, checks, failures: [] };
  const inconclusive = checks.filter((run) => !PASS_CONCLUSIONS.has(run.conclusion ?? ""));
  if (inconclusive.length > 0) {
    return {
      state: "unverified",
      total,
      checks,
      failures: [],
      reason: "check runs completed without a conclusive pass/fail conclusion",
    };
  }
  return { state: "success", total, checks, failures: [] };
}

export function formatCheckRuns(evaluation: CheckRunsEvaluation): string {
  return evaluation.checks
    .map((run) => `${run.name}\t${run.status}\t${run.conclusion ?? "-"}`)
    .join("\n");
}

export interface PullReadiness {
  number: number | null;
  url: string | null;
  state: string;
  headRefOid: string;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
}

const MERGE_STATE_MAP: Record<string, string> = {
  clean: "CLEAN",
  unstable: "UNSTABLE",
  blocked: "BLOCKED",
  dirty: "DIRTY",
  behind: "BEHIND",
  has_hooks: "HAS_HOOKS",
  unknown: "UNKNOWN",
  draft: "DRAFT",
};

export function parseRestPull(pull: unknown): PullReadiness | null {
  if (!pull || typeof pull !== "object" || Array.isArray(pull)) return null;
  const body = pull as Record<string, unknown>;
  const head = body.head && typeof body.head === "object" ? (body.head as Record<string, unknown>) : {};
  const number = typeof body.number === "number" ? body.number : null;
  const stateRaw = typeof body.state === "string" ? body.state.toLowerCase() : "";
  const merged = body.merged === true;
  const mergeableRaw = typeof body.mergeable === "boolean" ? body.mergeable : null;
  const mergeableState = typeof body.mergeable_state === "string" ? body.mergeable_state.toLowerCase() : "unknown";
  return {
    number,
    url: typeof body.html_url === "string" ? body.html_url : null,
    state: merged ? "MERGED" : stateRaw ? stateRaw.toUpperCase() : "UNKNOWN",
    headRefOid: typeof head.sha === "string" ? head.sha : "",
    mergeable: mergeableRaw === true ? "MERGEABLE" : mergeableRaw === false ? "CONFLICTING" : "UNKNOWN",
    mergeStateStatus: MERGE_STATE_MAP[mergeableState] ?? "UNKNOWN",
    reviewDecision: "",
  };
}

export function deriveReviewDecision(reviews: unknown): string {
  if (!Array.isArray(reviews)) return "";
  const latest = new Map<string, { state: string; at: string }>();
  for (const entry of reviews) {
    if (!entry || typeof entry !== "object") continue;
    const review = entry as Record<string, unknown>;
    const user = review.user && typeof review.user === "object" ? (review.user as Record<string, unknown>) : {};
    const login = typeof user.login === "string" ? user.login : "";
    const state = typeof review.state === "string" ? review.state.toUpperCase() : "";
    if (!login || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) continue;
    const at = typeof review.submitted_at === "string" ? review.submitted_at : "";
    const prior = latest.get(login);
    if (!prior || at >= prior.at) latest.set(login, { state, at });
  }
  const states = [...latest.values()].map((entry) => entry.state);
  if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (states.includes("APPROVED")) return "APPROVED";
  return "";
}
