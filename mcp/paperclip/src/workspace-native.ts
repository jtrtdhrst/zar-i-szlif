// Native workspace execution + git delivery tools (P0-A / P0-B).
//
// Runs INSIDE the paperclip container (same trust domain as the existing
// host-ops file bridge): local filesystem + spawned subprocesses, gated by
// workspace ownership resolved through the Paperclip API. No new privileges:
// reads need company-scoped auth (workspace.companyId must match the caller's
// company); mutations additionally need a live operatorRunId
// (paperclipStartOperatorRun) and, when issueId is given, a non-terminal
// owned issue. No shell, no sudo, no docker socket, no cross-company access.
//
// Reuse: workspace records + heartbeat-context + heartbeat-runs verification
// go through the existing PaperclipApiClient (same as control-plane tools).

import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import type { PaperclipApiClient } from "./client.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { assertPathInScope, enforceWriteScope } from "./write-scope.js";
import { enforceDeploymentRoot } from "./deployment-root.js";
import {
  deriveReviewDecision,
  evaluateCheckRunsPayload,
  formatCheckRuns,
  parseRestPull,
} from "./github-checks.js";

export interface WorkspaceNativeToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): WorkspaceNativeToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function getJsonOrNull(
  client: PaperclipApiClient,
  path: string,
  options: { callerKey?: boolean } = {},
): Promise<unknown> {
  return client.getJsonOrNull(path, options.callerKey ? { callerKey: true } : {});
}

function err(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

// ponytail: one redaction pass over workspace/exec output; never log raw secrets.
export function redactWorkspaceOutput(text: string): string {
  return text
    .replace(/pcp_[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]")
    .replace(/mcp_(at|rt)_[A-Za-z0-9_-]{8,}/g, "[REDACTED_OAUTH_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{8,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]{8,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/("?(?:password|secret|token|api[_-]?key)"?\s*[:=]\s*"?)[^",\s}]{6,}("?)/gi, "$1[REDACTED]$2");
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Workspace resolution + guards
// ---------------------------------------------------------------------------

export interface ResolvedWorkspace {
  workspaceId: string;
  cwd: string;
  realCwd: string;
  companyId: string;
  sourceIssueId: string | null;
  branchName: string | null;
}

function readCurrentWorkspaceFromContext(context: unknown): Record<string, unknown> | null {
  if (!isRecord(context)) return null;
  const direct = context.currentExecutionWorkspace;
  if (isRecord(direct)) return direct;
  const ws = (context as Record<string, unknown>).workspace;
  if (isRecord(ws)) return ws;
  return null;
}

export async function resolveWorkspace(
  client: PaperclipApiClient,
  ref: { workspaceId?: string | null; issueId?: string | null },
): Promise<ResolvedWorkspace> {
  const companyId = client.resolveCompanyId();
  let rec: Record<string, unknown> | null = null;
  if (ref.workspaceId) {
    const fetched = await getJsonOrNull(client, `/execution-workspaces/${enc(ref.workspaceId)}`);
    if (!isRecord(fetched)) throw err("not_found", `Execution workspace not found: ${ref.workspaceId}`);
    rec = fetched;
  } else if (ref.issueId) {
    const context = await client.requestJson("GET", `/issues/${enc(ref.issueId)}/heartbeat-context`);
    const embedded = readCurrentWorkspaceFromContext(context);
    if (!embedded || typeof embedded.id !== "string") {
      throw err("workspace_not_available", `Issue ${ref.issueId} has no current execution workspace (nothing realized for it on this host)`, {
        remediationOwner: "harness",
        remediation: "Checkout/provision the issue so a workspace with cwd is realized, then retry",
      });
    }
    const fetched = await getJsonOrNull(client, `/execution-workspaces/${enc(embedded.id as string)}`);
    rec = isRecord(fetched) ? fetched : embedded;
  } else {
    throw err("invalid_arguments", "Pass workspaceId or issueId");
  }
  const wsCompany = typeof rec.companyId === "string" ? rec.companyId : null;
  if (!wsCompany || wsCompany !== companyId) {
    throw err("permission_denied", "Cross-company workspace access refused", { remediationOwner: "board" });
  }
  const cwd = typeof rec.cwd === "string" ? rec.cwd : null;
  if (!cwd) {
    throw err("workspace_not_available", `Workspace ${String(rec.id ?? "?")} has no local cwd (not realized on this host)`, {
      remediationOwner: "harness",
    });
  }
  let st: Awaited<ReturnType<typeof fs.stat>>;
  try {
    st = await fs.stat(cwd);
  } catch {
    throw err("workspace_not_available", `Workspace cwd is not reachable from the MCP host: ${cwd}`, { remediationOwner: "harness" });
  }
  if (!st.isDirectory()) throw err("workspace_not_available", `Workspace cwd is not a directory: ${cwd}`, { remediationOwner: "harness" });
  const realCwd = await fs.realpath(cwd);
  return {
    workspaceId: String(rec.id ?? ref.workspaceId ?? "?"),
    cwd,
    realCwd,
    companyId: wsCompany,
    sourceIssueId: typeof rec.sourceIssueId === "string" ? rec.sourceIssueId : null,
    branchName: typeof rec.branchName === "string" ? rec.branchName : null,
  };
}

export async function verifyOperatorRun(client: PaperclipApiClient, operatorRunId: string): Promise<Record<string, unknown>> {
  const companyId = client.resolveCompanyId();
  const run = await getJsonOrNull(client, `/heartbeat-runs/${enc(operatorRunId)}`);
  if (!isRecord(run)) throw err("auth_failed", "Invalid or expired operatorRunId (no such run)", { remediationOwner: "caller", remediation: "Provide a live operator session owned by this caller/company; operator sessions are removed in Paperclip 2026.1012.0 (CAPABILITY_REMOVED, owner CTO)" });
  if (typeof run.companyId === "string" && run.companyId !== companyId) {
    throw err("auth_failed", "operatorRunId belongs to another company", { remediationOwner: "caller" });
  }
  const status = typeof run.status === "string" ? run.status : null;
  if (status !== "operator" && status !== "running") {
    throw err("auth_failed", `operatorRunId is not an active operator session (status=${status ?? "?"})`, { remediationOwner: "caller" });
  }
  const snap = isRecord(run.contextSnapshot) ? run.contextSnapshot : null;
  const exp = snap && typeof snap.expiresAt === "string" ? Date.parse(snap.expiresAt as string) : NaN;
  if (Number.isFinite(exp) && exp <= Date.now()) throw err("auth_failed", "operatorRunId expired", { remediationOwner: "caller" });
  return run;
}

const TERMINAL_ISSUE = new Set(["done", "cancelled"]);

export async function verifyIssueWritable(client: PaperclipApiClient, issueId: string): Promise<{ identifier: string; status: string }> {
  const companyId = client.resolveCompanyId();
  const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${enc(issueId)}`);
  const issueCompany = typeof issue.companyId === "string" ? issue.companyId : null;
  if (issueCompany !== companyId) throw err("permission_denied", "Cross-company issue access refused", { remediationOwner: "board" });
  const status = typeof issue.status === "string" ? issue.status : "?";
  if (TERMINAL_ISSUE.has(status)) {
    throw err("issue_state_conflict", `Issue is terminal (${status}); workspace mutations refused`, { remediationOwner: "operator" });
  }
  return { identifier: typeof issue.identifier === "string" ? (issue.identifier as string) : issueId, status };
}

// ---------------------------------------------------------------------------
// P0 2026-10-17: execution-context compatibility layer (operator-session removal).
//
// Paperclip 2026.1012.0 removed operator sessions: POST /companies/:id/operator-runs
// is gone, X-Paperclip-Operator-Run-Id is dead, and no operator run can be
// minted (verified: 0 routes, 0 columns, 0 validators upstream). Workspace
// mutations previously required a live operatorRunId. The sanctioned replacement
// contexts on this runtime are:
//   1. a board key (company authority; the gateway authenticates it against the
//      company API before the MCP session starts), or
//   2. the caller's OWN live heartbeat run: runId fetched with the caller's own
//      key, same company, run.agentId === caller agent, status === "running"
//      (the run's end IS the credential's expiration), and issue-bound via
//      contextSnapshot.issueId — the same bindings the runtime's own cross-issue
//      writer enforces server-side (cross-issue-influence-limit.ts
//      observeCrossIssueInfluence: company+agent match + issue binding).
//
// A legacy operatorRunId is still accepted when it verifies (grandfathered
// rows), but is never REQUIRED. Everything else fails closed with a typed
// error; agent-run authority is additionally bounded to the run's issue.
// ---------------------------------------------------------------------------

export type CallerIdentity =
  | { type: "board" }
  | { type: "agent"; agentId: string }
  | { type: "unknown" };

export interface WorkspaceMutationContext {
  authority: "board" | "agent-run" | "operator";
  runId?: string;
  agentId?: string;
  operatorRunId?: string;
  runIssueId?: string | null;
}

const callerIdentityCache = new WeakMap<PaperclipApiClient, Promise<CallerIdentity>>();

// Resolve the MCP session caller's identity from its own credential:
//   - pcp_board_* key -> board
//   - agent key      -> GET /agents/me with the caller key
//   - otherwise      -> GET /companies (board-only route) as corroboration
// Never fabricates an identity: unresolved callers stay "unknown" (deny).
export function resolveCallerIdentity(client: PaperclipApiClient): Promise<CallerIdentity> {
  const cached = callerIdentityCache.get(client);
  if (cached) return cached;
  const pending = (async (): Promise<CallerIdentity> => {
    const key = client.callerApiKey;
    if (!key) return { type: "unknown" };
    // An explicitly-prefixed Board credential is board authority; never probe
    // it as an agent (that only produced denials in the log).
    if (key.startsWith("pcp_board_")) return { type: "board" };
    // GET /agents/me answers 401 for every non-agent credential, so it is the
    // authoritative probe for ANY caller key. It must NOT be gated on a
    // "pcp_agent_" prefix: agent sessions are issued a JWT (PAPERCLIP_API_KEY),
    // not a pcp_agent_* key, and the prefix gate made every workspace-mutation
    // route fail closed with auth_failed before the write-scope guard ran.
    try {
      const me = await client.requestJson("GET", "/agents/me", { callerKey: true });
      if (isRecord(me) && typeof me.id === "string" && me.id.length > 0) {
        return { type: "agent", agentId: me.id };
      }
    } catch {
      // fall through to the Board probe below
    }
    try {
      await client.requestJson("GET", "/companies");
      return { type: "board" };
    } catch {
      return { type: "unknown" };
    }
  })();
  callerIdentityCache.set(client, pending);
  return pending;
}

// Verify a live heartbeat run as the caller's own execution context.
export async function verifyLiveAgentRun(
  client: PaperclipApiClient,
  runId: string,
  agentId: string,
): Promise<{ run: Record<string, unknown>; runIssueId: string | null }> {
  const companyId = client.resolveCompanyId();
  const run = await getJsonOrNull(client, `/heartbeat-runs/${enc(runId)}`);
  if (!isRecord(run)) {
    throw err("auth_failed", "runId does not identify a heartbeat run in this company", {
      remediationOwner: "caller",
      remediation: "Pass the runId of your own live heartbeat run ($PAPERCLIP_RUN_ID); operator sessions were removed in Paperclip 2026.1012.0",
    });
  }
  if (typeof run.companyId === "string" && run.companyId !== companyId) {
    throw err("auth_failed", "runId belongs to another company", { remediationOwner: "caller" });
  }
  const runAgentId = typeof run.agentId === "string" ? run.agentId : null;
  if (runAgentId !== agentId) {
    throw err("auth_failed", "runId does not belong to the authenticated caller's agent", {
      remediationOwner: "caller",
      remediation: "Use the run of the same agent that owns this API key; a live run id is not a transferable credential",
    });
  }
  const status = typeof run.status === "string" ? run.status : null;
  if (status !== "running") {
    throw err("auth_failed", `runId is not live (status=${status ?? "?"})`, {
      remediationOwner: "caller",
      remediation: "Workspace mutations accept only the caller's own RUNNING run; the run's end is the credential's expiration. Retry during an active run.",
    });
  }
  const snap = isRecord(run.contextSnapshot) ? run.contextSnapshot : null;
  const snapIssue = snap && typeof snap.issueId === "string" && snap.issueId.length > 0 ? snap.issueId : null;
  const snapTask = snap && typeof snap.taskId === "string" && snap.taskId.length > 0 ? snap.taskId : null;
  return { run, runIssueId: snapIssue ?? snapTask };
}

// Shared mutation admission for workspace/git/delivery tools.
export async function authorizeWorkspaceMutation(
  client: PaperclipApiClient,
  input: { runId?: string | null; operatorRunId?: string | null },
): Promise<WorkspaceMutationContext> {
  if (input.operatorRunId) {
    // Legacy/grandfathered operator session (cannot be minted on 1012, but
    // unexpired rows are honored).
    const run = await verifyOperatorRun(client, input.operatorRunId);
    const snap = isRecord(run.contextSnapshot) ? run.contextSnapshot : null;
    const runIssueId = snap && typeof snap.issueId === "string" && snap.issueId.length > 0 ? snap.issueId : null;
    return { authority: "operator", operatorRunId: input.operatorRunId, runIssueId };
  }
  const identity = await resolveCallerIdentity(client);
  if (identity.type === "board") return { authority: "board" };
  if (identity.type === "agent") {
    const effectiveRunId = input.runId ?? client.defaults.runId ?? null;
    if (!effectiveRunId) {
      throw err(
        "run_context_required",
        "Workspace mutations by an agent key require runId — the caller's own live heartbeat run. Operator sessions were removed in Paperclip 2026.1012.0; the live run is the sanctioned execution context. Pass runId (or a board key for direct company authority).",
        { remediationOwner: "caller", remediation: "Pass runId of your currently running heartbeat run ($PAPERCLIP_RUN_ID)" },
      );
    }
    const { runIssueId } = await verifyLiveAgentRun(client, effectiveRunId, identity.agentId);
    return { authority: "agent-run", runId: effectiveRunId, agentId: identity.agentId, runIssueId };
  }
  throw err("auth_failed", "Cannot establish the caller's identity for a workspace mutation: authenticate with an agent key or board key", {
    remediationOwner: "caller",
  });
}

// Agent-run authority is issue-bounded: the mutation must target the run's own
// issue (never another unit's workspace). Board/operator authority is exempt.
export function assertWorkspaceMutationScope(
  ctx: WorkspaceMutationContext,
  ws: ResolvedWorkspace,
  requestedIssueId?: string | null,
): void {
  if (ctx.authority !== "agent-run") return;
  const target = requestedIssueId ?? ws.sourceIssueId ?? null;
  if (!target) {
    throw err("issue_scope_required", "Agent-run workspace mutations are issue-bounded: pass issueId or target an issue-scoped workspace (project-level workspaces need board authority)", {
      remediationOwner: "caller",
    });
  }
  if (ws.sourceIssueId && requestedIssueId && ws.sourceIssueId !== requestedIssueId) {
    throw err("scope_denied", "Workspace does not belong to the requested issue", { remediationOwner: "caller" });
  }
  if (!ctx.runIssueId) {
    throw err("scope_denied", "runId has no issue binding in its contextSnapshot; cannot bound this workspace mutation", {
      remediationOwner: "caller",
      remediation: "Use a run whose contextSnapshot.issueId is the target issue",
    });
  }
  if (ctx.runIssueId !== target) {
    throw err("scope_denied", `runId is bound to issue ${ctx.runIssueId}; workspace mutation for ${target} refused (cross-issue workspace mutation)`, {
      remediationOwner: "caller",
      remediation: "Use the run bound to the workspace's issue, or a board key",
    });
  }
}

// Durable attribution for workspace mutations (best-effort local ledger).
export async function recordWorkspaceMutationAudit(
  ctx: WorkspaceMutationContext,
  ws: ResolvedWorkspace,
  detail: Record<string, unknown>,
): Promise<void> {
  const id = `mut-${randomUUID()}`;
  await writeLedger(id, {
    kind: "workspace-mutation",
    at: new Date().toISOString(),
    authority: ctx.authority,
    runId: ctx.runId ?? null,
    agentId: ctx.agentId ?? null,
    operatorRunId: ctx.operatorRunId ?? null,
    workspaceId: ws.workspaceId,
    cwd: ws.cwd,
    ...detail,
  }).catch(() => { /* audit is best-effort; the operation result carries attribution */ });
}

// Path must stay inside the workspace: no absolute escapes, no ".." breakout,
// no symlink escape (realpath containment). Shared by read + write paths.
export async function resolveWorkspacePath(ws: ResolvedWorkspace, relPath: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.length > 512) {
    throw err("invalid_arguments", "path must be a non-empty relative path (max 512 chars)");
  }
  if (relPath.startsWith("/") || relPath.startsWith("\\") || /^[A-Za-z]:/.test(relPath)) {
    throw err("path_denied", `Absolute paths refused: ${relPath}`);
  }
  const norm = normalize(relPath);
  if (norm === ".." || norm.startsWith(`..${sep}`) || norm.startsWith("../")) {
    throw err("path_denied", `Path escapes the workspace: ${relPath}`);
  }
  const abs = resolve(ws.cwd, norm);
  if (abs !== ws.cwd && !abs.startsWith(ws.cwd + sep)) throw err("path_denied", `Path escapes the workspace: ${relPath}`);
  if (abs === ws.cwd) {
    // Workspace root itself: containment is trivially satisfied; just make
    // sure the root is not itself a symlink pointing elsewhere.
    const real = await fs.realpath(abs).catch(() => null);
    if (real !== ws.realCwd) throw err("path_denied", `Workspace root resolves outside itself: ${relPath}`);
    return abs;
  }
  // Symlink escape: parent must resolve inside the workspace; an existing
  // symlink target itself is refused (never follow out).
  const parentReal = await fs.realpath(resolve(abs, "..")).catch(() => null);
  if (parentReal !== null && parentReal !== ws.realCwd && !parentReal.startsWith(ws.realCwd + sep)) {
    throw err("path_denied", `Symlink escape refused: ${relPath} resolves outside the workspace`);
  }
  try {
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) {
      const target = await fs.realpath(abs);
      if (target !== ws.realCwd && !target.startsWith(ws.realCwd + sep)) {
        throw err("path_denied", `Symlink escape refused: ${relPath} points outside the workspace`);
      }
    }
  } catch (e) {
    if (opts.mustExist) throw err("not_found", `Path not found in workspace: ${relPath}`);
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  return abs;
}

function ledgerDir(): string {
  return process.env.PAPERCLIP_WORKSPACE_OPS_LEDGER_DIR || "/paperclip/mcp-workspace-ops";
}

async function readLedger(operationId: string): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-fA-F-]{8,}$/.test(operationId)) return null;
  try {
    const raw = await fs.readFile(join(ledgerDir(), `${operationId}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLedger(operationId: string, envelope: Record<string, unknown>): Promise<void> {
  await fs.mkdir(ledgerDir(), { recursive: true });
  await fs.writeFile(join(ledgerDir(), `${operationId}.json`), JSON.stringify({ ...envelope, operationId }, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Subprocess execution (no shell, allowlisted binaries, jailed cwd)
// ---------------------------------------------------------------------------

const EXEC_ALLOW = new Set(["git", "pnpm", "npm", "node", "npx", "tsc", "vitest", "eslint", "gh"]);

const GIT_SUBCOMMAND_ALLOW = new Set([
  "status", "diff", "log", "rev-parse", "rev-list", "merge-base", "cat-file", "branch", "checkout", "switch", "add",
  "commit", "push", "show", "fetch", "remote", "ls-remote", "stash", "pull", "symbolic-ref",
  "clean", // single-file only: git clean -f -- <path> (validated below)
]);

const GH_SUBCOMMAND_ALLOW = new Set(["pr"]);

const GIT_CLEAN_ALLOW = new Set(["-f"]);

const GIT_ARG_DENY = [
  "--upload-pack", "--receive-pack", "--exec", "protocol.ext",
  "--config protocol", "-c protocol",
];

export interface ExecResult {
  operationId: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  replayed: boolean;
  command: string[];
}

function checkExecPolicy(argv: string[]): void {
  if (!Array.isArray(argv) || argv.length === 0) throw err("invalid_arguments", "argv must be a non-empty array");
  if (argv.length > 64) throw err("invalid_arguments", "argv too long (max 64 elements)");
  for (const a of argv) {
    if (typeof a !== "string" || a.length === 0 || a.length > 2048) throw err("invalid_arguments", "argv elements must be non-empty strings (max 2048 chars)");
    if (a.includes("\0")) throw err("command_denied", "NUL byte in argv refused");
  }
  const bin = argv[0].split("/").pop() as string;
  if (!EXEC_ALLOW.has(bin)) {
    throw err("command_denied", `Binary not allowlisted: ${argv[0]} (want one of ${[...EXEC_ALLOW].join(", ")}). No shell, no sudo, no docker, no ssh.`, {
      remediationOwner: "cto",
      remediation: "Pin a new binary in the MCP execution profile via owner review; ad-hoc host shells are never granted",
    });
  }
  if (bin === "git") {
    // Leading -c key=val pairs (our own safe.directory pin, commit identity)
    // precede the subcommand; validate the first non-flag token instead.
    let subIdx = 1;
    while (argv[subIdx] === "-c" && typeof argv[subIdx + 1] === "string") subIdx += 2;
    const sub = argv[subIdx];
    if (!sub || !GIT_SUBCOMMAND_ALLOW.has(sub)) {
      throw err("command_denied", `git subcommand not allowlisted: ${sub ?? "(missing)"}`);
    }
    const joined = argv.join(" ");
    for (const deny of GIT_ARG_DENY) {
      if (joined.includes(deny)) throw err("command_denied", `git argument refused: ${deny}`);
    }
    if (sub === "clean") {
      // Only single-file cleanup: git clean -f -- <path>. Never -d/-x/-X.
      const rest = argv.slice(subIdx + 1);
      const dash = rest.indexOf("--");
      const flags = dash === -1 ? rest : rest.slice(0, dash);
      for (const f of flags) {
        if (!GIT_CLEAN_ALLOW.has(f)) throw err("command_denied", `git clean flag refused: ${f} (only -f -- <path>)`);
      }
      if (dash === -1) throw err("command_denied", "git clean requires -- <path> (no bare clean)");
      const targets = rest.slice(dash + 1);
      if (targets.length !== 1) throw err("command_denied", "git clean allows exactly one path");
    }
  }
  if (bin === "gh") {
    const sub = argv[1];
    if (!sub || !GH_SUBCOMMAND_ALLOW.has(sub)) {
      throw err("command_denied", `gh subcommand not allowlisted: ${sub ?? "(missing)"} (only read/publish PR operations)`);
    }
  }
}

export async function runJailedExec(opts: {
  ws: ResolvedWorkspace;
  argv: string[];
  cwdRel?: string | null;
  timeoutSec?: number | null;
  outputLimit?: number | null;
  operationId?: string | null;
  extraEnv?: Record<string, string>;
}): Promise<ExecResult> {
  if (opts.operationId) {
    const stored = await readLedger(opts.operationId);
    if (stored) return { ...(stored as unknown as ExecResult), replayed: true };
  }
  checkExecPolicy(opts.argv);
  const timeoutSec = Math.min(Math.max(opts.timeoutSec ?? 60, 1), 110);
  const outputLimit = Math.min(Math.max(opts.outputLimit ?? 32768, 1024), 262144);
  let runCwd = opts.ws.cwd;
  if (opts.cwdRel) {
    runCwd = await resolveWorkspacePath(opts.ws, opts.cwdRel);
    const st = await fs.stat(runCwd).catch(() => null);
    if (!st || !st.isDirectory()) throw err("not_found", `exec cwd is not a directory: ${opts.cwdRel}`);
  }
  const operationId = opts.operationId ?? randomUUID();
  const started = Date.now();
  // Own-uid worktrees are fine, but workspaces realized by another uid hit
  // git's dubious-ownership guard: pin this exact cwd as safe (no globs,
  // no user input in the value) so git works regardless of which uid
  // realized the worktree.
  const spawnArgv = opts.argv[0].split("/").pop() === "git"
    ? ["git", "-c", `safe.directory=${runCwd}`, ...opts.argv.slice(1)]
    : opts.argv;
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: "/paperclip",
    LANG: "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    ...(opts.extraEnv ?? {}),
  };
  const result = await new Promise<{ code: number | null; timedOut: boolean; out: string; errOut: string; outTrunc: boolean; errTrunc: boolean }>(
    (resolvePromise) => {
      let out = "";
      let errOut = "";
      let outTrunc = false;
      let errTrunc = false;
      let timedOut = false;
      let settled = false;
      const child = spawn(spawnArgv[0], spawnArgv.slice(1), { cwd: runCwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 5000);
      }, timeoutSec * 1000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (out.length < outputLimit) {
          out += chunk.toString("utf8");
          if (out.length >= outputLimit) { out = out.slice(0, outputLimit); outTrunc = true; }
        } else outTrunc = true;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (errOut.length < outputLimit) {
          errOut += chunk.toString("utf8");
          if (errOut.length >= outputLimit) { errOut = errOut.slice(0, outputLimit); errTrunc = true; }
        } else errTrunc = true;
      });
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code: null, timedOut, out, errOut: errOut + `\nspawn error: ${(e as Error).message}`, outTrunc, errTrunc });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code, timedOut, out, errOut, outTrunc, errTrunc });
      });
    },
  );
  const envelope: ExecResult = {
    operationId,
    exitCode: result.code,
    timedOut: result.timedOut,
    stdout: redactWorkspaceOutput(result.out),
    stderr: redactWorkspaceOutput(result.errOut),
    stdoutTruncated: result.outTrunc,
    stderrTruncated: result.errTrunc,
    durationMs: Date.now() - started,
    replayed: false,
    command: spawnArgv,
  };
  await writeLedger(operationId, { ...envelope, workspaceId: opts.ws.workspaceId, cwd: runCwd, requestArgv: opts.argv, requestCwd: opts.cwdRel ?? null });
  return envelope;
}

async function gitHead(ws: ResolvedWorkspace): Promise<{ head: string | null; branch: string | null; dirty: boolean }> {
  const r = await runJailedExec({ ws, argv: ["git", "rev-parse", "HEAD"], timeoutSec: 15, outputLimit: 1024 });
  const b = await runJailedExec({ ws, argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"], timeoutSec: 15, outputLimit: 256 });
  const s = await runJailedExec({ ws, argv: ["git", "status", "--porcelain=v1"], timeoutSec: 15, outputLimit: 65536 });
  return {
    head: r.exitCode === 0 ? r.stdout.trim().split("\n")[0] : null,
    branch: b.exitCode === 0 ? b.stdout.trim().split("\n")[0] : null,
    dirty: s.exitCode === 0 ? s.stdout.trim().length > 0 : false,
  };
}

const SECRET_SCAN = [/pcp_[A-Za-z0-9_-]{8,}/, /mcp_(at|rt)_[A-Za-z0-9_-]{8,}/, /gh[pousr]_[A-Za-z0-9_]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

function scanForSecrets(patch: string): string[] {
  const hits: string[] = [];
  for (const re of SECRET_SCAN) {
    if (re.test(patch)) hits.push(re.source.slice(0, 40));
  }
  return hits;
}

const workspaceIdSchema = z.string().uuid().optional().nullable();
const issueIdSchema = z.string().min(1).optional().nullable();
const operatorRunIdSchema = z.string().uuid().optional().nullable();
const runIdSchema = z.string().uuid().optional().nullable();

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const WORKSPACE_NATIVE_TOOL_NAMES: string[] = [
  "paperclipWorkspaceListFiles",
  "paperclipWorkspaceReadFile",
  "paperclipWorkspacePatchFile",
  "paperclipWorkspaceExec",
  "paperclipGitStatus",
  "paperclipGitDiff",
  "paperclipGitCreateBranch",
  "paperclipGitCommit",
  "paperclipGitPush",
  "paperclipGitCreatePR",
  "paperclipGitGetChecks",
  "paperclipGitGetMergeReadiness",
];

export function createWorkspaceNativeTools(client: PaperclipApiClient): WorkspaceNativeToolDefinition[] {
  return [
    makeTool(
      "paperclipWorkspaceListFiles",
      "List files in an authorized execution workspace (by workspaceId, or the current workspace of issueId). Company-scoped: cross-company refused. Returns path/type/size (+sha256 for small files).",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        path: z.string().max(512).optional().default("."),
        recursive: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(2000).optional().default(200),
      }),
      async ({ workspaceId, issueId, path, recursive, limit }) => {
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const base = await resolveWorkspacePath(ws, path || ".");
        const st = await fs.stat(base).catch(() => null);
        if (!st || !st.isDirectory()) throw err("not_found", `Directory not found in workspace: ${path}`);
        type Entry = { path: string; type: string; size: number | null; sha256: string | null };
        const entries: Entry[] = [];
        let truncated = false;
        async function walk(dir: string, rel: string, depth: number): Promise<void> {
          if (entries.length >= (limit ?? 200)) { truncated = true; return; }
          if (depth > 12) { truncated = true; return; }
          const dirents = await fs.readdir(dir, { withFileTypes: true });
          for (const d of dirents) {
            if (entries.length >= (limit ?? 200)) { truncated = true; return; }
            if (d.name === ".git" && depth === 0 && !recursive) continue;
            const relPath = rel ? `${rel}/${d.name}` : d.name;
            const abs = join(dir, d.name);
            if (d.isSymbolicLink()) {
              entries.push({ path: relPath, type: "symlink", size: null, sha256: null });
              continue;
            }
            if (d.isDirectory()) {
              entries.push({ path: relPath, type: "dir", size: null, sha256: null });
              if (recursive) await walk(abs, relPath, depth + 1);
            } else if (d.isFile()) {
              let size: number | null = null;
              let sha: string | null = null;
              try {
                const s = await fs.stat(abs);
                size = s.size;
                if (s.size <= 65536) sha = sha256Hex(await fs.readFile(abs, "utf8").catch(() => ""));
              } catch { /* unreadable: leave nulls */ }
              entries.push({ path: relPath, type: "file", size, sha256: sha });
            }
          }
        }
        await walk(base, path && path !== "." ? path : "", 0);
        return { workspaceId: ws.workspaceId, cwd: ws.cwd, branch: ws.branchName, entries, truncated, scope: "company-owned execution workspace" };
      },
    ),
    makeTool(
      "paperclipWorkspaceReadFile",
      "Read a file from an authorized execution workspace with line pagination. Returns numbered lines, full-file sha256, and truncation info. Large files are paged via startLine/endLine.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        path: z.string().min(1).max(512),
        startLine: z.number().int().min(1).optional().default(1),
        endLine: z.number().int().min(1).max(10000).optional().default(400),
      }),
      async ({ workspaceId, issueId, path, startLine, endLine }) => {
        if ((endLine ?? 400) < (startLine ?? 1)) throw err("invalid_arguments", "endLine must be >= startLine");
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const abs = await resolveWorkspacePath(ws, path, { mustExist: true });
        const st = await fs.stat(abs);
        if (!st.isFile()) throw err("invalid_arguments", `Not a file: ${path}`);
        if (st.size > 2 * 1024 * 1024) throw err("file_too_large", `File exceeds 2 MiB (${st.size} bytes); refine scope`, { remediationOwner: "caller" });
        const content = await fs.readFile(abs, "utf8").catch(() => {
          throw err("invalid_arguments", `File is not valid UTF-8 text: ${path}`);
        });
        const sha256 = sha256Hex(content);
        const lines = content.split("\n");
        const totalLines = lines.length;
        const s = Math.min(startLine ?? 1, totalLines);
        const e = Math.min(endLine ?? 400, totalLines);
        const numbered = lines.slice(s - 1, e).map((text, i) => ({ line: s + i, text }));
        return {
          workspaceId: ws.workspaceId, path, sha256, totalLines, totalBytes: st.size,
          startLine: s, endLine: e, truncated: e < totalLines, lines: numbered,
        };
      },
    ),
    makeTool(
      "paperclipWorkspacePatchFile",
      "Atomically REPLACE a file's full content in an authorized workspace (optimistic concurrency via expectedSha; tmp+rename; no writes outside the workspace). NOTE: despite the legacy parameter name, `patch` carries the FULL target content, not a unified diff — `content` is the canonical alias for the same value. For true unified diffs use paperclipWorkspaceApplyUnifiedDiff. Mutations are authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0. dryRun returns the diff without writing.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        path: z.string().min(1).max(512),
        expectedSha: z.string().length(64).optional().nullable(),
        patch: z.string().min(1).max(1048576).optional().nullable(),
        content: z.string().min(1).max(1048576).optional().nullable(),
        dryRun: z.boolean().optional().default(false),
        allowCreate: z.boolean().optional().default(false),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ workspaceId, issueId, path, expectedSha, patch, content, dryRun, allowCreate, runId, operatorRunId }) => {
        if (patch != null && content != null && patch !== content) throw err("invalid_arguments", "Pass either patch (legacy full-content alias) or content, not conflicting values");
        patch = (content ?? patch ?? null) as unknown as string;
        if (typeof patch !== "string" || patch.length === 0) throw err("invalid_arguments", "Pass the full target file content via content (or legacy patch)");
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        else if (ws.sourceIssueId) {
          try { await verifyIssueWritable(client, ws.sourceIssueId); } catch { /* workspace-level write without issue scope: allowed */ }
        }
        if (patch.includes("\0")) throw err("invalid_arguments", "NUL byte in patch refused");
        await enforceWriteScope(client, { issueId: issueId ?? ws.sourceIssueId, paths: [path], tool: "paperclipWorkspacePatchFile" });
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipWorkspacePatchFile" });
        const secrets = scanForSecrets(patch);
        if (secrets.length > 0) throw err("secret_denied", `Patch contains secret-like material (${secrets.join(", ")}); refusing to write secrets to the repo`);
        const abs = await resolveWorkspacePath(ws, path);
        const exists = await fs.stat(abs).then((s) => s.isFile()).catch(() => false);
        if (!exists) {
          if (!allowCreate) {
            throw err("not_found", `Path not found in workspace: ${path} (pass allowCreate:true to create it inside the workspace)`);
          }
          const afterSha = sha256Hex(patch);
          if (dryRun) {
            return { workspaceId: ws.workspaceId, path, dryRun: true, create: true, afterSha, note: "dryRun: no write performed" };
          }
          const tmp = `${abs}.paperclip-tmp-${randomUUID()}`;
          try {
            await fs.writeFile(tmp, patch, "utf8");
            await fs.rename(tmp, abs);
          } finally {
            await fs.rm(tmp, { force: true });
          }
          const reread = sha256Hex(await fs.readFile(abs, "utf8"));
          if (reread !== afterSha) throw err("internal", "Post-write readback mismatch");
          await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "patch.create", path, afterSha: reread });
          return { workspaceId: ws.workspaceId, path, dryRun: false, create: true, beforeSha: null, afterSha: reread, attribution: mutationCtx };
        }
        if (!expectedSha) throw err("invalid_arguments", "expectedSha is required when patching an existing file (optimistic concurrency)");
        const current = await fs.readFile(abs, "utf8").catch(() => {
          throw err("invalid_arguments", `File is not valid UTF-8 text: ${path}`);
        });
        const currentSha = sha256Hex(current);
        if (currentSha !== expectedSha) {
          throw err("version_conflict", `expectedSha mismatch for ${path}: file changed since read (current sha256 ${currentSha}). Re-read and re-apply.`);
        }
        const beforeLines = current.split("\n").length;
        const afterLines = patch.split("\n").length;
        const afterSha = sha256Hex(patch);
        if (afterSha === currentSha) return { workspaceId: ws.workspaceId, path, dryRun: dryRun ?? false, alreadyApplied: true, sha256: afterSha };
        if (dryRun) {
          return { workspaceId: ws.workspaceId, path, dryRun: true, beforeSha: currentSha, afterSha, beforeLines, afterLines, note: "dryRun: no write performed" };
        }
        const tmp = `${abs}.paperclip-tmp-${randomUUID()}`;
        try {
          await fs.writeFile(tmp, patch, "utf8");
          const verify = sha256Hex(await fs.readFile(tmp, "utf8"));
          if (verify !== afterSha) throw err("internal", "Tmp write verification failed; original untouched");
          await fs.rename(tmp, abs);
        } finally {
          await fs.rm(tmp, { force: true });
        }
        const reread = sha256Hex(await fs.readFile(abs, "utf8"));
        if (reread !== afterSha) throw err("internal", "Post-write readback mismatch");
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "patch.replace", path, beforeSha: currentSha, afterSha: reread });
        return { workspaceId: ws.workspaceId, path, dryRun: false, beforeSha: currentSha, afterSha: reread, beforeLines, afterLines, attribution: mutationCtx };
      },
    ),
    makeTool(
      "paperclipWorkspaceExec",
      "Execute an allowlisted command (git/pnpm/npm/node/npx/tsc/vitest/eslint, no shell) as an unprivileged process jailed to an authorized workspace. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0. Bounded CPU/time/output; secrets redacted; stdout/stderr/exitCode/timeout returned. Pass operationId to replay a previous result without re-executing.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        argv: z.array(z.string().min(1).max(2048)).min(1).max(64).optional(),
        cwd: z.string().max(512).optional().nullable(),
        timeoutSec: z.number().int().min(1).max(110).optional().default(60),
        outputLimit: z.number().int().min(1024).max(262144).optional().default(32768),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
        operationId: z.string().uuid().optional().nullable(),
      }),
      async ({ workspaceId, issueId, argv, cwd, timeoutSec, outputLimit, runId, operatorRunId, operationId }) => {
        if (operationId) {
          const stored = await readLedger(operationId);
          if (stored) {
            if (!argv) return { ...(stored as unknown as Record<string, unknown>), replayed: true };
            // Same operationId with a DIFFERENT payload must conflict without
            // re-executing (stable request IDs): compare the original request.
            const storedRec = stored as Record<string, unknown>;
            const storedArgv = Array.isArray(storedRec.requestArgv) ? (storedRec.requestArgv as unknown[]) : null;
            const storedCwd = (storedRec.requestCwd ?? null) as string | null;
            const samePayload =
              storedArgv !== null && JSON.stringify(storedArgv) === JSON.stringify(argv) && storedCwd === (cwd ?? null);
            if (samePayload) return { ...storedRec, replayed: true };
            throw err("idempotency_conflict", `operationId ${operationId} was already used with a different argv/cwd; refusing to re-execute. Use a fresh operationId.`, { remediationOwner: "caller" });
          }
          if (!argv) throw err("not_found", `No stored exec result for operationId ${operationId}`);
        } else if (!argv) {
          throw err("invalid_arguments", "Pass argv, or operationId to replay a previous result");
        }
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        await enforceWriteScope(client, { issueId: issueId ?? ws.sourceIssueId, argv: argv as string[], tool: "paperclipWorkspaceExec" });
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipWorkspaceExec" });
        const fetchCredentialEnv = await gitFetchCredentialEnvForWorkspace(ws, argv as string[]);
        const execResult = await runJailedExec({
          ws,
          argv: argv as string[],
          cwdRel: cwd ?? null,
          timeoutSec: timeoutSec ?? 60,
          outputLimit: outputLimit ?? 32768,
          operationId: operationId ?? null,
          ...(fetchCredentialEnv ? { extraEnv: fetchCredentialEnv } : {}),
        });
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "exec", argv: (argv as string[]).slice(0, 8), exitCode: execResult.exitCode, operationId: execResult.operationId });
        return { ...execResult, attribution: mutationCtx };
      },
    ),
    makeTool(
      "paperclipGitStatus",
      "Git status of an authorized workspace: branch, HEAD, dirty state, porcelain list. Read-only (no operatorRunId needed).",
      z.object({ workspaceId: workspaceIdSchema, issueId: issueIdSchema }),
      async ({ workspaceId, issueId }) => {
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const [branch, head, status] = await Promise.all([
          runJailedExec({ ws, argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"], timeoutSec: 15, outputLimit: 256 }),
          runJailedExec({ ws, argv: ["git", "rev-parse", "HEAD"], timeoutSec: 15, outputLimit: 256 }),
          runJailedExec({ ws, argv: ["git", "status", "--porcelain=v1", "-b"], timeoutSec: 20, outputLimit: 65536 }),
        ]);
        if (status.exitCode !== 0) throw err("git_failed", `git status failed: ${status.stderr.slice(0, 500)}`, { remediationOwner: "harness" });
        return {
          workspaceId: ws.workspaceId, cwd: ws.cwd,
          branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
          head: head.exitCode === 0 ? head.stdout.trim() : null,
          dirty: status.stdout.split("\n").some((l) => l.trim() && !l.startsWith("##")),
          porcelain: status.stdout,
          stdoutTruncated: status.stdoutTruncated,
        };
      },
    ),
    makeTool(
      "paperclipGitDiff",
      "Git diff of an authorized workspace (working tree and/or staged). Read-only. Supports --stat and path filtering.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        staged: z.boolean().optional().default(false),
        stat: z.boolean().optional().default(false),
        path: z.string().max(512).optional().nullable(),
      }),
      async ({ workspaceId, issueId, staged, stat, path }) => {
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const argv = ["git", "diff"];
        if (staged) argv.push("--cached");
        if (stat) argv.push("--stat");
        argv.push("--", ...(path ? [path] : ["."]));
        if (path) await resolveWorkspacePath(ws, path);
        const r = await runJailedExec({ ws, argv, timeoutSec: 30, outputLimit: 131072 });
        if (r.exitCode !== 0) throw err("git_failed", `git diff failed: ${r.stderr.slice(0, 500)}`, { remediationOwner: "harness" });
        return { workspaceId: ws.workspaceId, staged: staged ?? false, diff: r.stdout, truncated: r.stdoutTruncated };
      },
    ),
    makeTool(
      "paperclipGitCreateBranch",
      "Create (or deterministically reuse) one canonical working branch per delivery unit. When issueId is given the branch must start with the issue identifier (e.g. KOMAA-798/...) so changes from different units never share a commit. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        branch: z.string().min(1).max(128).regex(/^[A-Za-z0-9._/-]+$/, "branch contains illegal characters"),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ workspaceId, issueId, branch, runId, operatorRunId }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        let identifier: string | null = null;
        if (issueId) {
          const info = await verifyIssueWritable(client, issueId);
          identifier = info.identifier;
          if (!branch.toUpperCase().startsWith(identifier.toUpperCase())) {
            throw err("branch_denied", `Branch ${branch} does not start with the issue identifier ${identifier}: one canonical branch per delivery unit`, {
              remediationOwner: "caller",
            });
          }
        }
        if (["main", "master"].includes(branch)) throw err("branch_denied", "Refusing to work directly on a protected branch");
        const before = await gitHead(ws);
        const existing = await runJailedExec({ ws, argv: ["git", "rev-parse", "--verify", `refs/heads/${branch}`], timeoutSec: 15, outputLimit: 256 });
        if (existing.exitCode === 0) {
          const co = await runJailedExec({ ws, argv: ["git", "checkout", branch], timeoutSec: 20, outputLimit: 4096 });
          if (co.exitCode !== 0) throw err("git_failed", `Branch ${branch} exists but checkout failed: ${co.stderr.slice(0, 500)}`);
          return { workspaceId: ws.workspaceId, branch, reused: true, before, after: await gitHead(ws) };
        }
        if (before.dirty) throw err("dirty_refused", "Uncommitted changes present: commit or stash before creating a branch (never overwritten)", { before });
        const cr = await runJailedExec({ ws, argv: ["git", "checkout", "-b", branch], timeoutSec: 20, outputLimit: 4096 });
        if (cr.exitCode !== 0) throw err("git_failed", `git checkout -b failed: ${cr.stderr.slice(0, 500)}`);
        return { workspaceId: ws.workspaceId, branch, reused: false, before, after: await gitHead(ws) };
      },
    ),
    makeTool(
      "paperclipGitCommit",
      "Commit an explicit file list in an authorized workspace (never commits unrelated units' changes). Verifies HEAD/branch/dirty before and after, scans the staged diff for secrets, and returns the new SHA. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        files: z.array(z.string().min(1).max(512)).min(1).max(100),
        message: z.string().trim().min(5).max(2000),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ workspaceId, issueId, files, message, runId, operatorRunId }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        else if (ws.sourceIssueId) {
          try { await verifyIssueWritable(client, ws.sourceIssueId); } catch { /* workspace-level: allowed */ }
        }
        const writeScope = await enforceWriteScope(client, { issueId: issueId ?? ws.sourceIssueId, paths: files, tool: "paperclipGitCommit" });
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipGitCommit" });
        for (const f of files) await resolveWorkspacePath(ws, f, { mustExist: true });
        const before = await gitHead(ws);
        if (!before.head) throw err("git_failed", "Cannot determine HEAD (is this a git repo?)", { remediationOwner: "harness" });
        const add = await runJailedExec({ ws, argv: ["git", "add", "--", ...files], timeoutSec: 20, outputLimit: 4096 });
        if (add.exitCode !== 0) throw err("git_failed", `git add failed: ${add.stderr.slice(0, 500)}`);
        // A scoped agent may not publish staged content outside its scope: the
        // index can still carry files staged earlier by another route.
        if (writeScope) {
          const staged = await runJailedExec({ ws, argv: ["git", "diff", "--cached", "--name-only"], timeoutSec: 15, outputLimit: 8192 });
          for (const line of staged.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)) {
            assertPathInScope(writeScope, line, "paperclipGitCommit");
          }
        }
        const cached = await runJailedExec({ ws, argv: ["git", "diff", "--cached"], timeoutSec: 20, outputLimit: 131072 });
        if (cached.stdout.trim().length === 0) throw err("empty_commit", "Nothing staged for the given file list; refusing empty commit");
        const secrets = scanForSecrets(cached.stdout);
        if (secrets.length > 0) {
          await runJailedExec({ ws, argv: ["git", "reset"], timeoutSec: 15, outputLimit: 1024 });
          throw err("secret_denied", `Staged diff contains secret-like material (${secrets.join(", ")}); unstaged and refusing commit`);
        }
        // Identity: deliberately NO -c user.name/email override and NO
        // --no-verify. The commit is attributed to the repo-configured user
        // (same as any harness agent commit in this worktree) and the repo's
        // own hooks (identity-gate, pre-commit) still enforce policy. A repo
        // without configured identity fails honestly instead of committing
        // under a synthetic localhost identity the hooks would reject.
        const commit = await runJailedExec({
          ws,
          argv: ["git", "commit", "-m", message],
          timeoutSec: 30, outputLimit: 8192,
        });
        if (commit.exitCode !== 0) throw err("git_failed", `git commit failed: ${(commit.stdout + commit.stderr).slice(0, 800)}`);
        const after = await gitHead(ws);
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "git.commit", files, before: before.head, after: after.head });
        return { workspaceId: ws.workspaceId, before, after, files, message, attribution: mutationCtx };
      },
    ),
    makeTool(
      "paperclipGitPush",
      "Push the current branch to origin in an authorized workspace. Origin + current branch only, no force by default, protected branches (main/master) need explicit opt-in. Verifies the remote SHA after push. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        remote: z.string().optional().default("origin"),
        branch: z.string().min(1).max(128).optional().nullable(),
        allowForce: z.boolean().optional().default(false),
        allowProtected: z.boolean().optional().default(false),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ workspaceId, issueId, remote, branch, allowForce, allowProtected, runId, operatorRunId }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipGitPush" });
        if ((remote ?? "origin") !== "origin") throw err("push_denied", "Only the origin remote is allowlisted");
        const before = await gitHead(ws);
        const target = branch ?? before.branch;
        if (!target) throw err("git_failed", "Cannot determine current branch", { remediationOwner: "harness" });
        if (target !== before.branch) throw err("push_denied", `Pushing a non-checked-out branch refused (current=${before.branch}, requested=${target})`);
        if (["main", "master"].includes(target) && !allowProtected) {
          throw err("push_denied", `Pushing protected branch ${target} needs allowProtected:true`, { remediationOwner: "cto" });
        }
        // Git does not read GH_TOKEN: without a credential helper the push asks the
        // terminal for a username and dies with "could not read Username for
        // 'https://github.com': terminal prompts disabled" instead of authenticating.
        // Project the bound host credential into git, and refuse BEFORE contacting
        // the remote when no usable credential is bound (nothing projected, or only
        // a placeholder), so the failure is an explicit reason, never a prompt.
        const credentialEnv = gitCredentialEnv();
        if (!credentialEnv) {
          throw err("github_auth_missing", "No usable GitHub credential is bound to this runtime: push refused before contacting the remote", {
            remediationOwner: "cto",
            requiredAction: "Bind an approved GitHub credential for the authorized write principal (company secret or managed GitHub connection); a placeholder token is not a credential",
          });
        }
        const argv = ["git", "push", "origin", target];
        if (allowForce) argv.splice(2, 0, "--force-with-lease");
        const push = await runJailedExec({ ws, argv, timeoutSec: 90, outputLimit: 16384, extraEnv: credentialEnv });
        if (push.exitCode !== 0) throw err("git_failed", `git push failed: ${(push.stdout + push.stderr).slice(0, 800)}`, { remediationOwner: "harness" });
        const ls = await runJailedExec({ ws, argv: ["git", "ls-remote", "origin", target], timeoutSec: 30, outputLimit: 1024, extraEnv: credentialEnv });
        const remoteSha = ls.exitCode === 0 ? ls.stdout.trim().split(/\s+/)[0] : null;
        const after = await gitHead(ws);
        const match = Boolean(remoteSha && after.head && remoteSha.startsWith(after.head.slice(0, 12)));
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "git.push", branch: target, remoteSha, shaMatch: match });
        return { workspaceId: ws.workspaceId, branch: target, before, after, remoteSha, shaMatch: match, attribution: mutationCtx };
      },
    ),
    makeTool(
      "paperclipGitCreatePR",
      "Open a pull request for the workspace branch via gh (uses the host's GitHub auth; no separate keys minted). No extra review gates beyond the repo's own CI/review policy. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or by a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        title: z.string().trim().min(5).max(300),
        body: z.string().trim().max(20000).optional().default(""),
        base: z.string().min(1).max(128).optional().nullable(),
        draft: z.boolean().optional().default(false),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ workspaceId, issueId, title, body, base, draft, runId, operatorRunId }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        const before = await gitHead(ws);
        if (!before.branch || ["main", "master"].includes(before.branch)) {
          throw err("branch_denied", "Create a working branch first (never PR from a protected branch directly)");
        }
        let baseBranch = base ?? null;
        if (!baseBranch) {
          const sym = await runJailedExec({ ws, argv: ["git", "symbolic-ref", "refs/remotes/origin/HEAD"], timeoutSec: 15, outputLimit: 256 });
          baseBranch = sym.exitCode === 0 ? (sym.stdout.trim().split("/").pop() || "main") : "main";
        }
        const argv = ["gh", "pr", "create", "--base", baseBranch, "--head", before.branch, "--title", title, "--body", body || title, ...(draft ? ["--draft"] : [])];
        let maybeGh = await runJailedExec({ ws, argv, timeoutSec: 90, outputLimit: 8192, extraEnv: { ...ghEnv() } });
        if (maybeGh.exitCode !== 0 && /command not found|spawn error|ENOENT/i.test(maybeGh.stdout + maybeGh.stderr)) {
          maybeGh = await runJailedExec({
            ws,
            argv: ["npx", "--yes", "gh", "pr", "create", "--base", baseBranch, "--head", before.branch as string, "--title", title, "--body", body || title, ...(draft ? ["--draft"] : [])],
            timeoutSec: 90, outputLimit: 8192, extraEnv: { ...ghEnv() },
          });
        }
        if (maybeGh.exitCode !== 0) {
          const out = (maybeGh.stdout + maybeGh.stderr).slice(0, 800);
          if (/auth|authentication|not logged|Bad credentials/i.test(out)) {
            throw err("auth_unverified", `GitHub auth not available to the MCP host; PR not created (branch ${before.branch} is pushed or ready). `, {
              remediationOwner: "cto",
              remediation: "Provision GH_TOKEN/GITHUB_TOKEN or gh auth login for the paperclip host, then retry",
              detail: out.slice(0, 300),
            });
          }
          if (/already exists|already.*pull request/i.test(out)) {
            return { workspaceId: ws.workspaceId, branch: before.branch, base: baseBranch, alreadyExists: true, output: out.slice(0, 500) };
          }
          throw err("git_failed", `PR creation failed: ${out}`, { remediationOwner: "harness" });
        }
        const url = maybeGh.stdout.trim().split("\n").pop() || null;
        return { workspaceId: ws.workspaceId, branch: before.branch, base: baseBranch, url, alreadyExists: false };
      },
    ),
    makeTool(
      "paperclipGitGetChecks",
      "Read CI checks for the workspace branch's PR (via gh). Read-only; UNVERIFIED with owner if GitHub auth is missing.",
      z.object({ workspaceId: workspaceIdSchema, issueId: issueIdSchema, branch: z.string().min(1).max(128).optional().nullable() }),
      async ({ workspaceId, issueId, branch }) => {
        if (!hasGitHubAuth()) {
          throw err("github_auth_missing", "GitHub checks unavailable without GH_TOKEN or GITHUB_TOKEN", {
            remediationOwner: "cto",
            requiredAction: "Configure approved GitHub read authentication; no interactive login was attempted",
          });
        }
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const head = await gitHead(ws);
        const target = branch ?? head.branch;
        if (!target) throw err("git_failed", "Cannot determine branch", { remediationOwner: "harness" });
        const slug = await resolveGitHubSlug(ws);
        if (!slug) throw err("git_failed", "Cannot resolve GitHub repository slug from workspace origin", { remediationOwner: "harness" });
        // Commit-scoped REST is readable with the bound fine-grained credential,
        // while `gh pr checks` (GraphQL status contexts) is not. Fail closed when
        // either the head SHA or the check-runs payload is unreadable.
        const headRef = await runJailedExec({
          ws,
          argv: ["gh", "api", `repos/${slug}/commits/${encodeURIComponent(target)}`, "--jq", ".sha"],
          timeoutSec: 30,
          outputLimit: 1024,
          extraEnv: { ...ghEnv() },
        });
        const sha = headRef.exitCode === 0 ? headRef.stdout.trim() : "";
        if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
          return unverifiedChecks(ws.workspaceId, target, `cannot resolve head SHA for ${target}: ${(headRef.stderr || headRef.stdout).slice(0, 300)}`);
        }
        const runs = await ghApiJson(ws, `repos/${slug}/commits/${sha}/check-runs?per_page=100`);
        if (!runs.ok) return unverifiedChecks(ws.workspaceId, target, runs.error);
        const evaluation = evaluateCheckRunsPayload(runs.data);
        return {
          workspaceId: ws.workspaceId,
          branch: target,
          headSha: sha,
          state: evaluation.state,
          overallStatus: evaluation.state,
          total: evaluation.total,
          checkConclusions: evaluation.checks.map((run) => `${run.name}\t${run.status}\t${run.conclusion ?? "-"}`),
          checks: formatCheckRuns(evaluation),
          failures: evaluation.failures.slice(0, 50),
          ...(evaluation.reason ? { reason: evaluation.reason } : {}),
          truncated: false,
        };
      },
    ),
    makeTool(
      "paperclipGitGetMergeReadiness",
      "Merge readiness for the workspace branch's PR: mergeable state, required checks, review decision. Read-only; UNVERIFIED with owner if GitHub auth is missing.",
      z.object({ workspaceId: workspaceIdSchema, issueId: issueIdSchema, branch: z.string().min(1).max(128).optional().nullable() }),
      async ({ workspaceId, issueId, branch }) => {
        if (!hasGitHubAuth()) {
          throw err("github_auth_missing", "GitHub merge readiness unavailable without GH_TOKEN or GITHUB_TOKEN", {
            remediationOwner: "cto",
            requiredAction: "Configure approved GitHub read authentication; no interactive login was attempted",
          });
        }
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const head = await gitHead(ws);
        const target = branch ?? head.branch;
        if (!target) throw err("git_failed", "Cannot determine branch", { remediationOwner: "harness" });
        const slug = await resolveGitHubSlug(ws);
        if (!slug) throw err("git_failed", "Cannot resolve GitHub repository slug from workspace origin", { remediationOwner: "harness" });
        const owner = slug.split("/")[0];
        const list = await ghApiJson(ws, `repos/${slug}/pulls?head=${encodeURIComponent(owner)}:${encodeURIComponent(target)}&state=all&per_page=5`);
        if (!list.ok) {
          return { workspaceId: ws.workspaceId, branch: target, state: "UNVERIFIED", overallStatus: "unverified", reason: list.error };
        }
        const candidates = Array.isArray(list.data) ? (list.data as Array<Record<string, unknown>>) : [];
        if (candidates.length === 0) {
          return { workspaceId: ws.workspaceId, branch: target, state: "UNVERIFIED", overallStatus: "unverified", reason: `no pull request found for ${owner}:${target}` };
        }
        const chosen = candidates.find((item) => item.state === "open") ?? candidates[0];
        const number = typeof chosen?.number === "number" ? chosen.number : null;
        if (!number) {
          return { workspaceId: ws.workspaceId, branch: target, state: "UNVERIFIED", overallStatus: "unverified", reason: "pull request number is unreadable" };
        }
        const detail = await ghApiJson(ws, `repos/${slug}/pulls/${number}`);
        if (!detail.ok) {
          return { workspaceId: ws.workspaceId, branch: target, state: "UNVERIFIED", overallStatus: "unverified", reason: detail.error };
        }
        const pull = parseRestPull(detail.data);
        if (!pull) {
          return { workspaceId: ws.workspaceId, branch: target, state: "UNVERIFIED", overallStatus: "unverified", reason: "pull request payload is unreadable" };
        }
        const reviews = await ghApiJson(ws, `repos/${slug}/pulls/${number}/reviews?per_page=100`);
        const runs = pull.headRefOid
          ? await ghApiJson(ws, `repos/${slug}/commits/${pull.headRefOid}/check-runs?per_page=100`)
          : { ok: false as const, error: "pull request head SHA is unreadable" };
        const evaluation = runs.ok
          ? evaluateCheckRunsPayload(runs.data)
          : { state: "unverified" as const, total: 0, checks: [], failures: [], reason: runs.error };
        return {
          workspaceId: ws.workspaceId,
          branch: target,
          number,
          url: pull.url,
          state: pull.state,
          mergeable: pull.mergeable,
          mergeStateStatus: pull.mergeStateStatus,
          reviewDecision: reviews.ok ? deriveReviewDecision(reviews.data) : "",
          headRefOid: pull.headRefOid,
          checksState: evaluation.state,
          statusCheckRollup: evaluation.checks,
          ...(evaluation.reason ? { checksReason: evaluation.reason } : {}),
        };
      },
    ),
  ];
}

/**
 * Operator placeholder family projected into GH_TOKEN/GITHUB_TOKEN to express
 * "this runtime gets no GitHub credential" (here: PAPERCLIP_GITHUB_WRITES_DISABLED
 * for a deliberately write-disabled principal). A placeholder is not a credential:
 * it must read as absent, exactly like the control-plane preflight predicate
 * (server/src/services/dispatch-preflight.ts) treats it, so neither a probe nor a
 * push can claim authority nobody granted.
 */
const UNBOUND_GIT_CREDENTIAL_SENTINEL_RE = /^PAPERCLIP_[A-Z0-9_]*_DISABLED$/;

export function isUnboundGitCredentialSentinel(value: string | undefined | null): boolean {
  return typeof value === "string" && UNBOUND_GIT_CREDENTIAL_SENTINEL_RE.test(value.trim());
}

/**
 * The token this process really carries, or null when it carries none. Both env
 * spellings are considered so a placeholder in one of them cannot hide a real
 * token in the other.
 */
export function readBoundGitToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    [env.GH_TOKEN, env.GITHUB_TOKEN]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((token) => token && !UNBOUND_GIT_CREDENTIAL_SENTINEL_RE.test(token)) ?? null
  );
}

/**
 * Git-side projection of the host credential. Git does not read GH_TOKEN, so a
 * push without a credential helper asks the terminal for a username and dies with
 * "could not read Username for 'https://github.com': terminal prompts disabled"
 * instead of authenticating. The helper answers only for https + github.com and
 * reads the token from PAPERCLIP_GIT_TOKEN; `credential.helper=` (empty) resets
 * the ambient helper list, so an empty host credential store can neither answer
 * nor swallow the request. Never places the token in argv, a URL, or on disk.
 */
const GIT_CREDENTIAL_HELPER =
  `!f() { ok=; proto=; while IFS= read -r l && [ -n "$l" ]; do case "$l" in host=github.com|host=www.github.com) ok=1;; protocol=https) proto=1;; esac; done; if [ "$1" = get ] && [ -n "$ok" ] && [ -n "$proto" ]; then printf 'username=x-access-token\\npassword=%s\\n' "$PAPERCLIP_GIT_TOKEN"; fi; }; f`;

/**
 * The env a git operation needs to authenticate, or null when no usable
 * credential is bound (nothing projected, or only a placeholder).
 */
export function gitCredentialEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> | null {
  const token = readBoundGitToken(env);
  if (!token) return null;
  const configEntries = [
    ["credential.helper", ""],
    ["credential.https://github.com.helper", GIT_CREDENTIAL_HELPER],
    ["credential.https://www.github.com.helper", GIT_CREDENTIAL_HELPER],
  ];
  return {
    ...Object.fromEntries(configEntries.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ])),
    GIT_CONFIG_COUNT: String(configEntries.length),
    PAPERCLIP_GIT_TOKEN: token,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function gitFetchCredentialEnv(
  argv: string[],
  originUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | null {
  if (argv[1] !== "fetch" || argv[2] !== "origin") return null;
  if (argv.some((arg) => arg === "--recurse-submodules" || arg.startsWith("--recurse-submodules="))) return null;

  let origin: URL;
  try {
    if (/[\r\n]/.test(originUrl)) return null;
    origin = new URL(originUrl.trim());
  } catch {
    return null;
  }
  if (
    origin.protocol !== "https:" ||
    origin.hostname.toLowerCase() !== "github.com" ||
    origin.username ||
    origin.password ||
    !["/miloszspyrka-code/zar-i-szlif", "/miloszspyrka-code/zar-i-szlif.git"].includes(origin.pathname.replace(/\/$/, ""))
  ) {
    return null;
  }

  const credential = gitCredentialEnv(env);
  if (!credential) return null;
  const { GH_TOKEN: _ghToken, GITHUB_TOKEN: _githubToken, ...gitOnlyEnv } = credential;
  gitOnlyEnv.GIT_CONFIG_COUNT = "4";
  gitOnlyEnv.GIT_CONFIG_KEY_3 = "fetch.recurseSubmodules";
  gitOnlyEnv.GIT_CONFIG_VALUE_3 = "false";
  return gitOnlyEnv;
}

async function gitFetchCredentialEnvForWorkspace(ws: ResolvedWorkspace, argv: string[]): Promise<Record<string, string> | null> {
  if (argv[1] !== "fetch" || argv[2] !== "origin") return null;

  const remote = await runJailedExec({ ws, argv: ["git", "remote", "get-url", "--all", "origin"], timeoutSec: 10, outputLimit: 2048 });
  return remote.exitCode === 0 ? gitFetchCredentialEnv(argv, remote.stdout) : null;
}

export function ghEnv(): Record<string, string> {
  const out: Record<string, string> = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };
  const token = readBoundGitToken();
  if (token) {
    out.GH_TOKEN = token;
    out.GITHUB_TOKEN = token;
  }
  for (const k of ["GH_HOST", "GH_REPO"]) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

function hasGitHubAuth(): boolean {
  return Boolean(readBoundGitToken());
}

function parseRepoSlugFromRemote(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** owner/repo for the workspace origin. REST reads stay scoped to that repo. */
async function resolveGitHubSlug(ws: ResolvedWorkspace): Promise<string | null> {
  const remote = await runJailedExec({ ws, argv: ["git", "remote", "get-url", "origin"], timeoutSec: 15, outputLimit: 1024 });
  return remote.exitCode === 0 ? parseRepoSlugFromRemote(remote.stdout) : null;
}

async function ghApiJson(
  ws: ResolvedWorkspace,
  path: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const result = await runJailedExec({
    ws,
    argv: ["gh", "api", path],
    timeoutSec: 45,
    outputLimit: 65536,
    extraEnv: { ...ghEnv() },
  });
  if (result.exitCode !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || `gh api exited ${result.exitCode}`).slice(0, 400) };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: "gh api returned invalid JSON" };
  }
}

function unverifiedChecks(workspaceId: string, branch: string, reason: string) {
  return {
    workspaceId,
    branch,
    state: "unverified" as const,
    overallStatus: "unverified" as const,
    total: 0,
    checkConclusions: [] as string[],
    checks: "",
    failures: [] as string[],
    reason,
  };
}
