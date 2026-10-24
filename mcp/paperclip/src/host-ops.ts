import { z } from "zod";
import type { PaperclipApiClient } from "./client.js";
import { enforceDeploymentRoot, enforceHostServiceScope } from "./deployment-root.js";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { formatErrorResponse, formatTextResponse } from "./format.js";

// Host Operations Adapter (P0 §3): exposes the EXISTING vps-ops-supervisor
// bridge (policy v3.8, supervisor 1.0.16) as typed public MCP tools.
//
// Architecture (no new privileges):
//   public tools/list → tools/call → intent JSON in
//   /paperclip/vps-ops/requests/ → supervisor watcher (10 s daemon, own
//   docker.sock, baked policy) → host action → envelope JSON in
//   /paperclip/vps-ops/results/ → read-back to the caller.
//
// The MCP layer NEVER touches docker, host credentials, or the board key.
// The gateway Bearer (OAuth-mapped pcp key) is only Paperclip API auth;
// host authorization is re-validated supervisor-side from issue/run context
// (owned non-terminal issue + live run context for reads and mutations —
// runId of the current heartbeat run, operatorRunId legacy alias, session
// default PAPERCLIP_RUN_ID; 900 s TTL, single-flight, persistent ledger).
// Unknown P0 catalog
// names (service_start/stop, container_build, database_*, cron, firewall…)
// are NOT in the schema enum: zod rejects them fail-closed with the bootstrap
// pointer instead of implying execution.

export const HOST_BRIDGE_POLICY_VERSION = "v3.8";
export const HOST_SUPERVISOR_VERSION = "1.0.16";
export const HOST_BRIDGE_TAG = "v3";
export const HOST_REQUEST_TTL_SEC = 900;

const DEFAULT_REQUESTS_DIR = "/paperclip/vps-ops/requests";
const DEFAULT_RESULTS_DIR = "/paperclip/vps-ops/results";

function requestsDir(): string {
  return process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR || DEFAULT_REQUESTS_DIR;
}

function resultsDir(): string {
  return process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR || DEFAULT_RESULTS_DIR;
}

export const HOST_READ_OPERATIONS = [
  "ps",
  "health",
  "gateway-health",
  "inspect",
  "logs",
  "stats",
  "volumes",
  "snapshots",
  "images",
  "patch-status",
  "watchdog-status",
  "disk-preflight",
  "host.file.read",
] as const;

export const HOST_ALIAS_OPERATIONS = [
  "host.health",
  "host.processes",
  "host.resources",
  "host.disk",
  "host.network_status",
  "host.service_status",
  "host.service_logs",
  "host.container_inspect",
  "host.container_logs",
  "host.volumes",
  "host.images",
  "host.deployments",
  "host.snapshots",
  "host.backups",
  "host.patch_status",
  "host.watchdog_status",
  "host.disk_preflight",
] as const;

export const HOST_MUT_OPERATIONS = [
  "restart",
  "deploy-paperclip",
  "mcp.build_candidate",
  "mcp.test_candidate",
  "mcp.deploy_candidate",
  "mcp.rollback",
  "host.file.patch",
  "host.container.recreate",
  "host.service.reload",
  "host.backup.create",
  "host.backup.restore_to_staging",
  "host.migration.apply",
] as const;

// P0-D expansion: underscore service/container names, staging migration
// lanes, backup verify, and deployment verify/rollback. Names WITHOUT a
// supervisor lane are schema-accepted but fail closed in submitHostIntent
// (configuration_missing, owner CTO) — never executed, never bypassed.
export const HOST_P1_READ_OPERATIONS = ["host.deployment_verify"] as const;

export const HOST_P1_ALIAS_OPERATIONS = [
  "host.service_reload",
  "host.container_recreate",
  "host.deployment_rollback",
] as const;

export const HOST_P1_NOLANE_OPERATIONS = [
  "host.container_build",
  "host.service_start",
  "host.service_stop",
  "host.service_restart",
  "host.backup.verify",
  "host.migration.dry_run",
  "host.migration.verify",
] as const;

const HOST_P1_ALIAS_TARGET: Record<string, string> = {
  "host.service_reload": "host.service.reload",
  "host.container_recreate": "host.container.recreate",
  "host.deployment_rollback": "mcp.rollback",
};

export function resolveHostOperationAlias(op: string): string {
  return HOST_P1_ALIAS_TARGET[op] ?? op;
}

export function hostOperationWithoutLane(op: string): boolean {
  return (HOST_P1_NOLANE_OPERATIONS as readonly string[]).includes(resolveHostOperationAlias(op));
}

export const HOST_OPERATIONS = [
  ...HOST_READ_OPERATIONS,
  ...HOST_ALIAS_OPERATIONS,
  ...HOST_MUT_OPERATIONS,
  ...HOST_P1_READ_OPERATIONS,
  ...HOST_P1_ALIAS_OPERATIONS,
  ...HOST_P1_NOLANE_OPERATIONS,
] as const;

export type HostOperation = (typeof HOST_OPERATIONS)[number];

const MUT_SET = new Set<string>(HOST_MUT_OPERATIONS);

export function isMutatingOperation(op: string): boolean {
  if ((HOST_P1_READ_OPERATIONS as readonly string[]).includes(op)) return false;
  if ((HOST_P1_ALIAS_OPERATIONS as readonly string[]).includes(op)) return true;
  // No-lane operations are schema-accepted intents that fail closed in
  // submitHostIntent (configuration_missing) - never executed as reads.
  // host.migration.dry_run sounds read-only but has no supervisor lane, so
  // it is classified mutating/fail-closed, never advertised as a working read.
  if ((HOST_P1_NOLANE_OPERATIONS as readonly string[]).includes(op)) return true;
  return MUT_SET.has(resolveHostOperationAlias(op));
}

export const HOST_INSPECT_TARGETS = [
  "paperclip",
  "paperclip-db",
  "paperclip-mcp-tunnel",
  "emailens-mcp-bridge",
  "playwright-mcp",
  "discord-mcp",
  "opencode",
  "paperclip-healthwatch",
  // KOMAA-1156: read-only Mantic lane (inspect/logs/service_status/service_logs).
  // Narrow, exact target name only - no wildcard; unrelated services stay denied.
  // The supervisor still enforces its own per-target pin (policy v3.9) host-side.
  "mantic-mcp-http",
] as const;

export const HOST_RESTART_TARGETS = [
  "paperclip-mcp-tunnel",
  "emailens-mcp-bridge",
  "playwright-mcp",
  "discord-mcp",
] as const;

export function targetError(op: string, target: string | undefined): string | null {
  if (op === "inspect" || op === "logs" || op === "host.service_status" || op === "host.container_inspect" || op === "host.service_logs" || op === "host.container_logs") {
    if (!target || !(HOST_INSPECT_TARGETS as readonly string[]).includes(target)) {
      return `target not allowlisted for ${op}: ${target ?? "(missing)"} (want one of ${(HOST_INSPECT_TARGETS as readonly string[]).join(", ")}) [errorCode=not_allowlisted]`;
    }
    return null;
  }
  if (op === "restart") {
    if (target === "paperclip") return "refused: paperclip restart goes through the restart-when-idle.sh lane, not this tool [errorCode=refused]";
    if (target === "paperclip-db" || target === "opencode") return `refused: restart of ${target} is disabled (data-loss/operator-suicide risk) [errorCode=refused]`;
    if (!target || !(HOST_RESTART_TARGETS as readonly string[]).includes(target)) {
      return `target not allowlisted for restart: ${target ?? "(missing)"} (want one of ${(HOST_RESTART_TARGETS as readonly string[]).join(", ")}) [errorCode=not_allowlisted]`;
    }
    return null;
  }
  return null;
}

// ponytail: one redaction pass over bridge output; supervisor already avoids
// raw secrets, this only scrubs accidental echoes (keys, tokens, headers).
export function redactHostOutput(text: string): string {
  return text
    .replace(/pcp_[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]")
    .replace(/mcp_(at|rt)_[A-Za-z0-9_-]{8,}/g, "[REDACTED_OAUTH_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/("?(?:password|secret|token|api[_-]?key)"?\s*[:=]\s*"?)[^",\s}]{6,}("?)/gi, "$1[REDACTED]$2");
}

// v3.8 idempotency hardening (P0 §3, matches supervisor watcher.sh payload_digest):
// canonical digest covers WHAT executes (op + params), not WHO (identity/context
// excluded so harmless context-only retries never false-conflict). Order/whitespace
// insensitive (fixed key list, not JSON string). Supervisor is authoritative;
// this wrapper fail-closeds early on the same digest to avoid false success.
// Canonical digest key list MUST match watcher.sh payload_digest() EXACTLY
// (supervisor image owns the stamp; any MCP-side deviation false-conflicts
// every replay of a supervisor-completed result). New intent fields
// (service/artifactDigest) stay OUT of the digest until a supervisor policy
// bump adopts them — the supervisor re-validates the full intent anyway.
const PAYLOAD_DIGEST_KEYS = [
  "operation",
  "target",
  "path",
  "content",
  "contentSha",
  "expectedSha",
  "image",
  "backupName",
  "migrationId",
  "sourceRef",
  "digest",
  "dryRun",
  "tail",
] as const;

// Python-str canonicalization: the supervisor stamps digests with Python
// str(value) (True/False/numbers), so JS must emit identical strings or
// every boolean-bearing replay false-conflicts.
function digestCanon(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "";
  return String(value);
}

export function payloadDigestForIntent(intent: Record<string, unknown>): string {
  const parts = PAYLOAD_DIGEST_KEYS.map((k) => digestCanon(intent[k]));
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

function conflictError(requestId: string): Error {
  return new Error(
    `IDEMPOTENCY_CONFLICT: requestId ${requestId} was already used with a different payload (payloadDigest mismatch); no operation executed. Retry with a fresh requestId. [errorCode=idempotency_conflict]`,
  );
}

const hostOperationSchema = z.object({
  operation: z.enum(HOST_OPERATIONS),
  target: z.string().min(1).max(128).optional(),
  tail: z.number().int().min(1).max(500).optional().default(100),
  dryRun: z.boolean().optional().default(false),
  sourceRef: z.string().min(1).max(256).optional(),
  digest: z.string().min(1).max(128).optional(),
  path: z.string().min(1).max(512).optional().describe("Absolute path for host.file.read/patch (allowlisted prefixes only)"),
  content: z.string().max(65536).optional().describe("New file content for host.file.patch (base64 or raw, verified against contentSha)"),
  contentSha: z.string().length(64).optional().describe("sha256 of content for host.file.patch"),
  expectedSha: z.string().length(64).optional().describe("Current sha256 from host.file.read, required for host.file.patch"),
  image: z.string().min(1).max(256).optional().describe("Image for host.container.recreate (must be allowlisted)"),
  backupName: z.string().min(1).max(128).optional().describe("Bare file name for host.backup.restore_to_staging"),
  migrationId: z.string().min(1).max(128).optional().describe("Bare file name from migrations-allowlisted/ for host.migration.apply"),
  service: z.string().min(1).max(128).optional().describe("Service name for host.deployment_verify / host.service_* operations"),
  artifactDigest: z.string().min(1).max(256).optional().describe("Expected artifact digest for host.deployment_verify"),
  reason: z.string().trim().min(1).max(500).optional(),
  requestId: z.string().guid().optional(),
  agentId: z.string().guid(),
  issueId: z.string().min(1).describe("Issue UUID or human identifier (KOMAA-xxx); supervisor resolves both host-side with same company/ownership guards"),
  runId: z.string().guid().optional().nullable(),
  operatorRunId: z.string().guid().optional().nullable(),
});

type HostOperationInput = z.infer<typeof hostOperationSchema>;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 65000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResult(requestId: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(join(resultsDir(), `${requestId}.json`), "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readRequest(requestId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(join(requestsDir(), `${requestId}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export interface HostBridgeHandle {
  requestId: string;
  result: unknown | null;
  pending: boolean;
}

// host.deployment_verify is a pure READ executed MCP-side (no bridge intent,
// no mutation): live gateway health + running commit compared against the
// expected artifactDigest. VERIFIED only on a healthy gateway whose running
// artifact matches; otherwise FAILED/UNVERIFIED with evidence — never a
// bare PASS.
async function submitDeploymentVerify(input: HostOperationInput): Promise<HostBridgeHandle> {
  const effectiveRun = input.runId ?? input.operatorRunId ?? process.env.PAPERCLIP_RUN_ID ?? null;
  if (!effectiveRun) {
    throw new Error("host op requires a live run context: pass runId of your current heartbeat run (legacy operatorRunId alias; PAPERCLIP_RUN_ID is applied automatically in agent sessions) [errorCode=auth_failed]");
  }
  const requestId = input.requestId ?? randomUUID();
  const expected = input.artifactDigest ?? null;
  // The built-in health endpoint verifies ONLY the Paperclip MCP gateway.
  // Never verify Plasmic/other services using the gateway health or omit
  // the expected immutable artifact identity.
  const supportedService = input.service === "paperclip-mcp-gateway";
  let gateway: Record<string, unknown> = { reachable: false, notChecked: true };
  if (supportedService && expected) try {
    const r = await fetch("http://127.0.0.1:3101/health", { signal: AbortSignal.timeout(8000) });
    const body = (await r.json().catch(() => null)) as unknown;
    gateway = { reachable: r.ok, status: r.status, body };
  } catch (e) {
    gateway = { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
  const runningCommit =
    gateway.body && typeof gateway.body === "object" && typeof (gateway.body as Record<string, unknown>).commit === "string"
      ? ((gateway.body as Record<string, unknown>).commit as string)
      : null;
  const match = Boolean(expected && runningCommit && expected === runningCommit);
  const verified = supportedService && Boolean(expected) && gateway.reachable === true && match;
  const verifyError = !supportedService ? "unsupported_service" : !expected ? "invalid_arguments" :
    !gateway.reachable ? "runtime_unavailable" : !match ? "verification_failed" : null;
  const prior = await readResult(requestId);
  const result = {
    operationId: requestId,
    requestId,
    operation: "host.deployment_verify",
    requestedOperation: input.operation,
    service: input.service ?? null,
    status: verified ? "succeeded" : "failed",
    verified,
    runningCommit,
    expectedArtifactDigest: expected,
    gateway,
    timestamp: new Date().toISOString(),
    errorCode: verifyError,
    policyDecision: supportedService && expected ? "allow" : "deny",
    evidenceReference: `ledger:${requestId}`,
    replayed: prior !== null,
  };
  // Audit trail: reads are safe to repeat, so re-verification overwrites the
  // envelope while HostGetOperation replays carry replayed:true.
  try {
    await fs.mkdir(resultsDir(), { recursive: true });
    await fs.writeFile(join(resultsDir(), `${requestId}.json`), JSON.stringify(result, null, 2), "utf8");
  } catch {
    /* audit write is best-effort; the live result above is authoritative */
  }
  return { requestId, result, pending: false };
}

export async function submitHostIntent(input: HostOperationInput): Promise<HostBridgeHandle> {
  const rawOp = input.operation;
  if (hostOperationWithoutLane(rawOp)) {
    throw new Error(
      `refused: ${rawOp} has no supervisor lane in enforced policy ${HOST_BRIDGE_POLICY_VERSION} (supervisor ${HOST_SUPERVISOR_VERSION}); intent NOT submitted, nothing executed. Owner-approved policy bump required. [errorCode=configuration_missing]`,
    );
  }
  const op = resolveHostOperationAlias(rawOp);
  if (op === "host.deployment_verify") {
    return submitDeploymentVerify(input);
  }
  const effectiveRunId = input.runId ?? input.operatorRunId ?? process.env.PAPERCLIP_RUN_ID ?? null;
  if (!effectiveRunId) {
    throw new Error("host op requires a live run context: pass runId of your current heartbeat run (legacy operatorRunId alias; PAPERCLIP_RUN_ID is applied automatically in agent sessions) [errorCode=auth_failed]");
  }
  const terr = targetError(op, input.target);
  if (terr) throw new Error(terr);

  const requestId = input.requestId ?? randomUUID();
  const intent: Record<string, unknown> = {
    v: 1,
    requestId,
    agentId: input.agentId,
    issueId: input.issueId,
    operation: op,
    ...(rawOp !== op ? { requestedOperation: rawOp } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.service ? { service: input.service } : {}),
    ...(input.artifactDigest ? { artifactDigest: input.artifactDigest } : {}),
    ...(op === "logs" || op === "host.service_logs" || op === "host.container_logs" ? { tail: input.tail ?? 100 } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.digest ? { digest: input.digest } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.content ? { content: input.content } : {}),
    ...(input.contentSha ? { contentSha: input.contentSha } : {}),
    ...(input.expectedSha ? { expectedSha: input.expectedSha } : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.backupName ? { backupName: input.backupName } : {}),
    ...(input.migrationId ? { migrationId: input.migrationId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(effectiveRunId ? { runId: effectiveRunId } : {}),
    ...(input.operatorRunId && input.operatorRunId !== effectiveRunId ? { operatorRunId: input.operatorRunId } : {}),
  };
  const curDigest = payloadDigestForIntent(intent);

  await fs.mkdir(requestsDir(), { recursive: true });
  // Case 2/3: result already exists — replay or conflict, never re-execute.
  const existing = await readResult(requestId);
  if (existing !== null) {
    if (existing && typeof existing === "object") {
      const rec = existing as Record<string, unknown>;
      const stored = rec["payloadDigest"];
      if (typeof stored === "string" && stored.length === 64 && stored !== curDigest) {
        throw conflictError(requestId);
      }
      // Identical replay (or grandfathered pre-digest result): no re-execution,
      // ensure replayed:true like the supervisor stamp_replayed lane.
      if (rec["replayed"] !== true) return { requestId, result: { ...rec, replayed: true }, pending: false };
    }
    return { requestId, result: existing, pending: false };
  }
  // Case 4: request file exists but no result yet (pending) — same digest polls,
  // different digest conflicts without overwriting the pending intent.
  const pendingReq = await readRequest(requestId);
  if (pendingReq !== null) {
    const pendingDigest = payloadDigestForIntent(pendingReq);
    if (pendingDigest !== curDigest) throw conflictError(requestId);
    // Same intent already in flight: fall through to poll without rewriting.
  } else {
    // Atomic reservation: first writer wins (O_EXCL); race loser re-checks above.
    try {
      await fs.writeFile(join(requestsDir(), `${requestId}.json`), JSON.stringify(intent, null, 2), { flag: "wx", encoding: "utf8" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        const raced = await readRequest(requestId);
        if (raced !== null && payloadDigestForIntent(raced) !== curDigest) throw conflictError(requestId);
        // else same intent won the race: poll for its result.
      } else {
        throw err;
      }
    }
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const found = await readResult(requestId);
    if (found !== null) {
      // Race with supervisor conflict write: enforce conflict if digests differ.
      if (found && typeof found === "object") {
        const rec = found as Record<string, unknown>;
        const stored = rec["payloadDigest"];
        if (typeof stored === "string" && stored.length === 64 && stored !== curDigest) {
          throw conflictError(requestId);
        }
      }
      return { requestId, result: found, pending: false };
    }
    if (Date.now() >= deadline) return { requestId, result: null, pending: true };
    await sleep(POLL_INTERVAL_MS);
  }
}

export function capabilitiesDocument(): Record<string, unknown> {
  return {
    bridge: HOST_BRIDGE_TAG,
    policyVersion: HOST_BRIDGE_POLICY_VERSION,
    supervisorVersion: HOST_SUPERVISOR_VERSION,
    requestTtlSec: HOST_REQUEST_TTL_SEC,
    deployGate: { minFreeGib: 20, minFreePct: 10, deployNeedGib: 8 },
    // NOTE: host.migration.dry_run is NOT listed here: it has no supervisor
    // lane (see p1Expansion.failClosedNoLane) and fails closed. Readiness is
    // exactly readOperations; no entry may also appear in failClosedNoLane.
    readOperations: [...HOST_READ_OPERATIONS, ...HOST_ALIAS_OPERATIONS, ...HOST_P1_READ_OPERATIONS],
    mutatingOperations: [...HOST_MUT_OPERATIONS, ...HOST_P1_ALIAS_OPERATIONS, ...HOST_P1_NOLANE_OPERATIONS],
    inspectTargets: [...HOST_INSPECT_TARGETS],
    // v3.8 pins NO container-recreate target: an empty list means every deployment
    // plan fails closed until a CTO-owned supervisor policy bump provisions one.
    recreateTargets: [...HOST_RECREATE_TARGETS],
    restartTargets: [...HOST_RESTART_TARGETS],
    auth: {
      read: "owned non-terminal issue (UUID or KOMAA-xxx, same guards) + live run context (runId of your current heartbeat run; operatorRunId legacy alias; PAPERCLIP_RUN_ID session default)",
      mutating: "live run context required (runId; operatorRunId legacy alias; PAPERCLIP_RUN_ID session default) — verified server-side by the supervisor; an absent context fails with auth_failed",
      notes: "Supervisor re-validates everything host-side; the gateway Bearer is never a host credential. Expired intents (>900 s) fail closed. Replays never re-execute (ledger, replayed:true).",
    },
    idempotency: "Pass requestId (uuid) to retry safely; omit it to mint a new intent. Same requestId + same payload replays with replayed:true and never re-executes; same requestId + different payload fails closed with IDEMPOTENCY_CONFLICT (errorCode=idempotency_conflict, policyDecision=deny). On pending, re-call with the same requestId and same payload.",
    p1Expansion: {
      read: [...HOST_P1_READ_OPERATIONS],
      aliases: { "host.service_reload": "host.service.reload", "host.container_recreate": "host.container.recreate", "host.deployment_rollback": "mcp.rollback" },
      failClosedNoLane: [...HOST_P1_NOLANE_OPERATIONS],
      note: "Alias operations execute with the target operation's enforcement and auth. No-lane operations are schema-accepted but fail closed with configuration_missing (owner CTO) — never executed, never bypassed. host.deployment_verify is a read-only MCP-side verification (gateway health + artifact match), never a mutation.",
    },
    notCovered: {
      operations: ["host.database_*", "host.cron/*", "host.firewall/DNS/TLS write", "host.build_candidate (bare)"],
      reason: "No supervisor implementation in policy v3.8 (immutable for agents). Rejected fail-closed at the schema layer. v3.8 covers host.file.read/patch, host.container.recreate (empty allowlist until canary), host.service.reload (no handler pinned), host.backup.create/restore_to_staging (staging only), host.migration.apply (staging only).",
      bootstrap: "Owner-approved supervisor policy bump (new image version + POLICY.md revision + audit) is required before any of these can execute. Ask the owner; do not retry via another path.",
    },
    evidence: "Every result carries operationId/timestamp/target/status/result/durationMs/errorCode/policyDecision/evidenceReference (ledger:<requestId> log:watcher.log) plus additive payloadDigest (empty when unknown) and replayed flag on replays.",
  };
}

export interface HostToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeHostTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): HostToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        const value = await execute(parsed);
        return formatTextResponse(typeof value === "string" ? redactHostOutput(value) : value);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return formatErrorResponse(new Error(redactHostOutput(msg)));
      }
    },
  };
}

export function createHostTools(client?: PaperclipApiClient): HostToolDefinition[] {
  return [
    makeHostTool(
      "paperclipHostCapabilities",
      "Static allowlist of the host-operations bridge (policy v3.8, supervisor 1.0.16): allowed operations, targets, auth rules, deploy gate, idempotency, and what is NOT covered (fail-closed bootstrap list). No host call is made.",
      z.object({}),
      async () => capabilitiesDocument(),
    ),
    makeHostTool(
      "paperclipHostOperation",
      "Execute one allowlisted host-supervisor intent via the file bridge and read back its evidence envelope (operationId/timestamp/target/status/result/durationMs/errorCode/policyDecision/evidenceReference). Both reads and mutations need a live run context: pass runId of your current heartbeat run (legacy operatorRunId alias; PAPERCLIP_RUN_ID is applied automatically in agent sessions); the supervisor re-validates it host-side and an absent context fails with auth_failed. Same requestId + same payload replays with replayed:true and never re-executes; same requestId + different payload fails closed with IDEMPOTENCY_CONFLICT. P0-D: host.service_reload/container_recreate/deployment_rollback alias existing lanes; host.deployment_verify is read-only MCP-side verification; host.container_build/service_start/stop/restart/backup.verify/migration.dry_run/verify fail closed (configuration_missing, owner CTO) until a supervisor lane exists. Supervisor policy v3.8 mutations still require a host-verified operator run (owner-approved policy bump pending) — such refusals surface as auth_failed. Unsupported names are schema-rejected fail-closed — see paperclipHostCapabilities.",
      hostOperationSchema,
      async (input) => {
        // Deployment-root admission (KOMAA-1005): a host operation must belong to
        // a host-infrastructure task and to the service that task declared. A
        // product task may not run host operations, and a host task may not
        // write into a product repository checkout. Refused BEFORE the intent
        // is submitted, so nothing is executed.
        if (client) {
          await enforceHostServiceScope(client, {
            issueId: input.issueId,
            operation: input.operation,
            target: input.target ?? input.service ?? null,
            tool: "paperclipHostOperation",
          });
          if (input.path) {
            await enforceDeploymentRoot(client, {
              issueId: input.issueId,
              targetPath: input.path,
              workspacePath: input.path,
              tool: `paperclipHostOperation:${input.operation}`,
            });
          }
        }
        const handle = await submitHostIntent(input as HostOperationInput);
        if (handle.pending) {
          return {
            status: "pending",
            requestId: handle.requestId,
            note: "Supervisor has not answered within ~65 s (interval 10 s; mcp.test_candidate may take minutes). Re-call paperclipHostOperation with the SAME requestId (+ same auth context) to collect the result; it will never re-execute.",
          };
        }
        return handle.result;
      },
    ),
  ];
}

export const HOST_TOOL_NAMES: string[] = ["paperclipHostCapabilities", "paperclipHostOperation"];

// v3.8 supervisor mirror: RECREATE_TARGETS/RECREATE_IMAGES are empty, so no
// service may be container-recreated yet. Keep in sync with the CTO-owned
// supervisor policy bump (same pattern as HOST_INSPECT_TARGETS/HOST_RESTART_TARGETS).
export const HOST_RECREATE_TARGETS = [] as string[];

// Operations with a REAL supervisor lane: read ops + mutating ops, minus the
// schema-accepted-but-no-lane set (failClosedNoLane) which can never execute.
export function hostLaneOperations(): string[] {
  const noLane = new Set<string>(HOST_P1_NOLANE_OPERATIONS as readonly string[]);
  return [
    ...HOST_READ_OPERATIONS,
    ...HOST_ALIAS_OPERATIONS,
    ...HOST_P1_READ_OPERATIONS,
    ...HOST_MUT_OPERATIONS,
    ...HOST_P1_ALIAS_OPERATIONS,
  ].filter((op) => !noLane.has(op));
}
