// Workspace and OAuth tools; retired custom host supervisor removed.
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { PaperclipApiClient } from "./client.js";
import {
  resolveWorkspace,
  verifyIssueWritable,
  resolveWorkspacePath,
  runJailedExec,
  redactWorkspaceOutput,
  authorizeWorkspaceMutation,
  assertWorkspaceMutationScope,
  recordWorkspaceMutationAudit,
  type WorkspaceMutationContext,
} from "./workspace-native.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { enforceWriteScope } from "./write-scope.js";
import { enforceDeploymentRoot } from "./deployment-root.js";

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
  "paperclipWorkspaceApplyUnifiedDiff",
  "paperclipWorkspaceBatchChange",
  "paperclipWorkspaceRunChecks",
  "paperclipOAuthDiagnoseSession",
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


export function createP1PlatformTools(client: PaperclipApiClient): P1PlatformToolDefinition[] {
  return [
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

