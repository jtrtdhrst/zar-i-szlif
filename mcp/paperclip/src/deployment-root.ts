// Hard deployment-root admission for write-capable MCP operations
// (KOMAA-1005, P0 host-vs-product scope correction, 2026-10-21).
//
// Policy source: the issue document "execution-deploy-scope" (JSON body) — the
// same first-class mechanism the write scope and the execution hold already
// use, so NO Paperclip/OpenCode Core change is required.
//
//   - document absent  -> no deployment-root restriction
//   - document present -> the declared deployment class is enforced
//   - document invalid -> fail closed
//
// The guard resolves the PHYSICAL location of the write target (realpath, so a
// symlink or a git worktree alias cannot hide the real owner) and the git
// remote of the checkout it belongs to. A host-infrastructure task may never
// write into a product repository checkout (or one of its worktrees); a product
// task may never write into host source. Both refusals are structured
// WRONG_DEPLOYMENT_ROOT verdicts naming the actual path + remote, the expected
// service/root and remediationOwner=CTO. They are raised BEFORE any filesystem
// write, so a refused operation performs ZERO writes.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PaperclipApiClient } from "./client.js";
import { scopeError } from "./write-scope.js";

export const DEPLOY_SCOPE_DOCUMENT_KEY = "execution-deploy-scope";

/** Canonical product checkout on this instance (historical folder label only). */
export const PRODUCT_CHECKOUT_ROOTS = ["/paperclip/repos/kompas-zbiorek"];

/** Canonical product repository remotes (a worktree alias resolves to one of them). */
export const PRODUCT_REPO_REMOTES = [
  "https://github.com/miloszspyrka-code/zar-i-szlif.git",
  "https://github.com/miloszspyrka-code/zar-i-szlif",
];

/** Host source roots a host-infrastructure task may write (MCP overlay source). */
export const HOST_SOURCE_ROOTS = ["/paperclip/mcp-patch"];

export type DeployKind = "host_mcp" | "product";

export interface DeployScope {
  kind: DeployKind;
  hostService?: string;
  hostSourceRoots?: string[];
  productRepoRemotes?: string[];
  ownerAgentId?: string;
}

export interface DeploymentRootVerdict {
  allowed: boolean;
  code?: string;
  reason?: string;
  actualPath?: string;
  actualRemote?: string | null;
  expectedService?: string;
  expectedRoot?: string;
  remediationOwner?: string;
}

export interface DeploymentRootContext {
  /** Physical path the operation would write into (workspace root or file path). */
  targetPath: string;
  /** Physical path of the checkout the target belongs to (workspace cwd). */
  workspacePath?: string;
  tool: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

/** Parse the deployment scope document body. Absent body => no scope. Invalid body => fail closed. */
export function parseDeployScope(body: string | null | undefined): DeployScope | null {
  if (body == null) return null;
  const text = body.trim();
  if (text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw scopeError(
      "wrong_deployment_root",
      `Deployment scope document "${DEPLOY_SCOPE_DOCUMENT_KEY}" is not valid JSON; refusing writes fail-closed`,
      { remediationOwner: "harness", reason: "WRONG_DEPLOYMENT_ROOT" },
    );
  }
  if (!isRecord(parsed)) {
    throw scopeError(
      "wrong_deployment_root",
      `Deployment scope document "${DEPLOY_SCOPE_DOCUMENT_KEY}" must be a JSON object; refusing writes fail-closed`,
      { remediationOwner: "harness", reason: "WRONG_DEPLOYMENT_ROOT" },
    );
  }
  const kind = parsed.kind;
  if (kind !== "host_mcp" && kind !== "product") {
    throw scopeError(
      "wrong_deployment_root",
      `Deployment scope document "${DEPLOY_SCOPE_DOCUMENT_KEY}" must declare kind "host_mcp" or "product"; refusing writes fail-closed`,
      { remediationOwner: "harness", reason: "WRONG_DEPLOYMENT_ROOT" },
    );
  }
  const scope: DeployScope = { kind };
  if (typeof parsed.hostService === "string" && parsed.hostService.trim().length > 0) scope.hostService = parsed.hostService.trim();
  const hostRoots = stringList(parsed.hostSourceRoots);
  if (hostRoots) scope.hostSourceRoots = hostRoots;
  const remotes = stringList(parsed.productRepoRemotes);
  if (remotes) scope.productRepoRemotes = remotes;
  if (typeof parsed.ownerAgentId === "string" && parsed.ownerAgentId.trim().length > 0) scope.ownerAgentId = parsed.ownerAgentId.trim();
  return scope;
}

/** Read the deployment scope of an issue from its scope document. */
export async function loadDeployScope(client: PaperclipApiClient, issueId: string): Promise<DeployScope | null> {
  const docs = await client.getJsonOrNull<unknown>(`/issues/${encodeURIComponent(issueId)}/documents?includeSystem=true`);
  if (!Array.isArray(docs)) return null;
  const hit = docs.find((doc) => isRecord(doc) && doc.key === DEPLOY_SCOPE_DOCUMENT_KEY);
  if (!isRecord(hit)) return null;
  const body = typeof hit.body === "string" ? hit.body : null;
  return parseDeployScope(body);
}

/** Normalize a git remote for comparison (strip .git suffix, trailing slash, case). */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  return trimmed.replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
}

/** True when `child` is `parent` or lives under it. */
export function isInsidePath(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent).replace(/[\\/]+$/, "");
  return c === p || c.startsWith(p + path.sep);
}

async function readOriginRemote(configPath: string): Promise<string | null> {
  const text = await fs.readFile(configPath, "utf8").catch(() => "");
  let inOrigin = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/i.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const m = /^url\s*=\s*(.+)$/i.exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

/**
 * Resolve the git checkout a path belongs to and its origin remote.
 * Handles a normal checkout (.git directory) and a linked worktree
 * (.git file -> gitdir -> commondir -> main repository config).
 */
export async function readGitIdentity(cwd: string): Promise<{ repoRoot: string; remote: string | null } | null> {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 16; depth++) {
    const dotGit = path.join(dir, ".git");
    const st = await fs.stat(dotGit).catch(() => null);
    if (st?.isDirectory()) {
      return { repoRoot: dir, remote: await readOriginRemote(path.join(dotGit, "config")) };
    }
    if (st?.isFile()) {
      const ptr = await fs.readFile(dotGit, "utf8").catch(() => "");
      const m = /^gitdir:\s*(.+)$/m.exec(ptr);
      if (!m) return null;
      const gitDir = path.resolve(dir, (m[1] ?? "").trim());
      const commonRaw = await fs.readFile(path.join(gitDir, "commondir"), "utf8").catch(() => "");
      const commonDir = commonRaw.trim().length > 0 ? path.resolve(gitDir, commonRaw.trim()) : gitDir;
      return { repoRoot: path.dirname(commonDir), remote: await readOriginRemote(path.join(commonDir, "config")) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Decide whether a write target is admitted for the declared deployment class.
 *
 * host_mcp: a product repository checkout (by physical root OR by origin remote,
 *           which also covers worktrees and symlink aliases) is refused.
 * product : host source roots are refused.
 */
export async function evaluateDeploymentRoot(
  scope: DeployScope | null,
  ctx: DeploymentRootContext,
): Promise<DeploymentRootVerdict> {
  if (!scope) return { allowed: true };
  const target = await fs.realpath(ctx.targetPath).catch(() => path.resolve(ctx.targetPath));
  const rawWorkspace = ctx.workspacePath ?? ctx.targetPath;
  const workspace = await fs.realpath(rawWorkspace).catch(() => path.resolve(rawWorkspace));
  const identity = await readGitIdentity(workspace);
  const remote = identity?.remote ?? null;
  const remoteNorm = normalizeRemote(remote);
  const productRemotes = (scope.productRepoRemotes ?? PRODUCT_REPO_REMOTES)
    .map(normalizeRemote)
    .filter((v): v is string => typeof v === "string");
  const declaredRoots = scope.hostSourceRoots ?? [];
  // Host source roots are the union of the issue-declared roots and the
  // instance inventory: a product task must never write host source, and the
  // inventory must hold even when an issue narrows its own allow-list.
  const hostRoots = Array.from(new Set([...declaredRoots, ...HOST_SOURCE_ROOTS]));
  const expectedService = scope.hostService ?? "host MCP service";
  const expectedRoot = declaredRoots[0] ?? HOST_SOURCE_ROOTS[0] ?? "(allowlisted host source root)";
  const inProductCheckout =
    PRODUCT_CHECKOUT_ROOTS.some((root) => isInsidePath(target, root)) ||
    (remoteNorm !== null && productRemotes.includes(remoteNorm));

  if (scope.kind === "host_mcp") {
    if (inProductCheckout) {
      return {
        allowed: false,
        code: "wrong_deployment_root",
        reason: "WRONG_DEPLOYMENT_ROOT",
        actualPath: target,
        actualRemote: remote,
        expectedService,
        expectedRoot,
        remediationOwner: "cto",
      };
    }
    return { allowed: true };
  }

  const inHostRoot = hostRoots.some((root) => isInsidePath(target, root));
  if (inHostRoot) {
    return {
      allowed: false,
      code: "wrong_deployment_root",
      reason: "WRONG_DEPLOYMENT_ROOT",
      actualPath: target,
      actualRemote: remote,
      expectedService,
      expectedRoot: hostRoots.join(", "),
      remediationOwner: "cto",
    };
  }
  return { allowed: true };
}

/**
 * Enforce the deployment-root admission for one write-capable operation.
 * Absent policy document leaves the operation unrestricted; an invalid document
 * fails closed; a refused target never performs a write.
 */
export async function enforceDeploymentRoot(
  client: PaperclipApiClient,
  opts: { issueId: string | null; targetPath: string; workspacePath?: string; tool: string },
): Promise<DeployScope | null> {
  if (!opts.issueId) return null;
  const scope = await loadDeployScope(client, opts.issueId);
  if (!scope) return null;
  const verdict = await evaluateDeploymentRoot(scope, {
    targetPath: opts.targetPath,
    workspacePath: opts.workspacePath,
    tool: opts.tool,
  });
  if (!verdict.allowed) {
    throw scopeError(
      "wrong_deployment_root",
      `WRONG_DEPLOYMENT_ROOT: ${opts.tool} would write into "${verdict.actualPath}" (remote ${verdict.actualRemote ?? "unknown"}), which is not the deployment root of this task (expected service ${verdict.expectedService}, expected root ${verdict.expectedRoot}); refusing with zero writes`,
      {
        reason: "WRONG_DEPLOYMENT_ROOT",
        remediationOwner: verdict.remediationOwner ?? "cto",
        actualPath: verdict.actualPath,
        actualRemote: verdict.actualRemote ?? null,
        expectedService: verdict.expectedService,
        expectedRoot: verdict.expectedRoot,
        writes: 0,
        tool: opts.tool,
      },
    );
  }
  return scope;
}

/**
 * Enforce the host-service binding for a host operation.
 * A product task may not run host operations at all; a host task may only
 * operate the service it declared.
 */
export async function enforceHostServiceScope(
  client: PaperclipApiClient,
  opts: { issueId: string | null; operation: string; target?: string | null; tool: string },
): Promise<DeployScope | null> {
  if (!opts.issueId) return null;
  const scope = await loadDeployScope(client, opts.issueId);
  if (!scope) return null;
  const hostRoots = scope.hostSourceRoots ?? HOST_SOURCE_ROOTS;
  const expectedService = scope.hostService ?? "host MCP service";
  if (scope.kind === "product") {
    throw scopeError(
      "wrong_deployment_root",
      `WRONG_DEPLOYMENT_ROOT: ${opts.tool} is a host operation but this task is a product deployment unit (${opts.operation}${opts.target ? ` ${opts.target}` : ""}); refusing with zero writes`,
      {
        reason: "WRONG_DEPLOYMENT_ROOT",
        remediationOwner: "cto",
        expectedService,
        expectedRoot: hostRoots.join(", "),
        writes: 0,
        tool: opts.tool,
      },
    );
  }
  if (scope.hostService && opts.target && opts.target !== scope.hostService) {
    throw scopeError(
      "wrong_deployment_root",
      `WRONG_DEPLOYMENT_ROOT: ${opts.tool} targets host service "${opts.target}" but this task is authorized for "${scope.hostService}"; refusing with zero writes`,
      {
        reason: "WRONG_DEPLOYMENT_ROOT",
        remediationOwner: "cto",
        actualPath: opts.target,
        expectedService,
        expectedRoot: hostRoots.join(", "),
        writes: 0,
        tool: opts.tool,
      },
    );
  }
  return scope;
}
