import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { CONTROL_PLANE_TOOL_NAMES, createControlPlaneTools } from "./control-plane.js";
import { createToolDefinitions } from "./tools.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const RUN = "33333333-3333-3333-3333-333333333333";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const OPERATOR_RUN = "55555555-5555-4555-8555-555555555555";
const WS = "66666666-6666-4666-8666-666666666666";
const OWNER = "77777777-7777-4777-8777-777777777777";

function makeClient(runId: string | null = RUN) {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: AGENT,
    runId,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function getTool(name: string, client: PaperclipApiClient = makeClient()) {
  const tool = createControlPlaneTools(client).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(body, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Route fetch by URL substring: responses keyed in order of matching rules.
function mockFetchRoutes(rules: Array<{ match: string; body: unknown; status?: number }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const rule = rules.find((r) => String(url).includes(r.match));
    if (!rule) return Promise.resolve(mockJsonResponse({ error: `no mock for ${url}` }, 500));
    return Promise.resolve(mockJsonResponse(rule.body, rule.status ?? 200));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("control-plane registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes every promised tool exactly once", () => {
    const tools = createControlPlaneTools(makeClient());
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const expected of CONTROL_PLANE_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
    expect(CONTROL_PLANE_TOOL_NAMES.length).toBeGreaterThanOrEqual(60);
  });

  it("is wired into the main tool registry", () => {
    const names = createToolDefinitions(makeClient()).map((t) => t.name);
    for (const expected of CONTROL_PLANE_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
  });
});

describe("runs & scheduler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists runs company-scoped and filters status client-side", async () => {
    const fetchMock = mockFetchOnce([
      { id: "r1", status: "queued" },
      { id: "r2", status: "failed" },
    ]);
    const res = await getTool("paperclipListRuns").execute({ status: "queued", limit: 10 });
    const text = res.content[0]?.text ?? "";
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/companies/${COMPANY}/heartbeat-runs`);
    expect(text).toContain("r1");
    expect(text).not.toContain("r2");
  });

  it("snapshots live runs", async () => {
    const fetchMock = mockFetchOnce([{ id: "live1", status: "running" }]);
    await getTool("paperclipListLiveRuns").execute({ limit: 5 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/companies/${COMPANY}/live-runs`);
  });

  it("returns the current operator run from env config", async () => {
    const fetchMock = mockFetchOnce({ id: RUN, status: "running" });
    const res = await getTool("paperclipGetCurrentOperatorRun").execute({});
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/heartbeat-runs/${RUN}`);
    expect(res.content[0]?.text ?? "").toContain(RUN);
  });

  it("cancels a run via the board cancel endpoint", async () => {
    const fetchMock = mockFetchOnce({ id: "r9", status: "cancelled" });
    await getTool("paperclipCancelRun").execute({ runId: "99999999-9999-4999-8999-999999999999" });
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = String(rawUrl);
    expect(url).toBe("http://localhost:3100/api/heartbeat-runs/99999999-9999-4999-8999-999999999999/cancel");
    expect(init.method).toBe("POST");
  });

  it("routes cancel through the board key, not the caller agent key", async () => {
    const fetchMock = mockFetchOnce({ id: "r9", status: "cancelled" });
    await getTool("paperclipCancelRun").execute({ runId: "99999999-9999-4999-8999-999999999999" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });

  it("fails closed when cancelling another run without a Board credential", async () => {
    const caller = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-123",
      companyId: COMPANY,
      agentId: AGENT,
      runId: RUN,
      agentApiKey: "token-agent",
      boardApiKey: null,
    });
    const fetchMock = mockFetchOnce({ id: "r9", status: "cancelled" });
    const tool = createControlPlaneTools(caller).find((t) => t.name === "paperclipCancelRun");
    if (!tool) throw new Error("Missing tool paperclipCancelRun");
    const result = await tool.execute({ runId: "99999999-9999-4999-8999-999999999999" });
    expect((result as unknown as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("CONFIGURATION_MISSING");
    expect(result.content[0]?.text ?? "").toContain("Board credential");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps caller attribution on non-cancel writes", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    await makeClient().requestJson("POST", `/issues/${ISSUE}/comments`, { body: { body: "hi" } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("keeps the agent key on /agents/* reads", async () => {
    const fetchMock = mockFetchOnce({ id: AGENT });
    await makeClient().requestJson("GET", `/agents/${AGENT}`);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-agent");
  });

  it.each([
    ["wiki data read", "POST", "/plugins/paperclipai.plugin-llm-wiki/data/pages"],
    ["wiki action write", "POST", "/plugins/paperclipai.plugin-llm-wiki/actions/write-page"],
    ["experimental flag read", "GET", "/instance/settings/experimental"],
    ["experimental flag write", "PATCH", "/instance/settings/experimental"],
    ["scheduled retry-now", "POST", `/issues/${ISSUE}/scheduled-retry/retry-now`],
    ["stalled review decision", "POST", `/issues/${ISSUE}/stalled-review-decision`],
    ["decisions list", "GET", `/companies/${COMPANY}/decisions?limit=1`],
    ["decisions stats", "GET", `/companies/${COMPANY}/decisions/stats`],
    ["decision decide", "POST", `/decisions/${ISSUE}/decide`],
    ["decision dismiss", "POST", `/decisions/${ISSUE}/dismiss`],
    ["approval approve", "POST", `/approvals/${ISSUE}/approve`],
    ["approval reject", "POST", `/approvals/${ISSUE}/reject`],
    ["approval request-revision", "POST", `/approvals/${ISSUE}/request-revision`],
    ["operator activity audit", "POST", `/companies/${COMPANY}/activity`],
  ])("routes board-only %s through the board key", async (_label, method, path) => {
    const fetchMock = mockFetchOnce({ ok: true });
    await makeClient().requestJson(method, path, { body: {} });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });

  it.each([
    ["issue read", "GET", `/issues/${ISSUE}`],
    ["company live runs", "GET", `/companies/${COMPANY}/live-runs`],
    ["decision create (agent run context)", "POST", `/companies/${COMPANY}/decisions`],
    ["approval resubmit (requesting agent)", "POST", `/approvals/${ISSUE}/resubmit`],
    ["decision get one (caller-origin scope)", "GET", `/decisions/${ISSUE}`],
    ["decision cancel (caller-origin scope)", "POST", `/decisions/${ISSUE}/cancel`],
  ])("keeps caller key on %s (agent-readable)", async (_label, method, path) => {
    const fetchMock = mockFetchOnce({ ok: true });
    await makeClient().requestJson(method, path);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  // Paperclip 2026.1012.0 gates /instance/scheduler-heartbeats behind
  // assertBoard: the agent key answers 403 "Board access required", so the
  // client has to route it through the board credential.
  it("routes scheduler heartbeats through the board key", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    await makeClient().requestJson("GET", "/instance/scheduler-heartbeats");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });

  it("dry-runs stale reap without cancelling", async () => {
    const old = new Date(Date.now() - 24 * 3600_000).toISOString();
    const fetchMock = mockFetchOnce([
      { id: "old1", status: "queued", createdAt: old },
      { id: "fresh1", status: "running", createdAt: new Date().toISOString() },
    ]);
    const res = await getTool("paperclipReapStaleRuns").execute({ maxAgeMinutes: 60, apply: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.content[0]?.text ?? "").toContain("old1");
  });

  it("retries fresh via retry-now and reports state", async () => {
    const { calls } = mockFetchRoutes([
      { match: "scheduled-retry/retry-now", body: { outcome: "retried" } },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "in_progress", scheduledRetry: null } },
    ]);
    const res = await getTool("paperclipRetryIssueFresh").execute({ issueId: ISSUE });
    expect(calls.some((c) => c.url.includes("retry-now"))).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("retried");
  });
});

describe("eligibility & DAG", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function eligibilityMocks(status: string, blockers: unknown[], live: unknown[]) {
    return mockFetchRoutes([
      { match: "diagnostics/blockers", body: { blockers } },
      { match: "diagnostics/wakes", body: { wakeRequestCount: 0 } },
      { match: "/live-runs", body: live },
      { match: "/active-run", body: null },
      { match: "/runs", body: [] },
      { match: "/documents?includeSystem=true", body: [] },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status, blockedByIssueIds: [], assigneeAgentId: AGENT } },
    ]);
  }

  it("flags blocked-with-zero-blockers as non-executable", async () => {
    eligibilityMocks("blocked", [], []);
    const res = await getTool("paperclipGetExecutionEligibility").execute({ issueId: ISSUE });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("blocked_but_zero_blockers");
    expect(text).toContain("executable");
  });

  it("computes blockedBy add/remove as one atomic PATCH", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "blocked", blockedByIssueIds: ["b1", "b2"] } },
    ]);
    const res = await getTool("paperclipPatchDependencyGraph").execute({
      issueId: ISSUE,
      addBlockerIds: ["b3"],
      removeBlockerIds: ["b1"],
      runId: RUN,
    });
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(patch).toBeDefined();
    expect(JSON.parse(String(patch?.init.body))).toEqual({ blockedByIssueIds: ["b2", "b3"] });
    expect((patch?.init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(RUN);
    expect(res.content[0]?.text ?? "").toContain("b3");
  });

  it("rejects self-blockers", async () => {
    mockFetchRoutes([{ match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "blocked", blockedByIssueIds: [] } }]);
    const res = await getTool("paperclipPatchDependencyGraph").execute({ issueId: ISSUE, addBlockerIds: [ISSUE] });
    expect(res.content[0]?.text ?? "").toMatch(/self-block/i);
  });

  it("detects DAG anomalies from subtree diagnostics (real server shape)", async () => {
    // Real shape: nodes are {issue:{...}, blockers:[...]}, edges carry
    // kind/fromIssueId/toIssueId with blocker -> blocked direction.
    mockFetchRoutes([
      {
        match: "diagnostics/subtree",
        body: {
          nodes: [
            { issue: { id: "a", identifier: "T-1", status: "blocked" }, blockers: [{ id: "b", identifier: "T-2", status: "done" }], omittedUnauthorizedBlockerCount: 0, truncatedSections: { blockers: false } },
            { issue: { id: "b", identifier: "T-2", status: "done" }, blockers: [], omittedUnauthorizedBlockerCount: 0, truncatedSections: { blockers: false } },
          ],
          edges: [
            { kind: "blocks", fromIssueId: "a", toIssueId: "a" },
            { kind: "blocks", fromIssueId: "b", toIssueId: "a" },
            { kind: "parent", fromIssueId: "b", toIssueId: "a" },
          ],
        },
      },
      { match: "diagnostics/blockers", body: { blockers: [{ id: "b", identifier: "T-2", status: "done" }] } },
    ]);
    const res = await getTool("paperclipValidateDAG").execute({ issueId: "a" });
    const parsed = JSON.parse(res.content[0]?.text ?? "{}");
    expect(parsed.edgeCount).toBe(2);
    const kinds = (parsed.anomalies as Array<{ kind: string }>).map((a) => a.kind);
    expect(kinds).toContain("self_blocker");
    expect(kinds).toContain("done_dependency");
    expect(kinds).not.toContain("blocked_zero_blockers");
    expect(kinds).not.toContain("relational_projection_diverged");
  });

  it("validator counts relational edges (KOMAA-874 false-zero regression)", async () => {
    mockFetchRoutes([
      {
        match: "diagnostics/subtree",
        body: {
          nodes: [
            { issue: { id: "root", identifier: "T-9", status: "blocked" }, blockers: [{ id: "b1", status: "blocked" }], omittedUnauthorizedBlockerCount: 0, truncatedSections: { blockers: false } },
          ],
          edges: [{ kind: "blocks", fromIssueId: "b1", toIssueId: "root" }],
        },
      },
      { match: "diagnostics/blockers", body: { blockers: [{ id: "b1", status: "blocked" }] } },
    ]);
    const res = await getTool("paperclipValidateDAG").execute({ issueId: "root" });
    const parsed = JSON.parse(res.content[0]?.text ?? "{}");
    expect(parsed.edgeCount).toBe(1);
    expect(parsed.anomalyCount).toBe(0);
  });

  it("validator flags relational blockers missing from the subtree view", async () => {
    mockFetchRoutes([
      {
        match: "diagnostics/subtree",
        body: {
          nodes: [
            { issue: { id: "root", identifier: "T-9", status: "blocked" }, blockers: [], omittedUnauthorizedBlockerCount: 0, truncatedSections: { blockers: false } },
          ],
          edges: [],
        },
      },
      { match: "diagnostics/blockers", body: { blockers: [{ id: "b1", status: "blocked" }] } },
    ]);
    const res = await getTool("paperclipValidateDAG").execute({ issueId: "root" });
    const kinds = (JSON.parse(res.content[0]?.text ?? "{}").anomalies as Array<{ kind: string }>).map((a) => a.kind);
    expect(kinds).toContain("relational_projection_diverged");
    expect(kinds).not.toContain("blocked_zero_blockers");
  });

  it("patchDependencyGraph uses the relational base, not the diverged projection", async () => {
    const { calls } = mockFetchRoutes([
      { match: "diagnostics/blockers", body: { blockers: [{ id: "b1", identifier: "B-1", status: "blocked" }] } },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, identifier: "T-7", status: "blocked", blockedByIssueIds: [] } },
    ]);
    const res = await getTool("paperclipPatchDependencyGraph").execute({
      issueId: ISSUE,
      addBlockerIds: ["b2"],
      removeBlockerIds: [],
      runId: RUN,
    });
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(patch).toBeDefined();
    // b1 survives from the relational base; the empty projection is ignored.
    expect(JSON.parse(String(patch?.init.body))).toEqual({ blockedByIssueIds: ["b1", "b2"] });
    expect(res.content[0]?.text ?? "").toContain("relationalBase");
  });

  it("bulk update stops on first error unless continueOnError", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/good-1`, body: { id: "good-1", status: "todo" } },
      { match: `/issues/bad-1`, body: { error: "nope" }, status: 422 },
    ]);
    const tool = getTool("paperclipBulkUpdateIssues");
    const stop = await tool.execute({
      items: [
        { issueId: "good-1", patch: { status: "in_progress" } },
        { issueId: "bad-1", patch: { status: "done" } },
      ],
    });
    expect(stop.content[0]?.text ?? "").toContain("completed");
    expect(calls.filter((c) => c.init.method === "PATCH").length).toBe(2);

    const cont = await tool.execute({
      items: [
        { issueId: "bad-1", patch: { status: "done" } },
        { issueId: "good-1", patch: { status: "todo" } },
      ],
      continueOnError: true,
    });
    expect(cont.content[0]?.text ?? "").toContain("true");
  });

  it("bulk update refuses to strip the agent assignee", async () => {
    mockFetchOnce({});
    const res = await getTool("paperclipBulkUpdateIssues").execute({
      items: [{ issueId: "good-1", patch: { assigneeAgentId: null } }],
    });
    expect(res.content[0]?.text ?? "").toMatch(/assignee/i);
  });
});

describe("dag relational consistency (KOMAA-874)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const OLD = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const NEW = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const DEP = "cccccccc-3333-4333-8333-cccccccccccc";
  const OTHER = "dddddddd-4444-4444-8444-dddddddddddd";

  function supersedeBaseRules(depDiagBody: unknown) {
    return [
      { match: `/issues/${OLD}/live-runs`, body: [] },
      { match: `/issues/${OLD}/documents?includeSystem=true`, body: [] },
      { match: `/issues/${OLD}/dependents`, body: null, status: 404 },
      { match: `/issues/${OLD}/diagnostics/subtree`, body: { nodes: [{ issue: { id: DEP, status: "blocked" }, blockers: [{ id: OLD, status: "cancelled" }], omittedUnauthorizedBlockerCount: 0, truncatedSections: { blockers: false } }], edges: [] } },
      { match: `/issues/${DEP}/diagnostics/blockers`, body: depDiagBody },
      { match: `/issues/${OLD}`, body: { id: OLD, identifier: "OLD-1", status: "blocked", companyId: COMPANY } },
      { match: `/issues/${NEW}`, body: { id: NEW, identifier: "NEW-1", status: "blocked", companyId: COMPANY } },
      { match: `/issues/${DEP}`, body: { id: DEP, identifier: "DEP-1", status: "blocked", blockedByIssueIds: [], companyId: COMPANY } },
      { match: `/issues/${DEP}/checkout`, body: { ok: true } },
    ];
  }

  it("supersede repoints dependents from the relational base (diverged projection ignored)", async () => {
    const { calls } = mockFetchRoutes([
      ...supersedeBaseRules({ blockers: [{ id: OLD, status: "cancelled" }, { id: OTHER, status: "blocked" }] }),
    ]);
    const res = await getTool("paperclipSupersedeIssue").execute({ oldIssueId: OLD, newIssueId: NEW, runId: RUN });
    const parsed = JSON.parse(res.content[0]?.text ?? "{}");
    expect(parsed.actions.map((a: { action: string }) => a.action)).toContain("terminalized_old");
    const depPatch = calls.find((c) => c.init.method === "PATCH" && String(c.url).includes(`/issues/${DEP}`));
    expect(depPatch).toBeDefined();
    // OTHER survives from the relational base; OLD is repointed to NEW.
    expect(JSON.parse(String(depPatch?.init.body))).toEqual({ blockedByIssueIds: [NEW, OTHER].sort() });
    expect(JSON.stringify(parsed.repointed)).toContain(NEW);
    expect(parsed.wakes.length).toBe(0);
  });

  it("repeated supersede is idempotent: no duplicate write or wake", async () => {
    const { calls } = mockFetchRoutes([
      ...supersedeBaseRules({ blockers: [{ id: NEW, status: "blocked" }] }),
    ]);
    const res = await getTool("paperclipSupersedeIssue").execute({ oldIssueId: OLD, newIssueId: NEW, runId: RUN });
    const parsed = JSON.parse(res.content[0]?.text ?? "{}");
    const depPatches = calls.filter((c) => c.init.method === "PATCH" && String(c.url).includes(`/issues/${DEP}`));
    expect(depPatches.length).toBe(0);
    expect(JSON.stringify(parsed.repointed)).toContain("already_repointed");
    expect(parsed.wakes.length).toBe(0);
  });

  it("supersede fails closed cross-company before any mutation", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/${OLD}`, body: { id: OLD, status: "blocked", companyId: COMPANY } },
      { match: `/issues/${NEW}`, body: { id: NEW, status: "blocked", companyId: "other-company" } },
    ]);
    const res = await getTool("paperclipSupersedeIssue").execute({ oldIssueId: OLD, newIssueId: NEW, runId: RUN });
    expect(res.content[0]?.text ?? "").toMatch(/cross-company/i);
    expect(calls.filter((c) => c.init.method === "PATCH").length).toBe(0);
  });

  it("supersede refuses a terminal replacement before any mutation", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/${OLD}`, body: { id: OLD, status: "blocked", companyId: COMPANY } },
      { match: `/issues/${NEW}`, body: { id: NEW, status: "cancelled", companyId: COMPANY } },
    ]);
    const res = await getTool("paperclipSupersedeIssue").execute({ oldIssueId: OLD, newIssueId: NEW, runId: RUN });
    expect(res.content[0]?.text ?? "").toMatch(/terminal replacement/i);
    expect(calls.filter((c) => c.init.method === "PATCH").length).toBe(0);
  });

  it("company reconcile reports diverged projection, never blockerless", async () => {
    mockFetchRoutes([
      { match: `/companies/${COMPANY}/issues`, body: [{ id: ISSUE, identifier: "T-1", status: "blocked", blockedByIssueIds: [] }] },
      { match: `/issues/${ISSUE}/diagnostics/blockers`, body: { blockers: [{ id: "x1", status: "blocked" }] } },
      { match: `/issues/${ISSUE}/documents?includeSystem=true`, body: [] },
    ]);
    const res = await getTool("paperclipReconcileCompanyControlPlane").execute({ apply: false });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("blocked_projection_diverged");
    expect(text).not.toContain("blocked_zero_blockers");
  });

  it("delivery metrics names the unverified projection queue honestly", async () => {
    mockFetchRoutes([
      { match: `/companies/${COMPANY}/issues`, body: [{ id: ISSUE, identifier: "T-1", status: "blocked", blockedByIssueIds: [] }] },
    ]);
    const res = await getTool("paperclipGetDeliveryMetrics").execute({ limit: 10 });
    const parsed = JSON.parse(res.content[0]?.text ?? "{}");
    expect(parsed.queueCounts.blocked_empty_projection).toBe(1);
    expect(parsed.queueCounts.stale_blocked_zero_blockers).toBeUndefined();
    expect(parsed.queueCounts.blocked_zero_blockers).toBeUndefined();
  });

  it("unblock uses the relational base and keeps unlisted live edges", async () => {
    const R1 = "11111111-1111-4111-8111-111111111111";
    const R2 = "22222222-2222-4222-8222-222222222222";
    const { calls } = mockFetchRoutes([
      { match: `/issues/${ISSUE}/diagnostics/blockers`, body: { blockers: [{ id: R1, identifier: "R-1", status: "blocked" }, { id: R2, identifier: "R-2", status: "done" }] } },
      { match: `/issues/${ISSUE}/diagnostics/wakes`, body: { wakeRequestCount: 0 } },
      { match: "/live-runs", body: [] },
      { match: "/active-run", body: null },
      { match: "/runs", body: [] },
      { match: "/documents?includeSystem=true", body: [] },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, identifier: "T-7", status: "blocked", blockedByIssueIds: ["ghost-p"], companyId: COMPANY, assigneeAgentId: AGENT } },
    ]);
    const res = await getTool("paperclipUnblockAndWake").execute({ issueId: ISSUE, removeBlockerIds: ["R-2"], runId: RUN });
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(patch).toBeDefined();
    // Ghost projection id dropped (not a real edge); live R1 kept; done R2 removed.
    expect(JSON.parse(String(patch?.init.body))).toEqual({ blockedByIssueIds: [R1] });
    expect(res.content[0]?.text ?? "").toContain("relationalBase");
  });

  it("unblock never auto-flips to todo when diagnostics are unreachable", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/${ISSUE}/diagnostics/blockers`, body: null, status: 404 },
      { match: `/issues/${ISSUE}/diagnostics/wakes`, body: { wakeRequestCount: 0 } },
      { match: "/live-runs", body: [] },
      { match: "/active-run", body: null },
      { match: "/runs", body: [] },
      { match: "/documents?includeSystem=true", body: [] },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, identifier: "T-7", status: "blocked", blockedByIssueIds: ["p1"], companyId: COMPANY, assigneeAgentId: AGENT } },
    ]);
    await getTool("paperclipUnblockAndWake").execute({ issueId: ISSUE, removeBlockerIds: ["p1"], runId: RUN });
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(patch).toBeDefined();
    const body = JSON.parse(String(patch?.init.body));
    expect(body.blockedByIssueIds).toEqual([]);
    expect(body.status).toBeUndefined();
  });

  it("reconcile-blocked never returns diverged-blocked to todo", async () => {
    const { calls } = mockFetchRoutes([
      { match: `/issues/${ISSUE}/diagnostics/blockers`, body: { blockers: [{ id: "x1", status: "blocked" }] } },
      { match: `/issues/${ISSUE}/documents?includeSystem=true`, body: [] },
      { match: `/issues/${ISSUE}/approvals`, body: [] },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, identifier: "T-1", status: "blocked", blockedByIssueIds: [], companyId: COMPANY } },
    ]);
    const res = await getTool("paperclipReconcileBlockedIssue").execute({ issueId: ISSUE, apply: true, runId: RUN });
    expect(calls.filter((c) => c.init.method === "PATCH").length).toBe(0);
    expect(res.content[0]?.text ?? "").not.toContain("blocked_to_todo");
  });
});

describe("review & holds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests review via status transition", async () => {
    const fetchMock = mockFetchOnce({ id: ISSUE, status: "in_review" });
    await getTool("paperclipRequestReview").execute({ issueId: ISSUE, note: "ready" });
    // KOMAA-1094: the handoff now reads the issue first (to invalidate a stale
    // scheduled retry before the new stage is armed), so select the transition
    // call by method instead of by position.
    const patchCall = fetchMock.mock.calls.find(([, init]) => init.method === "PATCH");
    expect(patchCall).toBeDefined();
    const [, init] = patchCall as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ status: "in_review" });
  });

  it("submits issue-mode review decisions to stalled-review-decision when no review stage is active", async () => {
    const fetchMock = mockFetchOnce({ id: ISSUE, status: "in_review", executionState: null });
    await getTool("paperclipSubmitReviewDecision").execute({ issueId: ISSUE, action: "approve" });
    const [reviewUrl, reviewInit] = fetchMock.mock.calls[1] as [unknown, RequestInit];
    expect(String(reviewUrl)).toContain("stalled-review-decision");
    expect(reviewInit.method).toBe("POST");
  });

  it("submits issue-mode review decisions of an active stage through the native issue transition", async () => {
    // KOMAA-849: the active reviewer must be able to decide. The stalled-review
    // endpoint is board-only and only applies to wedged reviews.
    const { calls } = mockFetchRoutes([
      {
        match: `/issues/${ISSUE}`,
        body: {
          id: ISSUE,
          status: "in_review",
          executionState: {
            status: "pending",
            currentStageId: "aaaaaaaa-1111-4111-8111-111111111111",
            currentStageType: "review",
            currentParticipant: { type: "agent", agentId: AGENT, userId: null },
            returnAssignee: { type: "agent", agentId: AGENT, userId: null },
            completedStageIds: [],
          },
        },
      },
    ]);
    await getTool("paperclipSubmitReviewDecision").execute({
      issueId: ISSUE,
      action: "approve",
      note: "kind: review\ndecision: approved",
    });
    const second = calls[1];
    expect(String(second.url)).toContain(`/issues/${ISSUE}`);
    expect(String(second.url)).not.toContain("stalled-review-decision");
    expect(second.init.method).toBe("PATCH");
    expect(JSON.parse(String(second.init.body))).toMatchObject({ status: "done" });
  });

  it("sets and clears execution holds via issue documents", async () => {
    const put = mockFetchOnce({ key: "control-plane/execution-hold" });
    await getTool("paperclipSetExecutionHold").execute({ issueId: ISSUE, reason: "harness outage" });
    const putCall = put.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT") as [string, RequestInit] | undefined;
    const putUrl = String(putCall?.[0]);
    expect(putUrl).toContain(`/issues/${ISSUE}/documents/`);
    expect(putCall?.[1].method).toBe("PUT");

mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: [{ key: "control-plane-execution-hold", body: JSON.stringify({ reason: "x" }) }] },
      { match: "/documents/control-plane-execution-hold", body: { ok: true } },
    ]);
    const cleared = await getTool("paperclipClearExecutionHold").execute({ issueId: ISSUE });
    expect(cleared.content[0]?.text ?? "").toContain("true");
  });

  // KOMAA-461: the hold document DELETE is board-only in routes/issues.ts, so
  // the client has to route it through the board key. Without this the clear
  // dies on 403 and no hold can ever be released.
  it("routes the execution-hold document DELETE through the board key", async () => {
    mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: [{ key: "control-plane-execution-hold", body: JSON.stringify({ kind: "execution_hold", reason: "x" }) }] },
      { match: "/documents/control-plane-execution-hold", body: { ok: true } },
    ]);
    await getTool("paperclipClearExecutionHold").execute({ issueId: ISSUE });
    const del = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(del).toBeDefined();
    const [url, init] = del as [string, RequestInit];
    expect(String(url)).toContain(`/issues/${ISSUE}/documents/control-plane-execution-hold`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });

  // KOMAA-849: a 409 "no longer a stalled review" is a TOCTOU race signal
  // (named review stage installed under us). Route MUST reconcile with
  // refreshed canonical state and MUST NOT PATCH status=todo.
  it("never demotes to todo when stalled-review-decision reports 409 no-longer-stalled", async () => {
    const { fetchMock } = mockFetchRoutes([
      { match: "/stalled-review-decision", body: { error: "Issue is no longer a stalled review" }, status: 409 },
      { match: "/live-runs", body: [] },
      { match: "/approvals", body: [] },
      { match: "/active-run", body: { error: "no active run" }, status: 404 },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "in_review", identifier: "KOMAA-999", title: "wedged review" } },
    ]);
    const res = await getTool("paperclipResolveReviewWedge").execute({ issueId: ISSUE, action: "route" });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("No status mutation");
    expect(text).toContain("no longer stalled");
  });

  // KOMAA-849: when stalled-review-decision is unavailable (5xx), route fails
  // closed with refreshed canonical state and still issues no status PATCH.
  it("fails closed without a todo patch when stalled-review-decision is unavailable", async () => {
    const { fetchMock } = mockFetchRoutes([
      { match: "/stalled-review-decision", body: { error: "upstream unavailable" }, status: 503 },
      { match: "/live-runs", body: [] },
      { match: "/approvals", body: [] },
      { match: "/active-run", body: { error: "no active run" }, status: 404 },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "in_review", identifier: "KOMAA-999", title: "wedged review" } },
    ]);
    const res = await getTool("paperclipResolveReviewWedge").execute({ issueId: ISSUE, action: "route" });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("No status mutation");
    expect(text).toContain("fail-closed");
  });

  // KOMAA-849 path B: delivery-cycle resolve_review MUST NOT PATCH todo when
  // stalled-review-decision 409s (TOCTOU: valid reviewer path appeared). It
  // returns ok:false/skipped with refreshed canonical state instead.
  it("delivery-cycle resolve_review never demotes to todo on 409 no-longer-stalled", async () => {
    const { fetchMock } = mockFetchRoutes([
      { match: "/control-plane-revision", body: { revision: "rev-849" } },
      { match: "/stalled-review-decision", body: { error: "Issue is no longer a stalled review" }, status: 409 },
      { match: `/issues/${ISSUE}/execution-state`, body: { wedgedReview: true, state: "WAITING_REVIEW" } },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "in_review", identifier: "KOMAA-999", title: "wedged review" } },
    ]);
    const res = await getTool("paperclipApplyControlPlaneRepair").execute({
      actions: [{ kind: "resolve_review", issueId: ISSUE }],
      expectedRevision: "rev-849",
    });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
    const out = JSON.parse(res.content[0]?.text ?? "{}");
    expect(out.skipped).toHaveLength(1);
    expect(JSON.stringify(out.skipped[0])).toContain("no todo fallback");
  });

  // KOMAA-849 path B: on 5xx the delivery-cycle also fails closed with no
  // mutation, so a transient outage cannot silently demote a valid review.
  it("delivery-cycle resolve_review fails closed without a todo patch on 5xx", async () => {
    const { fetchMock } = mockFetchRoutes([
      { match: "/control-plane-revision", body: { revision: "rev-849" } },
      { match: "/stalled-review-decision", body: { error: "upstream unavailable" }, status: 503 },
      { match: `/issues/${ISSUE}/execution-state`, body: { wedgedReview: true, state: "WAITING_REVIEW" } },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "in_review", identifier: "KOMAA-999", title: "wedged review" } },
    ]);
    const res = await getTool("paperclipApplyControlPlaneRepair").execute({
      actions: [{ kind: "resolve_review", issueId: ISSUE }],
      expectedRevision: "rev-849",
    });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(0);
    const out = JSON.parse(res.content[0]?.text ?? "{}");
    expect(out.skipped).toHaveLength(1);
    expect(JSON.stringify(out.skipped[0])).toContain("no todo fallback");
  });
});

describe("telemetry & misc", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("tails run logs with offset params", async () => {
    const fetchMock = mockFetchOnce({ runId: RUN, chunks: [] });
    await getTool("paperclipTailRunLog").execute({ runId: RUN, offset: 128, limitBytes: 1024 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/heartbeat-runs/${RUN}/log?offset=128&limitBytes=1024`);
  });

  it("pages run events", async () => {
    const fetchMock = mockFetchOnce([]);
    await getTool("paperclipGetRunEvents").execute({ runId: RUN, afterSeq: 10, limit: 50 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/heartbeat-runs/${RUN}/events?afterSeq=10&limit=50`);
  });

  it("explains known forbidden errors without API calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await getTool("paperclipExplainForbidden").execute({
      errorText: "403 cross_issue_influence_run_context_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.content[0]?.text ?? "").toContain("X-Paperclip-Run-Id");
  });

  it("reads server info from /health", async () => {
    const fetchMock = mockFetchOnce({ status: "ok", version: "v1" });
    await getTool("paperclipGetServerInfo").execute({});
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:3100/api/health");
  });
});

describe("recovery resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // KOMAA-674 / KOMAA-411 live proof (2026-10-04): the tool accepted
  // operatorRunId and then dropped it, so the resolve request carried no run
  // scope at all and the route answered 401 `Agent run id required`. The only
  // way out was to claim a terminal source status, which corrupts lifecycle
  // state instead of retiring a stale card.
  it("sends the operator session header when an operator resolves a recovery action", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    await getTool("paperclipResolveRecoveryAction").execute({
      issueId: ISSUE,
      outcome: "blocked",
      sourceIssueStatus: "blocked",
      operatorRunId: OPERATOR_RUN,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Paperclip-Operator-Run-Id"]).toBe(
      OPERATOR_RUN,
    );
  });

  it("still scopes a plain run resolution to the run id", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    await getTool("paperclipResolveRecoveryAction").execute({
      issueId: ISSUE,
      outcome: "restored",
      sourceIssueStatus: "todo",
      runId: RUN,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Paperclip-Run-Id"]).toBe(RUN);
  });

  // KOMAA-1364 RED (production 2026-10-22, Langfuse paperclip-production): the
  // gateway advertised sourceIssueStatus as a free string, so a caller that
  // guessed `in_progress` got an opaque upstream 400 from the server's closed
  // enum and repeated the same failing call. The enum now lives in the
  // advertised schema: a valid value is forwarded verbatim upstream and an
  // invalid one is rejected locally with zero upstream requests.
  //
  // KOMAA-1366: the pairs below are the server's own table
  // (packages/shared/src/validators/issue.ts:583-626) - the server couples
  // outcome<->sourceIssueStatus and REQUIRES the field, so the gateway tests
  // exactly the pairs the server accepts, nothing looser.
  it.each([
    ["restored", "todo"],
    ["restored", "done"],
    ["restored", "in_review"],
    ["blocked", "blocked"],
    ["false_positive", "done"],
    ["false_positive", "in_review"],
    ["cancelled", "done"],
    ["cancelled", "in_review"],
  ])(
    "accepts outcome=%s with sourceIssueStatus=%s and forwards it verbatim upstream",
    async (outcome, status) => {
      const fetchMock = mockFetchOnce({ ok: true });
      await getTool("paperclipResolveRecoveryAction").execute({
        issueId: ISSUE,
        outcome,
        sourceIssueStatus: status,
        operatorRunId: OPERATOR_RUN,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { outcome?: string; sourceIssueStatus?: string };
      expect(body.outcome).toBe(outcome);
      expect(body.sourceIssueStatus).toBe(status);
    },
  );

  it.each(["in_progress", "cancelled", ""])(
    "rejects sourceIssueStatus=%s locally without an upstream request",
    async (status) => {
      const fetchMock = mockFetchOnce({ ok: true });
      const res = await getTool("paperclipResolveRecoveryAction").execute({
        issueId: ISSUE,
        outcome: "restored",
        sourceIssueStatus: status,
        operatorRunId: OPERATOR_RUN,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect((res as { isError?: boolean }).isError).toBe(true);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("sourceIssueStatus");
      expect(text).toContain("INVALID_ARGUMENTS");
    },
  );

  // KOMAA-1366 RED: the server couples the outcome to the source status in
  // superRefine. The gateway only documented the coupling, so a mismatched
  // pair reached the server and came back as an opaque upstream 400.
  it.each([
    ["restored", "blocked"],
    ["blocked", "todo"],
    ["false_positive", "todo"],
    ["cancelled", "blocked"],
  ])(
    "rejects the mismatched pair outcome=%s sourceIssueStatus=%s locally without an upstream request",
    async (outcome, status) => {
      const fetchMock = mockFetchOnce({ ok: true });
      const res = await getTool("paperclipResolveRecoveryAction").execute({
        issueId: ISSUE,
        outcome,
        sourceIssueStatus: status,
        operatorRunId: OPERATOR_RUN,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect((res as { isError?: boolean }).isError).toBe(true);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("sourceIssueStatus");
      expect(text).toContain("INVALID_ARGUMENTS");
    },
  );

  // KOMAA-1366 RED: the server requires sourceIssueStatus (strict object, no
  // default). A missing value used to be forwarded as an absent field and came
  // back as an upstream "required" 400 instead of a local typed error.
  it("rejects an omitted sourceIssueStatus locally without an upstream request", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const res = await getTool("paperclipResolveRecoveryAction").execute({
      issueId: ISSUE,
      outcome: "restored",
      operatorRunId: OPERATOR_RUN,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("sourceIssueStatus");
    expect(text).toContain("INVALID_ARGUMENTS");
  });
});

describe("close-evidence run scope", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // KOMAA-1366 RED (production 2026-10-22, INVALID_ARGUMENTS at 01:01:24Z and
  // 01:25:05Z): the tool demanded a run scope even though the session already
  // carried one (PAPERCLIP_RUN_ID) and requestJson sends it as the run header,
  // so a valid in-session close was refused before a single request left the
  // gateway. The session run id is the fallback scope.
  it("uses the session run id when no explicit run scope is passed", async () => {
    const { fetchMock, calls } = mockFetchRoutes([{ match: "", body: { ok: true } }]);
    const res = await getTool("paperclipCloseIssueWithEvidence").execute({
      issueId: ISSUE,
      evidence: "KOMAA-1366 session run scope fallback proof.",
    });
    expect((res as { isError?: boolean }).isError).not.toBe(true);
    expect(res.content[0]?.text ?? "").not.toContain("operatorRunId (preferred");
    const write = calls.find((call) => String(call.init.method).toUpperCase() === "POST");
    expect(write).toBeDefined();
    expect((write?.init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(RUN);
    expect(fetchMock).toHaveBeenCalled();
  });

  // Fail-closed is preserved: without a session run and without an explicit
  // run scope the call is refused locally and sends nothing upstream.
  it("still fails closed without any run scope", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const res = await getTool("paperclipCloseIssueWithEvidence", makeClient(null)).execute({
      issueId: ISSUE,
      evidence: "KOMAA-1366 fail-closed proof.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("operatorRunId");
  });
});

describe("decisions & eligibility guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns issue_not_found as non-executable for missing issues", async () => {
    mockFetchRoutes([
      { match: "diagnostics/blockers", body: { blockers: [] } },
      { match: "diagnostics/wakes", body: null },
      { match: "/live-runs", body: [] },
      { match: "/active-run", body: null },
      { match: "/runs", body: [] },
      { match: "/documents?includeSystem=true", body: [] },
      { match: `/issues/${ISSUE}`, body: { error: "Issue not found" }, status: 404 },
    ]);
    const res = await getTool("paperclipGetExecutionEligibility").execute({ issueId: ISSUE });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("issue_not_found");
    expect(text).toContain('"executable": false');
  });

  it("reconcile surfaces issue_not_found without actions", async () => {
    mockFetchRoutes([
      { match: "diagnostics/blockers", body: { blockers: [] } },
      { match: "diagnostics/wakes", body: null },
      { match: "/live-runs", body: [] },
      { match: "/active-run", body: null },
      { match: "/runs", body: [] },
      { match: "/documents?includeSystem=true", body: [] },
      { match: `/issues/${ISSUE}`, body: { error: "Issue not found" }, status: 404 },
    ]);
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: ISSUE });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("issue_not_found");
  });

  it("resolveDecision sends optionId (choiceId as alias)", async () => {
    const fetchMock = mockFetchOnce({ id: ISSUE, status: "decided" });
    await getTool("paperclipResolveDecision").execute({
      decisionId: ISSUE,
      action: "decide",
      choiceId: "opt-1",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ optionId: "opt-1" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });
});

describe("agent control plane: instructions, runtime, skills, revisions, economics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the exact instructions bundle", async () => {
    const fetchMock = mockFetchOnce({ mode: "managed", files: { "AGENTS.md": "hi" } });
    const res = await getTool("paperclipGetAgentInstructions").execute({ agentId: AGENT });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `http://localhost:3100/api/agents/${AGENT}/instructions-bundle`,
    );
    expect(res.content[0]?.text ?? "").toContain("managed");
  });

  it("reads one instructions file by path", async () => {
    const fetchMock = mockFetchOnce({ path: "AGENTS.md", content: "hi" });
    await getTool("paperclipGetAgentInstructionsFile").execute({ agentId: AGENT, path: "AGENTS.md" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/agents/${AGENT}/instructions-bundle/file?path=AGENTS.md`);
  });

  it("mutates one instructions file with before/after diff", async () => {
    const { calls } = mockFetchRoutes([
      { match: "/instructions-bundle/file?path=", body: { path: "AGENTS.md", content: "line1\nline2" } },
      { match: "/instructions-bundle/file", body: { path: "AGENTS.md", size: 12 } },
    ]);
    const res = await getTool("paperclipUpdateAgentInstructionsFile").execute({
      agentId: AGENT, path: "AGENTS.md", content: "line1\nline3",
    });
    const text = res.content[0]?.text ?? "";
    expect(calls.length).toBe(2);
    expect(calls[1]?.init.method).toBe("PUT");
    expect(text).toContain('"changed": true');
    expect(text).toContain('"addedLines": 1');
  });

  it("patches bundle routing (mode/entryFile)", async () => {
    const fetchMock = mockFetchOnce({ mode: "managed", entryFile: "AGENTS.md" });
    await getTool("paperclipPatchAgentInstructionsBundle").execute({ agentId: AGENT, entryFile: "AGENTS.md" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(`/agents/${AGENT}/instructions-bundle`);
    expect(init.method).toBe("PATCH");
  });

  it("deletes one instructions file", async () => {
    const fetchMock = mockFetchOnce({ mode: "managed", files: {} });
    await getTool("paperclipDeleteAgentInstructionsFile").execute({ agentId: AGENT, path: "OLD.md" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/instructions-bundle/file?path=OLD.md");
    expect(init.method).toBe("DELETE");
  });

  it("atomically patches runtime config without full rewrite", async () => {
    const fetchMock = mockFetchOnce({ id: AGENT });
    await getTool("paperclipPatchAgentRuntimeConfig").execute({
      agentId: AGENT, runtimeConfig: { model: "x", timeout: 60 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(`http://localhost:3100/api/agents/${AGENT}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ runtimeConfig: { model: "x", timeout: 60 } });
  });

  it("rejects empty runtime patches and permissions via the wrong tool", async () => {
    const noCall = vi.fn();
    vi.stubGlobal("fetch", noCall);
    const empty = await getTool("paperclipPatchAgentRuntimeConfig").execute({ agentId: AGENT });
    expect(empty.content[0]?.text ?? "").toMatch(/Provide at least one field/i);
    const perm = await getTool("paperclipPatchAgentRuntimeConfig").execute({ agentId: AGENT, permissions: {} } as never);
    expect(perm.content[0]?.text ?? "").toMatch(/Unrecognized key|permissions/i);
    expect(noCall).not.toHaveBeenCalled();
  });

  it("reads effective skill set", async () => {
    const fetchMock = mockFetchOnce({ supported: true, mode: "persistent", entries: [], warnings: [] });
    await getTool("paperclipGetAgentSkillSet").execute({ agentId: AGENT });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://localhost:3100/api/agents/${AGENT}/skills`);
  });

  it("syncs skills and rejects duplicate keys", async () => {
    const fetchMock = mockFetchOnce({ supported: true, entries: [] });
    await getTool("paperclipSyncAgentSkills").execute({ agentId: AGENT, mode: "add", desiredSkills: ["a", "b"] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(`/agents/${AGENT}/skills/sync`);
    expect(JSON.parse(String(init.body))).toMatchObject({ mode: "add" });
    const dupe = await getTool("paperclipSyncAgentSkills").execute({ agentId: AGENT, mode: "add", desiredSkills: ["a", "a"] });
    expect(dupe.content[0]?.text ?? "").toContain("Duplicate skill keys");
  });

  it("lists, reads and rolls back config revisions", async () => {
    const rev = "55555555-5555-4555-8555-555555555555";
    let fetchMock = mockFetchOnce([{ id: rev }]);
    await getTool("paperclipListAgentConfigRevisions").execute({ agentId: AGENT });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://localhost:3100/api/agents/${AGENT}/config-revisions`);
    fetchMock = mockFetchOnce({ id: rev });
    await getTool("paperclipGetAgentConfigRevision").execute({ agentId: AGENT, revisionId: rev });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/config-revisions/${rev}`);
    fetchMock = mockFetchOnce({ id: AGENT });
    await getTool("paperclipRollbackAgentConfig").execute({ agentId: AGENT, revisionId: rev });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(`/config-revisions/${rev}/rollback`);
    expect(init.method).toBe("POST");
  });

  it("updates permissions via the dedicated endpoint", async () => {
    const fetchMock = mockFetchOnce({ id: AGENT });
    await getTool("paperclipUpdateAgentPermissions").execute({ agentId: AGENT, canCreateAgents: false, canAssignTasks: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(`http://localhost:3100/api/agents/${AGENT}/permissions`);
    expect(init.method).toBe("PATCH");
  });

  it("composes economics from ledgers plus run snapshot", async () => {
    const { calls } = mockFetchRoutes([
      { match: "/costs/summary", body: { totalCents: 0 } },
      { match: "/costs/by-agent", body: [] },
      { match: "/costs/by-provider", body: [] },
      { match: "/costs/by-agent-model", body: [] },
      { match: `/heartbeat-runs/${RUN}`, body: { id: RUN, status: "succeeded" } },
      { match: "/events", body: [] },
    ]);
    const res = await getTool("paperclipGetEconomicsMetrics").execute({ runId: RUN });
    const text = res.content[0]?.text ?? "";
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(text).toContain("billingCaveat");
    expect(text).toContain("Langfuse");
  });

  it("creates and reads skill test runs", async () => {
    const skillId = "skill-1";
    let fetchMock = mockFetchOnce({ id: "run-1", status: "queued" });
    await getTool("paperclipCreateSkillTestRun").execute({ skillId, agentId: AGENT, content: "hello" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/skills/${skillId}/test-runs`);
    fetchMock = mockFetchOnce({ id: "run-1", status: "passed" });
    const res = await getTool("paperclipGetSkillTestRun").execute({ skillId, runId: "run-1" });
    expect(res.content[0]?.text ?? "").toContain("passed");
  });

  it("routes the instruction bundle read through the board key", async () => {
    // Core gates GET /agents/:id/instructions-bundle behind
    // assertInstanceAdmin for external-mode agents, so the agent key answers
    // 403 "Board access required" even on its own row.
    const fetchMock = mockFetchOnce({ mode: "managed", files: {} });
    await getTool("paperclipGetAgentInstructions").execute({ agentId: AGENT });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-board");
  });
});
// KOMAA-461: typed conditional hold expiry + legacy reconciliation.
describe("conditional execution hold expiry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const GATE = "55555555-5555-4555-8555-555555555555";
  const HELD = "66666666-6666-4666-8666-666666666666";

  /** Exact legacy free-text bodies read from the live DB on 2026-10-02. */
  const STALE_436 = "Temporary post-restart serialization hold: recovery recreated multiple concurrent Harness Agent runs, violating the one-active-run-per-agent invariant. Keep held until KOMAA-459 finishes or yields; then clear and fresh-wake exactly one next Harness P0.";
  const STALE_461 = "Do not start while KOMAA-459 is the single active Harness P0. Clear after KOMAA-459 finishes/yields, then run this source fix before releasing other held Harness work.";
  const HOST_428 = "Host-only promotion gate: promote current KOMAA-428-live tip 364a9bbd5 into paperclip-local and restart the Paperclip user service. Until host state changes, no Harness execution should be queued or run for this issue.";
  const SAFETY_457 = "Safety hold: live evidence shows isolated_workspace can alias writable project_primary/main. Do not start repo release-hardening work until KOMAA-459 proves true isolated branch/worktree provisioning. After KOMAA-459 PASS, clear this hold and fresh-wake KOMAA-457.";

  function holdDoc(body: unknown) {
    return { key: "control-plane-execution-hold", body: JSON.stringify(body) };
  }

  /** Mocks the eligibility surface for one issue plus the gate issue lookup. */
  function mockHeldIssue(opts: { hold: unknown; gateStatus: string | null; issueStatus?: string }) {
    return mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: opts.hold ? [holdDoc(opts.hold)] : [] },
      { match: `/companies/${COMPANY}/issues`, body: [
        { id: HELD, identifier: "KOMAA-436", status: opts.issueStatus ?? "in_review" },
        ...(opts.gateStatus ? [{ id: GATE, identifier: "KOMAA-459", status: opts.gateStatus }] : []),
      ] },
      { match: `/issues/${GATE}`, body: opts.gateStatus ? { id: GATE, identifier: "KOMAA-459", status: opts.gateStatus } : null, status: opts.gateStatus ? 200 : 404 },
      { match: "/diagnostics/blockers", body: { blockers: [] } },
      { match: "/diagnostics/wakes", body: { wakes: [] } },
      { match: "/live-runs", body: [] },
      { match: "/active-run", body: null, status: 404 },
      { match: "/runs", body: [] },
      { match: `/issues/${HELD}`, body: { id: HELD, identifier: "KOMAA-436", status: opts.issueStatus ?? "in_review" } },
      { match: "/comments", body: { id: "c1" } },
    ]);
  }

  it("keeps blocking on a legacy capacity hold whose gate is still running", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: STALE_436 }, gateStatus: "in_progress" });
    const res = await getTool("paperclipGetExecutionEligibility").execute({ issueId: HELD });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("execution_hold");
    expect(text).not.toContain('"executable":true');
    // Nothing was mutated by a read.
    expect(calls.some((c) => c.init.method === "DELETE" || c.init.method === "PUT")).toBe(false);
  });

  it("auto-expires the stale legacy capacity hold once the gate is done (KOMAA-436 regression)", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: STALE_436 }, gateStatus: "done" });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("expired_capacity_hold");
    expect(text).toContain("KOMAA-459");
    // Hold document deleted and the expiry audited.
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(true);
    expect(calls.some((c) => c.init.method === "POST" && c.url.includes("/comments"))).toBe(true);
    // No dependency edge is created on expiry.
    expect(calls.some((c) => c.url.includes("dependencies") || c.url.includes("blocked"))).toBe(false);
    // No wake is enqueued by expiry itself (the GET /diagnostics/wakes preflight
    // read is not a wake; only a checkout or run dispatch would be).
    expect(calls.some((c) => c.url.includes("/checkout") || c.url.includes("heartbeat-runs"))).toBe(false);
  });

  it("auto-expires the stale capacity hold that gated KOMAA-461 itself", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: STALE_461 }, gateStatus: "done" });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    expect(res.content[0]?.text ?? "").toContain("expired_capacity_hold");
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(true);
  });

  it("never auto-expires a host-only hold even when its gate looks finished", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: HOST_428 }, gateStatus: "done" });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    const text = res.content[0]?.text ?? "";
    expect(text).not.toContain("expired_capacity_hold");
    expect(text).toContain("execution_hold");
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(false);
  });

  it("never auto-expires a safety hold whose gate issue is already done", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: SAFETY_457 }, gateStatus: "done" });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    expect(res.content[0]?.text ?? "").not.toContain("expired_capacity_hold");
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(false);
  });

  it("treats every explicitly typed non-capacity hold as fail-closed", async () => {
    for (const holdKind of ["safety", "host", "security", "external", "credential"] as const) {
      const { calls } = mockHeldIssue({
        hold: { kind: "execution_hold", holdKind, gateIssueId: GATE, reason: "capacity wording but typed otherwise" },
        gateStatus: "done",
      });
      const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
      expect(res.content[0]?.text ?? "", holdKind).not.toContain("expired_capacity_hold");
      expect(calls.some((c) => c.init.method === "DELETE"), holdKind).toBe(false);
    }
  });

  it("expires a typed capacity hold by explicit gateIssueId without listing issues", async () => {
    const { calls } = mockHeldIssue({
      hold: { kind: "execution_hold", holdKind: "capacity", gateIssueId: GATE, reason: "WIP serialization" },
      gateStatus: "cancelled",
    });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    expect(res.content[0]?.text ?? "").toContain("expired_capacity_hold");
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(true);
  });

  it("keeps a typed capacity hold blocking when its gate cannot be resolved", async () => {
    const { calls } = mockHeldIssue({
      hold: { kind: "execution_hold", holdKind: "capacity", gateIssueIdentifier: "KOMAA-999", reason: "WIP" },
      gateStatus: null,
    });
    const res = await getTool("paperclipReconcileIssueExecution").execute({ issueId: HELD, apply: true });
    expect(res.content[0]?.text ?? "").not.toContain("expired_capacity_hold");
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(false);
  });

  it("rejects a capacity hold with no gate at write time", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const res = await getTool("paperclipSetExecutionHold").execute({ issueId: ISSUE, kind: "capacity", reason: "no gate" });
    expect(res.content[0]?.text ?? "").toContain("requires gateIssueId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults new holds to the fail-closed safety kind", async () => {
    const { calls } = mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: [] },
      { match: "/documents/control-plane-execution-hold", body: { ok: true } },
    ]);
    await getTool("paperclipSetExecutionHold").execute({ issueId: ISSUE, reason: "harness outage" });
    const put = calls.find((c) => c.init.method === "PUT");
    expect(JSON.parse(String(put?.init.body)).body).toContain('"holdKind": "safety"');
  });

  // Regression: routes/issues.ts rejects a document update without
  // baseRevisionId, so re-setting an existing hold used to 409 and leave the
  // stale hold in force - the operator could never tighten or replace one.
  it("re-setting an existing hold sends baseRevisionId so the update is accepted", async () => {
    const { calls } = mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: [{ key: "control-plane-execution-hold", body: "{}", latestRevisionId: "77777777-7777-4777-8777-777777777777" }] },
      { match: "/documents/control-plane-execution-hold", body: { ok: true } },
    ]);
    await getTool("paperclipSetExecutionHold").execute({ issueId: ISSUE, kind: "capacity", gateIssueId: GATE, reason: "tighten" });
    const put = calls.find((c) => c.init.method === "PUT");
    expect(put).toBeDefined();
    expect(JSON.parse(String(put?.init.body)).baseRevisionId).toBe("77777777-7777-4777-8777-777777777777");
  });

  // Regression: the sweep asked for limit=100 with no offset and never issued a
  // second request, so on a 556-issue company it inspected 18% of the issues and
  // any stale capacity hold past the first page was unreachable.
  it("company sweep pages past the first page of issues", async () => {
    const page = (n: number) => Array.from({ length: 2 }, (_, i) => ({
      id: `0000000${n}-0000-4000-8000-00000000000${i}`,
      identifier: `KOMAA-${n}${i}`,
      status: "in_progress",
    }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init: init ?? {} });
      const json = (body: unknown, status = 200) => Promise.resolve(mockJsonResponse(body, status));
      if (u.includes("/documents?")) return json([]);
      if (u.includes(`/companies/${COMPANY}/issues`)) {
        // limit=2, so offset 0 and 2 are full pages and offset 4 is short.
        const offset = Number(new URL(u).searchParams.get("offset") ?? "0");
        if (offset >= 4) return json([]);
        return json(offset === 0 ? page(1) : page(2));
      }
      if (u.includes("/diagnostics/")) return json({ blockers: [], wakes: [] });
      if (u.includes("/live-runs")) return json([]);
      if (u.includes("/active-run")) return json(null, 404);
      if (u.includes("/runs")) return json([]);
      return json({ error: `no mock for ${u}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await getTool("paperclipReconcileCompanyControlPlane").execute({ limit: 2 });
    const urls = calls.map((c) => c.url).filter((u) => u.includes(`/companies/${COMPANY}/issues`));
    expect(urls.length).toBe(3);
    expect(urls.some((u) => u.includes("offset=0"))).toBe(true);
    expect(urls.some((u) => u.includes("offset=2"))).toBe(true);
    expect(JSON.parse(res.content[0]?.text ?? "{}").scanned).toBe(4);
  });

  it("creates a new hold without a baseRevisionId when none exists", async () => {
    const { calls } = mockFetchRoutes([
      { match: "/documents?includeSystem=true", body: [] },
      { match: "/documents/control-plane-execution-hold", body: { ok: true } },
    ]);
    await getTool("paperclipSetExecutionHold").execute({ issueId: ISSUE, reason: "first hold" });
    const put = calls.find((c) => c.init.method === "PUT");
    expect(JSON.parse(String(put?.init.body)).baseRevisionId).toBeUndefined();
  });

  // Regression: the company sweep used to skip issues that were themselves
  // terminal, so the stale post-restart serialization hold stranded on KOMAA-451
  // (gate KOMAA-459 done since 2026-10-01) was invisible to
  // paperclipReconcileCompanyControlPlane and could never be cleared.
  it("company sweep finds a stale capacity hold stranded on a terminal issue", async () => {
    const { calls } = mockHeldIssue({ hold: { kind: "execution_hold", reason: STALE_436 }, gateStatus: "done", issueStatus: "done" });
    const dry = await getTool("paperclipReconcileCompanyControlPlane").execute({});
    expect(dry.content[0]?.text ?? "").toContain("would_expire_capacity_hold");
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(false);

    vi.restoreAllMocks();
    const applied = mockHeldIssue({ hold: { kind: "execution_hold", reason: STALE_436 }, gateStatus: "done", issueStatus: "done" });
    const res = await getTool("paperclipReconcileCompanyControlPlane").execute({ apply: true });
    expect(res.content[0]?.text ?? "").toContain("expired_capacity_hold");
    expect(applied.calls.some((c) => c.init.method === "DELETE" && c.url.includes("control-plane-execution-hold"))).toBe(true);
  });
});

// Regression: close_with_evidence posted its evidence comment before checking
// the current disposition. The comment is what wakes the assignee, so re-running
// the delivery cycle over an already-`done` issue reopened it every pass and the
// cycle looped (KOMAA-639: four `[delivery-cycle evidence] disposition=done`
// comments in four minutes, interleaved with terminal-run recovery).
describe("delivery cycle: close_with_evidence is wake-idempotent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Stateful issue mock: a PATCH status transition is visible to the next pass,
  // which is what makes two consecutive passes a real loop replay.
  function mockCycle(issue: { status: string }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = String(init?.method ?? "GET").toUpperCase();
      calls.push({ url: u, init: init ?? {} });
      const json = (body: unknown, status = 200) => Promise.resolve(mockJsonResponse(body, status));
      if (u.includes("/control-plane-revision")) return json({ revision: "rev-640" });
      if (u.includes(`/companies/${COMPANY}/issues`)) return json([]);
      if (u.includes("/dependents")) return json({ dependents: [], count: 0 });
      if (u.includes(`/issues/${ISSUE}/comments`)) return json({ id: "c-640" });
      if (u.includes(`/issues/${ISSUE}`)) {
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (typeof body.status === "string") issue.status = body.status;
        }
        return json({ id: ISSUE, identifier: "KOMAA-640", status: issue.status });
      }
      return json({ error: `no mock for ${u}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const commentPosts = () => calls.filter((c) => String(c.init.method).toUpperCase() === "POST" && c.url.includes("/comments")).length;
    return { calls, commentPosts };
  }

  const runCycle = () => getTool("paperclipRunDeliveryCycle").execute({
    mode: "deliver_only",
    wakePolicy: "none",
    closeRequests: [{ issueId: ISSUE, evidence: "delivered and verified", disposition: "done" }],
  });

  it("posts zero evidence comments on an issue already at the disposition, and still closes", async () => {
    const { commentPosts } = mockCycle({ status: "done" });
    const out = JSON.parse((await runCycle()).content[0]?.text ?? "{}");
    expect(commentPosts()).toBe(0);
    expect(out.disposition).toBe("DELIVERED");
    expect(out.closed).toEqual([{ issueId: ISSUE, disposition: "done" }]);
  });

  it("comments once on a non-terminal issue and does not re-comment on the next pass", async () => {
    const { calls, commentPosts } = mockCycle({ status: "in_progress" });
    await runCycle();
    expect(commentPosts()).toBe(1);
    await runCycle();
    expect(commentPosts()).toBe(1);
    expect(calls.filter((c) => String(c.init.method).toUpperCase() === "PATCH" && c.url.includes(`/issues/${ISSUE}`)).length).toBe(2);
  });
});

// KOMAA-642: the residual loop behind KOMAA-640. The comment wakes the assignee,
// the woken run ends cancelled, terminal-run recovery leaves the issue `blocked`,
// and the next pass reads `blocked` !== `done` -- so it comments again. Two passes
// therefore cost two wakes. Silencing the pathless flavour of `blocked` (zero
// unresolved blockers, no hold, no descriptor) is what closes it; a `blocked`
// issue with any real blocker or descriptor still records its evidence.
describe("delivery cycle: close_with_evidence does not re-comment after recovery re-blocks the issue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // `recovery` mutates issue.status out from under the cycle between passes, which
  // is exactly what terminal-run recovery does to the real issue.
  function mockBlockedCycle(issue: { status: string }, executionState: Record<string, unknown>, executionStateStatus = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = String(init?.method ?? "GET").toUpperCase();
      calls.push({ url: u, init: init ?? {} });
      const json = (body: unknown, status = 200) => Promise.resolve(mockJsonResponse(body, status));
      if (u.includes("/control-plane-revision")) return json({ revision: "rev-642" });
      if (u.includes(`/companies/${COMPANY}/issues`)) return json([]);
      if (u.includes("/dependents")) return json({ dependents: [], count: 0 });
      if (u.includes(`/issues/${ISSUE}/execution-state`)) return json(executionState, executionStateStatus);
      if (u.includes(`/issues/${ISSUE}/comments`)) return json({ id: "c-642" });
      if (u.includes(`/issues/${ISSUE}`)) {
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (typeof body.status === "string") issue.status = body.status;
        }
        return json({ id: ISSUE, identifier: "KOMAA-642", status: issue.status });
      }
      return json({ error: `no mock for ${u}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const commentPosts = () => calls.filter((c) => String(c.init.method).toUpperCase() === "POST" && c.url.includes("/comments")).length;
    return { calls, commentPosts };
  }

  // The recovery block shape read live off the board: no blockers, no hold, no
  // descriptor, and no live run left to execute.
  const RECOVERY_BLOCK = {
    state: "BLOCKED", executable: false, liveRunCount: 0,
    unresolvedBlockerCount: 0, doneBlockerEdgeCount: 0,
    hasExecutionHold: false, hasUnblockDescriptor: false,
  };

  const runCycle = () => getTool("paperclipRunDeliveryCycle").execute({
    mode: "deliver_only",
    wakePolicy: "none",
    closeRequests: [{ issueId: ISSUE, evidence: "delivered and verified", disposition: "done" }],
  });

  it("yields one wake across the pass -> recovery -> pass interleaving, not one per pass", async () => {
    const issue = { status: "in_progress" };
    const { calls, commentPosts } = mockBlockedCycle(issue, RECOVERY_BLOCK);
    await runCycle();
    expect(commentPosts()).toBe(1); // pass 1 wakes the assignee
    expect(issue.status).toBe("done");

    issue.status = "blocked"; // the woken run was cancelled; recovery re-blocks
    const out = JSON.parse((await runCycle()).content[0]?.text ?? "{}");
    expect(commentPosts()).toBe(1); // pass 2 must not wake again
    expect(out.disposition).toBe("DELIVERED");
    expect(issue.status).toBe("done");
    expect(calls.filter((c) => String(c.init.method).toUpperCase() === "PATCH" && c.url.includes(`/issues/${ISSUE}`)).length).toBe(2);
  });

  it("records the silenced evidence on the cycle log instead of dropping it", async () => {
    const { commentPosts } = mockBlockedCycle({ status: "blocked" }, RECOVERY_BLOCK);
    const out = JSON.parse((await runCycle()).content[0]?.text ?? "{}");
    expect(commentPosts()).toBe(0);
    expect(out.suppressedEvidence).toEqual([
      { issueId: ISSUE, disposition: "done", reason: "blocked_no_execution_path", evidence: "delivered and verified" },
    ]);
  });

  it("still records the evidence comment when an unresolved blocker is present", async () => {
    const { commentPosts } = mockBlockedCycle({ status: "blocked" }, { ...RECOVERY_BLOCK, state: "WAITING_DEPENDENCY", unresolvedBlockerCount: 1 });
    const out = JSON.parse((await runCycle()).content[0]?.text ?? "{}");
    expect(commentPosts()).toBe(1);
    expect(out.suppressedEvidence).toBeUndefined();
  });

  // KOMAA-427 / KOMAA-446 on the live board: zero blocker edges, but a descriptor
  // naming a human. Silencing on blocker count alone would hide that record.
  it("still records the evidence comment on a descriptor-only block with zero blockers", async () => {
    const { commentPosts } = mockBlockedCycle({ status: "blocked" }, { ...RECOVERY_BLOCK, state: "HUMAN_ACTION_REQUIRED", hasUnblockDescriptor: true });
    await runCycle();
    expect(commentPosts()).toBe(1);
  });

  it("still records the evidence comment when an execution hold is present", async () => {
    const { commentPosts } = mockBlockedCycle({ status: "blocked" }, { ...RECOVERY_BLOCK, hasExecutionHold: true });
    await runCycle();
    expect(commentPosts()).toBe(1);
  });

  it("still records the evidence comment when the execution-state read fails", async () => {
    // An unreadable execution-state must fall back to commenting: suppression is
    // only safe when the read actually proves the block has no path left.
    const { commentPosts } = mockBlockedCycle({ status: "blocked" }, { error: "boom" }, 500);
    await runCycle();
    expect(commentPosts()).toBe(1);
  });
});

describe("paperclipGetRuntimePreflight workspace isolation (KOMAA-468)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function preflightRules(sourceIssueId: string, holders: unknown[]) {
    return [
      { match: "/heartbeat-context", body: { currentExecutionWorkspace: { id: WS, mode: "isolated_workspace" } } },
      { match: `/issues/${ISSUE}`, body: { id: ISSUE, assigneeAgentId: AGENT, executionWorkspaceId: WS } },
      { match: `/execution-workspaces/${WS}/close-readiness`, body: { ready: true } },
      { match: `/execution-workspaces/${WS}`, body: { id: WS, mode: "isolated_workspace", strategyType: "git_worktree", sourceIssueId, branchName: "KOMAA-774" } },
      { match: "/live-runs", body: holders },
      { match: "/configuration", body: {} },
      { match: "/runtime-state", body: {} },
      { match: "/environments", body: [] },
    ];
  }

  it("fails closed when the task session resolves a foreign per-issue worktree held by a live run", async () => {
    mockFetchRoutes(
      preflightRules(OWNER, [
        { id: "99999999-9999-4999-8999-999999999999", status: "running", contextSnapshot: { executionWorkspaceId: WS } },
      ]),
    );
    const result = await getTool("paperclipGetRuntimePreflight").execute({ issueId: ISSUE });
    expect((result as unknown as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("CROSS_ISSUE_LEASE_REFUSED");
  });

  it("returns the workspace isolation verdict for the issue's own worktree", async () => {
    mockFetchRoutes(preflightRules(ISSUE, []));
    const result = await getTool("paperclipGetRuntimePreflight").execute({ issueId: ISSUE });
    expect((result as unknown as { isError?: boolean }).isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      workspaceIsolation?: { status?: string; violation?: boolean };
    };
    expect(payload.workspaceIsolation?.status).toBe("OWN_WORKSPACE");
    expect(payload.workspaceIsolation?.violation).toBe(false);
  });

  // KOMAA-468 parity regression: the same issue asked for by display
  // identifier and by authoritative UUID must produce the same diagnostic.
  // Before the identifier->UUID normalization the identifier form compared
  // "KOMAA-468" with the workspace owner UUID and reported
  // FOREIGN_UNCONTENDED/violation=true, while the UUID form correctly
  // reported OWN_WORKSPACE/violation=false.
  it("returns the same diagnostic for a display identifier and for the authoritative UUID", async () => {
    const identifier = "KOMAA-468";
    const issueBody = {
      id: ISSUE,
      identifier,
      assigneeAgentId: AGENT,
      executionWorkspaceId: WS,
    };
    mockFetchRoutes([
      { match: "/heartbeat-context", body: { currentExecutionWorkspace: { id: WS, mode: "isolated_workspace" } } },
      { match: `/issues/${identifier}`, body: issueBody },
      { match: `/issues/${ISSUE}`, body: issueBody },
      { match: `/execution-workspaces/${WS}/close-readiness`, body: { ready: true } },
      {
        match: `/execution-workspaces/${WS}`,
        body: {
          id: WS,
          mode: "isolated_workspace",
          strategyType: "git_worktree",
          sourceIssueId: ISSUE,
          branchName: identifier,
        },
      },
      { match: "/live-runs", body: [] },
      { match: "/configuration", body: {} },
      { match: "/runtime-state", body: {} },
      { match: "/environments", body: [] },
    ]);

    const byIdentifier = await getTool("paperclipGetRuntimePreflight").execute({ issueId: identifier });
    const byUuid = await getTool("paperclipGetRuntimePreflight").execute({ issueId: ISSUE });

    expect((byIdentifier as unknown as { isError?: boolean }).isError).toBeFalsy();
    expect((byUuid as unknown as { isError?: boolean }).isError).toBeFalsy();

    const identifierPayload = JSON.parse(byIdentifier.content[0]?.text ?? "{}") as {
      issueId?: string;
      requestedIssueId?: string;
      workspaceIsolation?: { status?: string; violation?: boolean; ownerIssueId?: string | null };
    };
    const uuidPayload = JSON.parse(byUuid.content[0]?.text ?? "{}") as typeof identifierPayload;

    // Both forms resolve to the authoritative UUID before the
    // workspace-ownership comparison, so both report the same issue.
    expect(identifierPayload.issueId).toBe(ISSUE);
    expect(uuidPayload.issueId).toBe(ISSUE);
    expect(identifierPayload.requestedIssueId).toBe(identifier);
    expect(uuidPayload.requestedIssueId).toBe(ISSUE);
    // And therefore the same isolation verdict.
    expect(identifierPayload.workspaceIsolation).toEqual(uuidPayload.workspaceIsolation);
    expect(identifierPayload.workspaceIsolation?.status).toBe("OWN_WORKSPACE");
    expect(identifierPayload.workspaceIsolation?.violation).toBe(false);
    expect(identifierPayload.workspaceIsolation?.ownerIssueId).toBe(ISSUE);
  });
});
