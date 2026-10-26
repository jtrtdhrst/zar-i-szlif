import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperclipApiClient } from "./client.js";
import { createWorkspaceNativeTools, ghEnv, runJailedExec } from "./workspace-native.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const OTHER_ISSUE = "66666666-6666-4666-8666-666666666666";
const RUN = "77777777-7777-4777-8777-777777777777";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";

function client() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "test",
    companyId: COMPANY,
    agentId: AGENT,
    runId: null,
    agentApiKey: null,
    boardApiKey: null,
  });
}

function tool(name: string) {
  const found = createWorkspaceNativeTools(client()).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("GitHub checks fail closed without prompting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["paperclipGitGetChecks", "paperclipGitGetMergeReadiness"])("returns GITHUB_AUTH_MISSING for %s before workspace or gh access", async (name) => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await tool(name).execute({ issueId: ISSUE, workspaceId: WORKSPACE });

    expect(result.content[0]?.text).toContain("GITHUB_AUTH_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets non-interactive GitHub and git environment flags", () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(ghEnv()).toMatchObject({
      GH_TOKEN: "test-token",
      GH_PROMPT_DISABLED: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
  });
});

describe("agent Git ancestry preflight under jailed workspace exec", () => {
  it("permits read-only rev-list, merge-base and cat-file without opening destructive git commands", async () => {
    const temp = await mkdtemp(join(tmpdir(), "paperclip-git-preflight-"));
    const old = process.env.PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR;
    process.env.PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR = temp;
    const ws = { cwd: process.cwd(), workspaceId: WORKSPACE } as never;
    try {
      const rev = await runJailedExec({ ws, argv: ["git", "rev-list", "--count", "HEAD"] });
      expect(rev.exitCode).toBe(0);
      expect(Number(rev.stdout.trim())).toBeGreaterThan(0);
      const base = await runJailedExec({ ws, argv: ["git", "merge-base", "HEAD", "HEAD"] });
      expect(base.exitCode).toBe(0);
      expect(base.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
      const type = await runJailedExec({ ws, argv: ["git", "cat-file", "-t", "HEAD"] });
      expect(type.exitCode).toBe(0);
      expect(type.stdout.trim()).toBe("commit");
      await expect(runJailedExec({ ws, argv: ["git", "reset", "--hard"] })).rejects.toThrow(/not allowlisted/);
    } finally {
      if (old === undefined) delete process.env.PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR;
      else process.env.PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR = old;
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe("run-bound Git delivery tool handlers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function gitTool(name: "paperclipGitCommit" | "paperclipGitPush") {
    const found = createWorkspaceNativeTools(client()).find((candidate) => candidate.name === name);
    if (!found) throw new Error(`missing ${name}`);
    return found;
  }

  function mockRun(status: string, issueId: string) {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/agents/me")) return new Response(JSON.stringify({ id: AGENT }), { status: 200 });
      if (url.endsWith(`/heartbeat-runs/${RUN}`)) return new Response(JSON.stringify({
        id: RUN, companyId: COMPANY, agentId: AGENT, status, contextSnapshot: { issueId },
      }), { status: 200 });
      if (url.endsWith(`/execution-workspaces/${WORKSPACE}`)) return new Response(JSON.stringify({
        id: WORKSPACE, companyId: COMPANY, sourceIssueId: ISSUE, cwd: process.cwd(), branchName: "KOMAA-1465",
      }), { status: 200 });
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 404 });
    }));
    return requests;
  }

  it.each(["paperclipGitCommit", "paperclipGitPush"] as const)("refuses %s for a live run bound to another issue before workspace/Git access", async (name) => {
    const requests = mockRun("running", OTHER_ISSUE);
    const input = name === "paperclipGitCommit"
      ? { issueId: ISSUE, workspaceId: WORKSPACE, files: ["src/example.ts"], message: "test: KOMAA-1465 deny cross issue", runId: RUN }
      : { issueId: ISSUE, workspaceId: WORKSPACE, runId: RUN };

    const result = await gitTool(name).execute(input);

    expect(result.content[0]?.text).toContain("scope_denied");
    expect(requests).toHaveLength(3);
    expect(requests.every((url) => url.includes("agents/me") || url.includes("heartbeat-runs") || url.includes("execution-workspaces"))).toBe(true);
  });

  it.each(["paperclipGitCommit", "paperclipGitPush"] as const)("refuses %s when the supplied run has ended before workspace/Git access", async (name) => {
    const requests = mockRun("succeeded", ISSUE);
    const input = name === "paperclipGitCommit"
      ? { issueId: ISSUE, workspaceId: WORKSPACE, files: ["src/example.ts"], message: "test: KOMAA-1465 deny ended run", runId: RUN }
      : { issueId: ISSUE, workspaceId: WORKSPACE, runId: RUN };

    const result = await gitTool(name).execute(input);

    expect(result.content[0]?.text).toContain("auth_failed");
    expect(result.content[0]?.text).toContain("not live");
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.includes("agents/me") || url.includes("heartbeat-runs"))).toBe(true);
  });
});
