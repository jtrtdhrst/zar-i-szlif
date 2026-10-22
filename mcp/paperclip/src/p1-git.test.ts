import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createP1GitTools, deriveGitPermissions } from "./p1-git.js";
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
