// KOMAA-849 — review/execution lifecycle integrity (MCP layer only, no Paperclip Core change).
//
// Executable regression for the reproduced production incident:
//   * a semantically identical execution-policy write must have NO side effect
//     (no status change, no stage/participant id churn, no reviewer wake);
//   * the persisted stage and participant ids must be stable across a rewrite;
//   * the ACTIVE reviewer must be able to submit a first-class decision through
//     the native issue transition (the old implementation always used the
//     board-only stalled-review endpoint, which 409s for a live review);
//   * review liveness must not report a live-but-demoted review as "not_in_review".
//
// RED on the pre-fix implementation, GREEN on the patched candidate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";
import { createToolDefinitions } from "./tools.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const REVIEWER = "77777777-7777-4777-8777-777777777777";
const RUN = "33333333-3333-3333-3333-333333333333";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const STAGE = "aaaaaaa1-1111-4111-8111-111111111111";
const STAGE_2 = "aaaaaaa2-2222-4222-8222-222222222222";
const PARTICIPANT = "bbbbbbb1-1111-4111-8111-111111111111";
const PARTICIPANT_2 = "bbbbbbb2-2222-4222-8222-222222222222";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: AGENT,
    runId: RUN,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

function getTool(name: string) {
  const tool = createToolDefinitions(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return {
    ...tool,
    execute: async (input: Record<string, unknown>): Promise<ToolResult> =>
      (await tool.execute(input)) as ToolResult,
  };
}

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

type Call = { method: string; path: string; body: unknown };
type Rule = { method: string; path: string; body?: unknown; bodies?: unknown[]; status?: number };

/** Route fetch by (method, path); the LAST matching rule wins, `bodies` replays in order. */
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
    let status = rule?.status ?? (rule ? 200 : 500);
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

function issueWithPolicy(extra: Record<string, unknown> = {}) {
  return {
    id: ISSUE,
    identifier: "KOMAA-1001",
    title: "review fixture",
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
    executionState: {
      status: "pending",
      currentStageId: STAGE,
      currentStageIndex: 0,
      currentStageType: "review",
      currentParticipant: { type: "agent", agentId: REVIEWER, userId: null },
      returnAssignee: { type: "agent", agentId: AGENT, userId: null },
      reviewRequest: null,
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
      changesRequestedCount: 0,
    },
    blockedBy: [],
    blocks: [],
    ancestors: [],
    ...extra,
  };
}

describe("KOMAA-849 — execution policy write has no side effect when nothing changes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends no PATCH when set_comment_required repeats the committed value", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: ISSUE,
      operation: "set_comment_required",
      commentRequired: true,
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(false);
    expect(out.noOp).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("sends no PATCH when set_review_policy repeats the committed policy", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: ISSUE,
      operation: "set_review_policy",
      reviewPolicy: "not_creator",
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(false);
    expect(out.noOp).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("sends no PATCH when replace_stages repeats the committed stages", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: ISSUE,
      operation: "replace_stages",
      stages: [
        {
          id: STAGE,
          type: "review",
          approvalsNeeded: 1,
          participants: [{ type: "agent", agentId: REVIEWER }],
        },
      ],
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(false);
    expect(out.noOp).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the participant id in the written policy", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: ISSUE,
      operation: "set_mode",
      mode: "auto",
    });
    const patch = calls.find((c) => c.method === "PATCH");
    const policy = (patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>;
    const stages = policy.stages as Array<Record<string, unknown>>;
    expect(stages[0]?.id).toBe(STAGE);
    const participants = stages[0]?.participants as Array<Record<string, unknown>>;
    expect(participants[0]?.id).toBe(PARTICIPANT);
  });

  it("re-attaches the stored ids when the caller re-serializes the stages without ids", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: ISSUE,
      operation: "replace_stages",
      stages: [
        {
          type: "review",
          approvalsNeeded: 1,
          participants: [{ type: "agent", agentId: REVIEWER }],
        },
        {
          id: STAGE_2,
          type: "approval",
          approvalsNeeded: 1,
          participants: [{ id: PARTICIPANT_2, type: "agent", agentId: AGENT }],
        },
      ],
    });
    const patch = calls.find((c) => c.method === "PATCH");
    const policy = (patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>;
    const stages = policy.stages as Array<Record<string, unknown>>;
    // The untouched stage keeps its stored id and participant id.
    expect(stages[0]?.id).toBe(STAGE);
    expect((stages[0]?.participants as Array<Record<string, unknown>>)[0]?.id).toBe(PARTICIPANT);
    // The new stage keeps the id the caller supplied.
    expect(stages[1]?.id).toBe(STAGE_2);
  });

  it("sends no PATCH when the monitor is cleared although none is scheduled", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    const res = await getTool("paperclipManageIssueMonitor").execute({ issueId: ISSUE, operation: "clear" });
    const out = jsonOf(res);
    expect(out.committed).toBe(false);
    expect(out.noOp).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

describe("KOMAA-849 — the active reviewer has a working first-class decision path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("approves through the native issue transition, not the board-only stalled endpoint", async () => {
    const committedState = {
      status: "done",
      executionState: {
        status: "completed",
        currentStageId: null,
        currentStageIndex: null,
        currentStageType: null,
        currentParticipant: null,
        returnAssignee: { type: "agent", agentId: AGENT, userId: null },
        reviewRequest: null,
        completedStageIds: [STAGE],
        lastDecisionId: "dddddddd-1111-4111-8111-111111111111",
        lastDecisionOutcome: "approved",
        changesRequestedCount: 0,
      },
    };
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, bodies: [issueWithPolicy(), issueWithPolicy(committedState)] },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy(committedState) },
    ]);
    const res = await getTool("paperclipSubmitReviewDecision").execute({
      issueId: ISSUE,
      action: "approve",
      note: "kind: review\ndecision: approved\nReviewed the candidate.",
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(true);
    expect(out.mode).toBe("active_stage_transition");
    expect(calls.filter((c) => c.path.endsWith("/stalled-review-decision"))).toHaveLength(0);
    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as Record<string, unknown>;
    expect(body.status).toBe("done");
    expect(String(body.comment)).toContain("decision: approved");
  });

  it("requests changes through the native issue transition and returns the task to the executor", async () => {
    const committedState = {
      status: "in_progress",
      assigneeAgentId: AGENT,
      executionState: {
        status: "changes_requested",
        currentStageId: STAGE,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: REVIEWER, userId: null },
        returnAssignee: { type: "agent", agentId: AGENT, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: "cccccccc-1111-4111-8111-111111111111",
        lastDecisionOutcome: "changes_requested",
        changesRequestedCount: 1,
      },
    };
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, bodies: [issueWithPolicy(), issueWithPolicy(committedState)] },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy(committedState) },
    ]);
    const res = await getTool("paperclipSubmitReviewDecision").execute({
      issueId: ISSUE,
      action: "request_changes",
      note: "The candidate SHA does not match the reviewable head.",
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    const body = patch?.body as Record<string, unknown>;
    expect(body.status).toBe("in_progress");
    expect(String(body.comment)).toContain("does not match");
  });

  it("fails closed without a decision comment and sends no write", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
      { method: "PATCH", path: `/issues/${ISSUE}`, body: issueWithPolicy() },
    ]);
    const res = await getTool("paperclipSubmitReviewDecision").execute({ issueId: ISSUE, action: "approve" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("REVIEW_DECISION_COMMENT_REQUIRED");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the board-only stalled-review path for a wedged review (no active stage)", async () => {
    const { calls } = mockApi([
      {
        method: "GET",
        path: `/issues/${ISSUE}`,
        body: issueWithPolicy({ status: "in_review", executionState: null }),
      },
      { method: "POST", path: `/issues/${ISSUE}/stalled-review-decision`, body: { ok: true } },
    ]);
    const res = await getTool("paperclipSubmitReviewDecision").execute({
      issueId: ISSUE,
      action: "send_back",
      note: "No reviewer is reachable.",
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(true);
    expect(out.mode).toBe("stalled_review");
    expect(calls.filter((c) => c.path.endsWith("/stalled-review-decision"))).toHaveLength(1);
  });
});

describe("KOMAA-849 — review liveness reflects a demoted but live review", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the pending review as live instead of not_in_review", async () => {
    mockApi([
      { method: "GET", path: `/issues/${ISSUE}`, body: issueWithPolicy({ status: "in_progress" }) },
      { method: "GET", path: `/issues/${ISSUE}/approvals`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/work-products`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/live-runs`, body: [] },
      { method: "GET", path: `/issues/${ISSUE}/active-run`, body: null },
    ]);
    const res = await getTool("paperclipGetReviewState").execute({ issueId: ISSUE });
    const out = jsonOf(res);
    const liveness = out.liveness as Record<string, unknown>;
    expect(liveness.state).not.toBe("not_in_review");
    expect(liveness.state).toBe("review_pending_status_drifted");
    expect(out.wedged).toBe(false);
  });
});

describe("KOMAA-849 — control-plane registry still exposes the review tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps paperclipSubmitReviewDecision and paperclipGetReviewState registered", () => {
    const names = createControlPlaneTools(makeClient()).map((t) => t.name);
    expect(names).toContain("paperclipSubmitReviewDecision");
    expect(names).toContain("paperclipGetReviewState");
  });
});
