// KOMAA-401 acceptance C/D/E: board-authorized cross-issue recovery from a
// remote MCP operator session. The regression is that these three paths are
// reachable ONLY with a board key, so a dual-key client that keeps the
// agent key on them 403s ("Agent can only checkout as itself" /
// "Agent can only invoke itself"). Agent-key paths must stay on the agent key.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient, requiresBoardAuth, resolveCredentialClass } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CALLER = "22222222-2222-2222-2222-222222222222"; // operator session's own agent
const TARGET = "33333333-3333-3333-3333-333333333333"; // issue owner being recovered
const ISSUE = "44444444-4444-4444-8444-444444444444";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: CALLER,
    runId: "55555555-5555-5555-5555-555555555555",
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function getTool(name: string) {
  const tool = createControlPlaneTools(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockFetchRoutes(rules: Array<{ match: string; body: unknown; status?: number }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const rule = rules.find((r) => String(url).includes(r.match));
    const body = rule ? rule.body : { error: `no mock for ${url}` };
    const status = rule?.status ?? (rule ? 200 : 500);
    return Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const authOf = (call: { init: RequestInit }) =>
  (call.init.headers as Record<string, string>).Authorization;

async function runTool(name: string, input: Record<string, unknown>) {
  const res = await getTool(name).execute(input);
  return JSON.parse(String(res.content[0]?.text ?? "{}")) as Record<string, unknown>;
}

describe("KOMAA-401 cross-issue recovery key selection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks out a foreign-owned issue with the board key, attributed to the owner", async () => {
    const calls = mockFetchRoutes([
      { match: "/live-runs", body: [] },
      { match: "/diagnostics/blockers", body: { blockers: [] } },
      { match: "/execution-hold", body: null, status: 404 },
      { match: "/checkout", body: { checkoutRunId: "run-1" } },
      // KOMAA-1415: a checkout 200 alone is not a wake; the observed run must exist.
      { match: "/heartbeat-runs/run-1", body: { id: "run-1", status: "queued", issueId: ISSUE } },
      { match: "/issues/", body: { id: ISSUE, status: "todo", assigneeAgentId: TARGET } },
    ]);

    const result = await runTool("paperclipWakeIssueFresh", { issueId: ISSUE });

    expect(result).toMatchObject({ woke: true, agentId: TARGET, observedFrom: "heartbeat-run" });
    const checkout = calls.find((c) => c.url.includes("/checkout"));
    expect(authOf(checkout!)).toBe("Bearer token-board");
    // No impersonation: the checkout names the OWNER, not the caller's agent.
    expect(JSON.parse(String(checkout!.init.body)).agentId).toBe(TARGET);
  });

  it("refuses a blocked, dependency-held issue without force (acceptance G)", async () => {
    const calls = mockFetchRoutes([
      { match: "/live-runs", body: [] },
      { match: "/diagnostics/blockers", body: { blockers: [{ id: "dep-1" }] } },
      { match: "/execution-hold", body: null, status: 404 },
      { match: "/issues/", body: { id: ISSUE, status: "blocked", assigneeAgentId: TARGET } },
    ]);

    const result = await runTool("paperclipWakeIssueFresh", { issueId: ISSUE });

    expect(result).toMatchObject({ woke: false, blockerCount: 1 });
    expect(calls.some((c) => c.url.includes("/checkout"))).toBe(false);
  });

  it("directs a peer wakeup at the board key", () => {
    expect(requiresBoardAuth("POST", `/agents/${TARGET}/wakeup`)).toBe(true);
    expect(requiresBoardAuth("POST", `/agents/${TARGET}/heartbeat/invoke`)).toBe(true);
    // Agent reads under /agents/* 401 on a board key — must not regress.
    expect(requiresBoardAuth("GET", `/agents/${TARGET}`)).toBe(false);
    expect(requiresBoardAuth("GET", "/agents/me")).toBe(false);
  });

  it("force-release uses the board key and stays out of agent hands", () => {
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/admin/force-release`)).toBe(true);
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/admin/force-release?clearAssignee=true`)).toBe(true);
    expect(requiresBoardAuth("GET", `/issues/${ISSUE}/admin/force-release`)).toBe(false);
  });

  it("keeps agent-scoped issue writes on the agent key", () => {
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/comments`)).toBe(false);
    expect(requiresBoardAuth("PATCH", `/issues/${ISSUE}`)).toBe(false);
    expect(requiresBoardAuth("GET", `/issues/${ISSUE}`)).toBe(false);
  });

  it("routes Board-only agent-key management endpoints through the Board key", async () => {
    expect(requiresBoardAuth("GET", `/agents/${TARGET}/keys`)).toBe(true);
    expect(requiresBoardAuth("POST", `/agents/${TARGET}/keys`)).toBe(true);
    expect(requiresBoardAuth("DELETE", `/agents/${TARGET}/keys/key-1`)).toBe(true);
    expect(requiresBoardAuth("GET", `/agents/${TARGET}`)).toBe(false);
    const calls = mockFetchRoutes([{ match: `/agents/${TARGET}/keys`, body: [] }]);
    await makeClient().requestJson("GET", `/agents/${TARGET}/keys`);
    expect(authOf(calls[0])).toBe("Bearer token-board");
    expect(requiresBoardAuth("POST", `/execution-workspaces/${ISSUE}/reconcile-branch`)).toBe(true);
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/recovery-actions/resolve`, { outcome: "false_positive" })).toBe(true);
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/recovery-actions/resolve`, { outcome: "cancelled" })).toBe(true);
    expect(requiresBoardAuth("POST", `/issues/${ISSUE}/recovery-actions/resolve`, { outcome: "restored" })).toBe(false);
    const bodyCalls = mockFetchRoutes([{ match: "/recovery-actions/resolve", body: { ok: true } }]);
    const bodyClient = makeClient();
    await bodyClient.requestJson("POST", `/issues/${ISSUE}/recovery-actions/resolve`, { body: { outcome: "false_positive" } });
    await bodyClient.requestJson("POST", `/issues/${ISSUE}/recovery-actions/resolve`, { body: { outcome: "restored" } });
    expect(authOf(bodyCalls[0])).toBe("Bearer token-board");
    expect(authOf(bodyCalls[1])).toBe("Bearer token-123");
  });

  it("resolves routes through one permission matrix without identity fallback", () => {
    expect(resolveCredentialClass("GET", `/issues/${ISSUE}`)).toBe("caller");
    expect(resolveCredentialClass("GET", `/agents/${CALLER}`, { callerAgentId: CALLER })).toBe("agent");
    expect(resolveCredentialClass("GET", `/agents/${TARGET}/keys`, { callerAgentId: CALLER })).toBe("board");
    expect(resolveCredentialClass("POST", `/agents/${CALLER}/wakeup`, { callerAgentId: CALLER })).toBe("agent");
    expect(resolveCredentialClass("POST", `/agents/${TARGET}/wakeup`, { callerAgentId: CALLER })).toBe("board");
    expect(resolveCredentialClass("POST", `/heartbeat-runs/${"55555555-5555-5555-5555-555555555555"}/cancel`, { runId: "55555555-5555-5555-5555-555555555555" })).toBe("caller");
    expect(resolveCredentialClass("POST", `/heartbeat-runs/${"55555555-5555-5555-5555-555555555555"}/cancel`, { runId: "66666666-6666-4666-8666-666666666666" })).toBe("board");
    expect(resolveCredentialClass("POST", `/issues/${ISSUE}/checkout`, { callerAgentId: CALLER, body: { agentId: CALLER } })).toBe("caller");
    expect(resolveCredentialClass("POST", `/issues/${ISSUE}/checkout`, { callerAgentId: CALLER, body: { agentId: TARGET } })).toBe("board");
  });

  it("fails closed before fetch when a Board-only route has no Board credential", async () => {
    const calls = mockFetchRoutes([]);
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-agent",
      companyId: COMPANY,
      agentId: CALLER,
      runId: null,
      agentApiKey: null,
      boardApiKey: null,
    });
    let error: (Error & { detail?: Record<string, unknown> }) | null = null;
    try {
      await client.requestJson("GET", `/agents/${TARGET}/keys`);
    } catch (caught) {
      error = caught as Error & { detail?: Record<string, unknown> };
    }
    expect(error?.message).toContain("[errorCode=CONFIGURATION_MISSING]");
    expect(error?.detail).toMatchObject({ remediationOwner: "board" });
    expect(calls).toHaveLength(0);
  });

  it("uses the agent caller key when Paperclip runtime omits a duplicate agentApiKey", async () => {
    const calls = mockFetchRoutes([{ match: `/agents/${CALLER}`, body: { id: CALLER } }]);
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-agent-caller",
      companyId: COMPANY,
      agentId: CALLER,
      runId: null,
      agentApiKey: null,
      boardApiKey: "token-board",
    });
    await client.requestJson("GET", `/agents/${CALLER}`);
    expect(authOf(calls[0])).toBe("Bearer token-agent-caller");
  });

  it("routes issue mutations without a scoped run through the board key", async () => {
    const calls = mockFetchRoutes([{ match: `/issues/${ISSUE}`, body: { id: ISSUE, status: "todo" } }]);
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-agent",
      companyId: COMPANY,
      agentId: CALLER,
      runId: null,
      agentApiKey: null,
      boardApiKey: "token-board",
    });
    const res = await client.requestJson("PATCH", `/issues/${ISSUE}`, { body: { status: "todo" } });
    expect(authOf(calls[0])).toBe("Bearer token-board");
    expect(res).toMatchObject({ id: ISSUE });
    expect(calls).toHaveLength(1);
  });
});


describe("central Paperclip authorization matrix", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves caller, agent and Board credentials by explicit route policy", () => {
    expect(resolveCredentialClass("GET", `/issues/${ISSUE}`)).toBe("caller");
    expect(resolveCredentialClass("GET", `/agents/${CALLER}`, { callerAgentId: CALLER })).toBe("agent");
    expect(resolveCredentialClass("GET", `/agents/${TARGET}/keys`, { callerAgentId: CALLER })).toBe("board");
    expect(resolveCredentialClass("POST", `/agents/${CALLER}/wakeup`, { callerAgentId: CALLER })).toBe("agent");
    expect(resolveCredentialClass("POST", `/agents/${TARGET}/wakeup`, { callerAgentId: CALLER })).toBe("board");
    const ownRun = "55555555-5555-5555-5555-555555555555";
    const foreignRun = "66666666-6666-4666-8666-666666666666";
    expect(resolveCredentialClass("POST", `/heartbeat-runs/${ownRun}/cancel`, { runId: ownRun })).toBe("caller");
    expect(resolveCredentialClass("POST", `/heartbeat-runs/${ownRun}/cancel`, { runId: foreignRun })).toBe("board");
    expect(resolveCredentialClass("POST", `/issues/${ISSUE}/checkout`, { callerAgentId: CALLER, body: { agentId: CALLER } })).toBe("caller");
    expect(resolveCredentialClass("POST", `/issues/${ISSUE}/checkout`, { callerAgentId: CALLER, body: { agentId: TARGET } })).toBe("board");
  });

  it("does not fall back to an agent key when a Board credential is required", async () => {
    const calls = mockFetchRoutes([]);
    const client = new PaperclipApiClient({ apiUrl: "http://localhost:3100/api", apiKey: "agent-key", companyId: COMPANY, agentId: CALLER, runId: null, agentApiKey: null, boardApiKey: null });
    let caught: (Error & { detail?: Record<string, unknown> }) | null = null;
    try { await client.requestJson("GET", `/agents/${TARGET}/keys`); } catch (error) { caught = error as Error & { detail?: Record<string, unknown> }; }
    expect(caught?.message).toContain("[errorCode=CONFIGURATION_MISSING]");
    expect(caught?.detail).toMatchObject({ remediationOwner: "board" });
    expect(calls).toHaveLength(0);
  });

  it("uses the caller's configured agent key when the duplicate agent-key binding is absent", async () => {
    const calls = mockFetchRoutes([{ match: `/agents/${CALLER}`, body: { id: CALLER } }]);
    const client = new PaperclipApiClient({ apiUrl: "http://localhost:3100/api", apiKey: "agent-caller", companyId: COMPANY, agentId: CALLER, runId: null, agentApiKey: null, boardApiKey: "board-key" });
    await client.requestJson("GET", `/agents/${CALLER}`);
    expect(authOf(calls[0])).toBe("Bearer agent-caller");
  });

  it("preflights missing issue run context before any write request", async () => {
    const calls = mockFetchRoutes([]);
    const client = new PaperclipApiClient({ apiUrl: "http://localhost:3100/api", apiKey: "agent-key", companyId: COMPANY, agentId: CALLER, runId: null, agentApiKey: null, boardApiKey: null });
    let caught: Error | null = null;
    try { await client.requestJson("PATCH", `/issues/${ISSUE}`, { body: { status: "todo" } }); } catch (error) { caught = error as Error; }
    expect(caught?.message).toContain("[errorCode=RUN_CONTEXT_REQUIRED]");
    expect(calls).toHaveLength(0);
  });

  it("does not retry a Board denial under the caller or agent credential", async () => {
    const calls = mockFetchRoutes([{ match: `/agents/${TARGET}/keys`, body: { error: "Board access required" }, status: 403 }]);
    const client = new PaperclipApiClient({ apiUrl: "http://localhost:3100/api", apiKey: "agent-caller", companyId: COMPANY, agentId: CALLER, runId: null, agentApiKey: "agent-key", boardApiKey: "board-key" });
    await expect(client.requestJson("GET", `/agents/${TARGET}/keys`)).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(1);
    expect(authOf(calls[0])).toBe("Bearer board-key");
  });
});
