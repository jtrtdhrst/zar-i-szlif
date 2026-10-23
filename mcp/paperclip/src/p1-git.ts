// P0-C GitHub integration (non-interactive only).
//
// Adds: paperclipGitAuthStatus, paperclipGitGetRemoteTopology,
// paperclipGitWaitChecks, paperclipGitMergePR.
//
// Rules: never invoke interactive `gh auth login`; never return secrets;
// fail closed with GITHUB_AUTH_MISSING + remediationOwner + required scope
// when authentication is absent. All subprocesses reuse the workspace jail
// (runJailedExec) with GIT_TERMINAL_PROMPT=0 so git/gh can never prompt.

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { PaperclipApiClient } from "./client.js";
import {
  resolveWorkspace,
  verifyIssueWritable,
  runJailedExec,
  redactWorkspaceOutput,
  authorizeWorkspaceMutation,
  assertWorkspaceMutationScope,
  recordWorkspaceMutationAudit,
  readBoundGitToken,
  isUnboundGitCredentialSentinel,
  gitCredentialEnv,
} from "./workspace-native.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface P1GitToolDefinition {
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
): P1GitToolDefinition {
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

function err(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

const workspaceIdSchema = z.string().uuid().optional().nullable();
const issueIdSchema = z.string().min(1).max(128).optional().nullable();
const operatorRunIdSchema = z.string().uuid().optional().nullable();
const runIdSchema = z.string().uuid().optional().nullable();

function ledgerDir(): string {
  return process.env.PAPERCLIP_GITHUB_OPS_LEDGER_DIR || "/paperclip/mcp-github-ops";
}

async function readLedger(key: string): Promise<Record<string, unknown> | null> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) return null;
  try {
    const raw = await fs.readFile(join(ledgerDir(), `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLedger(key: string, envelope: Record<string, unknown>): Promise<void> {
  await fs.mkdir(ledgerDir(), { recursive: true });
  await fs.writeFile(join(ledgerDir(), `${key}.json`), JSON.stringify(envelope, null, 2), "utf8");
}

function scrub(text: string): string {
  return redactWorkspaceOutput(text);
}

/**
 * The credential this runtime really carries. A placeholder projected into
 * GH_TOKEN/GITHUB_TOKEN is not a credential: probing it answers a deterministic
 * 401, and reporting it as "env-token" would claim push authority the transport
 * never receives (the probe/transport disagreement this issue names). It reads as
 * absent, exactly like the control-plane preflight predicate does.
 */
export function hasGitHubTokenEnv(): { present: boolean; kind: string | null; reason: string | null } {
  const token = readBoundGitToken();
  if (token) return { present: true, kind: "env-token", reason: null };
  const placeholder = [process.env.GH_TOKEN, process.env.GITHUB_TOKEN].find((value) =>
    isUnboundGitCredentialSentinel(value),
  );
  return {
    present: false,
    kind: null,
    reason: placeholder
      ? "GH_TOKEN/GITHUB_TOKEN holds an operator placeholder (no GitHub credential bound), not a token"
      : "No GitHub credential is bound to this runtime",
  };
}

// Phase 4 (2026-10-19): derive effective permissions from the token's REAL
// repository permission set (gh api .permissions) instead of hardcoding
// read-only. A fine-grained PAT or app token may legitimately carry push;
// reporting it as missing is a false denial. Unknown/unfetchable scopes stay
// fail-closed (conservative fallback at the call site).
export function deriveGitPermissions(perms: { push?: unknown; admin?: unknown; pull?: unknown } | null): {
  allowedOperations: string[];
  missingPermissions: string[];
} {
  const canPush = Boolean(perms && (perms.push === true || perms.admin === true));
  if (canPush) return { allowedOperations: ["read", "push", "create_pr"], missingPermissions: [] };
  return { allowedOperations: ["read"], missingPermissions: ["contents:write", "pull-requests:write"] };
}

/**
 * Transport verdict for a git remote.
 *
 * The transport signal must mean "the remote answered an AUTHENTICATED request
 * with the bound credential", not "the remote has branches": an authenticated but
 * EMPTY remote (no heads yet) is a healthy transport, while a non-empty ref list
 * read WITHOUT a credential proves nothing about authentication. The ref count
 * stays informational and never decides authentication.
 */
export function deriveTransportVerdict(input: {
  exitCode: number | null;
  credentialProjected: boolean;
  remoteRefCount: number;
}): { transportAuthenticated: boolean; remoteRefCount: number; reason: string | null } {
  const { exitCode, credentialProjected, remoteRefCount } = input;
  if (!credentialProjected) {
    return {
      transportAuthenticated: false,
      remoteRefCount,
      reason: "no usable GitHub credential is bound: the remote was contacted anonymously, not authenticated",
    };
  }
  if (Number(exitCode ?? 1) !== 0) {
    return {
      transportAuthenticated: false,
      remoteRefCount,
      reason: "the remote refused the authenticated request (git ls-remote failed)",
    };
  }
  return { transportAuthenticated: true, remoteRefCount, reason: null };
}

/**
 * Write authority is claimed only when the GitHub API permission AND the git
 * transport agree. A denied or anonymous transport must never leave
 * "push"/"create_pr" in the advertised operations.
 */
export function applyTransportGate(
  allowedOperations: string[],
  missingPermissions: string[],
  transport: { transportAuthenticated: boolean } | null,
): { allowedOperations: string[]; missingPermissions: string[] } {
  const claimsWrite = allowedOperations.some((op) => op === "push" || op === "create_pr");
  if (!claimsWrite || transport?.transportAuthenticated) return { allowedOperations, missingPermissions };
  return {
    allowedOperations: allowedOperations.filter((op) => op !== "push" && op !== "create_pr"),
    missingPermissions: [...missingPermissions, "transport:not-authenticated"],
  };
}

/**
 * Does the git transport authenticate against this repository with the bound
 * credential? Same projection as the push lane, so the API probe and the real
 * transport read the SAME credential and cannot disagree.
 */
async function probeGitTransport(slug: string): Promise<{
  transportAuthenticated: boolean;
  remoteRefCount: number;
  reason: string | null;
}> {
  const credentialEnv = gitCredentialEnv();
  if (!credentialEnv) {
    return { transportAuthenticated: false, remoteRefCount: 0, reason: "no usable GitHub credential is bound to this runtime" };
  }
  try {
    const { spawn } = await import("node:child_process");
    const outcome = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      let buf = "";
      const p = spawn("git", ["ls-remote", "--heads", `https://github.com/${slug}.git`], {
        env: { ...process.env, ...credentialEnv },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 20000,
      });
      p.on("error", () => resolve({ code: null, stdout: "" }));
      const stdout = (p as unknown as { stdout?: { on: (ev: string, cb: (d: unknown) => void) => void } }).stdout;
      stdout?.on("data", (d: unknown) => {
        buf += String(d);
      });
      p.on("close", (code: number) => resolve({ code, stdout: buf }));
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* already exited */
        }
        resolve({ code: null, stdout: "" });
      }, 21000).unref?.();
    });
    const remoteRefCount = outcome.stdout
      .split("\n")
      .filter((line) => /^[0-9a-f]{40}\s+refs\/heads\//.test(line)).length;
    return deriveTransportVerdict({ exitCode: outcome.code, credentialProjected: true, remoteRefCount });
  } catch {
    return { transportAuthenticated: false, remoteRefCount: 0, reason: "the git transport probe could not be executed" };
  }
}

async function fetchRepoPermissions(slug: string, token: string): Promise<{ push?: unknown; admin?: unknown; pull?: unknown } | null> {
  try {
    const { spawn } = await import("node:child_process");
    const out = await new Promise<string>((resolve) => {
      let buf = "";
      const p = spawn("gh", ["api", `repos/${slug}`, "--jq", "{push: .permissions.push, admin: .permissions.admin, pull: .permissions.pull}"], {
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15000,
      });
      p.on("error", () => resolve(""));
      const stdout = (p as unknown as { stdout?: { on: (ev: string, cb: (d: unknown) => void) => void } }).stdout;
      stdout?.on("data", (d: unknown) => {
        buf += String(d);
      });
      p.on("close", (code: number) => resolve(code === 0 ? buf : ""));
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* already exited */
        }
        resolve("");
      }, 16000).unref?.();
    });
    if (!out.trim()) return null;
    const parsed: unknown = JSON.parse(out);
    return parsed && typeof parsed === "object" ? (parsed as { push?: unknown; admin?: unknown; pull?: unknown }) : null;
  } catch {
    return null;
  }
}

function githubRepositorySlug(value: string): string | null {
  let path = value.trim();
  if (/^https:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname.toLowerCase() !== "github.com") return null;
      path = url.pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      return null;
    }
  }
  path = path.replace(/\.git$/i, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path) ? path : null;
}


export type GitChecksAssessment = {
  terminal: boolean;
  overallStatus: "success" | "failure" | "pending" | "unverified";
  checkConclusions: string[];
  failureSummaries: string[];
  rawExitCode: number | null;
  reason: string | null;
};

/**
 * The gh CLI may fail GraphQL permissions (exit 4) while printing zero checks.
 * A zero-row or unreadable result is NEVER a green status. Only an exit-zero
 * response with at least one explicitly successful check and no unknown,
 * pending or failed check can count as verified.
 */
export function classifyGitCheckOutput(input: {
  exitCode: number | null;
  stdout: string;
  stderr?: string;
}): GitChecksAssessment {
  const lines = input.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stderr = (input.stderr ?? "").trim();
  const statuses = lines.map((line) => {
    const columns = line.split(/\t+/).map((v) => v.trim());
    return columns.length >= 2 ? columns[1].toLowerCase().split(/\s+/)[0] : "";
  });
  const pass = statuses.filter((s) => /^(pass|passed|success|successful)$/.test(s)).length;
  const failed = statuses.some((s) => /^(fail|failed|failure|cancelled|canceled|timed_out|action_required)$/.test(s));
  const pending = statuses.some((s) => /^(pending|queued|in_progress|waiting|requested)$/.test(s));
  const unknown = statuses.some((s) => !/^(pass|passed|success|successful|skipped|neutral|fail|failed|failure|cancelled|canceled|timed_out|action_required|pending|queued|in_progress|waiting|requested)$/.test(s));
  const rawExitCode = input.exitCode;
  const base = { checkConclusions: lines.map((l) => l.slice(0, 200)), rawExitCode };
  if (failed) return { ...base, terminal: true, overallStatus: "failure", failureSummaries: lines.filter((_, i) => /^(fail|failed|failure|cancelled|canceled|timed_out|action_required)$/.test(statuses[i])).slice(0, 20), reason: "GitHub check failed" };
  if (pending) return { ...base, terminal: false, overallStatus: "pending", failureSummaries: [], reason: "GitHub checks still pending" };
  if (rawExitCode === 0 && pass > 0 && !unknown) {
    return { ...base, terminal: true, overallStatus: "success", failureSummaries: [], reason: null };
  }
  return {
    ...base,
    terminal: false,
    overallStatus: "unverified",
    failureSummaries: [stderr || input.stdout.trim() || "No readable GitHub check results"].slice(0, 1),
    reason: rawExitCode !== 0 ? "GitHub checks query exited nonzero" : "No verified successful checks, or unknown check output",
  };
}

export const P1_GIT_TOOL_NAMES: string[] = [
  "paperclipGitAuthStatus",
  "paperclipGitGetRemoteTopology",
  "paperclipGitWaitChecks",
  "paperclipGitMergePR",
];

export function createP1GitTools(client: PaperclipApiClient): P1GitToolDefinition[] {
  return [
    makeTool(
      "paperclipGitAuthStatus",
      "GitHub authentication diagnostics (non-interactive, never prompts, never returns secrets). Reports authenticated/credentialType/repositoryAccessible/allowedOperations/missingPermissions/transportAuthenticated/transportReason/remediationOwner/errorCode. The transport fields are the real git transport, so a transport that cannot authenticate never advertises push/create_pr. Missing auth fails closed with GITHUB_AUTH_MISSING owned by CTO.",
      z.object({
        repository: z.string().min(1).max(256).optional().nullable(),
        operation: z.string().min(1).max(64).optional().nullable(),
        installationId: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ repository, operation, installationId }) => {
        const operationId = randomUUID();
        const token = hasGitHubTokenEnv();
        const boundToken = readBoundGitToken() ?? "";
        // Use gh's token-aware API client; raw git does not consume GH_TOKEN by itself.
        // No interactive login is ever invoked and no secrets are returned.
        let repositoryAccessible: boolean | null = null;
        if (repository && token.present) {
          try {
            const { spawn } = await import("node:child_process");
            const slug = githubRepositorySlug(repository);
            if (!slug) {
              repositoryAccessible = false;
            } else {
              const accessible = await new Promise<boolean>((resolve) => {
                const p = spawn("gh", ["api", `repos/${slug}`, "--jq", ".full_name"], {
                  env: {
                    ...process.env,
                    GH_TOKEN: boundToken,
                    GITHUB_TOKEN: boundToken,
                    GIT_TERMINAL_PROMPT: "0",
                    GH_PROMPT_DISABLED: "1",
                  },
                  stdio: "ignore",
                  timeout: 15000,
                });
                p.on("error", () => resolve(false));
                p.on("close", (code) => resolve(code === 0));
                setTimeout(() => {
                  try {
                    p.kill("SIGKILL");
                  } catch {
                    /* already exited */
                  }
                  resolve(false);
                }, 16000).unref?.();
              });
              repositoryAccessible = accessible;
            }
          } catch {
            repositoryAccessible = false;
          }
        }
        const op = (operation ?? "read").toLowerCase();
        const slug = repository ? githubRepositorySlug(repository) : null;
        let allowedOperations: string[];
        let missingPermissions: string[];
        if (!token.present) {
          allowedOperations = [];
          missingPermissions = op === "read" ? ["contents:read"] : ["contents:read", "contents:write", "pull-requests:write"];
        } else if (op === "read") {
          allowedOperations = ["read"];
          missingPermissions = [];
        } else if (slug && repositoryAccessible) {
          const perms = await fetchRepoPermissions(slug, boundToken);
          if (perms) {
            ({ allowedOperations, missingPermissions } = deriveGitPermissions(perms));
          } else {
            // Scopes unfetchable: fail closed exactly as before.
            allowedOperations = ["read"];
            missingPermissions = ["contents:write", "pull-requests:write"];
          }
        } else {
          allowedOperations = ["read"];
          missingPermissions = ["contents:write", "pull-requests:write"];
        }
        // The API permission and the real git transport must agree before any write
        // operation is advertised: a transport that cannot authenticate never
        // yields push/create_pr, whatever the API says.
        const transport = slug && token.present ? await probeGitTransport(slug) : null;
        ({ allowedOperations, missingPermissions } = applyTransportGate(allowedOperations, missingPermissions, transport));
        if (!token.present) {
          return {
            status: "denied",
            operationId,
            authenticated: false,
            credentialType: null,
            repositoryAccessible,
            allowedOperations,
            missingPermissions,
            transportAuthenticated: transport ? transport.transportAuthenticated : false,
            transportReason: transport?.reason ?? null,
            installationId: installationId ?? null,
            error: {
              code: "GITHUB_AUTH_MISSING",
              category: "AUTHENTICATION",
              retryable: false,
              retryRequiresChange: true,
              reason: token.reason,
              remediationOwner: "CTO",
              requiredAction: "Configure approved GitHub authentication (GitHub App installation token or GH_TOKEN via CTO); no interactive login is ever attempted",
            },
            possiblyCommitted: false,
            evidenceReference: `ledger:${operationId}`,
          };
        }
        return {
          status: "ok",
          operationId,
          authenticated: true,
          credentialType: token.kind,
          repositoryAccessible,
          allowedOperations,
          missingPermissions,
          transportAuthenticated: transport ? transport.transportAuthenticated : null,
          transportReason: transport?.reason ?? null,
          installationId: installationId ?? null,
          possiblyCommitted: false,
          evidenceReference: `ledger:${operationId}`,
        };
      },
    ),
    makeTool(
      "paperclipGitGetRemoteTopology",
      "Read-only remote topology of an authorized workspace: upstreamRepository/workingRepository/writableRemote/defaultBranch/baseSha/forkRequired/forkAvailable/pushTarget/pullRequestTarget/transportAuthenticated/transportReason/remoteRefCount. Never prompts (GIT_TERMINAL_PROMPT=0).",
      z.object({ workspaceId: workspaceIdSchema, issueId: issueIdSchema }),
      async ({ workspaceId, issueId }) => {
        const operationId = randomUUID();
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        // Git does not read GH_TOKEN: without a credential helper every remote-touching
        // git call asks the terminal for a username and dies instead of authenticating.
        // Project the bound host credential exactly like the push lane does, so the
        // probe (gh api) and the transport (git) read the SAME credential and cannot
        // disagree. No usable credential bound => nothing projected (fail closed).
        const credentialEnv = gitCredentialEnv();
        const run = async (argv: string[], limit = 4096) => {
          const r = (await runJailedExec({ ws, argv, timeoutSec: 20, outputLimit: limit, operationId: null, extraEnv: credentialEnv ?? undefined })) as unknown as Record<string, unknown>;
          return scrub(String(r.stdout ?? ""));
        };
        const remotesRaw = await run("git,remote,-v".split(","));
        const branch = (await run(["git", "branch", "--show-current"], 256)).trim() || null;
        const baseSha = (await run(["git", "rev-parse", "HEAD"], 256)).trim() || null;
        const originUrl = (/origin\s+(\S+)/.exec(remotesRaw)?.[1] ?? null) as string | null;
        const upstreamUrl = (/upstream\s+(\S+)/.exec(remotesRaw)?.[1] ?? null) as string | null;
        // Default branch: local symbolic ref, fall back to origin/HEAD via ls-remote symref.
        let defaultBranch: string | null = null;
        try {
          const sym = (await run(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], 256)).trim();
          const m = /refs\/remotes\/origin\/(.+)/.exec(sym);
          if (m) defaultBranch = m[1];
        } catch {
          /* no origin/HEAD locally */
        }
        if (!defaultBranch && originUrl && hasGitHubTokenEnv().present) {
          try {
            const ref = (await run(["git", "ls-remote", "--symref", originUrl, "HEAD"], 1024)).trim();
            const m = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(ref);
            if (m) defaultBranch = m[1];
          } catch {
            /* offline or denied */
          }
        }
        const writableRemote = originUrl && !/^https?:\/\/[^@]*@?[^/]*$/.test(originUrl) ? "origin" : originUrl ? "origin" : null;
        const forkRequired = Boolean(upstreamUrl && originUrl && upstreamUrl !== originUrl);
        // Transport signal: did the remote answer an AUTHENTICATED request with the
        // bound credential? The ref count is informational only: an authenticated but
        // EMPTY remote (no heads yet) is a healthy transport, and a non-empty ref
        // list read without a credential is not an authenticated one.
        let transportAuthenticated = false;
        let remoteRefCount = 0;
        let transportReason: string | null = null;
        if (originUrl) {
          const probe = (await runJailedExec({
            ws,
            argv: ["git", "ls-remote", "--heads", originUrl],
            timeoutSec: 20,
            outputLimit: 65536,
            operationId: null,
            extraEnv: credentialEnv ?? { GIT_TERMINAL_PROMPT: "0" },
          })) as unknown as Record<string, unknown>;
          const heads = scrub(String(probe.stdout ?? ""));
          remoteRefCount = heads.split("\n").filter((line) => /^[0-9a-f]{40}\s+refs\/heads\//.test(line)).length;
          const verdict = deriveTransportVerdict({
            exitCode: Number(probe.exitCode ?? 1),
            credentialProjected: Boolean(credentialEnv),
            remoteRefCount,
          });
          transportAuthenticated = verdict.transportAuthenticated;
          transportReason = verdict.reason;
        }
        return {
          status: "ok",
          operationId,
          upstreamRepository: upstreamUrl ?? originUrl,
          workingRepository: originUrl,
          writableRemote,
          defaultBranch,
          baseSha,
          forkRequired,
          forkAvailable: Boolean(originUrl),
          pushTarget: originUrl,
          pullRequestTarget: upstreamUrl ?? originUrl,
          branch,
          transportAuthenticated,
          transportReason,
          remoteRefCount,
          possiblyCommitted: false,
          evidenceReference: `ledger:${operationId}`,
        };
      },
    ),
    makeTool(
      "paperclipGitWaitChecks",
      "Poll PR checks to a terminal state (non-interactive; GITHUB_AUTH_MISSING when unauthenticated). Params: repository?, workspaceId?, pullRequestNumber, timeoutSec (max 600), pollIntervalSec (min 5). Returns workflowRuns/requiredChecks/checkConclusions/failureSummaries/terminal/overallStatus.",
      z.object({
        repository: z.string().min(1).max(256).optional().nullable(),
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        pullRequestNumber: z.number().int().positive(),
        timeoutSec: z.number().int().min(5).max(600).optional().default(120),
        pollIntervalSec: z.number().int().min(5).max(120).optional().default(15),
      }),
      async ({ repository, workspaceId, issueId, pullRequestNumber, timeoutSec, pollIntervalSec }) => {
        const operationId = randomUUID();
        if (!hasGitHubTokenEnv().present) {
          throw err(
            "github_auth_missing",
            "GitHub authentication missing: cannot poll PR checks non-interactively (no GH_TOKEN/GITHUB_TOKEN; interactive login is never attempted)",
            { remediationOwner: "CTO", remediation: "Configure approved GitHub authentication (GitHub App installation token or GH_TOKEN via CTO)" },
          );
        }
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        const repoFlag = (repository ? ["--repo", repository] : []) as string[];
        const deadline = Date.now() + (timeoutSec ?? 120) * 1000;
        let last: Record<string, unknown> | null = null;
        for (;;) {
          const r = (await runJailedExec({
            ws,
            argv: ["gh", "pr", "checks", String(pullRequestNumber), ...repoFlag],
            timeoutSec: 30,
            outputLimit: 16384,
            operationId: null,
          })) as unknown as Record<string, unknown>;
          const out = scrub(String(r.stdout ?? ""));
          const stderr = scrub(String(r.stderr ?? ""));
          const verdict = classifyGitCheckOutput({
            exitCode: r.exitCode == null ? null : Number(r.exitCode),
            stdout: out,
            stderr,
          });
          last = { workflowRuns: [], requiredChecks: [], checkConclusions: verdict.checkConclusions, failureSummaries: verdict.failureSummaries, rawExitCode: verdict.rawExitCode };
          if (verdict.overallStatus === "success" || verdict.overallStatus === "failure") {
            return {
              status: "ok", operationId, ...(last as object),
              terminal: true, overallStatus: verdict.overallStatus,
              possiblyCommitted: false, evidenceReference: `ledger:${operationId}`,
            };
          }
          if (verdict.overallStatus === "unverified") {
            return {
              status: "unverified", operationId, ...(last as object),
              terminal: false, overallStatus: "unverified",
              error: { code: "CHECKS_UNVERIFIED", category: "AUTHORIZATION", retryable: false, retryRequiresChange: true, remediationOwner: "CTO", requiredAction: "Restore GitHub Checks:Read and rerun against the exact PR SHA", reason: verdict.reason },
              possiblyCommitted: false, evidenceReference: `ledger:${operationId}`,
            };
          }
          if (Date.now() >= deadline) {
            return {
              status: "unverified", operationId, ...(last as object),
              terminal: false, overallStatus: "pending",
              error: { code: "TIMEOUT", category: "TIMEOUT", retryable: true, retryRequiresChange: false, remediationOwner: "caller", requiredAction: "Re-poll with the same pullRequestNumber; checks are still running" },
              possiblyCommitted: false, evidenceReference: `ledger:${operationId}`,
            };
          }
          await new Promise((res) => setTimeout(res, (pollIntervalSec ?? 15) * 1000));
        }
      },
    ),
    makeTool(
      "paperclipGitMergePR",
      "Merge an approved PR without bypassing branch protection (required CI + required review enforced by GitHub; no force merge; expectedHeadSha verified before merge; merge SHA confirmed and read back). Idempotent via idempotencyKey. Authorized by the caller's own live heartbeat run (runId; issue-bound, expires with the run) or a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        repository: z.string().min(1).max(256).optional().nullable(),
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        pullRequestNumber: z.number().int().positive(),
        expectedHeadSha: z.string().min(4).max(64),
        mergeMethod: z.enum(["merge", "squash", "rebase"]).optional().default("merge"),
        idempotencyKey: z.string().min(1).max(128).optional().nullable(),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ repository, workspaceId, issueId, pullRequestNumber, expectedHeadSha, mergeMethod, idempotencyKey, runId, operatorRunId }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        if (!hasGitHubTokenEnv().present) {
          throw err(
            "github_auth_missing",
            "GitHub authentication missing: merge refused without non-interactive auth",
            { remediationOwner: "CTO", remediation: "Configure approved GitHub authentication (GitHub App installation token or GH_TOKEN via CTO)" },
          );
        }
        const operationId = randomUUID();
        const ledgerKey = idempotencyKey ? `merge-${idempotencyKey}` : null;
        if (ledgerKey) {
          const prior = await readLedger(ledgerKey);
          if (prior) return { ...(prior as object), replayed: true };
        }
        const repoFlag = (repository ? ["--repo", repository] : []) as string[];
        const view = (await runJailedExec({
          ws,
          argv: ["gh", "pr", "view", String(pullRequestNumber), ...repoFlag, "--json", "headRefOid,mergeable,mergeStateStatus,reviewDecision"],
          timeoutSec: 30,
          outputLimit: 8192,
          operationId: null,
        })) as unknown as Record<string, unknown>;
        if (Number(view.exitCode ?? 1) !== 0) throw err("not_found", `PR not found or not readable: #${pullRequestNumber}`);
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(scrub(String(view.stdout ?? "{}"))) as Record<string, unknown>;
        } catch {
          throw err("invalid_arguments", `Unparseable gh pr view output for #${pullRequestNumber}`);
        }
        const headSha = String(meta.headRefOid ?? "");
        if (headSha && !headSha.startsWith(expectedHeadSha) && expectedHeadSha !== headSha) {
          throw err("version_conflict", `expectedHeadSha mismatch for #${pullRequestNumber}: PR head is ${headSha}, expected ${expectedHeadSha}. Re-read and re-confirm.`);
        }
        if (!headSha || String(meta.reviewDecision ?? "").toUpperCase() !== "APPROVED") {
          throw err("refused", `Merge refused for #${pullRequestNumber}: exact PR head and an independently approved GitHub review are required.`, { remediationOwner: "CTO" });
        }
        if (String(meta.mergeable ?? "").toUpperCase() === "CONFLICTING") {
          throw err("refused", `Merge refused for #${pullRequestNumber}: mergeable=CONFLICTING. Resolve conflicts first.`, {
            remediationOwner: "operator",
          });
        }
        // Branch protection may be disabled on private GitHub Free repositories.
        // Never infer permission to merge from a green/empty reviewDecision or
        // missing checks; verify exact PR checks again immediately before write.
        const checksRun = (await runJailedExec({
          ws,
          argv: ["gh", "pr", "checks", String(pullRequestNumber), ...repoFlag],
          timeoutSec: 30, outputLimit: 16384, operationId: null,
        })) as unknown as Record<string, unknown>;
        const checksVerdict = classifyGitCheckOutput({
          exitCode: checksRun.exitCode == null ? null : Number(checksRun.exitCode),
          stdout: scrub(String(checksRun.stdout ?? "")),
          stderr: scrub(String(checksRun.stderr ?? "")),
        });
        if (checksVerdict.overallStatus !== "success") {
          throw err("refused", `Merge refused for #${pullRequestNumber}: GitHub checks are ${checksVerdict.overallStatus} (${checksVerdict.reason ?? "not all passed"}).`, { remediationOwner: "CTO", requiredAction: "Verify all CI jobs against the exact head SHA and restore Checks:Read before merging" });
        }
        const methodFlag = mergeMethod === "squash" ? "--squash" : mergeMethod === "rebase" ? "--rebase" : "--merge";
        const merged = (await runJailedExec({
          ws,
          argv: ["gh", "pr", "merge", String(pullRequestNumber), ...repoFlag, methodFlag, "--match-head-commit", headSha],
          timeoutSec: 60,
          outputLimit: 8192,
          operationId: null,
        })) as unknown as Record<string, unknown>;
        if (Number(merged.exitCode ?? 1) !== 0) {
          throw err("refused", `Merge rejected for #${pullRequestNumber} (branch protection or CI unsatisfied; no force merge attempted): ${scrub(String(merged.stderr ?? merged.stdout ?? "")).slice(0, 500)}`, {
            remediationOwner: "operator",
          });
        }
        // Confirm merge SHA by re-reading the PR.
        const confirm = (await runJailedExec({
          ws,
          argv: ["gh", "pr", "view", String(pullRequestNumber), ...repoFlag, "--json", "mergedAt,mergeCommit,state"],
          timeoutSec: 30,
          outputLimit: 4096,
          operationId: null,
        })) as unknown as Record<string, unknown>;
        let confirmed: Record<string, unknown> = {};
        try {
          confirmed = JSON.parse(scrub(String(confirm.stdout ?? "{}"))) as Record<string, unknown>;
        } catch {
          confirmed = {};
        }
        const result = {
          status: "ok",
          operationId,
          pullRequestNumber,
          expectedHeadSha,
          actualHeadSha: headSha,
          mergedAt: confirmed.mergedAt ?? null,
          mergeCommit: (confirmed.mergeCommit as Record<string, unknown> | null)?.oid ?? confirmed.mergeCommit ?? null,
          state: confirmed.state ?? null,
          possiblyCommitted: true,
          evidenceReference: `ledger:${operationId}`,
          attribution: mutationCtx,
        };
        if (ledgerKey) await writeLedger(ledgerKey, result);
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "git.mergePR", pullRequestNumber, mergeCommit: result.mergeCommit, operationId });
        return result;
      },
    ),
  ];
}
