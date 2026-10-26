import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";

function makeClient(runId: string | null = "33333333-3333-3333-3333-333333333333") {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function getTool(name: string, client = makeClient()) {
  const tool = createToolDefinitions(client).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("paperclip MCP tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Exercise the full tool registry regardless of ambient env: production
    // lite-mode filtering (PAPERCLIP_COMPANY_ID / PAPERCLIP_MCP_LITE) must not
    // decide which tools the wiring tests can see.
    vi.stubEnv("PAPERCLIP_MCP_ENABLE_ALL", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds auth headers and run id to mutating requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipUpdateIssue");
    await tool.execute({
      issueId: "PAP-1135",
      status: "done",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-123");
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
  });

  it("forwards an explicit active run id for cross-issue writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateIssue").execute({
      issueId: "PAP-1135",
      status: "in_review",
      runId: "44444444-4444-4444-8444-444444444444",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("forwards an explicit active run id for generic blocker writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipApiRequest").execute({
      method: "PATCH",
      path: "/issues/KOMAA-246",
      jsonBody: JSON.stringify({ status: "blocked" }),
      runId: "55555555-5555-4555-8555-555555555555",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
  });

  it("updates agent capabilities and reporting relationship", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateAgent").execute({
      agentId: "22222222-2222-2222-2222-222222222222",
      reportsTo: "33333333-3333-3333-8333-333333333333",
      capabilities: "Technical delivery lead",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/agents/22222222-2222-2222-2222-222222222222");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      reportsTo: "33333333-3333-3333-8333-333333333333",
      capabilities: "Technical delivery lead",
    });
  });

  it("lists the company skill library with the default company id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse([{ key: "paperclipai/bundled/product/wireframe", name: "wireframe" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipListSkills");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills",
    );
    expect(response.content[0]?.text).toContain("wireframe");
  });

  it("uses default company id for company-scoped list tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse([{ id: "issue-1" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipListIssues");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/issues",
    );
    expect(response.content[0]?.text).toContain("issue-1");
  });

  it("uses default agent id for checkout requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "PAP-1135", status: "in_progress" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCheckoutIssue");
    await tool.execute({
      issueId: "PAP-1135",
    });

    // The checkout write is the call under test; the KOMAA-468 guard reads the
    // issue/workspace before it.
    const write = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST") as [string, RequestInit];
    expect(JSON.parse(String(write[1].body))).toEqual({
      agentId: "22222222-2222-2222-2222-222222222222",
      expectedStatuses: ["todo", "backlog", "blocked"],
    });
  });

  it("allows create issue requests to omit status so the API applies assignee defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "issue-1", status: "todo" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCreateIssue");
    await tool.execute({
      title: "Assigned follow-up",
      assigneeAgentId: "22222222-2222-2222-2222-222222222222",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/issues",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Assigned follow-up",
      workMode: "standard",
      priority: "medium",
      assigneeAgentId: "22222222-2222-2222-2222-222222222222",
      requestDepth: 0,
      allowDuplicate: false,
    });
  });

  it("defaults issue document format to markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ key: "plan", latestRevisionNumber: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipUpsertIssueDocument");
    await tool.execute({
      issueId: "PAP-1135",
      key: "plan",
      body: "# Updated",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      format: "markdown",
      body: "# Updated",
    });
  });

  it("controls issue workspace services through the current execution workspace", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        currentExecutionWorkspace: {
          id: "44444444-4444-4444-8444-444444444444",
          runtimeServices: [],
        },
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        operation: { id: "operation-1" },
        workspace: {
          id: "44444444-4444-4444-8444-444444444444",
          runtimeServices: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              serviceName: "web",
              status: "running",
              url: "http://127.0.0.1:5173",
            },
          ],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipControlIssueWorkspaceServices");
    await tool.execute({
      issueId: "PAP-1135",
      action: "restart",
      workspaceCommandId: "web",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(lookupUrl)).toBe("http://localhost:3100/api/issues/PAP-1135/heartbeat-context");
    expect(lookupInit.method).toBe("GET");

    const [controlUrl, controlInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(controlUrl)).toBe(
      "http://localhost:3100/api/execution-workspaces/44444444-4444-4444-8444-444444444444/runtime-services/restart",
    );
    expect(controlInit.method).toBe("POST");
    expect(JSON.parse(String(controlInit.body))).toEqual({
      workspaceCommandId: "web",
    });
  });

  it("waits for an issue workspace runtime service URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        currentExecutionWorkspace: {
          id: "44444444-4444-4444-8444-444444444444",
          runtimeServices: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              serviceName: "web",
              status: "running",
              healthStatus: "healthy",
              url: "http://127.0.0.1:5173",
            },
          ],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipWaitForIssueWorkspaceService");
    const response = await tool.execute({
      issueId: "PAP-1135",
      serviceName: "web",
      timeoutSeconds: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.content[0]?.text).toContain("http://127.0.0.1:5173");
  });

  it("rejects malformed UUID-looking project ids before the upstream request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipGetProject").execute({
      projectId: "3d251932-c5e1-4ebe-bb4a-3d46628a76e",
    });

    expect(JSON.parse(response.content[0]?.text ?? "{}").code).toBe("INVALID_ARGUMENTS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts company-scoped short project references", async () => {
    const projectId = "3d251932-c5e1-4ebe-bb4a-3d46628a1951";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse([{ id: projectId, urlKey: "paperclip-ops" }]))
      .mockResolvedValueOnce(mockJsonResponse({ id: projectId, urlKey: "paperclip-ops" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipGetProject").execute({ projectId: "paperclip-ops" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/projects");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`http://localhost:3100/api/projects/${projectId}`);
  });

  it("lists only the caller's agent chats with a bounded summary payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([
      {
        id: "chat-1",
        identifier: "CHAT-1",
        title: "Chat with MCP Engineer",
        conversationAgentId: "agent-1",
        conversationUserId: "user-1",
        conversationState: "waiting",
        conversationSessionGeneration: 2,
        conversationBoundaryCommentId: "boundary-1",
        status: "in_review",
        updatedAt: "2026-10-18T20:00:00Z",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipListAgentChats").execute({ limit: 10 });
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(String(url)).toBe("http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/chats");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
    expect(result).toMatchObject({ total: 1, returned: 1, truncated: false });
    expect(result.chats[0]).toMatchObject({ chatId: "chat-1", agentId: "agent-1", sessionGeneration: 2 });
    expect(result.chats[0]).not.toHaveProperty("conversationUserId");
  });

  it("gets an existing agent chat without creating one when absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(null));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipGetAgentChat").execute({ agentRef: "mcp-engineer" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/chats/mcp-engineer");
    expect(JSON.parse(response.content[0]?.text ?? "{}")).toEqual({
      agentRef: "mcp-engineer",
      exists: false,
      chat: null,
    });
  });

  it("sends a user chat message idempotently without an issue-run header", async () => {
    const chatId = "44444444-4444-4444-8444-444444444444";
    const requestId = "66666666-6666-4666-8666-666666666666";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        id: chatId,
        conversationAgentId: "22222222-2222-2222-2222-222222222222",
        conversationUserId: "user-1",
      }))
      .mockResolvedValueOnce(mockJsonResponse({ id: "comment-1", body: "hello" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipSendChatMessage", makeClient(null)).execute({
      chatId,
      message: "hello",
      clientRequestId: requestId,
    });
    const [preflightUrl, preflightInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const result = JSON.parse(response.content[0]?.text ?? "{}");

    expect(String(preflightUrl)).toBe(`http://localhost:3100/api/issues/${chatId}`);
    expect(preflightInit.method).toBe("GET");
    expect(String(sendUrl)).toBe(`http://localhost:3100/api/issues/${chatId}/comments`);
    expect(sendInit.method).toBe("POST");
    expect(JSON.parse(String(sendInit.body))).toEqual({ body: "hello", clientRequestId: requestId });
    expect((sendInit.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
    expect((sendInit.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBeUndefined();
    expect(result).toMatchObject({ chatId, clientRequestId: requestId, responsePending: true });
  });

  it("refuses to send chat messages to regular issues", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "regular-issue", conversationAgentId: null }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipSendChatMessage").execute({ chatId: "regular-issue", message: "hello" });

    expect(JSON.parse(response.content[0]?.text ?? "{}").code).toBe("INVALID_ARGUMENTS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads chat messages chronologically from the requested cursor", async () => {
    const chatId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        id: chatId,
        conversationAgentId: "22222222-2222-2222-2222-222222222222",
        conversationUserId: "user-1",
      }))
      .mockResolvedValueOnce(mockJsonResponse([{ id: "comment-2", body: "reply" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipGetChatMessages").execute({ chatId, after: "comment-1" });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const result = JSON.parse(response.content[0]?.text ?? "{}");

    expect(String(url)).toBe(`http://localhost:3100/api/issues/${chatId}/comments?order=asc&limit=100&after=comment-1`);
    expect(init.method).toBe("GET");
    expect(result.messages).toEqual([{ id: "comment-2", body: "reply" }]);
  });

  it("starts a fresh session with /new while retaining the chat issue", async () => {
    const chatId = "44444444-4444-4444-8444-444444444444";
    const requestId = "77777777-7777-4777-8777-777777777777";
    const chat = {
      id: chatId,
      conversationAgentId: "22222222-2222-2222-2222-222222222222",
      conversationUserId: "user-1",
      conversationSessionGeneration: 3,
      conversationBoundaryCommentId: "boundary-3",
      title: "Chat with MCP Engineer",
      status: "in_review",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse(chat))
      .mockResolvedValueOnce(mockJsonResponse({ id: "boundary-4", body: "/new", conversationSessionGeneration: 3 }, 201))
      .mockResolvedValueOnce(mockJsonResponse(chat));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipNewChatSession").execute({ agentRef: "mcp-engineer", clientRequestId: requestId });
    const [openUrl, openInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [resetUrl, resetInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const result = JSON.parse(response.content[0]?.text ?? "{}");

    expect(String(openUrl)).toBe("http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/chats/mcp-engineer");
    expect(openInit.method).toBe("POST");
    expect(String(resetUrl)).toBe(`http://localhost:3100/api/issues/${chatId}/comments`);
    expect(resetInit.method).toBe("POST");
    expect(JSON.parse(String(resetInit.body))).toEqual({ body: "/new", clientRequestId: requestId });
    expect(result).toMatchObject({
      chat: { chatId, sessionGeneration: 3, boundaryCommentId: "boundary-4" },
      clientRequestId: requestId,
      historyDeleted: false,
      sessionReset: {
        status: "pending",
        previousGeneration: 3,
        observedGeneration: 3,
        boundaryCommentId: "boundary-4",
      },
      sessionResetPending: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a /new session reset as applied once the new generation is observable", async () => {
    const chatId = "44444444-4444-4444-8444-444444444444";
    const chat = {
      id: chatId,
      conversationAgentId: "22222222-2222-2222-2222-222222222222",
      conversationUserId: "user-1",
      conversationSessionGeneration: 3,
      conversationBoundaryCommentId: "boundary-3",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse(chat))
      .mockResolvedValueOnce(mockJsonResponse({ id: "boundary-4", body: "/new", conversationSessionGeneration: 4 }, 201))
      .mockResolvedValueOnce(mockJsonResponse({ ...chat, conversationSessionGeneration: 4, conversationBoundaryCommentId: "boundary-4" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getTool("paperclipNewChatSession").execute({ agentRef: "mcp-engineer" });
    const result = JSON.parse(response.content[0]?.text ?? "{}");

    expect(result).toMatchObject({
      chat: { chatId, sessionGeneration: 4, boundaryCommentId: "boundary-4" },
      sessionReset: { status: "applied", previousGeneration: 3, observedGeneration: 4 },
      sessionResetPending: false,
      historyDeleted: false,
    });
  });

  it("creates suggest_tasks interactions with the expected issue-scoped payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "interaction-1", kind: "suggest_tasks" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipSuggestTasks");
    await tool.execute({
      issueId: "PAP-1135",
      idempotencyKey: "run-1:suggest",
      payload: {
        version: 1,
        tasks: [{
          clientKey: "task-1",
          title: "One",
          assigneeAgentId: "22222222-2222-2222-2222-222222222222",
        }],
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135/interactions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      idempotencyKey: "run-1:suggest",
      payload: {
        version: 1,
        tasks: [{
          clientKey: "task-1",
          title: "One",
          assigneeAgentId: "22222222-2222-2222-2222-222222222222",
        }],
      },
    });
  });

  it("creates request_confirmation interactions with plan target payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "interaction-1", kind: "request_confirmation" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipRequestConfirmation");
    await tool.execute({
      issueId: "PAP-1135",
      idempotencyKey: "confirmation:PAP-1135:plan:33333333-3333-4333-8333-333333333333",
      title: "Plan approval",
      payload: {
        version: 1,
        prompt: "Accept this plan?",
        acceptLabel: "Accept plan",
        allowDeclineReason: true,
        rejectLabel: "Request changes",
        rejectRequiresReason: true,
        supersedeOnUserComment: true,
        target: {
          type: "issue_document",
          key: "plan",
          revisionId: "33333333-3333-4333-8333-333333333333",
          revisionNumber: 3,
        },
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135/interactions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "request_confirmation",
      continuationPolicy: "none",
      idempotencyKey: "confirmation:PAP-1135:plan:33333333-3333-4333-8333-333333333333",
      title: "Plan approval",
      payload: {
        version: 1,
        prompt: "Accept this plan?",
        acceptLabel: "Accept plan",
        allowDeclineReason: true,
        rejectLabel: "Request changes",
        rejectRequiresReason: true,
        supersedeOnUserComment: true,
        target: {
          type: "issue_document",
          key: "plan",
          revisionId: "33333333-3333-4333-8333-333333333333",
          revisionNumber: 3,
        },
      },
    });
  });

  it("creates request_checkbox_confirmation interactions with checkbox payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "interaction-1", kind: "request_checkbox_confirmation" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipRequestCheckboxConfirmation");
    await tool.execute({
      issueId: "PAP-1135",
      idempotencyKey: "confirmation:PAP-1135:files",
      title: "Choose files",
      payload: {
        version: 1,
        prompt: "Which files should be included?",
        detailsMarkdown: "Pick the files to attach.",
        options: [
          { id: "file-a", label: "File A", description: "Primary draft" },
          { id: "file-b", label: "File B" },
        ],
        defaultSelectedOptionIds: ["file-a"],
        minSelected: 1,
        maxSelected: 2,
        acceptLabel: "Use selected files",
        rejectLabel: "Do not attach files",
        rejectRequiresReason: true,
        allowDeclineReason: false,
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135/interactions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "request_checkbox_confirmation",
      continuationPolicy: "wake_assignee",
      idempotencyKey: "confirmation:PAP-1135:files",
      title: "Choose files",
      payload: {
        version: 1,
        prompt: "Which files should be included?",
        detailsMarkdown: "Pick the files to attach.",
        options: [
          { id: "file-a", label: "File A", description: "Primary draft" },
          { id: "file-b", label: "File B" },
        ],
        defaultSelectedOptionIds: ["file-a"],
        minSelected: 1,
        maxSelected: 2,
        acceptLabel: "Use selected files",
        rejectLabel: "Do not attach files",
        rejectRequiresReason: true,
        allowDeclineReason: false,
      },
    });
  });

  it("creates approvals with the expected company-scoped payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "approval-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCreateApproval");
    await tool.execute({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/approvals",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });
  });

  it("rejects invalid generic request paths", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "issues",
    });

    expect(response.content[0]?.text).toContain("path must start with /");
  });

  it("rejects generic request paths that escape /api", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "/../../secret",
    });

    expect(response.content[0]?.text).toContain("must not contain '..'");
  });

  it("rejects issue creation without an agent assignee", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCreateIssue");
    const response = await tool.execute({ title: "Unassigned work" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("assigneeAgentId");
  });

  it("rejects suggested tasks without an agent assignee", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipSuggestTasks");
    const response = await tool.execute({
      issueId: "PAP-1135",
      payload: {
        version: 1,
        tasks: [{ clientKey: "task-1", title: "One" }],
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("assigneeAgentId");
  });

  it("rejects generic task creation without an agent assignee", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "POST",
      path: "/companies/11111111-1111-1111-1111-111111111111/issues",
      jsonBody: JSON.stringify({ title: "Unassigned work" }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("assigneeAgentId");
  });

  it("rejects removing the agent assignee through issue updates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipUpdateIssue");
    const response = await tool.execute({ issueId: "PAP-1135", assigneeAgentId: null });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("assignment");
  });

  it("exposes all skill management tools", async () => {
    const names = createToolDefinitions(makeClient()).map((tool) => tool.name);
    for (const expected of [
      "paperclipListSkills",
      "paperclipGetSkill",
      "paperclipListCatalogSkills",
      "paperclipGetCatalogSkill",
      "paperclipCreateSkill",
      "paperclipUpdateSkill",
      "paperclipDeleteSkill",
      "paperclipInstallCatalogSkill",
      "paperclipInstallSkillUpdate",
      "paperclipGetSkillUpdateStatus",
      "paperclipGetSkillFile",
      "paperclipUpdateSkillFile",
      "paperclipAuditSkill",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("lists skills with search query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipListSkills").execute({ q: "browser", sort: "recent" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills?q=browser&sort=recent",
    );
    expect(init.method).toBe("GET");
  });

  it("gets a single skill by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "skill-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipGetSkill").execute({ skillId: "skill-1" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills/skill-1",
    );
  });

  it("creates, updates and deletes a skill through the dedicated endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "skill-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipCreateSkill").execute({ name: "E2E skill", markdown: "# hi" });
    await getTool("paperclipUpdateSkill").execute({ skillId: "skill-1", description: "updated" });
    await getTool("paperclipDeleteSkill").execute({ skillId: "skill-1" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls.map(([url, init]) => [
      String(url),
      (init as RequestInit).method,
      (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : undefined,
    ]);
    expect(calls[0][0]).toBe("http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills");
    expect(calls[0][1]).toBe("POST");
    expect(calls[0][2]).toMatchObject({ name: "E2E skill" });
    expect(calls[1][0]).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills/skill-1",
    );
    expect(calls[1][1]).toBe("PATCH");
    expect(calls[1][2]).toMatchObject({ description: "updated" });
    expect(calls[2][0]).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills/skill-1",
    );
    expect(calls[2][1]).toBe("DELETE");
  });

  it("installs catalog skills and origin updates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ action: "created" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipInstallCatalogSkill").execute({ catalogSkillId: "catalog-1" });
    await getTool("paperclipInstallSkillUpdate").execute({ skillId: "skill-1", force: true });

    const urls = fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit).method]);
    expect(urls).toEqual([
      [
        "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills/install-catalog",
        "POST",
      ],
      [
        "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/skills/skill-1/install-update",
        "POST",
      ],
    ]);
  });

  it("rejects skill routes through the generic api request fallback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "/companies/11111111-1111-1111-1111-111111111111/skills",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("dedicated paperclip*Skill tools");
  });
});

describe("run detail contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers backend id for runId in GetRunDetail", async () => {
    const runId = "99999999-9999-4999-8999-999999999999";
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith(`/heartbeat-runs/${runId}`)) return Promise.resolve(mockJsonResponse({ id: runId, status: "succeeded", agentId: "a1" }));
      if (u.includes("/events")) return Promise.resolve(mockJsonResponse([]));
      return Promise.resolve(mockJsonResponse([], 200));
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await getTool("paperclipGetRunDetail").execute({ runId });
    expect(res.content[0]?.text ?? "").toContain(runId);
    expect(res.content[0]?.text ?? "").not.toContain('"runId": null');
  });
});

describe("paperclipUpdateIssue terminal status preservation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pins the observed status on a metadata-only update of a cancelled issue", async () => {
    const cancelled = { id: "KOMAA-841", status: "cancelled" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse(cancelled))
      .mockResolvedValueOnce(mockJsonResponse(cancelled))
      .mockResolvedValueOnce(mockJsonResponse(cancelled));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getTool("paperclipUpdateIssue").execute({
      issueId: "KOMAA-841",
      title: "Archiwum — canary Paperclip MCP (→ KOMAA-1415)",
      comment: "consolidated into KOMAA-1415",
    });

    expect((res as { isError?: boolean }).isError).not.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(getInit.method).toBe("GET");
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    const sent = JSON.parse(String(patchInit.body)) as Record<string, unknown>;
    expect(sent.status).toBe("cancelled");
    expect(sent.title).toContain("Archiwum");
    const [, verifyInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(verifyInit.method).toBe("GET");
  });

  it("restores terminal state once when upstream reopens it, then reports success only after proof", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ status: "cancelled" }))
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({ status: "todo" }))
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({ status: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getTool("paperclipUpdateIssue").execute({ issueId: "KOMAA-841", title: "x" });

    expect((res as { isError?: boolean }).isError).not.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [, repairInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(repairInit.method).toBe("PATCH");
    expect(JSON.parse(String(repairInit.body))).toEqual({ status: "cancelled" });
  });

  it("fails closed when the terminal status cannot be proven after the repair attempt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ status: "cancelled" }))
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({ status: "todo" }))
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({ status: "todo" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getTool("paperclipUpdateIssue").execute({ issueId: "KOMAA-841", title: "x" });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("TERMINAL_STATUS_REOPENED");
  });

  it("leaves non-terminal metadata updates untouched", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ status: "in_progress" }))
      .mockResolvedValueOnce(mockJsonResponse({ status: "in_progress" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateIssue").execute({ issueId: "KOMAA-1415", title: "y" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((JSON.parse(String(patchInit.body)) as Record<string, unknown>).status).toBeUndefined();
  });

  it("still allows an explicit terminal-to-active transition", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ status: "todo" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateIssue").execute({ issueId: "KOMAA-841", status: "todo" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, patchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect((JSON.parse(String(patchInit.body)) as Record<string, unknown>).status).toBe("todo");
  });

  it("does not pin status when the caller explicitly asks to reopen", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockJsonResponse({ status: "todo" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateIssue").execute({ issueId: "KOMAA-841", reopen: true, title: "z" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, patchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(patchInit.body)) as Record<string, unknown>;
    expect(sent.status).toBeUndefined();
    expect(sent.reopen).toBe(true);
  });
});
