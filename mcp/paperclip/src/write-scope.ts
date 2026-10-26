// Hard domain/path admission for workspace write operations (KOMAA-1005, v69).
//
// Policy source: the issue document "execution-write-scope" (JSON body). This is
// the same first-class mechanism the execution hold uses (issue document), so
// the approved scope travels with the verified issue and NO Paperclip Core
// change is required.
//
//   - document absent  -> no path restriction (agents without a scope are unaffected)
//   - document present -> allow-list: a write target is admitted only when it
//                         matches one of the configured globs. Every other target
//                         is refused BEFORE any filesystem write.
//   - document invalid -> fail closed. A broken policy must never widen access.
//
// The scope is a WRITE scope. Reads (list/read file, git status/diff/log) stay
// open; only write targets are gated.

import type { PaperclipApiClient } from "./client.js";

export const WRITE_SCOPE_DOCUMENT_KEY = "execution-write-scope";

export interface WriteScope {
  paths: string[];
}

export function scopeError(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse the scope document body. Absent body => no scope. Invalid body => fail closed. */
export function parseWriteScope(body: string | null | undefined): WriteScope | null {
  if (body == null) return null;
  const text = body.trim();
  if (text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw scopeError(
      "path_denied",
      `Write scope document "${WRITE_SCOPE_DOCUMENT_KEY}" is not valid JSON; refusing writes fail-closed`,
      { remediationOwner: "harness" },
    );
  }
  if (!isRecord(parsed)) {
    throw scopeError(
      "path_denied",
      `Write scope document "${WRITE_SCOPE_DOCUMENT_KEY}" must be a JSON object; refusing writes fail-closed`,
      { remediationOwner: "harness" },
    );
  }
  const paths = parsed.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string" || p.trim().length === 0)) {
    throw scopeError(
      "path_denied",
      `Write scope document "${WRITE_SCOPE_DOCUMENT_KEY}" must carry a non-empty "paths" array of globs; refusing writes fail-closed`,
      { remediationOwner: "harness" },
    );
  }
  return { paths: paths.map((p) => (p as string).trim()) };
}

/** Normalize a repo-relative path for scope matching. Escapes are refused. */
export function normalizeScopePath(relPath: string): string {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw scopeError("path_denied", "Write target path is missing; refusing writes fail-closed");
  }
  const unix = relPath.replace(/\\/g, "/");
  if (unix.startsWith("/") || /^[A-Za-z]:/.test(unix)) {
    throw scopeError("path_denied", `Absolute write target refused: ${relPath}`);
  }
  const segments: string[] = [];
  for (const segment of unix.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw scopeError("path_denied", `Write target escapes the workspace: ${relPath}`);
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function matchesSegment(pattern: string, segment: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(segment);
}

/** Glob match with "**" (zero or more segments) and "*" (inside one segment). */
export function matchesScopePattern(pattern: string, path: string): boolean {
  const ps = pattern.split("/").filter((s) => s.length > 0);
  const xs = path.split("/").filter((s) => s.length > 0);
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let out: boolean;
    if (i === ps.length) out = j === xs.length;
    else if (ps[i] === "**") out = go(i + 1, j) || (j < xs.length && go(i, j + 1));
    else if (j === xs.length) out = false;
    else out = matchesSegment(ps[i], xs[j]) ? go(i + 1, j + 1) : false;
    memo.set(key, out);
    return out;
  };
  return go(0, 0);
}

export function isPathInScope(scope: WriteScope, relPath: string): boolean {
  const normalized = normalizeScopePath(relPath);
  return scope.paths.some((pattern) => matchesScopePattern(pattern, normalized));
}

/** Admit a single write target, or refuse it before any write happens. */
export function assertPathInScope(scope: WriteScope | null, relPath: string, tool: string): void {
  if (!scope) return;
  if (isPathInScope(scope, relPath)) return;
  throw scopeError(
    "path_denied",
    `Write target "${relPath}" is outside the approved write scope of this issue (allowed: ${scope.paths.join(", ")}); refusing ${tool}`,
    { remediationOwner: "caller", allowedPaths: scope.paths },
  );
}

// git subcommands that never write the worktree (read-only or repo-level only).
const GIT_READONLY = new Set([
  "status", "diff", "log", "show", "rev-parse", "rev-list", "merge-base", "ls-remote", "symbolic-ref",
  "remote", "branch", "tag", "blame", "describe", "cat-file", "fetch", "config", "stash",
]);

// git subcommands that write the worktree as a whole: they can materialize
// out-of-scope trees, so a scoped agent may not use them.
const GIT_WHOLE_TREE_WRITE = new Set([
  "checkout", "switch", "reset", "restore", "apply", "rebase", "merge", "pull",
  "cherry-pick", "revert", "rm", "mv", "worktree", "commit",
]);

// git subcommands that write only the paths they name: every named path must
// be inside the scope.
const GIT_PATH_SCOPED = new Set(["add", "clean"]);

const PATH_TOKEN_RE = /(?:[A-Za-z0-9_@.-]+\/)+[A-Za-z0-9_@.*-]+/g;

function gitSubcommand(argv: string[]): string | null {
  let idx = 1;
  while (argv[idx] === "-c" && typeof argv[idx + 1] === "string") idx += 2;
  return argv[idx] ?? null;
}

// Only the tokens AFTER the subcommand are pathspecs. The binary ("git") and
// the subcommand ("add") are not paths and must never be matched against the
// allow-list, otherwise every `git add <in-scope-path>` would be refused for
// the wrong reason ("git" is not an allowed path).
function pathArguments(argv: string[]): string[] {
  let idx = 1;
  while (argv[idx] === "-c" && typeof argv[idx + 1] === "string") idx += 2;
  const dash = argv.indexOf("--");
  const tail = dash === -1 ? argv.slice(idx + 1) : argv.slice(dash + 1);
  return tail.filter((token) => token.length > 0 && !token.startsWith("-"));
}

/**
 * Admit a shell command under a write scope.
 *
 * git: whole-tree writers are refused, path-bearing writers must name in-scope
 * paths only. Other binaries (node/pnpm/vitest/...) may not mention an
 * out-of-scope repo path in their arguments.
 */
export function assertExecInScope(scope: WriteScope | null, argv: string[], tool: string): void {
  if (!scope) return;
  if (!Array.isArray(argv) || argv.length === 0) return;
  const bin = argv[0].split("/").pop() as string;
  if (bin === "git") {
    const sub = gitSubcommand(argv);
    if (sub && GIT_WHOLE_TREE_WRITE.has(sub)) {
      throw scopeError(
        "path_denied",
        `git ${sub} writes the whole worktree and can materialize out-of-scope paths; refusing ${tool} under a write scope. Use the scoped file-write tools (paperclipWorkspacePatchFile / paperclipWorkspaceBatchChange / paperclipGitCommit) with in-scope paths.`,
        { remediationOwner: "caller", allowedPaths: scope.paths },
      );
    }
    if (sub && GIT_PATH_SCOPED.has(sub)) {
      const paths = pathArguments(argv);
      if (paths.length === 0) {
        throw scopeError(
          "path_denied",
          `git ${sub} without an explicit path would touch the whole worktree; refusing ${tool} under a write scope`,
          { remediationOwner: "caller", allowedPaths: scope.paths },
        );
      }
      for (const path of paths) assertPathInScope(scope, path, tool);
      return;
    }
    if (sub && GIT_READONLY.has(sub)) {
      // Read-only git stays open. Branch/remote/stash mutations are refused
      // below; plain reads are not path writes.
      const joined = argv.join(" ");
      if (sub === "branch" && /\s-{1,2}[dDm]\b/.test(` ${joined} `)) {
        throw scopeError("path_denied", `git branch -d/-D/-m mutates refs; refusing ${tool} under a write scope`, { remediationOwner: "caller" });
      }
      if (sub === "remote" && /\bset-url\b|\badd\b|\bremove\b|\brename\b/.test(joined)) {
        throw scopeError("path_denied", `git remote mutation changes the workspace remote; refusing ${tool} under a write scope`, { remediationOwner: "caller" });
      }
      if (sub === "stash" && !/\blist\b|\bshow\b/.test(joined)) {
        throw scopeError("path_denied", `git stash mutates the whole worktree; refusing ${tool} under a write scope`, { remediationOwner: "caller" });
      }
      return;
    }
    return;
  }
  // Non-git binaries: any repo-shaped path mentioned in the arguments must be
  // inside the scope (catches "node -e ... ops/x" and "vitest run app/web/y").
  const joined = argv.join(" ");
  const tokens = joined.match(PATH_TOKEN_RE) ?? [];
  for (const token of tokens) {
    if (token.includes("://")) continue;
    if (!isPathInScope(scope, token)) {
      throw scopeError(
        "path_denied",
        `Command mentions the out-of-scope path "${token}" (allowed: ${scope.paths.join(", ")}); refusing ${tool}`,
        { remediationOwner: "caller", allowedPaths: scope.paths },
      );
    }
  }
}

/** Read the write scope of an issue from its scope document. */
export async function loadWriteScope(client: PaperclipApiClient, issueId: string): Promise<WriteScope | null> {
  const docs = await client.getJsonOrNull<unknown>(`/issues/${encodeURIComponent(issueId)}/documents?includeSystem=true`);
  if (!Array.isArray(docs)) return null;
  const hit = docs.find((doc) => isRecord(doc) && doc.key === WRITE_SCOPE_DOCUMENT_KEY);
  if (!isRecord(hit)) return null;
  const body = typeof hit.body === "string" ? hit.body : null;
  return parseWriteScope(body);
}

/**
 * Enforce the issue write scope for one mutation. Fails closed on an invalid
 * policy document; a missing document leaves the workspace unrestricted.
 */
export async function enforceWriteScope(
  client: PaperclipApiClient,
  opts: { issueId: string | null; paths?: string[]; argv?: string[]; tool: string },
): Promise<WriteScope | null> {
  const issueId = opts.issueId;
  if (!issueId) return null;
  const scope = await loadWriteScope(client, issueId);
  if (!scope) return null;
  for (const path of opts.paths ?? []) assertPathInScope(scope, path, opts.tool);
  if (opts.argv) assertExecInScope(scope, opts.argv, opts.tool);
  return scope;
}
