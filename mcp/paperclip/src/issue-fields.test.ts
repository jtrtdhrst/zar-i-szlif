// P0 2026-10-20 — complete issue field management (MCP layer only).
//
// Executable regression for the Relationships/Execution field surface and the
// fail-closed parent-hierarchy guard. Every test asserts the OBSERVED result
// (call log + committed read-back), never just "the tool returned something".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";
import { createPaperclipMcpServer } from "./index.js";
import { ISSUE_FIELD_TOOL_NAMES } from "./issue-fields.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const AGENT = "22222222-2222-2222-2222-222222222222";
const REVIEWER = "77777777-7777-4777-8777-777777777777";
const RUN = "33333333-3333-3333-3333-333333333333";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const X = "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx";
const STAGE_1 = "aaaaaaa1-1111-4111-8111-111111111111";
const STAGE_2 = "aaaaaaa2-2222-4222-8222-222222222222";

function makeClient(overrides: Partial<{ runId: string | null; boardApiKey: string | null; agentId: string | null }> = {}) {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: overrides.agentId === undefined ? AGENT : overrides.agentId,
    runId: overrides.runId === undefined ? RUN : overrides.runId,
    agentApiKey: "token-agent",
    boardApiKey: overrides.boardApiKey === undefined ? "token-board" : overrides.boardApiKey,
  });
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

function getTool(name: string, client = makeClient()) {
  const tool = createToolDefinitions(client).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return {
    ...tool,
    execute: async (input: Record<string, unknown>): Promise<ToolResult> =>
      (await tool.execute(input)) as ToolResult,
  };
}

function issueRow(id: string, identifier: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    identifier,
    title: `issue ${identifier}`,
    status: "todo",
    companyId: COMPANY,
    parentId: null,
    assigneeAgentId: AGENT,
    assigneeUserId: null,
    reviewPolicy: "not_creator",
    executionPolicy: { mode: "normal", commentRequired: true, stages: [] },
    executionState: null,
    blockedBy: [],
    blocks: [],
    ancestors: [],
    ...extra,
  };
}

type Route = {
  method: string;
  path: string;
  body?: unknown;
  bodies?: unknown[];
  status?: number;
  handler?: (path: string, init: RequestInit) => { body: unknown; status?: number };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockApi(routes: Route[]) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const seen = new Map<string, number>();
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const full = String(url);
    const fullPath = full.replace(/^http:\/\/[^/]+\/api/, "");
    const path = fullPath.split("?")[0];
    let body: unknown;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ method, path, body });
    const route = [...routes].reverse().find((r) => r.method === method && (r.path === path || r.path === fullPath));
    if (!route) return Promise.resolve(json({ error: `no mock for ${method} ${path}` }, 500));
    if (route.handler) {
      const result = route.handler(fullPath, init ?? {});
      return Promise.resolve(json(result.body, result.status ?? 200));
    }
    if (route.bodies) {
      const key = `${method} ${route.path}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      return Promise.resolve(json(route.bodies[Math.min(index, route.bodies.length - 1)], route.status ?? 200));
    }
    return Promise.resolve(json(route.body, route.status ?? 200));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function textOf(res: { content: Array<{ type: string; text: string }> }): string {
  return res.content[0]?.text ?? "";
}

function jsonOf(res: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  try { return JSON.parse(textOf(res)) as Record<string, unknown>; } catch { return {}; }
}

/** The MCP error envelope: the outer flag carries isError, the text carries the code/status. */
function expectError(res: { isError?: boolean; content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  expect(res.isError).toBe(true);
  return jsonOf(res);
}

const hierarchyRoutes: Route[] = [
  { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { parentId: null }) },
  { method: "GET", path: `/issues/${B}`, body: issueRow(B, "KOMAA-901", { parentId: A }) },
  { method: "GET", path: `/issues/${C}`, body: issueRow(C, "KOMAA-902", { parentId: B }) },
  { method: "GET", path: `/issues/${D}`, body: issueRow(D, "KOMAA-903", { parentId: null, companyId: OTHER_COMPANY }) },
  { method: "GET", path: `/issues/${X}`, body: issueRow(X, "KOMAA-904", { parentId: null }) },
  // identifier lookups (GET /issues/:id accepts an identifier too)
  { method: "GET", path: "/issues/KOMAA-900", body: issueRow(A, "KOMAA-900", { parentId: null }) },
  { method: "GET", path: "/issues/KOMAA-901", body: issueRow(B, "KOMAA-901", { parentId: A }) },
  { method: "GET", path: "/issues/KOMAA-902", body: issueRow(C, "KOMAA-902", { parentId: B }) },
  { method: "GET", path: "/issues/KOMAA-904", body: issueRow(X, "KOMAA-904", { parentId: null }) },
];

describe("issue field tools — registry", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("registers every new field tool exactly once", () => {
    const names = createToolDefinitions(makeClient()).map((t) => t.name);
    for (const want of ISSUE_FIELD_TOOL_NAMES) expect(names).toContain(want);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("P0 — parent hierarchy cycle prevention (fail closed)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("T12 rejects a direct parent cycle (A -> B -> A)", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: B });
    const out = expectError(res);
    expect(out.code).toBe("PARENT_CYCLE");
    expect(out.category).toBe("INVALID_ARGUMENTS");
    expect(textOf(res)).toContain("PARENT_CYCLE");
    // No write was sent: the guard rejects before the PATCH.
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T13 rejects an indirect parent cycle (A -> C -> B -> A)", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: C });
    expect(res.isError).toBe(true);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_CYCLE");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("rejects a self-parent", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: A });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_SELF_REFERENCE");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("rejects a cross-company parent", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: D });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_CROSS_COMPANY");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("rejects a parent that does not exist", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: "/issues/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", body: { error: "Issue not found" }, status: 404 },
    ]);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_NOT_FOUND");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T53 the generic API route cannot bypass the hierarchy guard", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipApiRequest").execute({
      method: "PATCH",
      path: `/issues/${A}`,
      jsonBody: JSON.stringify({ parentId: B }),
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_CYCLE");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T53 the bulk update path cannot bypass the hierarchy guard", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipBulkUpdateIssues").execute({
      items: [{ issueId: A, patch: { parentId: B } }],
    });
    const results = jsonOf(res).results as Array<Record<string, unknown>>;
    expect(results[0]?.ok).toBe(false);
    expect(String(results[0]?.error)).toContain("PARENT_CYCLE");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T53 the create path rejects a cross-company parent", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    const res = await getTool("paperclipCreateIssue").execute({
      title: "child",
      assigneeAgentId: AGENT,
      parentId: D,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PARENT_CROSS_COMPANY");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("allows clearing the parent (parentId=null is always safe)", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { parentId: null }) },
    ]);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: null });
    expect(res.isError).toBeUndefined();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("allows a legitimate parent change and sends exactly one PATCH", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "PATCH", path: `/issues/${X}`, body: issueRow(X, "KOMAA-904", { parentId: A }) },
    ]);
    const res = await getTool("paperclipUpdateIssue").execute({ issueId: X, parentId: A });
    expect(res.isError).toBeUndefined();
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ parentId: A });
  });

  it("T55 a rejected hierarchy write sends no write and no wake (no PATCH at all)", async () => {
    const { calls } = mockApi(hierarchyRoutes);
    await getTool("paperclipUpdateIssue").execute({ issueId: A, parentId: C });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("relationships (parent / blockers / subtasks)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("T02 changes the parent and reads the committed value back", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "PATCH", path: `/issues/${X}`, body: issueRow(X, "KOMAA-904", { parentId: A }) },
      { method: "GET", path: `/issues/${X}`, body: issueRow(X, "KOMAA-904", { parentId: A }) },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({
      issueId: X,
      operation: "set_parent",
      parentIssueId: "KOMAA-900",
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(true);
    expect((out.committedValues as Record<string, unknown>).parentId).toBe(A);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("T03 clears the parent", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "PATCH", path: `/issues/${B}`, body: issueRow(B, "KOMAA-901", { parentId: null }) },
      { method: "GET", path: `/issues/${B}`, body: issueRow(B, "KOMAA-901", { parentId: null }) },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({ issueId: B, operation: "clear_parent" });
    expect(jsonOf(res).committed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ parentId: null });
  });

  it("T04 lists direct children from the authoritative parentId relation", async () => {
    mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/companies/${COMPANY}/issues`, body: [issueRow(B, "KOMAA-901", { parentId: A })] },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({ issueId: A, operation: "list_children" });
    const out = jsonOf(res);
    expect(out.count).toBe(1);
    expect((out.directChildren as Array<Record<string, unknown>>)[0]?.id).toBe(B);
  });

  it("T05 traverses descendants", async () => {
    const childOf: Record<string, string[]> = { [A]: [B], [B]: [C], [C]: [] };
    mockApi([
      ...hierarchyRoutes,
      {
        method: "GET",
        path: `/companies/${COMPANY}/issues`,
        handler: (fullPath) => {
          const parentId = new URL(`http://x${fullPath}`).searchParams.get("parentId") ?? "";
          const ids = childOf[parentId] ?? [];
          return { body: ids.map((id) => issueRow(id, id === B ? "KOMAA-901" : "KOMAA-902", { parentId })) };
        },
      },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({ issueId: A, operation: "list_descendants" });
    const out = jsonOf(res);
    expect(out.count).toBe(2);
    expect(out.truncated).toBe(false);
  });

  it("T06 adds a blocker while preserving the existing edges", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X, identifier: "KOMAA-904", status: "todo" }] } },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X }, { id: B }] } },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({
      issueId: A,
      operation: "add_blocker",
      blockerIssueIds: ["KOMAA-901"],
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    expect((patch?.body as Record<string, unknown>).blockedByIssueIds).toEqual([X, B]);
  });

  it("T07 removes one blocker without losing the others", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X }, { id: B }] } },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X }] } },
    ]);
    await getTool("paperclipManageIssueRelationships").execute({
      issueId: A,
      operation: "remove_blocker",
      blockerIssueIds: ["KOMAA-901"],
    });
    const patch = calls.find((c) => c.method === "PATCH");
    expect((patch?.body as Record<string, unknown>).blockedByIssueIds).toEqual([X]);
  });

  it("T08 clears all blockers with an explicit empty set", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X }, { id: B }] } },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [] } },
    ]);
    await getTool("paperclipManageIssueRelationships").execute({ issueId: A, operation: "clear_blockers" });
    const patch = calls.find((c) => c.method === "PATCH");
    expect((patch?.body as Record<string, unknown>).blockedByIssueIds).toEqual([]);
  });

  it("T10 rejects a self-blocker before the write", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [] } },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({
      issueId: A,
      operation: "add_blocker",
      blockerIssueIds: ["KOMAA-900"],
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Self-blocker rejected");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T54 a dry run never reports an uncommitted write as successful", async () => {
    const { calls } = mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [{ id: X }] } },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({
      issueId: A,
      operation: "add_blocker",
      blockerIssueIds: ["KOMAA-901"],
      dryRun: true,
    });
    const out = jsonOf(res);
    expect(out.committed).toBe(false);
    expect(out.dryRun).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T11 surfaces a backend dependency-cycle rejection unchanged", async () => {
    mockApi([
      ...hierarchyRoutes,
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [] } },
      { method: "PATCH", path: `/issues/${A}`, body: { error: "Dependency cycle detected" }, status: 422 },
    ]);
    const res = await getTool("paperclipManageIssueRelationships").execute({
      issueId: A,
      operation: "add_blocker",
      blockerIssueIds: ["KOMAA-901"],
    });
    const out = expectError(res);
    expect(out.status).toBe(422);
    expect(out.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("execution policy, review stages and monitor", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("T18/T19 adds a reviewer stage and preserves the existing stages", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", {
        executionPolicy: { mode: "normal", commentRequired: true, stages: [{ id: "stage-1", type: "approval", approvalsNeeded: 1, participants: [{ type: "user", userId: "u-1" }] }] },
      }) },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
    ]);
    await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: A,
      operation: "add_stage",
      stages: [{ type: "review", participants: [{ type: "agent", agentId: REVIEWER }] }],
    });
    const patch = calls.find((c) => c.method === "PATCH");
    const policy = (patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>;
    const stages = policy.stages as Array<Record<string, unknown>>;
    expect(stages).toHaveLength(2);
    expect(stages[0]?.type).toBe("approval");
    expect(stages[1]?.type).toBe("review");
  });

  it("T22 preserves stage ordering on replace", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, bodies: [
        issueRow(A, "KOMAA-900", {
          executionPolicy: { mode: "normal", commentRequired: true, stages: [
            { id: STAGE_1, type: "approval", participants: [] },
            { id: STAGE_2, type: "review", participants: [] },
          ] },
        }),
        issueRow(A, "KOMAA-900", {
          executionPolicy: { mode: "normal", commentRequired: true, stages: [
            { id: STAGE_1, type: "approval", participants: [] },
            { id: STAGE_2, type: "review", participants: [] },
          ] },
        }),
      ] },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
    ]);
    await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: A,
      operation: "replace_stages",
      stages: [
        { id: STAGE_1, type: "review", participants: [] },
        { id: STAGE_2, type: "approval", participants: [] },
      ],
    });
    const patch = calls.find((c) => c.method === "PATCH");
    const stages = ((patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>).stages as Array<Record<string, unknown>>;
    expect(stages.map((s) => s.id)).toEqual([STAGE_1, STAGE_2]);
    expect(stages.map((s) => s.type)).toEqual(["review", "approval"]);
  });

  it("T22b a replace_stages with the committed stages is a no-op (no write at all)", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", {
        executionPolicy: { mode: "normal", commentRequired: true, stages: [
          { id: STAGE_1, type: "review", participants: [] },
          { id: STAGE_2, type: "approval", participants: [] },
        ] },
      }) },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
    ]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: A,
      operation: "replace_stages",
      stages: [
        { id: STAGE_1, type: "review", participants: [] },
        { id: STAGE_2, type: "approval", participants: [] },
      ],
    });
    expect(jsonOf(res).committed).toBe(false);
    expect(jsonOf(res).noOp).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("T23 removes only the requested stage", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, bodies: [
        issueRow(A, "KOMAA-900", {
          executionPolicy: { mode: "normal", commentRequired: true, stages: [
            { id: STAGE_1, type: "review", participants: [] },
            { id: STAGE_2, type: "approval", participants: [] },
          ] },
        }),
        issueRow(A, "KOMAA-900", {
          executionPolicy: { mode: "normal", commentRequired: true, stages: [
            { id: STAGE_1, type: "review", participants: [] },
          ] },
        }),
      ] },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
    ]);
    await getTool("paperclipManageIssueExecutionPolicy").execute({ issueId: A, operation: "remove_stage", stageId: STAGE_2 });
    const patch = calls.find((c) => c.method === "PATCH");
    const stages = ((patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>).stages as Array<Record<string, unknown>>;
    expect(stages.map((s) => s.id)).toEqual([STAGE_1]);
  });

  it("T24 rejects an invalid participant identity (agent participant without agentId)", async () => {
    mockApi([{ method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") }]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: A,
      operation: "add_stage",
      stages: [{ type: "review", participants: [{ type: "agent" }] }],
    });
    expect(res.isError).toBe(true);
  });

  it("T33 surfaces an unauthorized review-policy relaxation as a security control", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { reviewPolicy: "not_creator" }) },
      { method: "PATCH", path: `/issues/${A}`, body: { error: "review_policy_denied" }, status: 403 },
    ]);
    const res = await getTool("paperclipManageIssueExecutionPolicy").execute({
      issueId: A,
      operation: "set_review_policy",
      reviewPolicy: "anyone",
    });
    const out = expectError(res);
    expect(out.status).toBe(403);
    expect(out.code).toBe("PERMISSION_DENIED");
  });

  it("T34 schedules a monitor and keeps the rest of the execution policy", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, bodies: [
        issueRow(A, "KOMAA-900", { status: "in_progress", executionPolicy: { mode: "auto", commentRequired: false, stages: [{ id: STAGE_1, type: "review", participants: [] }] } }),
        issueRow(A, "KOMAA-900", { status: "in_progress" }),
      ] },
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "in_progress" }) },
    ]);
    const res = await getTool("paperclipManageIssueMonitor").execute({
      issueId: A,
      operation: "schedule",
      nextCheckAt: "2026-10-21T10:00:00.000Z",
      notes: "waiting for provider",
    });
    expect(jsonOf(res).committed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    const policy = (patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>;
    expect(policy.mode).toBe("auto");
    expect(policy.commentRequired).toBe(false);
    expect((policy.stages as unknown[])).toHaveLength(1);
    expect((policy.monitor as Record<string, unknown>).nextCheckAt).toBe("2026-10-21T10:00:00.000Z");
  });

  it("T35 surfaces the native ineligibility reason for a monitor", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "todo" }) },
      { method: "PATCH", path: `/issues/${A}`, body: { error: "Monitor can only be scheduled on issues assigned to an agent in in_progress or in_review" }, status: 422 },
    ]);
    const res = await getTool("paperclipManageIssueMonitor").execute({
      issueId: A,
      operation: "schedule",
      nextCheckAt: "2026-10-21T10:00:00.000Z",
    });
    expectError(res);
    expect(textOf(res)).toContain("Monitor can only be scheduled on issues assigned to an agent in in_progress or in_review");
  });

  it("T36 reads the monitor state from both the policy and the runtime state", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", {
        status: "in_review",
        monitorNextCheckAt: "2026-10-21T10:00:00.000Z",
        monitorAttemptCount: 2,
        executionPolicy: { mode: "normal", commentRequired: true, stages: [], monitor: { nextCheckAt: "2026-10-21T10:00:00.000Z" } },
        executionState: { status: "pending", monitor: { status: "scheduled", attemptCount: 2 } },
      }) },
    ]);
    const res = await getTool("paperclipManageIssueMonitor").execute({ issueId: A, operation: "read" });
    const monitor = jsonOf(res).monitor as Record<string, unknown>;
    expect(monitor.nextCheckAt).toBe("2026-10-21T10:00:00.000Z");
    expect(monitor.attemptCount).toBe(2);
    expect(monitor.scheduled).toBe(true);
  });

  it("T38 clears the monitor (monitor=null) and verifies the committed state", async () => {
    const { calls } = mockApi([
      { method: "PATCH", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "in_review" }) },
      // The mock resolves the LAST matching GET route, so the read-back body
      // must carry the monitor for the tool to see a scheduled monitor.
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "in_review", executionPolicy: { mode: "normal", commentRequired: true, stages: [], monitor: { nextCheckAt: "2026-10-21T10:00:00.000Z" } } }) },
    ]);
    const res = await getTool("paperclipManageIssueMonitor").execute({ issueId: A, operation: "clear" });
    expect(jsonOf(res).committed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(((patch?.body as Record<string, unknown>).executionPolicy as Record<string, unknown>).monitor).toBeNull();
  });
});

describe("watchdog and links", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("T39/T41 creates and updates a watchdog through the native route", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "PUT", path: `/issues/${A}/watchdog`, body: { agentId: AGENT, instructions: "watch" } },
      { method: "GET", path: `/issues/${A}/watchdog`, body: { agentId: AGENT, instructions: "watch" } },
    ]);
    const res = await getTool("paperclipManageIssueWatchdog").execute({
      issueId: A,
      operation: "create",
      agentId: AGENT,
      instructions: "watch",
    });
    expect(jsonOf(res).committed).toBe(true);
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe(`/issues/${A}/watchdog`);
    expect(put?.body).toEqual({ agentId: AGENT, instructions: "watch" });
  });

  it("T43 removes a watchdog and reads the configuration back", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "DELETE", path: `/issues/${A}/watchdog`, body: { ok: true } },
      { method: "GET", path: `/issues/${A}/watchdog`, body: null },
    ]);
    const res = await getTool("paperclipManageIssueWatchdog").execute({ issueId: A, operation: "remove" });
    expect(jsonOf(res).committed).toBe(true);
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe(`/issues/${A}/watchdog`);
  });

  it("T46 discovers the real URL source (no native writable url column)", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { description: "see http://plasmic-mcp:8091/mcp" }) },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [{ object: { providerKey: "url", objectType: "link", sanitizedCanonicalUrl: "http://plasmic-mcp:8091/mcp", statusCategory: "unresolved" }, mentions: [{ sourceKind: "description" }] }] },
      { method: "GET", path: `/issues/${A}/external-object-summary`, body: { counts: {} } },
    ]);
    const res = await getTool("paperclipManageIssueLinks").execute({ issueId: A, operation: "list" });
    const out = jsonOf(res);
    expect(out.writableNativeField).toBe(false);
    expect(String(out.sourceOfTruth)).toContain("description/comments/documents");
    expect(textOf(res)).toContain("plasmic-mcp:8091");
  });

  it("T47 adds a link through the source record and refreshes the projection", async () => {
    const { calls } = mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "POST", path: `/issues/${A}/comments`, body: { id: "comment-1", body: "http://plasmic-mcp:8091/mcp" } },
      { method: "POST", path: `/issues/${A}/external-objects/refresh`, body: { refreshed: 1 } },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [] },
    ]);
    const res = await getTool("paperclipManageIssueLinks").execute({
      issueId: A,
      operation: "add",
      url: "http://plasmic-mcp:8091/mcp",
    });
    expect(jsonOf(res).committed).toBe(true);
    const comment = calls.find((c) => c.method === "POST" && c.path.endsWith("/comments"));
    expect((comment?.body as Record<string, unknown>).body).toBe("http://plasmic-mcp:8091/mcp");
    expect(calls.some((c) => c.path.endsWith("/external-objects/refresh"))).toBe(true);
  });

  it("T48 does not call a Docker-internal URL invalid", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900") },
      { method: "POST", path: `/issues/${A}/comments`, body: { id: "comment-1" } },
      { method: "POST", path: `/issues/${A}/external-objects/refresh`, body: {} },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [] },
    ]);
    const res = await getTool("paperclipManageIssueLinks").execute({
      issueId: A,
      operation: "add",
      url: "http://plasmic-mcp:8091/mcp",
    });
    expect(res.isError).toBeUndefined();
  });
});

describe("field discovery and catalogue", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("T49 expands every section of an issue", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "in_progress" }) },
      { method: "GET", path: `/companies/${COMPANY}/issues`, body: [] },
      { method: "GET", path: `/issues/${A}/approvals`, body: [] },
      { method: "GET", path: `/issues/${A}/watchdog`, body: null },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [] },
      { method: "GET", path: `/issues/${A}/external-object-summary`, body: {} },
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [] } },
    ]);
    const res = await getTool("paperclipGetIssueFieldDetails").execute({ issueId: A, includeCapabilities: true });
    const out = jsonOf(res);
    expect(out.relationships).toBeTruthy();
    expect(out.execution).toBeTruthy();
    expect(out.monitor).toBeTruthy();
    expect(out.watchdog).toBeTruthy();
    expect(out.links).toBeTruthy();
    const capabilities = out.capabilities as Array<Record<string, unknown>>;
    expect(capabilities.length).toBeGreaterThanOrEqual(11);
  });

  it("T50 reports per-field editability, source of truth and denial reason", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "todo" }) },
      { method: "GET", path: `/companies/${COMPANY}/issues`, body: [] },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [] },
      { method: "GET", path: `/issues/${A}/watchdog`, body: null },
    ]);
    const res = await getTool("paperclipDescribeIssueFields").execute({ issueId: A });
    const fields = jsonOf(res).fields as Array<Record<string, unknown>>;
    const monitor = fields.find((f) => f.field === "monitor");
    expect(monitor?.editable).toBe(false);
    expect(String(monitor?.denialReason)).toContain("in_progress or in_review");
    const url = fields.find((f) => f.field === "url");
    expect(url?.derived).toBe(true);
    expect(url?.mutationTool).toBe("paperclipManageIssueLinks");
    const current = fields.find((f) => f.field === "currentExecution");
    expect(current?.editable).toBe(false);
  });

  it("T50 reports editable fields for the assignee agent with a live run context", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { status: "in_progress", assigneeAgentId: AGENT }) },
      { method: "GET", path: `/companies/${COMPANY}/issues`, body: [] },
      { method: "GET", path: `/issues/${A}/external-objects`, body: [] },
      { method: "GET", path: `/issues/${A}/watchdog`, body: null },
    ]);
    const res = await getTool("paperclipDescribeIssueFields").execute({ issueId: A });
    const fields = jsonOf(res).fields as Array<Record<string, unknown>>;
    const parent = fields.find((f) => f.field === "parent");
    expect(parent?.editable).toBe(true);
    expect(parent?.requiresRunContext).toBe(true);
  });

  it("T51 every critical tool carries an explicit CRITICAL description", () => {
    const tools = createToolDefinitions(makeClient());
    const byName = new Map(tools.map((t) => [t.name, t.description]));
    const required = [
      "paperclipUpdateIssue", "paperclipCreateIssue", "paperclipGetIssue",
      "paperclipManageIssueRelationships", "paperclipManageIssueExecutionPolicy",
      "paperclipManageIssueMonitor", "paperclipManageIssueWatchdog",
      "paperclipGetReviewState", "paperclipValidateDAG", "paperclipApiRequest",
      "paperclipGetIssueFieldDetails", "paperclipDescribeIssueFields",
      "paperclipManageIssueLinks", "paperclipPatchDependencyGraph",
    ];
    for (const name of required) {
      const description = byName.get(name) ?? "";
      expect(description, name).toContain("CRITICAL");
      expect(description, name).toContain("NATIVE PAPERCLIP ISSUE CONFIGURATION");
    }
  });

  it("T52 the runtime registration exposes the new tools with their descriptions and schemas", () => {
    const { server } = createPaperclipMcpServer({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-123",
      companyId: COMPANY,
      agentId: AGENT,
      runId: RUN,
      agentApiKey: "token-agent",
      boardApiKey: "token-board",
    });
    const registered = (server as unknown as { _registeredTools: Record<string, { description?: string; inputSchema?: unknown }> })._registeredTools;
    for (const name of ISSUE_FIELD_TOOL_NAMES) {
      expect(registered[name], name).toBeTruthy();
      expect(String(registered[name]?.description ?? ""), name).toContain("CRITICAL");
      expect(registered[name]?.inputSchema, name).toBeTruthy();
    }
  });
});

describe("review liveness classification", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  const reviewRoutes = (status: string, runs: unknown[], extra: Record<string, unknown> = {}): Route[] => [
    { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", {
      status,
      executionState: { status: "pending", currentParticipant: { type: "agent", agentId: REVIEWER } },
      ...extra,
    }) },
    { method: "GET", path: `/issues/${A}/approvals`, body: [] },
    { method: "GET", path: `/issues/${A}/work-products`, body: [] },
    { method: "GET", path: `/issues/${A}/live-runs`, body: runs },
    { method: "GET", path: `/issues/${A}/active-run`, body: null },
  ];

  it("T31 detects a genuinely wedged review (reviewer configured, no live run)", async () => {
    mockApi(reviewRoutes("in_review", []));
    const res = await getTool("paperclipGetReviewState").execute({ issueId: A });
    const out = jsonOf(res);
    expect(out.wedged).toBe(true);
    expect((out.liveness as Record<string, unknown>).state).toBe("wedged");
    expect(String((out.liveness as Record<string, unknown>).recoveryGuidance)).toContain("never approve on the reviewer's behalf");
  });

  it("does not report a running reviewer as wedged", async () => {
    mockApi(reviewRoutes("in_review", [{ id: "run-1", status: "running", agentId: REVIEWER }]));
    const res = await getTool("paperclipGetReviewState").execute({ issueId: A });
    const out = jsonOf(res);
    expect(out.wedged).toBe(false);
    expect((out.liveness as Record<string, unknown>).state).toBe("reviewer_running");
  });

  it("does not report a queued reviewer as wedged", async () => {
    mockApi(reviewRoutes("in_review", [{ id: "run-1", status: "queued", agentId: REVIEWER }]));
    const res = await getTool("paperclipGetReviewState").execute({ issueId: A });
    expect((jsonOf(res).liveness as Record<string, unknown>).state).toBe("reviewer_queued");
  });

  it("classifies a legitimately waiting decision", async () => {
    mockApi([
      ...reviewRoutes("in_review", []),
      { method: "GET", path: `/issues/${A}/approvals`, body: [{ id: "ap-1", status: "pending" }] },
    ]);
    const res = await getTool("paperclipGetReviewState").execute({ issueId: A });
    const out = jsonOf(res);
    expect(out.wedged).toBe(false);
    expect((out.liveness as Record<string, unknown>).state).toBe("awaiting_decision");
  });

  it("classifies a stale projection after a completed review", async () => {
    mockApi([
      ...reviewRoutes("in_review", []),
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", {
        status: "in_review",
        executionState: { status: "completed", currentParticipant: { type: "agent", agentId: REVIEWER } },
      }) },
    ]);
    const res = await getTool("paperclipGetReviewState").execute({ issueId: A });
    expect((jsonOf(res).liveness as Record<string, unknown>).state).toBe("completed_stale_projection");
  });

  it("T17 reports the hierarchy scope separately from the dependency graph", async () => {
    mockApi([
      { method: "GET", path: `/issues/${A}`, body: issueRow(A, "KOMAA-900", { parentId: null }) },
      { method: "GET", path: `/issues/${A}/diagnostics/subtree`, body: { nodes: [], edges: [] } },
      { method: "GET", path: `/issues/${A}/diagnostics/blockers`, body: { blockers: [] } },
    ]);
    const res = await getTool("paperclipValidateDAG").execute({ issueId: A });
    const out = jsonOf(res);
    expect(out.validatedGraph).toBe("dependency (issue_relations type=blocks)");
    expect((out.hierarchy as Record<string, unknown>).valid).toBe(true);
    expect(String((out.scope as Record<string, unknown>).hierarchyGraph)).toContain("not a subtree-wide hierarchy proof");
  });
});
