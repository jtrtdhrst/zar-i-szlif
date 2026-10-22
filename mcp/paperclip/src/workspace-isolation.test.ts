// KOMAA-468 — a child issue must not inherit the parent's isolated execution
// workspace (MCP layer only, no Paperclip Core change).
//
// Executable regression for the 2026-10-20 live cross-agent collision:
// execution workspace f7ce6667 (branch KOMAA-774) was bound to 23 issues and
// carried two live runs of two DIFFERENT agents at the same time. Every test
// asserts the OBSERVED decision or the OBSERVED outgoing request body.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import {
  assertTaskSessionWorkspaceIsolation,
  evaluateCheckoutWorkspaceIsolation,
  evaluateChildWorkspaceIsolation,
  evaluateTaskSessionWorkspaceIsolation,
  hasExplicitWorkspaceOverride,
  perIssueBranchTemplate,
  WorkspaceIsolationError,
  type WorkspaceIsolationReader,
} from "./workspace-isolation.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const PARENT = "33333333-3333-3333-3333-333333333333";
const CHILD = "44444444-4444-4444-4444-444444444444";
const OTHER_ISSUE = "55555555-5555-5555-5555-555555555555";
const WS = "66666666-6666-6666-6666-666666666666";
const AGENT_A = "77777777-7777-4777-8777-777777777777";
const AGENT_B = "88888888-8888-4888-8888-888888888888";
const RUN = "99999999-9999-4999-8999-999999999999";

const isolatedParent = {
  id: PARENT,
  identifier: "KOMAA-774",
  projectId: PROJECT,
  executionWorkspaceId: WS,
  executionWorkspacePreference: "reuse_existing",
  executionWorkspaceSettings: { mode: "isolated_workspace" },
};

const isolatedWorkspace = {
  id: WS,
  mode: "isolated_workspace",
  strategyType: "git_worktree",
  branchName: "KOMAA-774",
  sourceIssueId: PARENT,
  status: "active",
};

const isolatedProject = {
  id: PROJECT,
  executionWorkspacePolicy: {
    enabled: true,
    defaultMode: "isolated_workspace",
    allowIssueOverride: true,
    sharedWorkspaceConcurrency: "serialize",
    workspaceStrategy: {
      type: "git_worktree",
      baseRef: "main",
      branchTemplate: "{{issue.identifier}}",
    },
  },
};

function makeReader(routes: Record<string, unknown>): WorkspaceIsolationReader & {
  config: { companyId: string };
} {
  return {
    config: { companyId: COMPANY },
    async getJsonOrNull<T>(path: string): Promise<T | null> {
      const value = routes[path];
      return value === undefined ? null : (value as T);
    },
  };
}

function baseRoutes(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`/issues/${PARENT}`]: isolatedParent,
    [`/execution-workspaces/${WS}`]: isolatedWorkspace,
    [`/projects/${PROJECT}`]: isolatedProject,
    ...extra,
  };
}

describe("KOMAA-468 child workspace isolation", () => {
  it("isolates a child of an isolated_workspace parent onto its own branch", async () => {
    const decision = await evaluateChildWorkspaceIsolation(makeReader(baseRoutes()), {
      parentId: PARENT,
      body: { title: "child", assigneeAgentId: AGENT_A },
    });

    expect(decision.code).toBe("ISOLATED_PARENT_WORKSPACE_ISOLATED");
    expect(decision.isolation).toBe("isolated");
    expect(decision.parentWorkspaceId).toBe(WS);
    expect(decision.injected?.executionWorkspacePreference).toBe("isolated_workspace");
    expect(decision.injected?.executionWorkspaceSettings.mode).toBe("isolated_workspace");
    expect(
      (decision.injected?.executionWorkspaceSettings.workspaceStrategy as Record<string, unknown>)
        .branchTemplate,
    ).toBe("{{issue.identifier}}");
  });

  it("isolates two different agents creating children under one parent", async () => {
    const reader = makeReader(baseRoutes());
    const first = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "harness child", assigneeAgentId: AGENT_A },
    });
    const second = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "engineer child", assigneeAgentId: AGENT_B },
    });

    expect(first.isolation).toBe("isolated");
    expect(second.isolation).toBe("isolated");
    // Same branch template, different issue identifier -> different branches.
    expect(first.injected?.executionWorkspaceSettings).toEqual(
      second.injected?.executionWorkspaceSettings,
    );
    expect(first.injected?.executionWorkspaceSettings).not.toHaveProperty(
      "executionWorkspaceId",
    );
  });

  it("isolates the same agent creating two issues under one parent", async () => {
    const reader = makeReader(baseRoutes());
    const a = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "one", assigneeAgentId: AGENT_A },
    });
    const b = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "two", assigneeAgentId: AGENT_A },
    });

    expect(a.isolation).toBe("isolated");
    expect(b.isolation).toBe("isolated");
  });

  it("never hands the child the parent's literal branch name", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/projects/${PROJECT}`]: {
          id: PROJECT,
          executionWorkspacePolicy: {
            enabled: true,
            defaultMode: "isolated_workspace",
            allowIssueOverride: true,
            workspaceStrategy: {
              type: "git_worktree",
              baseRef: "main",
              branchTemplate: "KOMAA-774",
            },
          },
        },
      }),
    );

    const decision = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "child" },
    });

    expect(
      (decision.injected?.executionWorkspaceSettings.workspaceStrategy as Record<string, unknown>)
        .branchTemplate,
    ).toBe("{{issue.identifier}}");
    expect(perIssueBranchTemplate("{{issue.identifier}}-{{slug}}")).toBe("{{issue.identifier}}-{{slug}}");
    expect(perIssueBranchTemplate("KOMAA-774")).toBe("{{issue.identifier}}");
  });

  it("preserves an explicit lawful same-issue reuse", async () => {
    const decision = await evaluateChildWorkspaceIsolation(makeReader(baseRoutes()), {
      parentId: PARENT,
      body: { title: "child", executionWorkspacePreference: "reuse_existing" },
    });

    expect(decision.code).toBe("EXPLICIT_OVERRIDE_ALLOWED");
    expect(decision.injected).toBeUndefined();
    expect(hasExplicitWorkspaceOverride({ executionWorkspaceId: WS })).toBe(true);
    expect(hasExplicitWorkspaceOverride({ executionWorkspacePreference: "inherit" })).toBe(false);
  });

  it("preserves an intentional shared, serialized workspace", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${PARENT}`]: {
          ...isolatedParent,
          executionWorkspaceSettings: { mode: "shared_workspace" },
        },
        [`/execution-workspaces/${WS}`]: { ...isolatedWorkspace, mode: "shared_workspace" },
      }),
    );

    const decision = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "child" },
    });

    expect(decision.code).toBe("SHARED_WORKSPACE_REUSE_ALLOWED");
    expect(decision.isolation).toBe("inherited");
    expect(decision.injected).toBeUndefined();
  });

  it("routes a child of an isolated parent to the project's shared workspace when the project default is shared", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/projects/${PROJECT}`]: {
          id: PROJECT,
          executionWorkspacePolicy: {
            enabled: true,
            defaultMode: "shared_workspace",
            allowIssueOverride: true,
            sharedWorkspaceConcurrency: "serialize",
            workspaceStrategy: { type: "project_primary" },
          },
        },
      }),
    );

    const decision = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "child" },
    });

    expect(decision.injected?.executionWorkspacePreference).toBe("shared_workspace");
    expect(decision.injected?.executionWorkspaceSettings.mode).toBe("shared_workspace");
  });

  it("fails closed when the project forbids issue-level workspace overrides", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/projects/${PROJECT}`]: {
          id: PROJECT,
          executionWorkspacePolicy: {
            enabled: true,
            defaultMode: "isolated_workspace",
            allowIssueOverride: false,
            workspaceStrategy: { type: "git_worktree", branchTemplate: "{{issue.identifier}}" },
          },
        },
      }),
    );

    await expect(
      evaluateChildWorkspaceIsolation(reader, { parentId: PARENT, body: { title: "child" } }),
    ).rejects.toMatchObject({ code: "PROJECT_OVERRIDE_FORBIDDEN" });
  });

  it("fails closed when the parent cannot be read", async () => {
    await expect(
      evaluateChildWorkspaceIsolation(makeReader({}), {
        parentId: PARENT,
        body: { title: "child" },
      }),
    ).rejects.toMatchObject({ code: "PARENT_UNREADABLE" });
  });

  it("inherits nothing when the parent owns no workspace", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${PARENT}`]: { id: PARENT, projectId: PROJECT, executionWorkspaceId: null },
      }),
    );

    const decision = await evaluateChildWorkspaceIsolation(reader, {
      parentId: PARENT,
      body: { title: "child" },
    });

    expect(decision.code).toBe("NO_PARENT_WORKSPACE");
    expect(decision.injected).toBeUndefined();
  });
});

describe("KOMAA-468 cross-issue lease at checkout", () => {
  it("refuses a checkout into a cross-issue lease held by a live run", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${CHILD}`]: { id: CHILD, executionWorkspaceId: WS },
        [`/companies/${COMPANY}/live-runs?limit=100`]: [
          { id: "run-1", status: "running", executionWorkspaceId: WS, agentId: AGENT_B },
        ],
      }),
    );

    await expect(
      evaluateCheckoutWorkspaceIsolation(reader, { issueId: CHILD }),
    ).rejects.toMatchObject({ code: "CROSS_ISSUE_LEASE_REFUSED" });
  });

  it("reports but does not block an uncontended cross-issue lease", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${CHILD}`]: { id: CHILD, executionWorkspaceId: WS },
        [`/companies/${COMPANY}/live-runs?limit=100`]: [
          { id: "run-1", status: "succeeded", executionWorkspaceId: WS },
        ],
      }),
    );

    const decision = await evaluateCheckoutWorkspaceIsolation(reader, { issueId: CHILD });

    expect(decision.code).toBe("CROSS_ISSUE_LEASE_UNCONTENDED");
    expect(decision.parentIssueId).toBe(PARENT);
  });

  it("keeps lawful same-issue reuse of the issue's own workspace", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${CHILD}`]: { id: CHILD, executionWorkspaceId: WS },
        [`/execution-workspaces/${WS}`]: { ...isolatedWorkspace, sourceIssueId: CHILD },
      }),
    );

    const decision = await evaluateCheckoutWorkspaceIsolation(reader, { issueId: CHILD });

    expect(decision.code).toBe("CROSS_ISSUE_LEASE_UNCONTENDED");
  });

  it("does not refuse a shared workspace (the shared holder gate serializes it)", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${CHILD}`]: { id: CHILD, executionWorkspaceId: WS },
        [`/execution-workspaces/${WS}`]: { ...isolatedWorkspace, mode: "shared_workspace" },
        [`/companies/${COMPANY}/live-runs?limit=100`]: [
          { id: "run-1", status: "running", executionWorkspaceId: WS },
        ],
      }),
    );

    const decision = await evaluateCheckoutWorkspaceIsolation(reader, { issueId: CHILD });

    expect(decision.code).toBe("SHARED_WORKSPACE_REUSE_ALLOWED");
  });

  it("leaves an issue without a workspace alone", async () => {
    const reader = makeReader(baseRoutes({ [`/issues/${CHILD}`]: { id: CHILD } }));

    const decision = await evaluateCheckoutWorkspaceIsolation(reader, { issueId: CHILD });

    expect(decision.code).toBe("NO_PARENT_WORKSPACE");
  });
});

describe("KOMAA-468 create path wiring (client choke point)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the child with an explicit per-issue workspace preference", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        sent.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
        return Promise.resolve(
          new Response(JSON.stringify({ id: CHILD, identifier: "KOMAA-1099" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-123",
      companyId: COMPANY,
      agentId: AGENT_A,
      runId: RUN,
      agentApiKey: "token-agent",
      boardApiKey: "token-board",
    });

    // The guard reads the parent + workspace + project before the write.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        const target = String(url);
        if (target.includes(`/issues/${PARENT}`)) {
          return Promise.resolve(
            new Response(JSON.stringify(isolatedParent), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        if (target.includes(`/execution-workspaces/${WS}`)) {
          return Promise.resolve(
            new Response(JSON.stringify(isolatedWorkspace), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        if (target.includes(`/projects/${PROJECT}`)) {
          return Promise.resolve(
            new Response(JSON.stringify(isolatedProject), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        sent.push({ url: target, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return Promise.resolve(
          new Response(JSON.stringify({ id: CHILD, identifier: "KOMAA-1099" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    await client.requestJson("POST", `/companies/${COMPANY}/issues`, {
      body: { title: "child", parentId: PARENT, assigneeAgentId: AGENT_B },
    });

    expect(sent).toHaveLength(1);
    const body = sent[0].body as Record<string, unknown>;
    expect(body.parentId).toBe(PARENT);
    expect(body.executionWorkspacePreference).toBe("isolated_workspace");
    expect(body.executionWorkspaceId).toBeUndefined();
    expect((body.executionWorkspaceSettings as Record<string, unknown>).mode).toBe(
      "isolated_workspace",
    );
  });
});

describe("KOMAA-468 guard error surface", () => {
  it("carries a fail-closed error code and remediation owner", () => {
    const error = new WorkspaceIsolationError("CROSS_ISSUE_LEASE_REFUSED", "boom");
    expect(error.message).toContain("errorCode=CROSS_ISSUE_LEASE_REFUSED");
    expect(error.message).toContain("MCP gateway only");
    expect((error as unknown as { detail: { remediationOwner: string } }).detail.remediationOwner).toBe(
      "caller",
    );
  });
});

describe("KOMAA-468 task-session workspace resolution", () => {
  const liveRuns = (rows: unknown[]): Record<string, unknown> => ({
    [`/companies/${COMPANY}/live-runs?limit=100`]: rows,
  });

  it("refuses a task session that resolves a foreign per-issue worktree held by a live run", async () => {
    const reader = makeReader(
      baseRoutes(
        liveRuns([{ id: RUN, status: "running", contextSnapshot: { executionWorkspaceId: WS } }]),
      ),
    );
    await expect(
      assertTaskSessionWorkspaceIsolation(reader, { issueId: CHILD, resolvedWorkspaceId: WS }),
    ).rejects.toThrow(/CROSS_ISSUE_LEASE_REFUSED/);
  });

  it("reports an uncontended foreign binding instead of hiding it", async () => {
    const reader = makeReader(baseRoutes(liveRuns([])));
    const verdict = await assertTaskSessionWorkspaceIsolation(reader, {
      issueId: CHILD,
      resolvedWorkspaceId: WS,
    });
    expect(verdict.status).toBe("FOREIGN_UNCONTENDED");
    expect(verdict.violation).toBe(true);
    expect(verdict.ownerIssueId).toBe(PARENT);
    expect(verdict.branchName).toBe("KOMAA-774");
  });

  it("keeps the issue's own worktree runnable", async () => {
    const reader = makeReader(baseRoutes(liveRuns([])));
    const verdict = await assertTaskSessionWorkspaceIsolation(reader, {
      issueId: PARENT,
      resolvedWorkspaceId: WS,
    });
    expect(verdict.status).toBe("OWN_WORKSPACE");
    expect(verdict.violation).toBe(false);
  });

  it("keeps a shared workspace runnable", async () => {
    const shared = { ...isolatedWorkspace, id: "sh", mode: "shared_workspace", sourceIssueId: null };
    const reader = makeReader(
      baseRoutes({
        "/execution-workspaces/sh": shared,
        [`/companies/${COMPANY}/live-runs?limit=100`]: [],
      }),
    );
    const verdict = await assertTaskSessionWorkspaceIsolation(reader, {
      issueId: CHILD,
      resolvedWorkspaceId: "sh",
    });
    expect(verdict.status).toBe("SHARED_WORKSPACE");
    expect(verdict.violation).toBe(false);
  });

  it("keeps an issue without a workspace runnable", async () => {
    const reader = makeReader(baseRoutes(liveRuns([])));
    const verdict = await assertTaskSessionWorkspaceIsolation(reader, {
      issueId: CHILD,
      resolvedWorkspaceId: null,
    });
    expect(verdict.status).toBe("NO_WORKSPACE");
    expect(verdict.violation).toBe(false);
  });

  it("falls back to the issue's own pointer when the session resolves nothing", async () => {
    const reader = makeReader(
      baseRoutes({
        [`/issues/${CHILD}`]: { ...isolatedParent, id: CHILD, executionWorkspaceId: WS },
        [`/companies/${COMPANY}/live-runs?limit=100`]: [],
      }),
    );
    const verdict = await evaluateTaskSessionWorkspaceIsolation(reader, { issueId: CHILD });
    expect(verdict.workspaceId).toBe(WS);
    expect(verdict.status).toBe("FOREIGN_UNCONTENDED");
  });

  it("does not fail closed when the workspace cannot be read", async () => {
    const reader = makeReader({});
    const verdict = await assertTaskSessionWorkspaceIsolation(reader, {
      issueId: CHILD,
      resolvedWorkspaceId: "missing-workspace",
    });
    expect(verdict.status).toBe("UNKNOWN");
    expect(verdict.violation).toBe(false);
  });
});
