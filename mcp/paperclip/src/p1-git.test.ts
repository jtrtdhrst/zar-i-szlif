import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMergeArgv, createP1GitTools, deriveGitPermissions, evaluateMergeGate, evaluatePrChecks } from "./p1-git.js";
import type { PaperclipApiClient } from "./client.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

function authTool() {
  const tool = createP1GitTools({} as PaperclipApiClient).find((item) => item.name === "paperclipGitAuthStatus");
  if (!tool) throw new Error("missing paperclipGitAuthStatus");
  return tool;
}

describe("paperclipGitAuthStatus", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    spawnMock.mockReset();
  });

  it("fails closed when no token is injected", async () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");

    const result = await authTool().execute({ repository: "miloszspyrka-code/zar-i-szlif", operation: "read" });
    const body = JSON.parse(result.content[0]?.text ?? "{}");

    expect(body.error.code).toBe("GITHUB_AUTH_MISSING");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("checks repo access through token-aware gh api instead of unauthenticated git ls-remote", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
    child.kill = vi.fn();
    spawnMock.mockImplementation((_command: string, _args: string[], _options: unknown) => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    const result = await authTool().execute({ repository: "miloszspyrka-code/zar-i-szlif", operation: "read" });
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];

    expect(command).toBe("gh");
    expect(args).toEqual(["api", "repos/miloszspyrka-code/zar-i-szlif", "--jq", ".full_name"]);
    expect(options.env.GH_TOKEN).toBe("test-token");
    expect(options.env.GH_PROMPT_DISABLED).toBe("1");
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(body.authenticated).toBe(true);
    expect(body.repositoryAccessible).toBe(true);
    // The transport is read through git with the SAME projected credential.
    const [transportCommand, transportArgs, transportOptions] = spawnMock.mock.calls[1] as [string, string[], { env: Record<string, string> }];
    expect(transportCommand).toBe("git");
    expect(transportArgs).toEqual(["ls-remote", "--heads", "https://github.com/miloszspyrka-code/zar-i-szlif.git"]);
    expect(transportOptions.env.GIT_CONFIG_COUNT).toBe("3");
    expect(transportOptions.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(body.transportAuthenticated).toBe(true);
  });
});

describe("deriveGitPermissions (Phase 4)", () => {
  it("reports push/create_pr when the token carries push", () => {
    expect(deriveGitPermissions({ push: true, admin: false, pull: true })).toEqual({
      allowedOperations: ["read", "push", "create_pr"],
      missingPermissions: [],
    });
  });
  it("reports push/create_pr for admins", () => {
    expect(deriveGitPermissions({ push: false, admin: true, pull: true }).allowedOperations).toContain("push");
  });
  it("stays read-only when scopes are absent or unfetchable", () => {
    expect(deriveGitPermissions({ push: false, admin: false, pull: true })).toEqual({
      allowedOperations: ["read"],
      missingPermissions: ["contents:write", "pull-requests:write"],
    });
    expect(deriveGitPermissions(null).missingPermissions).toContain("contents:write");
  });
});

describe("paperclipGitAuthStatus scope reporting", () => {
  function ghChild(stdout: string, code = 0) {
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      stdout: { on: (ev: string, cb: (d: unknown) => void) => void };
    };
    child.kill = vi.fn();
    const handlers: Record<string, (d?: unknown) => void> = {};
    child.stdout = { on(ev: string, cb: (d: unknown) => void): void { handlers[ev] = cb; } };
    queueMicrotask(() => {
      if (stdout) handlers["data"]?.(stdout);
      child.emit("close", code);
    });
    return child;
  }
  it("push op with push-scoped token reports push allowed (no false denial)", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    spawnMock.mockImplementation((_command: string, args: string[], _options: unknown) => {
      if (args.join(" ").includes(".permissions")) return ghChild('{"push":true,"admin":false,"pull":true}');
      return ghChild("");
    });
    const result = await authTool().execute({ repository: "miloszspyrka-code/zar-i-szlif", operation: "push" });
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    expect(body.authenticated).toBe(true);
    expect(body.allowedOperations).toContain("push");
    expect(body.missingPermissions).toEqual([]);
    expect(body.transportAuthenticated).toBe(true);
    // gh api (access) + gh api (permissions) + git ls-remote (transport)
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });
  it("push op drops push when the transport cannot authenticate even though the API allows it", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    spawnMock.mockImplementation((command: string, args: string[], _options: unknown) => {
      if (args.join(" ").includes(".permissions")) return ghChild('{"push":true,"admin":false,"pull":true}');
      if (command === "git") return ghChild("", 128);
      return ghChild("");
    });
    const result = await authTool().execute({ repository: "miloszspyrka-code/zar-i-szlif", operation: "push" });
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    expect(body.allowedOperations).toEqual(["read"]);
    expect(body.missingPermissions).toContain("transport:not-authenticated");
    expect(body.transportAuthenticated).toBe(false);
    expect(body.transportReason).toContain("refused");
  });
  it("push op with read-only token stays fail-closed", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    spawnMock.mockImplementation((_command: string, args: string[], _options: unknown) => {
      if (args.join(" ").includes(".permissions")) return ghChild('{"push":false,"admin":false,"pull":true}');
      return ghChild("");
    });
    const result = await authTool().execute({ repository: "miloszspyrka-code/zar-i-szlif", operation: "push" });
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    expect(body.allowedOperations).toEqual(["read"]);
    expect(body.missingPermissions).toContain("contents:write");
  });
});

describe("paperclipGitWaitChecks evaluation (fail-closed)", () => {
  it("never reports success when the checks context is unreadable (denied Checks:Read)", () => {
    // Observed live defect: exit 4 with empty stdout returned success/terminal.
    expect(evaluatePrChecks(4, "")).toMatchObject({ state: "unverified" });
    expect(evaluatePrChecks(1, "")).toMatchObject({ state: "unverified" });
    expect(evaluatePrChecks(0, "no checks reported on the 'KOMAA-1415' branch")).toMatchObject({ state: "unverified" });
  });

  it("reports success only for explicit pass lines with a zero exit", () => {
    expect(evaluatePrChecks(0, "verify-infrastructure\tpass\t1m\thttps://example/1")).toMatchObject({ state: "success" });
    expect(evaluatePrChecks(0, "verify-infrastructure\tpass\t1m")).toMatchObject({ state: "success" });
    expect(evaluatePrChecks(3, "verify-infrastructure\tpass\t1m")).toMatchObject({ state: "unverified" });
  });

  it("separates failure and pending states", () => {
    expect(evaluatePrChecks(1, "mcp-tests\tfail\t2m")).toMatchObject({ state: "failure" });
    expect(evaluatePrChecks(1, "mcp-tests\tpending\t0")).toMatchObject({ state: "pending" });
    expect(evaluatePrChecks(1, "mcp-tests\tqueued\t0")).toMatchObject({ state: "pending" });
  });
});

describe("paperclipGitMergePR gate (fail-closed)", () => {
  const base = { headRefOid: "df09a54950358a6acb179f59738919e71962f8ec", reviewDecision: "APPROVED", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };

  it("allows a clean, exact-head, approved PR", () => {
    expect(evaluateMergeGate(base, "df09a54950358a6acb179f59738919e71962f8ec").ok).toBe(true);
  });

  it("refuses when the head or gate state is unreadable", () => {
    expect(evaluateMergeGate({ ...base, headRefOid: "" }, "df09a549").ok).toBe(false);
    expect(evaluateMergeGate({ ...base, mergeStateStatus: "UNKNOWN" }, "df09a549").ok).toBe(false);
    expect(evaluateMergeGate({ ...base, mergeable: "UNKNOWN" }, "df09a549").ok).toBe(false);
  });

  it("refuses a mismatched SHA, requested changes, or blocked merge state", () => {
    expect(evaluateMergeGate(base, "0000000000000000000000000000000000000000").ok).toBe(false);
    expect(evaluateMergeGate({ ...base, reviewDecision: "CHANGES_REQUESTED" }, "df09a549").ok).toBe(false);
    expect(evaluateMergeGate({ ...base, mergeStateStatus: "BLOCKED" }, "df09a549").ok).toBe(false);
  });
});

describe("paperclipGitMergePR head-race guard", () => {
  const headSha = "fd281ca51f67207dabbeaaa7a832555071d81b6f";

  it("pins the merge to the verified full head SHA", () => {
    // A head push between the gate read and the merge must make gh refuse.
    expect(buildMergeArgv(98, ["--repo", "owner/repo"], "--merge", headSha)).toEqual([
      "gh", "pr", "merge", "98", "--repo", "owner/repo", "--merge", "--match-head-commit", headSha,
    ]);
  });

  it("pins every merge method, not just the default", () => {
    for (const methodFlag of ["--merge", "--squash", "--rebase"]) {
      const argv = buildMergeArgv(7, [], methodFlag, headSha);
      expect(argv).toContain("--match-head-commit");
      expect(argv[argv.indexOf("--match-head-commit") + 1]).toBe(headSha);
    }
  });
});
