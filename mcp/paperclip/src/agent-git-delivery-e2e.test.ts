import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceNativeTools } from "./workspace-native.js";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const RUN = "66666666-6666-4666-8666-666666666666";

const cleanupPaths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanupPaths.splice(0).map(p => rm(p, { recursive: true, force: true })));
});
function git(cwd: string, ...args: string[]) {
  const p = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000 });
  if (p.status !== 0) throw Error("git " + args[0] + " failed: " + p.stderr);
  return p.stdout.trim();
}
function fakeClient(cwd: string, runStatus = "running", runIssue = ISSUE) {
  return {
    callerApiKey: "agent-test-key",
    defaults: { runId: RUN },
    resolveCompanyId: () => COMPANY,
    getJsonOrNull: async (path: string) => {
      if (path === "/heartbeat-runs/" + RUN) return {
        agentId: AGENT, companyId: COMPANY, status: runStatus,
        contextSnapshot: { issueId: runIssue },
      };
      if (path === "/execution-workspaces/" + WORKSPACE) return {
        id: WORKSPACE, companyId: COMPANY, sourceIssueId: ISSUE,
        branchName: "KOMAA-TEST", cwd,
      };
      if (path.startsWith("/issues/" + ISSUE + "/documents")) return [];
      throw Error("unexpected getJsonOrNull " + path);
    },
    requestJson: async (_method: string, path: string) => {
      if (path === "/agents/me") return { id: AGENT };
      if (path === "/issues/" + ISSUE) return {
        id: ISSUE, companyId: COMPANY, identifier: "KOMAA-TEST", status: "in_progress",
      };
      throw Error("unexpected requestJson " + path);
    },
  } as never;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-push-contract-"));
  cleanupPaths.push(root);
  const cwd = join(root, "work"), bare = join(root, "remote.git");
  await mkdir(cwd);
  git(root, "init", "--bare", bare);
  git(cwd, "init", "-b", "KOMAA-TEST");
  git(cwd, "config", "user.name", "Test Git Agent");
  git(cwd, "config", "user.email", "ci@users.noreply.github.com");
  await mkdir(join(cwd, "mcp", "paperclip"), { recursive: true });
  await writeFile(join(cwd, "mcp", "paperclip", "delivery.txt"), "initial\n");
  git(cwd, "add", "--", "mcp/paperclip/delivery.txt");
  git(cwd, "commit", "-m", "initial test state");
  git(cwd, "remote", "add", "origin", bare);
  await writeFile(join(cwd, "mcp", "paperclip", "delivery.txt"), "changed by agent run\n");
  return { cwd, bare, root };
}
describe("native agent-run git commit and push contract (local bare remote)", () => {
  it("commits and pushes with a valid run; the remote sha equals HEAD", async () => {
    const f = await fixture();
    // Fake non-empty GitHub credential required by the runtime even for local bare remote;
    // neither production credentials nor the internet are involved.
    vi.stubEnv("GH_TOKEN", "ghp_" + "x".repeat(40));
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR", join(f.root, "ledger"));
    const tools = createWorkspaceNativeTools(fakeClient(f.cwd));
    const commit = tools.find(x => x.name === "paperclipGitCommit")!;
    const push = tools.find(x => x.name === "paperclipGitPush")!;
    const c = await commit.execute({
      workspaceId: WORKSPACE, issueId: ISSUE, runId: RUN,
      files: ["mcp/paperclip/delivery.txt"], message: "test: verify agent owned Git commit",
    });
    const committed = JSON.parse(c.content[0]!.text);
    expect(committed.after.head).toMatch(/^[0-9a-f]{40}$/);
    const p = await push.execute({ workspaceId: WORKSPACE, issueId: ISSUE, runId: RUN });
    const pushed = JSON.parse(p.content[0]!.text);
    expect(pushed.shaMatch).toBe(true);
    expect(pushed.remoteSha).toBe(committed.after.head);
    expect(git(f.cwd, "ls-remote", "origin", "refs/heads/KOMAA-TEST").split(/\s+/)[0]).toBe(committed.after.head);
  });
  it.each([
    ["ended run", "succeeded", ISSUE],
    ["run bound to another issue", "running", OTHER],
  ])("refuses %s before creating any commit", async (_reason, status, boundIssue) => {
    const f = await fixture();
    vi.stubEnv("PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR", join(f.root, "ledger"));
    const before = git(f.cwd, "rev-parse", "HEAD");
    const commit = createWorkspaceNativeTools(fakeClient(f.cwd, status, boundIssue))
      .find(x => x.name === "paperclipGitCommit")!;
    const r = await commit.execute({
      workspaceId: WORKSPACE, issueId: ISSUE, runId: RUN,
      files: ["mcp/paperclip/delivery.txt"], message: "test: must not write",
    });
    expect(r.content[0]!.text).toMatch(/auth_failed|scope_denied/i);
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(before);
  });
});
