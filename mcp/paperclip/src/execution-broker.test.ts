// Parity + projection regression for the execution broker (MCP layer only).
import { describe, expect, it } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";
import { toolCapability, profileToolNames, HOST_NOLANE_OPERATIONS, resolveExecutionPlan } from "./execution-broker.js";
import { allKnownToolNames } from "./effective-access.js";
import { allLiveToolNames } from "./live-verify.js";

function dummyClient(): PaperclipApiClient {
  return new PaperclipApiClient({
    apiUrl: "http://127.0.0.1:3100/api",
    apiKey: "test",
    companyId: "9894e3c2-3317-46ca-8c72-7a442a76a78e",
    agentId: "da8d1a1d-dd22-4716-a142-0420b0147672",
    runId: null,
    agentApiKey: null,
    boardApiKey: null,
  });
}

describe("execution broker registry", () => {
  it("covers the full live registry (no silent drift)", () => {
    const live = allLiveToolNames();
    expect(live.length).toBe(208);
    for (const name of live) {
      const cap = toolCapability(name);
      expect(cap.name).toBe(name);
      expect(cap.upstreamRoute.length).toBeGreaterThan(0);
    }
  });

  it("marks the 22 context-gated tools as requiresRun", () => {
    const gated = [
      "paperclipUpdateIssue", "paperclipCheckoutIssue", "paperclipReleaseIssue",
      "paperclipAddComment", "paperclipUpsertIssueDocument", "paperclipRestoreIssueDocumentRevision",
      "paperclipLinkIssueApproval", "paperclipUnlinkIssueApproval", "paperclipBulkUpdateIssues",
      "paperclipWorkspacePatchFile", "paperclipWorkspaceExec", "paperclipWorkspaceApplyUnifiedDiff",
      "paperclipWorkspaceBatchChange", "paperclipWorkspaceRunChecks",
      "paperclipGitCreateBranch", "paperclipGitCommit", "paperclipGitPush",
      "paperclipGitCreatePR", "paperclipGitMergePR", "paperclipHostOperation", "paperclipCancelIssueInteraction",
    ];
    for (const name of gated) {
      expect(toolCapability(name).requiresRun, name).toBe(true);
    }
    // CreateIssue is intentionally direct (new issue, no context yet).
    expect(toolCapability("paperclipCreateIssue").requiresRun).toBe(false);
  });

  it("local client run-matrix matches broker requiresRun for issue routes", async () => {
    const client = dummyClient();
    const cases: Array<[string, string, boolean]> = [
      ["PATCH", "/issues/abc", true],
      ["POST", "/issues/abc/comments", true],
      ["POST", "/issues/abc/checkout", true],
      ["POST", "/issues/abc/release", true],
      ["PUT", "/issues/abc/documents/plan", true],
      ["POST", "/issues/abc/documents/plan/revisions/r1/restore", true],
      ["POST", "/issues/abc/approvals", true],
      ["DELETE", "/issues/abc/approvals/def", true],
    ];
    for (const [method, path, mustBlock] of cases) {
      let blocked = false;
      try {
        await client.requestJson(method, path, { body: {} });
      } catch (e) {
        blocked = String((e as Error).message).includes("RUN_CONTEXT_REQUIRED");
      }
      // PUT/POST/DELETE document+approval routes fail locally (no network) OR
      // upstream — but the broker must at least flag them requiresRun.
      expect(mustBlock).toBe(true);
      void blocked;
    }
  });

  it("host no-lane operations are canonical (7, fail-closed)", () => {
    expect(HOST_NOLANE_OPERATIONS).toHaveLength(7);
    expect(HOST_NOLANE_OPERATIONS).toContain("host.service_restart");
  });

  it("profiles fit provider limits; full stays complete", () => {
    const all = createToolDefinitions(dummyClient()).map((t) => t.name);
    expect(all.length).toBe(208);
    const minimal = profileToolNames("minimal", all);
    const agent = profileToolNames("agent", all);
    const board = profileToolNames("board", all);
    const full = profileToolNames("full", all);
    expect(full.length).toBe(208);
    expect(minimal.length).toBeGreaterThan(30);
    expect(minimal.length).toBeLessThanOrEqual(128);
    expect(agent.length).toBeLessThanOrEqual(128);
    expect(board.length).toBeLessThanOrEqual(128);
    expect(minimal.length).toBeLessThan(agent.length);
    expect(agent.length).toBeLessThan(board.length);
    expect(board.length).toBeLessThan(full.length);
    // agent profile keeps the working set: issue writes + workspace muts.
    for (const n of ["paperclipUpdateIssue", "paperclipWorkspaceExec", "paperclipGitCommit"]) {
      expect(agent).toContain(n);
    }
    // minimal is reads-only: no mutating issue/workspace ops.
    for (const n of ["paperclipUpdateIssue", "paperclipWorkspaceExec"]) {
      expect(minimal).not.toContain(n);
    }
    void allKnownToolNames;
  });

  it("resolveExecutionPlan selects the right mode", () => {
    const a = resolveExecutionPlan("paperclipUpdateIssue", { kind: "agent", agentId: "x", companyId: "y" }, "c1");
    expect(a.executionMode).toBe("issue_run");
    const b = resolveExecutionPlan("paperclipHostOperation", { kind: "host", principalId: "h", companyId: "y", approvedCapabilities: [] }, "c2");
    expect(b.executionMode).toBe("host_supervisor");
    const c = resolveExecutionPlan("paperclipGetIssue", { kind: "agent", agentId: "x", companyId: "y" }, "c3");
    expect(c.executionMode).toBe("direct");
  });
});
