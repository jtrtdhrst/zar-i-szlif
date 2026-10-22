// Negative/positive tests for the hard deployment-root admission
// (KOMAA-1005, P0 host-vs-product scope correction).
//
// The 6 MANDATORY NEGATIVE E2E cases from the owner directive are modelled
// here against real filesystem layouts (product checkout, linked worktree,
// symlink alias, host source root) so the classification itself is proven
// without touching the network.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseDeployScope,
  evaluateDeploymentRoot,
  enforceDeploymentRoot,
  enforceHostServiceScope,
  normalizeRemote,
  isInsidePath,
  readGitIdentity,
  DEPLOY_SCOPE_DOCUMENT_KEY,
} from "./deployment-root.js";

const PRODUCT_REMOTE = "https://github.com/miloszspyrka-code/zar-i-szlif.git";

let root = "";
let productCheckout = "";
let productWorktree = "";
let hostSource = "";
let symlinkAlias = "";

async function writeFile(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-root-"));
  // Product checkout: .git directory with an origin remote.
  productCheckout = path.join(root, "repos", "kompas-zbiorek");
  await writeFile(
    path.join(productCheckout, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${PRODUCT_REMOTE}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
  await writeFile(path.join(productCheckout, "app", "mcp-worker", "src", "index.ts"), "export const x = 1;\n");

  // Linked worktree: .git FILE pointing at the main repository worktree dir.
  const gitDir = path.join(productCheckout, ".git", "worktrees", "KOMAA-1003");
  productWorktree = path.join(productCheckout, ".paperclip", "worktrees", "KOMAA-1003");
  await writeFile(path.join(gitDir, "commondir"), "../..\n");
  await writeFile(path.join(productCheckout, ".git", "worktrees", "KOMAA-1003", "gitdir"), `${path.join(productWorktree, ".git")}\n`);
  await writeFile(path.join(productWorktree, ".git"), `gitdir: ${path.join(gitDir)}\n`);
  await writeFile(path.join(productWorktree, "app", "mcp-worker", "src", "index.ts"), "export const x = 1;\n");

  // Host source root (MCP overlay-like) with no git checkout.
  hostSource = path.join(root, "mcp-patch", "src");
  await writeFile(path.join(hostSource, "deployment-root.ts"), "export const x = 1;\n");

  // Symlink alias that points INTO the product checkout.
  symlinkAlias = path.join(root, "host-alias");
  await fs.symlink(productWorktree, symlinkAlias, "dir");
  hostScope = {
    kind: "host_mcp",
    hostService: "paperclip-mcp-gateway",
    hostSourceRoots: [path.join(root, "mcp-patch")],
    productRepoRemotes: [PRODUCT_REMOTE],
  };
  productScope = {
    kind: "product",
    productRepoRemotes: [PRODUCT_REMOTE],
    hostSourceRoots: [path.join(root, "mcp-patch")],
  };
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

let hostScope: {
  kind: "host_mcp";
  hostService: string;
  hostSourceRoots: string[];
  productRepoRemotes: string[];
};

let productScope: {
  kind: "product";
  productRepoRemotes: string[];
  hostSourceRoots: string[];
};

describe("deployment scope document", () => {
  it("treats an absent document as no restriction", () => {
    expect(parseDeployScope(null)).toBeNull();
    expect(parseDeployScope("   ")).toBeNull();
  });

  it("fails closed on an invalid document", () => {
    expect(() => parseDeployScope("{not json")).toThrow(/wrong_deployment_root/);
    expect(() => parseDeployScope(JSON.stringify({ kind: "whatever" }))).toThrow(/wrong_deployment_root/);
    expect(() => parseDeployScope(JSON.stringify({ kind: "host_mcp" }))).not.toThrow();
  });

  it("uses a stable document key", () => {
    expect(DEPLOY_SCOPE_DOCUMENT_KEY).toBe("execution-deploy-scope");
  });
});

describe("git identity resolution", () => {
  it("resolves the origin remote of a normal checkout", async () => {
    const identity = await readGitIdentity(productCheckout);
    expect(identity?.remote).toBe(PRODUCT_REMOTE);
  });

  it("resolves the origin remote through a linked worktree", async () => {
    const identity = await readGitIdentity(productWorktree);
    expect(identity?.remote).toBe(PRODUCT_REMOTE);
  });

  it("normalizes remotes for comparison", () => {
    expect(normalizeRemote("https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBe(
      "https://github.com/miloszspyrka-code/zar-i-szlif",
    );
    expect(normalizeRemote(null)).toBeNull();
  });

  it("detects path containment", () => {
    expect(isInsidePath("/a/b/c", "/a/b")).toBe(true);
    expect(isInsidePath("/a/bc", "/a/b")).toBe(false);
  });
});

describe("MANDATORY NEGATIVE E2E (deployment-root classification)", () => {
  it("(1) host MCP issue + product repository workspace -> DENY", async () => {
    const verdict = await evaluateDeploymentRoot(hostScope, {
      targetPath: productWorktree,
      workspacePath: productWorktree,
      tool: "paperclipWorkspacePatchFile",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("WRONG_DEPLOYMENT_ROOT");
    expect(verdict.actualRemote).toBe(PRODUCT_REMOTE);
    expect(verdict.expectedService).toBe("paperclip-mcp-gateway");
    expect(verdict.remediationOwner).toBe("cto");
  });

  it("(2) host issue + symlink alias into the product repo -> DENY", async () => {
    const verdict = await evaluateDeploymentRoot(hostScope, {
      targetPath: symlinkAlias,
      workspacePath: symlinkAlias,
      tool: "paperclipWorkspacePatchFile",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.actualRemote).toBe(PRODUCT_REMOTE);
    expect(verdict.actualPath).toContain("kompas-zbiorek");
  });

  it("(2b) host issue + worktree alias into the product repo -> DENY", async () => {
    const verdict = await evaluateDeploymentRoot(hostScope, {
      targetPath: path.join(productWorktree, "app", "mcp-worker", "src", "index.ts"),
      workspacePath: productWorktree,
      tool: "paperclipWorkspaceBatchChange",
    });
    expect(verdict.allowed).toBe(false);
  });

  it("(3) product MCP Engineer + app/mcp-worker/** in the product repo -> ALLOW", async () => {
    const verdict = await evaluateDeploymentRoot(productScope, {
      targetPath: path.join(productWorktree, "app", "mcp-worker", "src", "index.ts"),
      workspacePath: productWorktree,
      tool: "paperclipWorkspacePatchFile",
    });
    expect(verdict.allowed).toBe(true);
  });

  it("(4) product MCP Engineer + host source path -> DENY", async () => {
    const verdict = await evaluateDeploymentRoot(productScope, {
      targetPath: path.join(hostSource, "deployment-root.ts"),
      workspacePath: hostSource,
      tool: "paperclipWorkspacePatchFile",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("WRONG_DEPLOYMENT_ROOT");
    expect(verdict.expectedRoot).toContain("mcp-patch");
  });

  it("(5) host task + exact authorized host service -> ALLOW, other service -> DENY", async () => {
    const client = {
      getJsonOrNull: async () => [{ key: DEPLOY_SCOPE_DOCUMENT_KEY, body: JSON.stringify(hostScope) }],
    } as never;
    await expect(
      enforceHostServiceScope(client, {
        issueId: "KOMAA-1005",
        operation: "host.service_reload",
        target: "paperclip-mcp-gateway",
        tool: "paperclipHostOperation",
      }),
    ).resolves.toMatchObject({ kind: "host_mcp" });
    await expect(
      enforceHostServiceScope(client, {
        issueId: "KOMAA-1005",
        operation: "host.service_reload",
        target: "plasmic-mcp",
        tool: "paperclipHostOperation",
      }),
    ).rejects.toThrow(/WRONG_DEPLOYMENT_ROOT/);
  });

  it("(6) wrong issue/service -> DENY; product task may not run host operations", async () => {
    const productClient = {
      getJsonOrNull: async () => [{ key: DEPLOY_SCOPE_DOCUMENT_KEY, body: JSON.stringify(productScope) }],
    } as never;
    await expect(
      enforceHostServiceScope(productClient, {
        issueId: "KOMAA-1003",
        operation: "mcp.deploy_candidate",
        target: "paperclip-mcp-gateway",
        tool: "paperclipHostOperation",
      }),
    ).rejects.toThrow(/WRONG_DEPLOYMENT_ROOT/);
  });
});

describe("enforcement wiring", () => {
  it("refuses a host write into the product repo with a structured verdict and zero writes", async () => {
    const client = {
      getJsonOrNull: async () => [{ key: DEPLOY_SCOPE_DOCUMENT_KEY, body: JSON.stringify(hostScope) }],
    } as never;
    let error: unknown;
    try {
      await enforceDeploymentRoot(client, {
        issueId: "KOMAA-1005",
        targetPath: productWorktree,
        workspacePath: productWorktree,
        tool: "paperclipGitPush",
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    const detail = (error as { detail?: Record<string, unknown> }).detail;
    expect(detail?.errorCode).toBe("wrong_deployment_root");
    expect(detail?.reason).toBe("WRONG_DEPLOYMENT_ROOT");
    expect(detail?.writes).toBe(0);
    expect(detail?.remediationOwner).toBe("cto");
    expect(detail?.actualRemote).toBe(PRODUCT_REMOTE);
  });

  it("leaves an issue without a scope document unrestricted", async () => {
    const client = { getJsonOrNull: async () => [] } as never;
    await expect(
      enforceDeploymentRoot(client, {
        issueId: "KOMAA-1005",
        targetPath: productWorktree,
        workspacePath: productWorktree,
        tool: "paperclipGitPush",
      }),
    ).resolves.toBeNull();
  });
});
