import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const ISSUE = "44444444-4444-4444-8444-444444444444";

const pendingReview = {
  status: "pending",
  currentStageType: "review",
  currentStageId: "55555555-5555-4555-8555-555555555555",
};
const requestedChanges = {
  status: "changes_requested",
  currentStageType: "review",
};

function mockIssue(status: string, executionState: Record<string, unknown> | null = null) {
  return {
    id: ISSUE, identifier: "KOMAA-841", status, companyId: COMPANY,
    assigneeAgentId: AGENT, executionState, blockedBy: [],
    blockedByIssueIds: [], blockerAttention: { state: "needs_attention" },
  };
}

function runTool(
  toolName: string,
  issue: Record<string, unknown>,
  opts: { live?: unknown[]; liveAfter?: unknown[]; retryRouteExists?: boolean } = {},
) {
  const calls: Array<{ url: string; method: string }> = [];
  let liveReadCount = 0;
  const fetchMock = vi.fn().mockImplementation((urlArg: string, init?: RequestInit) => {
    const url = String(urlArg);
    const method = String(init?.method ?? "GET");
    calls.push({ url, method });
    const path = new URL(url).pathname;
    let body: unknown = {};
    let status = 200;
    if (path.endsWith("/execution-state") || (path.endsWith("/retry-eligibility") && opts.retryRouteExists !== true)) {
      status = 404;
      body = { error: "API route not found" };
    } else if (path.endsWith("/heartbeat-context")) body = { issue };
    else if (path.endsWith("/live-runs")) body = (++liveReadCount > 1 ? opts.liveAfter ?? opts.live : opts.live) ?? [];
    else if (path.endsWith("/diagnostics/blockers")) body = { blockers: [] };
    else if (path.endsWith("/diagnostics/wakes")) body = { events: [] };
    else if (path.endsWith("/active-run")) body = null;
    else if (path.endsWith("/runs")) body = [];
    else if (path.endsWith("/approvals")) body = [];
    else if (path.endsWith("/interactions")) body = [];
    else if (path.endsWith("/recovery-actions")) body = {};
    else if (path.includes("/documents")) body = [];
    else if (path.endsWith("/checkout") && method === "POST") body = { ...issue, status: "in_progress" };
    else if (path.endsWith("/retry-eligibility")) body = { retryEligible: false };
    else if (path.endsWith("/issues/" + ISSUE)) body = issue;
    else if (path.endsWith("/issues/" + ISSUE + "/relations")) body = [];
    else if (path.endsWith("/execution-hold")) body = null;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api", apiKey: "token", companyId: COMPANY,
    agentId: AGENT, agentApiKey: "agent-key", boardApiKey: "board-key",
  });
  const tool = createControlPlaneTools(client).find((item) => item.name === toolName);
  if (!tool) throw new Error("Unknown tool " + toolName);
  return { execute: (args: Record<string, unknown>) => tool.execute(args), calls };
}
function readResult(result: { content: Array<{ type: string; text: string }> }) {
  const raw = result.content.find((x) => x.type === "text")?.text ?? "";
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return { raw }; }
}

describe("KOMAA-841: execution truth and no fake progress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["in_progress", null, [], "INCONSISTENT", "false_progress_no_issue_run"],
    ["in_progress", pendingReview, [], "INCONSISTENT", "review_pending_status_drifted"],
    ["in_review", pendingReview, [], "WAITING_REVIEW", "assigneeAgentId"],
    ["in_progress", requestedChanges, [{ id: "r1", status: "running" }], "RUNNING", "running run"],
    ["blocked", null, [], "INCONSISTENT", "status=blocked"],
    ["todo", requestedChanges, [], "READY", ""],
  ] as const)("execution projection for %s stage=%j runs=%j is %s", async (status, stage, live, expected, reason) => {
    const { execute } = runTool("paperclipGetExecutionState", mockIssue(status, stage), { live: [...live] });
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(obj.state).toBe(expected);
    if (reason) expect(String(JSON.stringify(obj.reasons))).toContain(reason);
    if (expected === "INCONSISTENT") expect(obj.executable).toBe(false);
  });

  it.each([
    ["blocked", null, [], "status_blocked"],
    ["in_review", pendingReview, [], "review_pending"],
    ["in_progress", requestedChanges, [], "false_progress_no_issue_run"],
    ["in_progress", pendingReview, [], "review_stage_pending"],
  ] as const)("eligibility rejects %s without a proved run or valid review transition", async (status, stage, live, reason) => {
    const { execute } = runTool("paperclipGetExecutionEligibility", mockIssue(status, stage), { live: [...live] });
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(obj.executable).toBe(false);
    expect(obj.reasons).toContain(reason);
  });

  it("still permits original COO after independent changes_requested when status is todo", async () => {
    const { execute } = runTool("paperclipGetExecutionEligibility", mockIssue("todo", requestedChanges));
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(obj.executable).toBe(true);
  });

  it.each([false, true])("never demotes pending independent review via fresh wake (force=%s)", async (force) => {
    const { execute, calls } = runTool("paperclipWakeIssueFresh", mockIssue("in_review", pendingReview));
    const obj = readResult(await execute({ issueId: ISSUE, force }));
    expect(obj.woke).toBe(false);
    expect(obj.reason).toBe("review_pending_no_checkout");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("refuses re-checkout of stale in_progress with no run", async () => {
    const { execute, calls } = runTool("paperclipWakeIssueFresh", mockIssue("in_progress", requestedChanges));
    const obj = readResult(await execute({ issueId: ISSUE, expectedStatuses: ["in_progress"] }));
    expect(obj.reason).toBe("false_progress_requires_reconciliation");
    expect(calls.some((x) => x.url.endsWith("/checkout"))).toBe(false);
  });

  it("does not claim woke=true when checkout succeeds but scheduler created zero issue runs", async () => {
    const { execute, calls } = runTool("paperclipWakeIssueFresh", mockIssue("todo", requestedChanges));
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(calls.some((x) => x.url.endsWith("/checkout") && x.method === "POST")).toBe(true);
    expect(obj.checkoutAccepted).toBe(true);
    expect(obj.woke).toBe(false);
    expect(obj.verified).toBe(false);
    expect(obj.reason).toBe("checkout_without_confirmed_issue_run");
  });

  it("reports woke only when a queued/running issue run was observed on readback", async () => {
    const { execute } = runTool("paperclipWakeIssueFresh", mockIssue("todo", requestedChanges), {
      live: [],
      liveAfter: [{ id: "r1", status: "queued" }],
    });
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(obj.checkoutAccepted).toBe(true);
    expect(obj.woke).toBe(true);
    expect(obj.verified).toBe(true);
  });

  it.each(["in_review", "in_progress"] as const)("unblock composite refuses manually forged %s", async (setStatus) => {
    const { execute, calls } = runTool("paperclipUnblockAndWake", mockIssue("todo", requestedChanges));
    const obj = readResult(await execute({ issueId: ISSUE, setStatus }));
    expect(obj.reason).toBe("native_execution_transition_required");
    expect(calls.filter((x) => x.method === "PATCH")).toHaveLength(0);
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(0);
  });

  it("does not convert upstream retry-eligibility 404 into an unconditional retry", async () => {
    const { execute, calls } = runTool("paperclipRetryWithCausalGate", mockIssue("todo", requestedChanges));
    const obj = readResult(await execute({ issueId: ISSUE, force: true }));
    expect(obj.retried).toBe(false);
    expect(obj.circuitOpen).toBe(true);
    expect(obj.nativeRouteAbsent).toBe(true);
    expect(obj.retryReason).toBe("native_retry_eligibility_unavailable");
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(0);
  });

  it("unblock composite preserves native pending review even when explicitly asked for todo", async () => {
    const { execute, calls } = runTool("paperclipUnblockAndWake", mockIssue("in_review", pendingReview));
    const obj = readResult(await execute({ issueId: ISSUE, setStatus: "todo" }));
    expect(obj.reason).toBe("review_pending_no_manual_status_or_wake");
    expect(calls.filter((x) => x.method === "PATCH" || x.method === "POST")).toHaveLength(0);
  });

  it("fresh wake never mints another checkout when an issue already has a live run", async () => {
    const { execute, calls } = runTool("paperclipWakeIssueFresh", mockIssue("todo", requestedChanges), {
      live: [{ id: "r1", status: "running" }],
    });
    const obj = readResult(await execute({ issueId: ISSUE }));
    expect(obj.woke).toBe(false);
    expect(obj.reason).toBe("issue_already_has_live_run");
    expect(calls.some((x) => x.url.endsWith("/checkout"))).toBe(false);
  });

});
