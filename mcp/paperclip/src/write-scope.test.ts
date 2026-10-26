// Negative tests for the hard write-scope admission (KOMAA-1005, v69).
//
// The scope is the issue-scoped product-MCP write scope:
//   allow app/mcp-worker/** and app/plugin/knowledge/**
//   deny  app/cloudflare-worker/** (legacy Worker) and ops/** (unrelated ops)
// Every denial must happen BEFORE any filesystem write.

import { describe, expect, it, vi } from "vitest";
import {
  WRITE_SCOPE_DOCUMENT_KEY,
  assertExecInScope,
  assertPathInScope,
  isPathInScope,
  loadWriteScope,
  matchesScopePattern,
  normalizeScopePath,
  parseWriteScope,
} from "./write-scope.js";

const SCOPE = {
  paths: ["app/mcp-worker/**", "app/plugin/knowledge/**"],
};

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const detail = (e as unknown as Record<string, unknown>).detail as Record<string, unknown> | undefined;
    return String(detail?.errorCode ?? "unknown");
  }
  return "no-error";
}

describe("write scope policy parsing", () => {
  it("treats an absent document as no scope", () => {
    expect(parseWriteScope(null)).toBeNull();
    expect(parseWriteScope(undefined)).toBeNull();
    expect(parseWriteScope("   ")).toBeNull();
  });

  it("parses the allow-list", () => {
    expect(parseWriteScope(JSON.stringify(SCOPE))).toEqual(SCOPE);
  });

  it("fails closed on a malformed policy document", () => {
    expect(errorCode(() => parseWriteScope("not json"))).toBe("path_denied");
    expect(errorCode(() => parseWriteScope("[]"))).toBe("path_denied");
    expect(errorCode(() => parseWriteScope(JSON.stringify({ paths: [] })))).toBe("path_denied");
    expect(errorCode(() => parseWriteScope(JSON.stringify({ scope: ["app/**"] })))).toBe("path_denied");
  });
});

describe("path admission", () => {
  it("allows the approved product-MCP paths", () => {
    expect(isPathInScope(SCOPE, "app/mcp-worker/src/index.ts")).toBe(true);
    expect(isPathInScope(SCOPE, "app/mcp-worker/index.ts")).toBe(true);
    expect(isPathInScope(SCOPE, "app/mcp-worker")).toBe(true);
    expect(isPathInScope(SCOPE, "app/plugin/knowledge/retrieval.ts")).toBe(true);
  });

  it("denies the legacy Worker and unrelated ops paths", () => {
    expect(isPathInScope(SCOPE, "app/cloudflare-worker/src/mcp.ts")).toBe(false);
    expect(isPathInScope(SCOPE, "ops/deploy.sh")).toBe(false);
    expect(isPathInScope(SCOPE, "app/web/src/App.tsx")).toBe(false);
    expect(isPathInScope(SCOPE, "docs/KOMAA-385-rag2.md")).toBe(false);
  });

  it("does not let a prefix lookalike pass as the allowed subtree", () => {
    expect(matchesScopePattern("app/mcp-worker/**", "app/mcp-workerx/src/index.ts")).toBe(false);
    expect(matchesScopePattern("app/mcp-worker/**", "app/mcp-worker-evil/x.ts")).toBe(false);
  });

  it("refuses escaping and absolute write targets", () => {
    expect(errorCode(() => normalizeScopePath("../outside.ts"))).toBe("path_denied");
    expect(errorCode(() => normalizeScopePath("app/../../outside.ts"))).toBe("path_denied");
    expect(errorCode(() => normalizeScopePath("/etc/passwd"))).toBe("path_denied");
  });

  it("throws path_denied for out-of-scope targets and passes in-scope ones", () => {
    expect(errorCode(() => assertPathInScope(SCOPE, "app/cloudflare-worker/src/mcp.ts", "paperclipWorkspacePatchFile"))).toBe("path_denied");
    expect(errorCode(() => assertPathInScope(SCOPE, "ops/deploy.sh", "paperclipWorkspacePatchFile"))).toBe("path_denied");
    expect(errorCode(() => assertPathInScope(SCOPE, "app/mcp-worker/src/index.ts", "paperclipWorkspacePatchFile"))).toBe("no-error");
    expect(errorCode(() => assertPathInScope(null, "ops/deploy.sh", "paperclipWorkspacePatchFile"))).toBe("no-error");
  });
});

describe("shell admission under a write scope", () => {
  it("denies git writers that can touch out-of-scope trees", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "checkout", "main"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "switch", "-c", "other"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "reset", "--hard"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "commit", "-m", "sneaky"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "stash"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "remote", "set-url", "origin", "https://example.invalid/x.git"], "paperclipWorkspaceExec"))).toBe("path_denied");
  });

  it("denies path-bearing git writers outside the scope", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "--", "app/cloudflare-worker/src/mcp.ts"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "--", "ops/deploy.sh"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "-A"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "clean", "-f", "--", "ops/deploy.sh"], "paperclipWorkspaceExec"))).toBe("path_denied");
  });

  it("denies out-of-scope paths mentioned by non-git commands", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["node", "-e", "fs.writeFileSync('ops/deploy.sh','x')"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["vitest", "run", "app/web/src/App.test.ts"], "paperclipWorkspaceExec"))).toBe("path_denied");
  });

  it("keeps read-only git and in-scope commands available", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "status"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "log", "--oneline"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "rev-list", "--count", "HEAD"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "merge-base", "HEAD", "HEAD"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "diff", "--", "app/mcp-worker/src/index.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "--", "app/mcp-worker/src/index.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["vitest", "run", "app/mcp-worker/src/index.test.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
  });

  // Regression: the binary ("git") and the subcommand ("add") are not paths.
  // Without this, `git add <in-scope-path>` was refused with
  // 'Write target "git" is outside the approved write scope'.
  it("admits path-bearing git writers without the -- separator", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "app/mcp-worker/src/index.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "app/plugin/knowledge/retrieval.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "clean", "-f", "app/mcp-worker/src/index.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "-c", "user.name=x", "add", "app/mcp-worker/src/index.ts"], "paperclipWorkspaceExec"))).toBe("no-error");
  });

  it("still denies path-bearing git writers outside the scope without the -- separator", () => {
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "app/cloudflare-worker/src/mcp.ts"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "ops/deploy.sh"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "clean", "-f", "ops/deploy.sh"], "paperclipWorkspaceExec"))).toBe("path_denied");
    expect(errorCode(() => assertExecInScope(SCOPE, ["git", "add", "-A"], "paperclipWorkspaceExec"))).toBe("path_denied");
  });
});

describe("scope document read", () => {
  function clientWith(docs: unknown) {
    return {
      getJsonOrNull: vi.fn().mockResolvedValue(docs),
    } as unknown as Parameters<typeof loadWriteScope>[0];
  }

  it("reads the scope document of the issue", async () => {
    const client = clientWith([{ key: WRITE_SCOPE_DOCUMENT_KEY, body: JSON.stringify(SCOPE) }]);
    await expect(loadWriteScope(client, "KOMAA-1003")).resolves.toEqual(SCOPE);
  });

  it("returns no scope when the issue has no scope document", async () => {
    const client = clientWith([{ key: "acceptance-evidence", body: "x" }]);
    await expect(loadWriteScope(client, "KOMAA-1003")).resolves.toBeNull();
  });

  it("fails closed when the scope document is malformed", async () => {
    const client = clientWith([{ key: WRITE_SCOPE_DOCUMENT_KEY, body: "{" }]);
    await expect(loadWriteScope(client, "KOMAA-1003")).rejects.toThrow(/path_denied/);
  });
});
