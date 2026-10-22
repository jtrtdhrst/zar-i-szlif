// Durable host-operation reads (P0-C §6.1): Get/List/Cancel over the existing
// vps-ops-supervisor file bridge. Reads NEVER re-execute: they only inspect
// /paperclip/vps-ops/requests + results. No supervisor or policy change.

import { z } from "zod";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface HostQueryToolDefinition {
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
): HostQueryToolDefinition {
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

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function requestsDir(): string {
  return process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR || "/paperclip/vps-ops/requests";
}

function resultsDir(): string {
  return process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR || "/paperclip/vps-ops/results";
}

function err(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRequestFile(dir: string, requestId: string): string {
  if (!REQUEST_ID_RE.test(requestId)) throw err("invalid_arguments", `Unsafe requestId for ledger lookup: ${requestId}`);
  return join(dir, `${requestId}.json`);
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeResult(requestId: string, result: unknown): Record<string, unknown> {
  if (!isRecord(result)) return { requestId, raw: result };
  const rec = result as Record<string, unknown>;
  return {
    requestId,
    operationId: rec.operationId ?? rec.requestId ?? requestId,
    state: rec.status ?? (rec.ok === true ? "succeeded" : rec.ok === false ? "failed" : "unknown"),
    operation: rec.operation ?? null,
    target: rec.target ?? null,
    errorCode: rec.errorCode ?? null,
    policyDecision: rec.policyDecision ?? null,
    replayed: rec.replayed ?? false,
    payloadDigest: rec.payloadDigest ?? null,
    evidenceReference: rec.evidenceReference ?? `ledger:${requestId}`,
    completedAt: rec.timestamp ?? rec.completedAt ?? null,
  };
}

export const HOST_QUERY_TOOL_NAMES: string[] = [
  "paperclipHostGetOperation",
  "paperclipHostListOperations",
  "paperclipHostCancelOperation",
];

export function createHostQueryTools(): HostQueryToolDefinition[] {
  return [
    makeTool(
      "paperclipHostGetOperation",
      "Read back one host-supervisor operation by requestId (preferred) or operationId. Pure read: NEVER re-executes; replays carry replayed:true. No full payload resend needed. Returns operationId/requestId/state/createdAt/startedAt/completedAt/actor/issueId/operation/target/policyDecision/errorCode/result/evidenceReference/replayed/payloadDigest.",
      z.object({
        // Legacy ledger entries use non-UUID ids (komaa843-stats-001, 00deploy1-...): accept any safe string.
        requestId: z.string().min(1).max(128).optional().nullable(),
        operationId: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ requestId, operationId }) => {
        if (!requestId && !operationId) {
          throw err("invalid_arguments", "Pass requestId (preferred) or operationId");
        }
        if (requestId) {
          const result = await readJsonFile(safeRequestFile(resultsDir(), requestId));
          if (result !== null) {
            const summary = summarizeResult(requestId, result);
            const req = await readJsonFile(safeRequestFile(requestsDir(), requestId));
            return {
              ...summary,
              result,
              intent: req && isRecord(req)
                ? { operation: req.operation ?? null, target: (req as Record<string, unknown>).target ?? null, agentId: req.agentId ?? null, issueId: req.issueId ?? null }
                : null,
              replayed: true,
              note: "Read-back only: the operation was NOT re-executed",
            };
          }
          const pending = await readJsonFile(safeRequestFile(requestsDir(), requestId));
          if (pending !== null) {
            return { requestId, state: "pending", replayed: false, intent: pending, note: "No result yet: re-call paperclipHostGetOperation with the same requestId later; it will never re-execute" };
          }
          throw err("not_found", `No host operation for requestId ${requestId} (unknown or expired >900 s / pruned)`);
        }
        // operationId lookup: bounded scan of recent results (mtime desc, cap 500).
        const files = await fs.readdir(resultsDir()).catch(() => [] as string[]);
        const withTime: Array<{ f: string; mtime: number }> = [];
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          try {
            const st = await fs.stat(join(resultsDir(), f));
            withTime.push({ f, mtime: st.mtimeMs });
          } catch { /* raced deletion */ }
        }
        withTime.sort((a, b) => b.mtime - a.mtime);
        for (const { f } of withTime.slice(0, 500)) {
          const result = await readJsonFile(join(resultsDir(), f));
          if (isRecord(result) && String((result as Record<string, unknown>).operationId ?? "") === operationId) {
            const rid = f.replace(/\.json$/, "");
            return {
              ...summarizeResult(rid, result),
              result,
              replayed: true,
              note: "Read-back only: the operation was NOT re-executed",
            };
          }
        }
        throw err("not_found", `No host operation for operationId ${operationId} in the recent 500 results`);
      },
    ),
    makeTool(
      "paperclipHostListOperations",
      "List recent host-supervisor operation results (newest first). Pure read, never executes. Filter by operation and/or state; paged via limit (max 100).",
      z.object({
        limit: z.number().int().min(1).max(100).optional().default(20),
        operation: z.string().min(1).max(128).optional().nullable(),
        state: z.string().min(1).max(32).optional().nullable(),
      }),
      async ({ limit, operation, state }) => {
        const files = await fs.readdir(resultsDir()).catch(() => [] as string[]);
        const withTime: Array<{ f: string; mtime: number }> = [];
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          try {
            const st = await fs.stat(join(resultsDir(), f));
            withTime.push({ f, mtime: st.mtimeMs });
          } catch { /* raced */ }
        }
        withTime.sort((a, b) => b.mtime - a.mtime);
        const items: Record<string, unknown>[] = [];
        for (const { f } of withTime) {
          if (items.length >= (limit ?? 20)) break;
          const rid = f.replace(/\.json$/, "");
          const result = await readJsonFile(join(resultsDir(), f));
          const summary = summarizeResult(rid, result);
          if (operation && String(summary.operation ?? "") !== operation) continue;
          if (state && String(summary.state ?? "") !== state) continue;
          items.push(summary);
        }
        return { count: items.length, operations: items };
      },
    ),
    makeTool(
      "paperclipHostCancelOperation",
      "Request cancellation of YOUR OWN pending host operation (request file exists, no result yet). Only safe for not-yet-started intents: if the supervisor already picked it up, cancellation is best-effort. Terminal operations are returned as-is (no-op). NOTE: supervisor policy v3.7/v3.8 has no cancel consumer lane, so a pending intent is marked cancel-requested but the supervisor may still execute it: treat honored:false as UNVERIFIED and re-read via paperclipHostGetOperation.",
      z.object({
        requestId: z.string().min(1).max(128),
        reason: z.string().trim().min(1).max(500).optional(),
        operatorRunId: z.string().uuid().optional().nullable(),
      }),
      async ({ requestId, reason }) => {
        const result = await readJsonFile(safeRequestFile(resultsDir(), requestId));
        if (result !== null) {
          return { ...summarizeResult(requestId, result), cancelRequested: false, note: "Already terminal: cancellation is a no-op; result returned without re-execution" };
        }
        const pending = await readJsonFile(safeRequestFile(requestsDir(), requestId));
        if (pending === null) throw err("not_found", `No pending host operation for requestId ${requestId}`);
        const marker = { v: 1, requestId, cancelRequestedAt: new Date().toISOString(), reason: reason ?? "operator cancel", honoredBySupervisor: false };
        await fs.writeFile(join(requestsDir(), `${requestId}.cancel.json`), JSON.stringify(marker, null, 2), "utf8");
        return {
          requestId,
          state: "cancel_requested",
          honoredBySupervisor: false,
          remediationOwner: "owner",
          remediation: "Supervisor has no cancel consumer lane (policy v3.7/v3.8): the intent may still execute. Re-read via paperclipHostGetOperation; a CTO-owned policy bump is needed for hard cancel.",
        };
      },
    ),
  ];
}
