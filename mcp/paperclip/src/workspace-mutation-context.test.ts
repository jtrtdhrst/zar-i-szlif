import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaperclipApiClient } from "./client.js";
import {
  authorizeWorkspaceMutation,
  assertWorkspaceMutationScope,
  resolveCallerIdentity,
  verifyLiveAgentRun,
  type WorkspaceMutationContext,
  type ResolvedWorkspace,
} from "./workspace-native.js";

// P0 2026-10-17 regression: operator sessions were removed in Paperclip
// 2026.1012.0 (POST /companies/:id/operator-runs gone). Workspace mutations
// must authorize via the caller's own live heartbeat run (issue-bound) or a
// board key, and fail closed otherwise. A stale operatorRunId is honored only
// while it still verifies; a run that is not the caller's own, not running, or
// bound to another issue never authorizes a mutation.

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const OTHER_AGENT = "33333333-3333-3333-3333-333333333333";
const RUN = "44444444-4444-4444-4444-444444444444";
const OPERATOR_RUN = "55555555-5555-5555-5555-555555555555";
const ISSUE = "66666666-6666-6666-6666-666666666666";
const OTHER_ISSUE = "77777777-7777-7777-7777-777777777777";

function makeClient(apiKey = "pcp_agent_key") {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey,
    companyId: COMPANY,
    agentId: AGENT,
    runId: null,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function routeFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [part, body] of Object.entries(routes)) {
        if (url.includes(part)) return jsonResponse(body, body === null ? 404 : 200);
      }
      return jsonResponse({ error: "not mocked" }, 404);
    }),
  );
}

const ws: ResolvedWorkspace = {
  workspaceId: "88888888-8888-8888-8888-888888888888",
  cwd: "/x",
  realCwd: "/x",
  companyId: COMPANY,
  sourceIssueId: ISSUE,
  branchName: "KOMAA-845/work",
};

const liveRun = {
  id: RUN,
  companyId: COMPANY,
  agentId: AGENT,
  status: "running",
  contextSnapshot: { issueId: ISSUE },
};

describe("resolveCallerIdentity", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves the caller's own agent via GET /agents/me", async () => {
    routeFetch({ "/agents/me": { id: AGENT } });
    const id = await resolveCallerIdentity(makeClient());
    expect(id).toEqual({ type: "agent", agentId: AGENT });
  });

  it("treats a pcp_board_ key as board authority", async () => {
    routeFetch({ "/agents/me": null });
    const id = await resolveCallerIdentity(makeClient("pcp_board_abc"));
    expect(id).toEqual({ type: "board" });
  });

  it("denies when neither identity resolves", async () => {
    routeFetch({ "/agents/me": null, "/companies": null });
    const id = await resolveCallerIdentity(makeClient());
    expect(id).toEqual({ type: "unknown" });
  });
});

describe("verifyLiveAgentRun", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts the caller's own running run and extracts the issue binding", async () => {
    routeFetch({ "/heartbeat-runs/": liveRun });
    const out = await verifyLiveAgentRun(makeClient(), RUN, AGENT);
    expect(out.runIssueId).toBe(ISSUE);
  });

  it("refuses a run owned by another agent", async () => {
    routeFetch({ "/heartbeat-runs/": { ...liveRun, agentId: OTHER_AGENT } });
    await expect(verifyLiveAgentRun(makeClient(), RUN, AGENT)).rejects.toThrow(/does not belong/);
  });

  it("refuses a non-running run (the run's end is the credential's expiration)", async () => {
    routeFetch({ "/heartbeat-runs/": { ...liveRun, status: "succeeded" } });
    await expect(verifyLiveAgentRun(makeClient(), RUN, AGENT)).rejects.toThrow(/not live/);
  });

  it("refuses a run from another company", async () => {
    routeFetch({ "/heartbeat-runs/": { ...liveRun, companyId: "99999999-9999-9999-9999-999999999999" } });
    await expect(verifyLiveAgentRun(makeClient(), RUN, AGENT)).rejects.toThrow(/another company/);
  });
});

describe("authorizeWorkspaceMutation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("board key: authority board without any run", async () => {
    routeFetch({ "/agents/me": null });
    const ctx = await authorizeWorkspaceMutation(makeClient("pcp_board_abc"), {});
    expect(ctx).toEqual({ authority: "board" });
  });

  it("agent key without runId fails closed with run_context_required", async () => {
    routeFetch({ "/agents/me": { id: AGENT } });
    const err = await authorizeWorkspaceMutation(makeClient(), {}).catch((e) => e);
    expect((err as Error).message).toContain("run_context_required");
  });

  it("agent key with its own live run gets issue-bounded authority", async () => {
    routeFetch({ "/agents/me": { id: AGENT }, "/heartbeat-runs/": liveRun });
    const ctx = await authorizeWorkspaceMutation(makeClient(), { runId: RUN });
    expect(ctx).toEqual({ authority: "agent-run", runId: RUN, agentId: AGENT, runIssueId: ISSUE });
  });

  it("falls back to the session default runId (PAPERCLIP_RUN_ID)", async () => {
    routeFetch({ "/agents/me": { id: AGENT }, "/heartbeat-runs/": liveRun });
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "pcp_agent_key",
      companyId: COMPANY,
      agentId: AGENT,
      runId: RUN,
      agentApiKey: "token-agent",
      boardApiKey: "token-board",
    });
    const ctx = await authorizeWorkspaceMutation(client, {});
    expect(ctx.authority).toBe("agent-run");
  });

  it("legacy operatorRunId is honored when it still verifies", async () => {
    routeFetch({ "/heartbeat-runs/": { ...liveRun, status: "operator", agentId: AGENT, contextSnapshot: { issueId: ISSUE } } });
    const ctx = await authorizeWorkspaceMutation(makeClient(), { operatorRunId: OPERATOR_RUN });
    expect(ctx.authority).toBe("operator");
    expect(ctx.operatorRunId).toBe(OPERATOR_RUN);
  });
});

describe("assertWorkspaceMutationScope", () => {
  const agentRun: WorkspaceMutationContext = { authority: "agent-run", runId: RUN, agentId: AGENT, runIssueId: ISSUE };

  it("allows the run's own issue", () => {
    expect(() => assertWorkspaceMutationScope(agentRun, ws)).not.toThrow();
  });

  it("refuses cross-issue workspace mutations", () => {
    expect(() => assertWorkspaceMutationScope(agentRun, ws, OTHER_ISSUE)).toThrow(/scope_denied/);
  });

  it("refuses project-level workspaces without an issue binding", () => {
    const projectWs: ResolvedWorkspace = { ...ws, sourceIssueId: null };
    expect(() => assertWorkspaceMutationScope(agentRun, projectWs)).toThrow(/issue_scope_required/);
  });

  it("refuses when the run has no issue binding at all", () => {
    const noIssue: WorkspaceMutationContext = { authority: "agent-run", runId: RUN, agentId: AGENT, runIssueId: null };
    expect(() => assertWorkspaceMutationScope(noIssue, ws)).toThrow(/scope_denied/);
  });

  it("board authority is exempt from issue scoping", () => {
    expect(() => assertWorkspaceMutationScope({ authority: "board" }, ws, OTHER_ISSUE)).not.toThrow();
  });
});
