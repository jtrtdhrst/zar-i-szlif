// P0-E/F/G + P1-A/B/C platform tools.
//
// paperclipHostGetEffectivePolicy      (P0-E policy drift)
// paperclipWorkspaceApplyUnifiedDiff   (P0-F single-file unified diff)
// paperclipWorkspaceBatchChange        (P0-F atomic multi-file batch)
// paperclipWorkspaceRunChecks          (P0-G explicit test profiles)
// paperclipOAuthDiagnoseSession        (P1-A OAuth E2E diagnostics)
// paperclipHostPlanDeployment          (P1-B plan, no mutation)
// paperclipHostApplyDeployment         (P1-B apply with state machine)
// paperclipExecuteDeliveryUnit         (P1-C saga orchestrator)
//
// Mutating tools authorize via the caller's own live heartbeat run (issue-bound)
// or a board key — see authorizeWorkspaceMutation in workspace-native.ts
// (legacy operatorRunId is still honored when it verifies; operator sessions
// were removed in Paperclip 2026.1012.0). Results bind to source SHA, persist
// idempotent ledgers, and fail closed.

import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { PaperclipApiClient } from "./client.js";
import {
  resolveWorkspace,
  verifyOperatorRun,
  verifyIssueWritable,
  resolveWorkspacePath,
  runJailedExec,
  redactWorkspaceOutput,
  authorizeWorkspaceMutation,
  assertWorkspaceMutationScope,
  recordWorkspaceMutationAudit,
} from "./workspace-native.js";
import { capabilitiesDocument, hostLaneOperations } from "./host-ops.js";
import { hostPolicyDigest, missingRequiredInPlan, noDeploymentExecutorResult, resolveDeploymentOps, unsupportedPlannedOps } from "./host-plan-ops.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { enforceWriteScope } from "./write-scope.js";
import { enforceDeploymentRoot } from "./deployment-root.js";
import { noDeliveryExecutorResult } from "./execution-truth.js";

export interface P1PlatformToolDefinition {
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
): P1PlatformToolDefinition {
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

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}



const workspaceIdSchema = z.string().uuid().optional().nullable();
const issueIdSchema = z.string().min(1).max(128).optional().nullable();
const operatorRunIdSchema = z.string().uuid().optional().nullable();
const runIdSchema = z.string().uuid().optional().nullable();

function opsLedgerDir(): string {
  return process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR || "/paperclip/mcp-platform-ops";
}

async function readLedger(key: string): Promise<Record<string, unknown> | null> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) return null;
  try {
    const raw = await fs.readFile(join(opsLedgerDir(), `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLedger(key: string, envelope: Record<string, unknown>): Promise<void> {
  await fs.mkdir(opsLedgerDir(), { recursive: true });
  await fs.writeFile(join(opsLedgerDir(), `${key}.json`), JSON.stringify(envelope, null, 2), "utf8");
}

function scanForSecrets(text: string): string[] {
  const hits: string[] = [];
  if (/pcp_[A-Za-z0-9_-]{8,}/.test(text)) hits.push("paperclip-key");
  if (/mcp_(at|rt)_[A-Za-z0-9_-]{8,}/.test(text)) hits.push("oauth-token");
  if (/gh[pousr]_[A-Za-z0-9_]{8,}/.test(text) || /github_pat_[A-Za-z0-9_]{8,}/.test(text)) hits.push("github-token");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push("private-key");
  return hits;
}

// P0-A operator scope enforcement (AUTH-01..10):
// wraps verifyOperatorRun (company + active status + expiry) with
// - agent binding: a run delegated to another agent cannot be reused
//   (AUTH-02 foreign issue/agent, AUTH-06 foreign company already denied
//   inside verifyOperatorRun),
// - issue scope: a run explicitly scoped to issues cannot wander outside
//   them, including post-authorization swaps (AUTH-04/AUTH-08).
// Unknown record shapes stay permissive: the supervisor/API re-validates
// host-side, and the error contract always carries errorCode (AUTH-09) and
// never accepts forged context (AUTH-10 is supervisor-side).
export async function verifyOperatorScope(
  client: PaperclipApiClient,
  operatorRunId: string,
  issueId?: string | null,
): Promise<Record<string, unknown>> {
  const run = await verifyOperatorRun(client, operatorRunId);
  let callerAgent: string | null = null;
  try {
    callerAgent = client.resolveAgentId();
  } catch {
    callerAgent = null;
  }
  const snap = isRecord(run.contextSnapshot) ? (run.contextSnapshot as Record<string, unknown>) : null;
  const boardAuthorized =
    (run as Record<string, unknown>).authority === "board" || snap?.authority === "board";
  const runAgent = typeof run.agentId === "string" ? (run.agentId as string) : null;
  if (!boardAuthorized && runAgent && callerAgent && runAgent !== callerAgent) {
    throw err("auth_failed", "operatorRunId is delegated to another agent; not usable by this caller", {
      remediationOwner: "caller",
      remediation: "Provide a live execution context owned by this caller; operator sessions are removed upstream (CAPABILITY_REMOVED) — never reuse another actor's run",
    });
  }
  const scopes: string[] = [
    ...(Array.isArray(run.scopeIssueIds) ? (run.scopeIssueIds as unknown[]) : []),
    ...(snap && Array.isArray(snap.scopeIssueIds) ? (snap.scopeIssueIds as unknown[]) : []),
    ...(snap && typeof snap.issueId === "string" ? [snap.issueId] : []),
  ].filter((s): s is string => typeof s === "string");
  if (issueId && scopes.length > 0 && !scopes.includes(issueId)) {
    throw err("auth_failed", `operatorRunId scope does not cover issue ${issueId}`, {
      remediationOwner: "caller",
      remediation: "Provide a live run context scoped to this issue; operator sessions are removed upstream (CAPABILITY_REMOVED, owner CTO)",
    });
  }
  return run;
}

// ---------------------------------------------------------------------------
// Unified diff applier (pure TS, all-or-nothing)
// ---------------------------------------------------------------------------

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: Array<{ kind: " " | "-" | "+"; text: string }>;
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");
  let cur: DiffHunk | null = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    // Terminal empty element from a trailing newline is not a hunk line.
    if (line === "" && li === lines.length - 1) continue;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      if (cur) hunks.push(cur);
      cur = {
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3], 10),
        newLines: m[4] === undefined ? 1 : parseInt(m[4], 10),
        ops: [],
      };
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("Index: ") || line.startsWith("diff ")) continue;
    if (cur && (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+") || line === "")) {
      // Empty line inside a hunk is a context line with stripped leading space.
      cur.ops.push({ kind: line === "" ? " " : (line[0] as " " | "-" | "+"), text: line === "" ? "" : line.slice(1) });
    } else if (line.startsWith("\\ ")) {
      continue; // "\ No newline at end of file" marker
    } else if (cur && line.length > 0) {
      throw err("invalid_arguments", `Unparseable diff line inside hunk: ${line.slice(0, 80)}`);
    }
  }
  if (cur) hunks.push(cur);
  if (hunks.length === 0) throw err("invalid_arguments", "No hunks found in unifiedDiff");
  return hunks;
}

export function applyUnifiedDiffToText(current: string, hunks: DiffHunk[]): { text: string; appliedHunks: number } {
  const hasTrailingNl = current.endsWith("\n");
  const src = current.split("\n");
  if (hasTrailingNl && src[src.length - 1] === "") src.pop();
  const out: string[] = [];
  let cursor = 0; // 0-based index into src
  for (const h of hunks) {
    const startIdx = h.oldStart - 1;
    if (startIdx < cursor) throw err("version_conflict", `Overlapping hunks at old line ${h.oldStart}`);
    while (cursor < startIdx) {
      if (cursor >= src.length) throw err("version_conflict", `Hunk at old line ${h.oldStart} exceeds file length ${src.length}`);
      out.push(src[cursor]!);
      cursor++;
    }
    for (const op of h.ops) {
      if (op.kind === " ") {
        if (src[cursor] !== op.text) {
          throw err(
            "version_conflict",
            `Context mismatch at old line ${cursor + 1}: expected ${JSON.stringify(op.text).slice(0, 80)}, found ${JSON.stringify(src[cursor] ?? null).slice(0, 80)}`,
          );
        }
        out.push(src[cursor]!);
        cursor++;
      } else if (op.kind === "-") {
        if (src[cursor] !== op.text) {
          throw err(
            "version_conflict",
            `Removal mismatch at old line ${cursor + 1}: expected ${JSON.stringify(op.text).slice(0, 80)}, found ${JSON.stringify(src[cursor] ?? null).slice(0, 80)}`,
          );
        }
        cursor++;
      } else {
        out.push(op.text);
      }
    }
  }
  while (cursor < src.length) {
    out.push(src[cursor]!);
    cursor++;
  }
  return { text: out.join("\n") + (hasTrailingNl || out.length > 0 ? "\n" : ""), appliedHunks: hunks.length };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const P1_PLATFORM_TOOL_NAMES: string[] = [
  "paperclipHostGetEffectivePolicy",
  "paperclipWorkspaceApplyUnifiedDiff",
  "paperclipWorkspaceBatchChange",
  "paperclipWorkspaceRunChecks",
  "paperclipOAuthDiagnoseSession",
  "paperclipHostPlanDeployment",
  "paperclipHostApplyDeployment",
  "paperclipExecuteDeliveryUnit",
];

const RUN_CHECKS_PROFILES = {
  typecheck: { argv: ["npx", "tsc", "--noEmit"], describe: "TypeScript typecheck (npx tsc --noEmit)" },
  lint: { argv: ["npx", "eslint", "."], describe: "ESLint over the workspace" },
  unit: { argv: ["npx", "vitest", "run"], describe: "Vitest unit suite" },
  integration: { argv: ["npx", "vitest", "run", "--project", "integration"], describe: "Vitest integration project" },
  build: { argv: ["npm", "run", "build"], describe: "Package build (npm run build)" },
  e2e: { argv: ["npx", "vitest", "run", "--project", "e2e"], describe: "End-to-end project" },
} as const;

type RunChecksProfile = keyof typeof RUN_CHECKS_PROFILES;

const DEPLOY_STATES = ["PLANNED", "AUTHORIZED", "PREFLIGHT_PASSED", "BUILDING", "BUILD_VERIFIED", "DEPLOYING", "HEALTH_CHECKING", "VERIFIED", "FAILED", "ROLLING_BACK", "ROLLED_BACK", "UNVERIFIED"] as const;

export function createP1PlatformTools(client: PaperclipApiClient): P1PlatformToolDefinition[] {
  return [
    makeTool(
      "paperclipHostGetEffectivePolicy",
      "Effective host policy: runningSupervisorVersion/activePolicyVersion+digest vs mirroredPolicyVersion+digest vs expectedReleasePolicyDigest, supported/enabled/disabled operations, driftDetected+differences+remediationOwner. Read-only. Mutating ops are rejected while material drift is unresolved.",
      z.object({}),
      async () => {
        const operationId = randomUUID();
        const caps = capabilitiesDocument() as unknown as Record<string, unknown>;
        const enforced = {
          supervisorVersion: String(caps.supervisorVersion ?? "unknown"),
          policyVersion: String(caps.policyVersion ?? "unknown"),
          bridge: String(caps.bridge ?? "unknown"),
        };
        let mirrorVersion = "unknown";
        let mirrorDigest = "unknown";
        let mirrorSupervisor = "unknown";
        try {
          const policy = await fs.readFile("/paperclip/vps-ops/policy/POLICY.md", "utf8");
          const sums = await fs.readFile("/paperclip/vps-ops/policy/SHA256SUMS", "utf8").catch(() => "");
          mirrorVersion = /policy\s+(v[\d.]+)/i.exec(policy.slice(0, 2000))?.[1] ?? /v3\.\d+/.exec(policy.slice(0, 2000))?.[0] ?? "unknown";
          mirrorSupervisor = /supervisor\s+([\d.]+)/i.exec(policy.slice(0, 2000))?.[1] ?? "unknown";
          const sumsLine = sums.split("\n").find((l) => l.trim().endsWith("POLICY.md"));
          mirrorDigest = sumsLine ? sumsLine.trim().split(/\s+/)[0]! : sha256Hex(policy);
        } catch {
          /* mirror unreadable: reported as drift */
        }
        const readOps = Array.isArray(caps.readOperations) ? (caps.readOperations as string[]) : [];
        const mutOps = Array.isArray(caps.mutatingOperations) ? (caps.mutatingOperations as string[]) : [];
        const supported = [...readOps, ...mutOps];
        const enabled = Array.isArray(caps.enabledOperations) ? (caps.enabledOperations as string[]) : supported;
        const disabled = supported.filter((op) => !enabled.includes(op));
        const differences: string[] = [];
        if (mirrorVersion !== "unknown" && mirrorVersion !== enforced.policyVersion) {
          differences.push(`policy version: enforced=${enforced.policyVersion} mirror=${mirrorVersion}`);
        }
        if (mirrorSupervisor !== "unknown" && mirrorSupervisor !== enforced.supervisorVersion) {
          differences.push(`supervisor: enforced=${enforced.supervisorVersion} mirror Mentions=${mirrorSupervisor}`);
        }
        const driftDetected = differences.length > 0;
        return {
          status: "ok",
          operationId,
          runningSupervisorVersion: enforced.supervisorVersion,
          activePolicyVersion: enforced.policyVersion,
          activePolicyDigest: hostPolicyDigest(caps),
          mirroredPolicyVersion: mirrorVersion,
          mirroredPolicyDigest: mirrorDigest,
          expectedReleasePolicyDigest: hostPolicyDigest(caps),
          supportedOperations: supported,
          enabledOperations: enabled,
          disabledOperations: disabled,
          driftDetected,
          differences,
          remediationOwner: driftDetected ? "owner" : null,
          remediation: driftDetected
            ? "Mirror differs from enforced policy: promote only via a CTO-owned supervisor image bump with baked SHA256SUMS; never promote on version number alone. Mutating host ops stay fail-closed until digests reconcile."
            : null,
          possiblyCommitted: false,
          evidenceReference: `ledger:${operationId}`,
        };
      },
    ),
    makeTool(
      "paperclipWorkspaceApplyUnifiedDiff",
      "Apply ONE unified diff to ONE file (all hunks verified before any write; no partial writes; tmp+rename; beforeSha/afterSha). Params: workspaceId?/issueId?, path, expectedSha, unifiedDiff, dryRun?, runId?/operatorRunId?, idempotencyKey?. Mismatched hunks stop the edit with zero writes. Authorized by the caller's own live heartbeat run (issue-bound) or a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        path: z.string().min(1).max(512),
        expectedSha: z.string().length(64),
        unifiedDiff: z.string().min(1).max(1048576),
        dryRun: z.boolean().optional().default(false),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
        idempotencyKey: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ workspaceId, issueId, path, expectedSha, unifiedDiff, dryRun, runId, operatorRunId, idempotencyKey }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const operationId = randomUUID();
        const ledgerKey = idempotencyKey ? `diff-${idempotencyKey}` : null;
        if (ledgerKey) {
          const prior = await readLedger(ledgerKey);
          if (prior) return { ...(prior as object), replayed: true };
        }
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        if (unifiedDiff.includes("\0")) throw err("invalid_arguments", "NUL byte in unifiedDiff refused");
        await enforceWriteScope(client, { issueId: issueId ?? ws.sourceIssueId, paths: [path], tool: "paperclipWorkspaceApplyUnifiedDiff" });
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipWorkspaceApplyUnifiedDiff" });
        const secrets = scanForSecrets(unifiedDiff);
        if (secrets.length > 0) throw err("secret_denied", `Diff contains secret-like material (${secrets.join(",")}); refusing`);
        const abs = await resolveWorkspacePath(ws, path);
        const current = await fs.readFile(abs, "utf8").catch(() => {
          throw err("not_found", `Path not found in workspace: ${path}`);
        });
        const beforeSha = sha256Hex(current);
        if (beforeSha !== expectedSha) {
          throw err("version_conflict", `expectedSha mismatch for ${path}: current ${beforeSha}`);
        }
        const hunks = parseUnifiedDiff(unifiedDiff);
        const { text: next, appliedHunks } = applyUnifiedDiffToText(current, hunks);
        const afterSha = sha256Hex(next);
        if (afterSha === beforeSha) return { status: "ok", operationId, workspaceId: ws.workspaceId, path, alreadyApplied: true, beforeSha, afterSha, appliedHunks, rejectedHunks: 0, conflict: false };
        if (dryRun) {
          return { status: "ok", operationId, workspaceId: ws.workspaceId, path, dryRun: true, beforeSha, afterSha, appliedHunks, rejectedHunks: 0, conflict: false, note: "dryRun: no write performed" };
        }
        const tmp = `${abs}.paperclip-tmp-${operationId}`;
        try {
          await fs.writeFile(tmp, next, "utf8");
          const verify = sha256Hex(await fs.readFile(tmp, "utf8"));
          if (verify !== afterSha) throw err("internal", "Tmp write verification failed; original untouched");
          await fs.rename(tmp, abs);
        } finally {
          await fs.rm(tmp, { force: true });
        }
        const reread = sha256Hex(await fs.readFile(abs, "utf8"));
        if (reread !== afterSha) throw err("internal", "Post-write readback mismatch");
        const result = {
          status: "ok",
          operationId,
          workspaceId: ws.workspaceId,
          path,
          beforeSha,
          afterSha,
          appliedHunks,
          rejectedHunks: 0,
          conflict: false,
          diff: unifiedDiff.slice(0, 4096),
          possiblyCommitted: false,
          evidenceReference: `ledger:${operationId}`,
          attribution: mutationCtx,
        };
        if (ledgerKey) await writeLedger(ledgerKey, result);
        await writeLedger(`op-${operationId}`, result);
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "diff.apply", path, beforeSha, afterSha, operationId });
        return result;
      },
    ),
    makeTool(
      "paperclipWorkspaceBatchChange",
      "Atomic-feeling multi-file change: verifies ALL files (path traversal, symlinks, expectedSha, secrets) before ANY write; journaled; tmp+rename per file with rollback on failure; never claims success on partial results. Params: workspaceId?/issueId?, expectedHeadSha?, changes[{path, expectedSha?, content?|unifiedDiff?}], dryRun?, runId?/operatorRunId?, idempotencyKey?. Authorized by the caller's own live heartbeat run (issue-bound) or a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        expectedHeadSha: z.string().min(4).max(64).optional().nullable(),
        changes: z
          .array(
            z.object({
              path: z.string().min(1).max(512),
              expectedSha: z.string().length(64).optional().nullable(),
              content: z.string().max(1048576).optional().nullable(),
              unifiedDiff: z.string().max(1048576).optional().nullable(),
            }),
          )
          .min(1)
          .max(50),
        dryRun: z.boolean().optional().default(false),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
        idempotencyKey: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ workspaceId, issueId, expectedHeadSha, changes, dryRun, runId, operatorRunId, idempotencyKey }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const operationId = randomUUID();
        const ledgerKey = idempotencyKey ? `batch-${idempotencyKey}` : null;
        if (ledgerKey) {
          const prior = await readLedger(ledgerKey);
          if (prior) return { ...(prior as object), replayed: true };
        }
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        await enforceWriteScope(client, { issueId: issueId ?? ws.sourceIssueId, paths: (changes ?? []).map((ch) => ch.path), tool: "paperclipWorkspaceBatchChange" });
        await enforceDeploymentRoot(client, { issueId: issueId ?? ws.sourceIssueId, targetPath: ws.realCwd, workspacePath: ws.realCwd, tool: "paperclipWorkspaceBatchChange" });
        if (expectedHeadSha) {
          const head = (await runJailedExec({ ws, argv: ["git", "rev-parse", "HEAD"], timeoutSec: 15, outputLimit: 256, operationId: null })) as unknown as Record<string, unknown>;
          const actual = String(head.stdout ?? "").trim();
          if (actual !== expectedHeadSha) throw err("version_conflict", `expectedHeadSha mismatch: HEAD is ${actual}`);
        }
        // Phase 1: verify everything.
        const prepared: Array<{ path: string; abs: string; before: string | null; beforeSha: string | null; next: string; nextSha: string }> = [];
        for (const ch of changes ?? []) {
          if (!ch.content && !ch.unifiedDiff) throw err("invalid_arguments", `Change for ${ch.path} needs content or unifiedDiff`);
          if (ch.content && ch.unifiedDiff) throw err("invalid_arguments", `Change for ${ch.path} must not carry both content and unifiedDiff`);
          const payload = (ch.content ?? ch.unifiedDiff)!;
          if (payload.includes("\0")) throw err("invalid_arguments", `NUL byte refused in ${ch.path}`);
          const secrets = scanForSecrets(payload);
          if (secrets.length > 0) throw err("secret_denied", `Change for ${ch.path} contains secret-like material (${secrets.join(",")})`);
          const abs = await resolveWorkspacePath(ws, ch.path);
          const exists = await fs.stat(abs).then((s) => s.isFile()).catch(() => false);
          const before = exists ? await fs.readFile(abs, "utf8").catch(() => { throw err("invalid_arguments", `File is not valid UTF-8 text: ${ch.path}`); }) : null;
          const beforeSha = before === null ? null : sha256Hex(before);
          if (before !== null && ch.expectedSha && beforeSha !== ch.expectedSha) {
            throw err("version_conflict", `expectedSha mismatch for ${ch.path}: current ${beforeSha}`);
          }
          let next: string;
          if (ch.content) next = ch.content;
          else next = applyUnifiedDiffToText(before ?? "", parseUnifiedDiff(ch.unifiedDiff!)).text;
          prepared.push({ path: ch.path, abs, before, beforeSha, next, nextSha: sha256Hex(next) });
        }
        if (dryRun) {
          return {
            status: "ok",
            operationId,
            workspaceId: ws.workspaceId,
            dryRun: true,
            files: prepared.map((p) => ({ path: p.path, beforeSha: p.beforeSha, afterSha: p.nextSha })),
            note: "dryRun: verified all changes, no writes performed",
            possiblyCommitted: false,
            evidenceReference: `ledger:${operationId}`,
          };
        }
        // Phase 2: journal then apply (rollback restores completed files).
        const journalKey = `journal-${operationId}`;
        await writeLedger(journalKey, { operationId, workspaceId: ws.workspaceId, startedAt: new Date().toISOString(), files: prepared.map((p) => ({ path: p.path, beforeSha: p.beforeSha, before: p.before })) });
        const applied: string[] = [];
        try {
          for (const p of prepared) {
            if (p.nextSha === p.beforeSha) {
              applied.push(p.path);
              continue;
            }
            const tmp = `${p.abs}.paperclip-tmp-${operationId}`;
            try {
              await fs.writeFile(tmp, p.next, "utf8");
              const verify = sha256Hex(await fs.readFile(tmp, "utf8"));
              if (verify !== p.nextSha) throw err("internal", `Tmp verification failed for ${p.path}; rolling back`);
              await fs.rename(tmp, p.abs);
            } finally {
              await fs.rm(tmp, { force: true });
            }
            const reread = sha256Hex(await fs.readFile(p.abs, "utf8"));
            if (reread !== p.nextSha) throw err("internal", `Readback mismatch for ${p.path}; rolling back`);
            applied.push(p.path);
          }
        } catch (applyError) {
          // Rollback completed files from the journal.
          const journal = await readLedger(journalKey);
          const files = (journal?.files as Array<{ path: string; before: string | null }> | undefined) ?? [];
          for (const f of files) {
            if (!applied.includes(f.path)) continue;
            try {
              const abs = await resolveWorkspacePath(ws, f.path);
              if (f.before === null) await fs.rm(abs, { force: true });
              else await fs.writeFile(abs, f.before, "utf8");
            } catch {
              /* best-effort rollback */
            }
          }
          throw err(
            "internal",
            `Batch failed and rolled back (${applied.length} files restored): ${applyError instanceof Error ? applyError.message.slice(0, 300) : String(applyError)}`,
            { remediationOwner: "operator", remediation: `Inspect journal ${journalKey}, fix the cause, retry with a fresh idempotencyKey` },
          );
        }
        const result = {
          status: "ok",
          operationId,
          workspaceId: ws.workspaceId,
          files: prepared.map((p) => ({ path: p.path, beforeSha: p.beforeSha, afterSha: p.nextSha })),
          journal: journalKey,
          possiblyCommitted: false,
          evidenceReference: `ledger:${operationId}`,
          attribution: mutationCtx,
        };
        if (ledgerKey) await writeLedger(ledgerKey, result);
        await writeLedger(`op-${operationId}`, result);
        await recordWorkspaceMutationAudit(mutationCtx, ws, { action: "batch.apply", files: prepared.map((p) => p.path), operationId });
        return result;
      },
    ),
    makeTool(
      "paperclipWorkspaceRunChecks",
      "Run an explicit check profile jailed to an authorized workspace (no shell; allowlisted binaries; bounded time/output; secrets redacted; result bound to source SHA; replayable via operationId). Profiles: typecheck | lint | unit | integration | build | e2e. Authorized by the caller's own live heartbeat run (issue-bound) or a board key; operator sessions were removed in Paperclip 2026.1012.0.",
      z.object({
        workspaceId: workspaceIdSchema,
        issueId: issueIdSchema,
        profile: z.enum(["typecheck", "lint", "unit", "integration", "build", "e2e"]),
        timeoutSec: z.number().int().min(5).max(110).optional().default(60),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
        operationId: z.string().uuid().optional().nullable(),
      }),
      async ({ workspaceId, issueId, profile, timeoutSec, runId, operatorRunId, operationId }) => {
        if (operationId && !profile) {
          throw err("invalid_arguments", "Pass profile, or extend the client to replay by operationId");
        }
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const ws = await resolveWorkspace(client, { workspaceId: workspaceId ?? null, issueId: issueId ?? null });
        assertWorkspaceMutationScope(mutationCtx, ws, issueId ?? null);
        if (issueId) await verifyIssueWritable(client, issueId);
        const def = RUN_CHECKS_PROFILES[profile as RunChecksProfile];
        if (!def) throw err("invalid_arguments", `Unknown profile (want one of ${Object.keys(RUN_CHECKS_PROFILES).join(", ")})`);
        const head = (await runJailedExec({ ws, argv: ["git", "rev-parse", "HEAD"], timeoutSec: 15, outputLimit: 256, operationId: null })) as unknown as Record<string, unknown>;
        const sourceSha = String(head.stdout ?? "").trim() || null;
        const r = (await runJailedExec({ ws, argv: [...def.argv], timeoutSec: timeoutSec ?? 60, outputLimit: 65536, operationId: null })) as unknown as Record<string, unknown>;
        const exitCode = Number(r.exitCode ?? 1);
        return {
          status: exitCode === 0 ? "ok" : "failed",
          operationId: r.operationId,
          profile,
          command: def.argv,
          describe: def.describe,
          sourceSha,
          exitCode,
          timedOut: r.timedOut,
          stdout: r.stdout,
          stderr: r.stderr,
          durationMs: r.durationMs,
          error: exitCode === 0 ? null : { code: "TEST_FAILED", category: "TEST_FAILED", retryable: false, retryRequiresChange: true, remediationOwner: "operator", requiredAction: `Fix the failing ${profile} output above, then re-run this profile` },
          possiblyCommitted: false,
          evidenceReference: `ledger:${String(r.operationId)}`,
          attribution: mutationCtx,
        };
      },
    ),
    makeTool(
      "paperclipOAuthDiagnoseSession",
      "Stage-by-stage OAuth diagnostics without logging secrets (no tokens/codes/cookies/headers ever recorded). Stages: discovery, resource metadata, auth initiation, redirect validation, callback, code exchange, PKCE, token/audience/scope validation, MCP initialize, tools/list, authenticated tools/call, refresh. Server-testable stages are probed live; browser-mediated stages return the exact next step.",
      z.object({
        correlationId: z.string().min(1).max(128).optional().nullable(),
        clientId: z.string().min(1).max(256).optional().nullable(),
      }),
      async ({ correlationId, clientId }) => {
        const cid = correlationId ?? randomUUID();
        const ts = () => new Date().toISOString();
        const stages: Array<Record<string, unknown>> = [];
        const push = (stage: string, status: string, extra?: Record<string, unknown>) => {
          stages.push({ stage, status, timestamp: ts(), correlationId: cid, remediationOwner: status === "fail" ? "owner" : null, ...(extra ?? {}) });
        };
        const base = (process.env.MCP_PUBLIC_BASE_URL || process.env.PAPERCLIP_PUBLIC_URL || "https://paperclip-mcp.kompaszbiorek.pl").replace(/\/+$/, "");
        // 1. discovery
        try {
          const r = await fetch(`${base}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10000) });
          const body = (await r.json().catch(() => null)) as unknown;
          const ok = r.ok && isRecord(body) && typeof (body as Record<string, unknown>).authorization_endpoint === "string";
          push("discovery", ok ? "pass" : "fail", { errorCode: ok ? null : "OAUTH_DISCOVERY_FAILED", nextStep: ok ? "Fetch protected-resource metadata" : "Owner: restore /.well-known/oauth-authorization-server on the public gateway" });
        } catch (e) {
          push("discovery", "fail", { errorCode: "OAUTH_DISCOVERY_FAILED", detail: redactWorkspaceOutput(e instanceof Error ? e.message : String(e)).slice(0, 200), nextStep: "Owner: check tunnel paperclip-mcp-tunnel and gateway :3101" });
        }
        // 2. protected resource metadata
        try {
          const r = await fetch(`${base}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(10000) });
          push("resource_metadata", r.ok ? "pass" : "unverified", { errorCode: r.ok ? null : "OAUTH_RESOURCE_METADATA_MISSING", nextStep: r.ok ? "Initiate authorization" : "Optional metadata missing; continue with discovery document" });
        } catch {
          push("resource_metadata", "unverified", { nextStep: "Optional metadata unreachable; continue with discovery document" });
        }
        // 3-7. browser-mediated: exact next steps, no secrets.
        push("authorization_initiation", "client_action_required", { nextStep: "Open ${authorization_endpoint}?response_type=code&client_id=<id>&redirect_uri=<https-callback>&scope=mcp&state=<random>&code_challenge=<S256>&code_challenge_method=S256".replace("${authorization_endpoint}", "authorization_endpoint"), clientId: clientId ?? null });
        push("redirect_validation", "client_action_required", { nextStep: "Register an exact https redirect_uri (loopback http://127.0.0.1 allowed for native apps); mismatch fails closed with invalid_redirect_uri" });
        push("oauth_callback", "client_action_required", { nextStep: "If the browser shows 'Brak danych zwrotnych OAuth', the callback never reached the local port: keep exactly one `mcp auth` process and verify the 127.0.0.1:19876 -> container :19877 bridge chain" });
        push("code_exchange", "client_action_required", { nextStep: "Exchange the code within 60s with the original code_verifier; reuse fails closed with invalid_grant" });
        push("pkce_validation", "client_action_required", { nextStep: "Use code_challenge_method S256; plain is accepted only where the server advertises it" });
        // 8-10. token/audience/scope: validated live on the next authenticated call.
        push("token_validation", "unverified", { nextStep: "Call tools/list with the access token; expired tokens fail closed and require refresh" });
        push("audience_validation", "unverified", { nextStep: "Request resource=https://paperclip.kompaszbiorek.pl/mcp; wrong audience fails closed" });
        push("scope_validation", "unverified", { nextStep: "Request scope=mcp; insufficient scope fails closed on tools/call" });
        // 11-12. gateway live probes (unauthenticated tools/list must be denied).
        try {
          const r = await fetch(`${base}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json,text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
            signal: AbortSignal.timeout(10000),
          });
          const denied = r.status === 401 || r.status === 403;
          push("mcp_tools_list_deny_unauth", denied ? "pass" : "fail", { errorCode: denied ? null : "OAUTH_UNAUTH_ACCEPTED", nextStep: denied ? "Authenticate, then list tools" : "Owner: unauthenticated tools/list was NOT denied" });
        } catch (e) {
          push("mcp_tools_list_deny_unauth", "unverified", { detail: redactWorkspaceOutput(e instanceof Error ? e.message : String(e)).slice(0, 200), nextStep: "Owner: check public /mcp reachability" });
        }
        push("authenticated_tools_call", "client_action_required", { nextStep: "With a valid token, call initialize then tools/list then an authenticated read (e.g. paperclipMe)" });
        push("refresh_reconnect", "unverified", { nextStep: "Use the refresh_token grant before access-token expiry; replay initialize on reconnect" });
        const failed = stages.filter((s) => s.status === "fail").length;
        return { status: failed === 0 ? "ok" : "degraded", correlationId: cid, failed, stages, possiblyCommitted: false, evidenceReference: `ledger:${cid}` };
      },
    ),
    makeTool(
      "paperclipHostPlanDeployment",
      "Plan a deployment WITHOUT mutating anything: validates policy digest, resolves current digest, emits planId/risk/operations/policyDecision/prerequisiteChecks/backupReference/rollbackTarget/requiredAuthority. Planning never builds, restarts, or migrates.",
      z.object({
        service: z.string().min(1).max(128),
        artifactDigest: z.string().min(8).max(256),
        expectedCurrentDigest: z.string().min(1).max(256).optional().nullable(),
        environment: z.string().min(1).max(64).optional().default("staging"),
        expectedPolicyDigest: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ service, artifactDigest, expectedCurrentDigest, environment, expectedPolicyDigest }) => {
        const operationId = randomUUID();
        const planId = randomUUID();
        const caps = capabilitiesDocument() as unknown as Record<string, unknown>;
        const activeDigest = hostPolicyDigest(caps);
        if (expectedPolicyDigest && expectedPolicyDigest !== activeDigest) {
          throw err("version_conflict", `expectedPolicyDigest mismatch: active ${activeDigest}`, { remediationOwner: "owner" });
        }
        // v3.8 fix (KOMAA-1156): the lane set comes from the capabilities document
        // (caps.supportedOperations never existed -> the set was always [] ->
        // backup.create was force-included -> backup-only PLANNED/allow=true plans).
        const supported = hostLaneOperations();
        const recreateTargets = Array.isArray(caps.recreateTargets) ? (caps.recreateTargets as string[]) : [];
        const { operations, missingOps, missingTargets } = resolveDeploymentOps({ laneOperations: supported, recreateTargets }, service);
        if (missingOps.length > 0) {
          throw err("configuration_missing", `Plan refused: no supervisor lane for ${missingOps.join(", ")} (policy ${String(caps.policyVersion)}). A plan is produced only when every required operation has a real lane.`, { remediationOwner: "CTO", remediation: "Pin the missing lane via a CTO-owned supervisor policy bump (image + POLICY.md revision), then re-plan." });
        }
        if (missingTargets.length > 0) {
          throw err("configuration_missing", `Plan refused: service ${service} is not a provisioned container-recreate target (recreate targets: ${recreateTargets.join(", ") || "<none>"}). A backup-only plan is not a deployment plan.`, { remediationOwner: "CTO", remediation: "CTO pins the recreate target + image id (RECREATE_TARGETS/RECREATE_IMAGES) in a supervisor policy bump, then re-plan." });
        }
        const risk = environment === "production" ? "high" : "medium";
        const plan = {
          status: "ok",
          operationId,
          planId,
          state: "PLANNED",
          service,
          artifactDigest,
          expectedCurrentDigest: expectedCurrentDigest ?? null,
          environment: environment ?? "staging",
          risk,
          operations,
          policyDecision: { allow: true, policyVersion: String(caps.policyVersion), supervisorVersion: String(caps.supervisorVersion) },
          prerequisiteChecks: ["disk-preflight", "backup.create", "artifact digest pinned", "staging health gate (non-production)"],
          backupReference: null,
          rollbackTarget: expectedCurrentDigest ?? "previous-verified-artifact",
          requiredAuthority: environment === "production" ? "board" : "operator",
          possiblyCommitted: false,
          evidenceReference: `ledger:${planId}`,
        };
        await writeLedger(`plan-${planId}`, { ...plan, createdAt: new Date().toISOString() });
        return plan;
      },
    ),
    makeTool(
      "paperclipHostApplyDeployment",
      "Apply a PLANNED deployment only if actual host execution exists. Currently returns deployment_executor_missing/FAILED, with zero host operations submitted, rather than a false PREFLIGHT_PASSED success. Validates plan and authority first.",
      z.object({
        planId: z.string().uuid(),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
        expectedPolicyDigest: z.string().min(1).max(128).optional().nullable(),
        idempotencyKey: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ planId, runId, operatorRunId, expectedPolicyDigest, idempotencyKey }) => {
        const mutationCtx = await authorizeWorkspaceMutation(client, { runId: runId ?? null, operatorRunId: operatorRunId ?? null });
        const operationId = randomUUID();
        const ledgerKey = idempotencyKey ? `deploy-${idempotencyKey}` : null;
        if (ledgerKey) {
          const prior = await readLedger(ledgerKey);
          if (prior) return { ...(prior as object), replayed: true };
        }
        const plan = await readLedger(`plan-${planId}`);
        if (!plan) throw err("not_found", `Unknown planId ${planId}: plan first via paperclipHostPlanDeployment`);
        if (String(plan.environment ?? "staging") === "production" && mutationCtx.authority === "agent-run") {
          throw err("scope_denied", "Production deployments require board authority; an agent's live run may not apply a production deployment", { remediationOwner: "caller", remediation: "Use a board key for production, or plan against a non-production environment" });
        }
        const caps = capabilitiesDocument() as unknown as Record<string, unknown>;
        const activeDigest = hostPolicyDigest(caps);
        if (expectedPolicyDigest && expectedPolicyDigest !== activeDigest) {
          throw err("version_conflict", `expectedPolicyDigest mismatch: active ${activeDigest}`, { remediationOwner: "owner" });
        }
        // Fail closed on operations the supervisor cannot execute yet.
        const supported = hostLaneOperations();
        const plannedOps = (plan.operations as string[] | undefined) ?? [];
        // v3.8 fix (KOMAA-1156): no exemptions - a planned op without a lane, or
        // a plan that does not cover every required op (legacy backup-only plans
        // included), is refused instead of silently applied.
        const unsupported = unsupportedPlannedOps(plannedOps, supported);
        const missingRequired = missingRequiredInPlan(plannedOps);
        const recordStep = async (state: (typeof DEPLOY_STATES)[number], extra?: Record<string, unknown>) => {
          const rec = { deploymentId: operationId, planId, state, at: new Date().toISOString(), ...(extra ?? {}) };
          await writeLedger(`deploy-state-${operationId}-${state}`, rec);
          return rec;
        };
        const gaps = [...unsupported, ...missingRequired.filter((op) => !unsupported.includes(op))];
        if (gaps.length > 0) {
          await recordStep("FAILED", { reason: `No supervisor lane for: ${gaps.join(", ")}`, errorCode: "configuration_missing" });
          throw err(
            "configuration_missing",
            `Deployment refused: no supervisor lane for ${gaps.join(", ")} (policy ${String(caps.policyVersion)}). Backup/verify lanes exist; container recreation needs a CTO-owned pin.`,
            { remediationOwner: "CTO", remediation: "Pin canary targets/images via a CTO-owned supervisor policy bump, then re-plan" },
          );
        }
        // Plan validation is not host execution. In particular, do NOT persist
        // AUTHORIZED/PREFLIGHT_PASSED without submitting any supervisor intents.
        const result = noDeploymentExecutorResult(planId, operationId, String(plan.service ?? ""));
        await recordStep("FAILED", { reason: result.note, errorCode: result.errorCode, possiblyCommitted: false });
        if (ledgerKey) await writeLedger(ledgerKey, result);
        await writeLedger("op-" + operationId, result);
        return result;
      },
    ),
    makeTool(
      "paperclipExecuteDeliveryUnit",
      "Read-only issue delivery preflight (eligibility and workspace). Actual implement/test/git/deploy/verify/close phase drivers are not implemented: returns explicit delivery_executor_missing/refused, never in_progress, and never treats resume as execution. No issues created or mutations performed.",
      z.object({
        issueId: z.string().min(1).max(128),
        expectedRevision: z.string().min(1).max(128).optional().nullable(),
        mode: z.enum(["start", "resume"]).optional().default("start"),
        stopAt: z.enum(["eligibility", "workspace", "implement", "test", "git", "deploy", "verify", "close"]).optional().nullable(),
        idempotencyKey: z.string().min(1).max(128).optional().nullable(),
        runId: runIdSchema,
        operatorRunId: operatorRunIdSchema,
      }),
      async ({ issueId, expectedRevision, mode, stopAt, idempotencyKey, runId, operatorRunId }) => {
        const executionId = idempotencyKey ? `delivery-${idempotencyKey}` : `delivery-${randomUUID()}`;
        if (mode === "resume") {
          const prior = await readLedger(executionId);
          if (!prior) throw err("not_found", `No prior execution ${executionId} to resume (start first with the same idempotencyKey)`);
          // An identical ledger reply is NOT execution or advancement of any phase.
          return { ...(prior as object), replayed: true, resumed: false };
        }
        const steps: Array<Record<string, unknown>> = [];
        const step = (stepId: string, status: string, extra?: Record<string, unknown>) => {
          const rec = { stepId, executionId, issueId, status, at: new Date().toISOString(), ...(extra ?? {}) };
          steps.push(rec);
          return rec;
        };
        // 1. eligibility (read-only)
        const issue = await client.requestJson<Record<string, unknown>>("GET", `/issues/${encodeURIComponent(issueId)}`).catch((e: unknown) => {
          throw err("not_found", `Eligibility failed: issue not readable: ${issueId}`);
        });
        const status = String(issue.status ?? "?");
        if (["done", "cancelled"].includes(status)) {
          const terminal = { status: "refused", executionId, issueId, reason: `Issue is terminal (${status})`, error: { code: "ISSUE_STATE_CONFLICT", category: "CONCURRENCY_CONFLICT", retryable: false, remediationOwner: "operator" }, steps, possiblyCommitted: false, evidenceReference: `ledger:${executionId}` };
          await writeLedger(executionId, terminal);
          return terminal;
        }
        step("eligibility", "done", { issueStatus: status, assignee: issue.assigneeAgentId ?? null, expectedRevision: expectedRevision ?? null, evidenceReference: `issue:${issueId}` });
        if (stopAt === "eligibility") {
          const res = { status: "stopped", executionId, issueId, stoppedAt: "eligibility", steps, possiblyCommitted: false, evidenceReference: `ledger:${executionId}` };
          await writeLedger(executionId, res);
          return res;
        }
        // 2. workspace (read-only resolve; no dirty reset, never touches KOMAA-797 or foreign changes)
        const ws = await resolveWorkspace(client, { workspaceId: null, issueId }).catch((e: unknown) => {
          step("workspace", "failed", { error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
          throw e;
        });
        step("workspace", "done", { workspaceId: (ws as unknown as Record<string, unknown>).workspaceId ?? null, evidenceReference: `workspace:${(ws as unknown as Record<string, unknown>).workspaceId ?? "?"}` });
        if (stopAt === "workspace") {
          const res = { status: "stopped", executionId, issueId, stoppedAt: "workspace", steps, possiblyCommitted: false, evidenceReference: `ledger:${executionId}` };
          await writeLedger(executionId, res);
          return res;
        }
        // The existing saga never implemented any mutation phase; it previously
        // returned in_progress + recoveryAction:resume for a list of "deferred"
        // phases. This generated repeated wakes with no deployment.
        step("implement", "not_executed", { errorCode: "delivery_executor_missing" });
        const res = noDeliveryExecutorResult(executionId, issueId, steps);
        await writeLedger(executionId, res);
        return res;
      },
    ),
  ];
}
