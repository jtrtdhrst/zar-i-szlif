// KOMAA-849 / KOMAA-1094 — review DECISION integrity (MCP layer only, no Paperclip Core change).
//
// Reproduced production incident (KOMAA-1094, 2026-10-20 20:04Z): the server
// applied the review status transition WITHOUT persisting a decision record.
// The issue became `done` while executionState still had
//   lastDecisionId=null, lastDecisionOutcome=null, completedStageIds=[]
// and the decision note was posted as an issue comment as if it were an
// approval -> false-positive terminal state and a broken audit chain.
//
// v3 contract (CTO CHANGES 2026-10-21, second round):
//   * the server exposes NO compare-and-set for issue updates (PATCH /issues/:id
//     carries no version/precondition field), so a compensating write can never
//     be made indivisible with its precondition: a decision or status another
//     actor commits between the guard read and the rollback would be
//     overwritten by the stale pre-decision status (the data-loss race).
//     The MCP therefore performs EXACTLY ONE write and NEVER compensates;
//   * the write is admitted only when the server itself persists the decision
//     (its participant path commits status + decision row in one transaction),
//     so the decision attempt is atomic by construction. When the server would
//     NOT persist a decision (stage missing from the persisted policy, or a
//     drifted status for a foreign writer) the MCP refuses BEFORE writing:
//     zero writes, typed error;
//   * the commit evidence is read from the WRITE RESPONSE (same transaction),
//     not from a later read that a lagging replica could serve stale - a stale
//     read could make the MCP roll back a REAL decision;
//   * a transition that landed without a persisted decision is reported as a
//     typed error with the exact state; the status the server applied is left
//     untouched and the missing decision is reported for the Core
//     terminal-enforcement repair path;
//   * a terminal issue whose stage was never decided is reported as
//     terminal_without_persisted_decision, never as a finished review;
//   * a review handoff invalidates a stale scheduled retry before arming the
//     new stage (it could otherwise demote the pending stage to blocked);
//   * concurrent / repeated decisions, missing comment and already-terminal
//     stages stay fail-closed with zero writes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const EXECUTOR = "33333333-3333-3333-3333-333333333333";
const REVIEWER = "77777777-7777-4777-8777-777777777777";
const RUN = "44444444-4444-4444-8444-444444444444";
const ISSUE = "55555555-5555-4555-8555-555555555555";
const STAGE = "aaaaaaa1-1111-4111-8111-111111111111";
const PARTICIPANT = "bbbbbbb1-1111-4111-8111-111111111111";
const RETRY_RUN = "99999999-9999-4999-8999-999999999999";

function makeClient(agentId: string = REVIEWER) {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId,
    runId: RUN,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Call = { method: string; path: string; body: unknown };
type Rule = { method: string; path: string; body?: unknown; bodies?: unknown[]; status?: number };

function textOf(res: ToolResult): string {
  return res.content[0]?.text ?? "";
}

function jsonOf(res: ToolResult): Record<string, unknown> {
  try {
    return JSON.parse(textOf(res)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mockApi(rules: Rule[]) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const fullPath = String(url).replace(/^http:\/\/[^/]+\/api/, "").split("?")[0];
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, path: fullPath, body });
    const rule = [...rules].reverse().find((r) => r.method === method && r.path === fullPath);
    let payload: unknown = rule ? rule.body : { error: `no mock for ${method} ${fullPath}` };
    const status = rule?.status ?? (rule ? 200 : 500);
    if (rule?.bodies) {
      const key = `${method} ${rule.path}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      payload = rule.bodies[Math.min(index, rule.bodies.length - 1)];
    }
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
  agentId: string = REVIEWER,
): Promise<{ text: string; isError: boolean }> {
  const tool = createToolDefinitions(makeClient(agentId)).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  try {
    const res = (await tool.execute(input)) as ToolResult;
    const text = textOf(res);
    return { text, isError: res.isError === true || text.includes("[errorCode=") };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

function pendingStage(extra: Record<string, unknown> = {}) {
  return {
    status: "pending",
    currentStageId: STAGE,
    currentStageIndex: 0,
    currentStageType: "review",
    currentParticipant: { type: "agent", agentId: REVIEWER, userId: null },
    returnAssignee: { type: "agent", agentId: EXECUTOR, userId: null },
    reviewRequest: null,
    completedStageIds: [],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 0,
    ...extra,
  };
}

function issue(extra: Record<string, unknown> = {}) {
  return {
    id: ISSUE,
    identifier: "KOMAA-1094",
    title: "decision integrity fixture",
    status: "in_review",
    companyId: COMPANY,
    parentId: null,
    assigneeAgentId: REVIEWER,
    assigneeUserId: null,
    reviewPolicy: "not_creator",
    executionPolicy: {
      mode: "normal",
      commentRequired: true,
      stages: [
        {
          id: STAGE,
          type: "review",
          approvalsNeeded: 1,
          participants: [{ id: PARTICIPANT, type: "agent", agentId: REVIEWER, userId: null }],
        },
      ],
    },
    executionState: pendingStage(),
    scheduledRetry: null,
    blockedBy: [],
    blocks: [],
    ancestors: [],
    ...extra,
  };
}

const PATCH_PATH = `/issues/${ISSUE}`;
const GET_PATH = `/issues/${ISSUE}`;

describe("KOMAA-1094 — the decision attempt is atomic, there is no compensating write", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("commits an approve from the write response without a second read", async () => {
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue() },
      {
        method: "PATCH",
        path: PATCH_PATH,
        body: issue({
          status: "done",
          executionState: pendingStage({
            status: "completed",
            lastDecisionId: "dec-1",
            lastDecisionOutcome: "approved",
            completedStageIds: [STAGE],
          }),
        }),
      },
    ]);
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED for the immutable candidate",
    });
    expect(out.isError).toBe(false);
    expect(out.text).toContain("committed");
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect((patches[0].body as Record<string, unknown>).status).toBe("done");
    // the commit evidence came from the write response: no readback GET
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("never rolls back when the server applied done without persisting a decision", async () => {
    // The server applied the status but persisted no decision (Core defect).
    // The MCP has no compare-and-set, so a rollback write could overwrite a
    // concurrent decision: it writes nothing and reports the exact state.
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue() },
      { method: "PATCH", path: PATCH_PATH, body: issue({ status: "done" }) },
    ]);
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED for the immutable candidate",
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_DECISION_NOT_RECORDED");
    expect(out.text).toContain("noDecisionCommitted=true");
    expect(out.text).toContain("partialStatusMutation=true");
    expect(out.text).toContain("compensatedTo=none");
    expect(out.text).toContain("rollbackNotAttempted=true");
    expect(out.text).toContain("compensationSkipped=not_attempted_no_server_compare_and_set");
    expect(out.text).toContain("terminalWithoutPersistedDecision=true");
    expect(out.text).toContain("evidenceSource=write_response");
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect((patches[0].body as Record<string, unknown>).status).toBe("done");
  });

  it("preserves a concurrent decision committed after the write and issues no rollback", async () => {
    // CTO CHANGES 2026-10-21 (second round): the concurrent transition commits
    // AFTER the failed decision write. The MCP must not write again - a
    // rollback would overwrite the newer decision with the stale pre-decision
    // status. Exactly one write, and the newer state is untouched.
    const calls: Call[] = [];
    let concurrentDecisionCommitted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const fullPath = String(url).replace(/^http:\/\/[^/]+\/api/, "").split("?")[0];
        let body: unknown;
        if (typeof init?.body === "string") {
          try {
            body = JSON.parse(init.body);
          } catch {
            body = init.body;
          }
        }
        calls.push({ method, path: fullPath, body });
        if (method === "PATCH") {
          // our write landed a status without a decision, and immediately
          // afterwards another actor committed a real decision
          concurrentDecisionCommitted = true;
          return Promise.resolve(
            new Response(JSON.stringify(issue({ status: "done" })), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(issue()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED for the immutable candidate",
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_DECISION_NOT_RECORDED");
    expect(out.text).toContain("rollbackNotAttempted=true");
    // the newer state was committed by another actor and must survive
    expect(concurrentDecisionCommitted).toBe(true);
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect((patches[0].body as Record<string, unknown>).status).toBe("done");
    expect(
      patches.some((p) => (p.body as Record<string, unknown>).status === "in_review"),
    ).toBe(false);
  });

  it("refuses to write when the pending stage is not in the persisted policy", async () => {
    // Without the stage in the policy the server applies the status without a
    // decision (the false-positive terminal of KOMAA-1094). Refuse first.
    const { calls } = mockApi([
      {
        method: "GET",
        path: GET_PATH,
        body: issue({ executionPolicy: { mode: "normal", commentRequired: true, stages: [] } }),
      },
    ]);
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED for the immutable candidate",
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_STAGE_NOT_IN_POLICY");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("refuses to write when the status drifted and the caller is not the reviewer", async () => {
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue({ status: "in_progress" }) },
    ]);
    const out = await callTool(
      "paperclipSubmitReviewDecision",
      {
        issueId: ISSUE,
        action: "approve",
        note: "APPROVED for the immutable candidate",
      },
      AGENT,
    );
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_STATUS_DRIFTED");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("lets the designated reviewer decide a drifted issue (checkout demotion must not block)", async () => {
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue({ status: "in_progress" }) },
      {
        method: "PATCH",
        path: PATCH_PATH,
        body: issue({
          status: "done",
          executionState: pendingStage({
            status: "completed",
            lastDecisionId: "dec-1",
            lastDecisionOutcome: "approved",
            completedStageIds: [STAGE],
          }),
        }),
      },
    ]);
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED for the immutable candidate",
    });
    expect(out.isError).toBe(false);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("refuses a decision without a decision comment and writes nothing", async () => {
    const { calls } = mockApi([{ method: "GET", path: GET_PATH, body: issue() }]);
    const out = await callTool("paperclipSubmitReviewDecision", { issueId: ISSUE, action: "approve" });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_DECISION_COMMENT_REQUIRED");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("refuses a second decision once the stage is already decided", async () => {
    const { calls } = mockApi([
      {
        method: "GET",
        path: GET_PATH,
        body: issue({
          status: "done",
          executionState: pendingStage({
            status: "completed",
            lastDecisionId: "dec-1",
            lastDecisionOutcome: "approved",
            completedStageIds: [STAGE],
          }),
        }),
      },
    ]);
    const out = await callTool("paperclipSubmitReviewDecision", {
      issueId: ISSUE,
      action: "approve",
      note: "APPROVED again",
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("REVIEW_STAGE_NOT_PENDING");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

describe("KOMAA-1094 — a terminal issue without a persisted decision is not a finished review", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports terminal_without_persisted_decision for a done issue with a pending stage", async () => {
    mockApi([
      { method: "GET", path: GET_PATH, body: issue({ status: "done" }) },
      { method: "GET", path: `/issues/${ISSUE}/approvals`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/work-products`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/live-runs`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/active-run`, body: null },
    ]);
    const out = await callTool("paperclipGetReviewState", { issueId: ISSUE });
    const json = JSON.parse(out.text) as Record<string, unknown>;
    const liveness = json.liveness as Record<string, unknown>;
    expect(liveness.state).toBe("terminal_without_persisted_decision");
    expect(json.terminalWithoutPersistedDecision).toBe(true);
    expect(json.wedged).toBe(false);
  });

  it("does not flag a legitimately decided terminal issue", async () => {
    mockApi([
      {
        method: "GET",
        path: GET_PATH,
        body: issue({
          status: "done",
          executionState: pendingStage({
            status: "completed",
            lastDecisionId: "dec-1",
            lastDecisionOutcome: "approved",
            completedStageIds: [STAGE],
          }),
        }),
      },
      { method: "GET", path: `/issues/${ISSUE}/approvals`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/work-products`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/live-runs`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/active-run`, body: null },
    ]);
    const out = await callTool("paperclipGetReviewState", { issueId: ISSUE });
    const json = JSON.parse(out.text) as Record<string, unknown>;
    const liveness = json.liveness as Record<string, unknown>;
    expect(liveness.state).not.toBe("terminal_without_persisted_decision");
    expect(json.terminalWithoutPersistedDecision).toBe(false);
  });
});

describe("KOMAA-1094 — a review handoff invalidates a stale scheduled retry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels the stale retry before arming the review stage", async () => {
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue({ status: "in_progress", scheduledRetry: { runId: RETRY_RUN } }) },
      { method: "POST", path: `/heartbeat-runs/${RETRY_RUN}/cancel`, body: { cancelled: true } },
      { method: "PATCH", path: PATCH_PATH, body: issue({ status: "in_review" }) },
    ]);
    const out = await callTool("paperclipRequestReview", { issueId: ISSUE, note: "please review" });
    expect(out.isError).toBe(false);
    const cancelIndex = calls.findIndex((c) => c.path === `/heartbeat-runs/${RETRY_RUN}/cancel`);
    const patchIndex = calls.findIndex((c) => c.method === "PATCH");
    expect(cancelIndex).toBeGreaterThanOrEqual(0);
    expect(cancelIndex).toBeLessThan(patchIndex);
    expect(JSON.parse(out.text).staleRetryInvalidated).toBe(true);
  });

  it("hands over unchanged when there is no scheduled retry", async () => {
    const { calls } = mockApi([
      { method: "GET", path: GET_PATH, body: issue({ status: "in_progress" }) },
      { method: "PATCH", path: PATCH_PATH, body: issue({ status: "in_review" }) },
    ]);
    const out = await callTool("paperclipRequestReview", { issueId: ISSUE, note: "please review" });
    expect(out.isError).toBe(false);
    expect(calls.filter((c) => c.path.startsWith("/heartbeat-runs/"))).toHaveLength(0);
    const patch = calls.find((c) => c.method === "PATCH");
    expect((patch?.body as Record<string, unknown>).status).toBe("in_review");
  });
});
