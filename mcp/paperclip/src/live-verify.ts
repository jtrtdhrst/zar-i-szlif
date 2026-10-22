// Live MCP deployment verification + public smoke test (P0-E).
//
// paperclipVerifyLiveMCP identifies the ACTUALLY RUNNING public MCP:
// endpoint, transport, OAuth, image/commit, artifact digest, source digest,
// tool manifest, bridge capabilities, supervisor/policy digests, deploy
// marker, auth pass + denial probes, rollback state. Verdict is evidence,
// never an assurance: LIVE_VERIFIED | STAGING_ONLY | SOURCE_RUNTIME_MISMATCH
// | AUTH_FAILED | DEPLOY_INCOMPATIBLE... (see type) | UNVERIFIED.
//
// paperclipMCPRunSmokeTest runs the controlled public-MCP sequence
// (read, authorized write to a dedicated test object, read-after-write,
// unauthorized-write denial, idempotency, audit, manifest, artifact match)
// over the real public transport with the caller's own auth class. Writes
// are dryRun/canary-only: nothing destructive, every step reports
// pass/fail/skip with evidence (no PASS without proof).

import { z } from "zod";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { PaperclipApiClient } from "./client.js";
import { CONTROL_PLANE_TOOL_NAMES } from "./control-plane.js";
import { HOST_TOOL_NAMES, capabilitiesDocument } from "./host-ops.js";
import { HOST_QUERY_TOOL_NAMES } from "./host-query.js";
import { WORKSPACE_NATIVE_TOOL_NAMES } from "./workspace-native.js";
import { EFFECTIVE_ACCESS_TOOL_NAMES, allKnownToolNames } from "./effective-access.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface LiveVerifyToolDefinition {
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
): LiveVerifyToolDefinition {
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

async function getJsonOrNull(client: PaperclipApiClient, path: string): Promise<unknown> {
  try {
    return await client.requestJson("GET", path);
  } catch {
    return null;
  }
}

function err(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

export const LIVE_VERIFY_TOOL_NAMES: string[] = [
  "paperclipVerifyLiveMCP",
  "paperclipMCPRunSmokeTest",
];

export function allLiveToolNames(): string[] {
  return [...new Set([...allKnownToolNames(), ...LIVE_VERIFY_TOOL_NAMES])];
}

function toolManifestDigest(): { count: number; digest: string; names: string[] } {
  const names = allLiveToolNames().sort();
  const digest = createHash("sha256").update(names.join("\n"), "utf8").digest("hex");
  return { count: names.length, digest, names };
}

async function gatewayHealth(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch("http://127.0.0.1:3101/health", { signal: AbortSignal.timeout(8000) });
    const body = (await r.json().catch(() => null)) as unknown;
    return { reachable: r.ok, status: r.status, body };
  } catch (e) {
    return { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Phase 1 (2026-10-19): VerifyLiveMCP must probe the ACTUAL configured public
// endpoint over the real public transport - never a hardcoded URL paired with
// loopback health. Tunnel routes (verified 2026-10-19):
//   https://paperclip.kompaszbiorek.pl      -> named tunnel rule 0 -> paperclip:3100 (Core app/UI+API, NOT MCP)
//   https://paperclip-mcp.kompaszbiorek.pl  -> named tunnel rule 1 -> paperclip:3101 -> socat fwd -> gateway:3101 (public MCP)
export const PUBLIC_APP_BASE_DEFAULT = "https://paperclip.kompaszbiorek.pl";
export const PUBLIC_MCP_BASE_DEFAULT = "https://paperclip-mcp.kompaszbiorek.pl";

export function resolvePublicMcpBase(): string {
  const env = (process.env.MCP_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return env || PUBLIC_MCP_BASE_DEFAULT;
}

export function parseMcpStreamBody(raw: string, contentType: string): unknown {
  if (!raw) return null;
  if (contentType.includes("text/event-stream")) {
    const frames = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((d) => d && d !== "[DONE]");
    const last = frames[frames.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last) as unknown;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export interface McpPublicProbe {
  base: string;
  publicHealth: Record<string, unknown>;
  discovery: Record<string, unknown>;
  unauthDenial: Record<string, unknown>;
  initialize: Record<string, unknown>;
  toolsList: Record<string, unknown>;
  harmlessCall: Record<string, unknown>;
  appDomain: Record<string, unknown>;
}

async function mcpPost(
  base: string,
  payload: unknown,
  callerKey: string | null,
  sessionId: string | null,
): Promise<{ ok: boolean; status: number; sessionId: string | null; wwwAuthenticate: string | null; body: unknown; rawSnippet: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (callerKey) headers["Authorization"] = `Bearer ${callerKey}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const r = await fetch(`${base.replace(/\/+$/, "")}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await r.text().catch(() => "");
  const body = parseMcpStreamBody(raw, r.headers.get("content-type") || "");
  return { ok: r.ok, status: r.status, sessionId: r.headers.get("mcp-session-id"), wwwAuthenticate: r.headers.get("www-authenticate"), body, rawSnippet: raw.slice(0, 200) };
}

function isMcpError(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as Record<string, unknown>).error);
}

// Real public-MCP protocol evidence with the CALLER's own credential class
// (callerKey is the caller's own Paperclip API key - gateways accept pcp_
// bearers on /mcp; no privilege change, read-only probes + one harmless
// read-only tools/call). Every step is best-effort: failures are recorded,
// never thrown, so a broken transport yields DEPLOY_INCOMPLETE, not a crash.
export async function probePublicMcpTransport(base: string, callerKey: string | null): Promise<McpPublicProbe> {
  const clean = base.replace(/\/+$/, "");
  const timed = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      return { ...(typeof fallback === "object" && fallback !== null ? (fallback as Record<string, unknown>) : {}), error: e instanceof Error ? e.message.slice(0, 300) : String(e) } as T;
    }
  };
  const publicHealth = await timed(async () => {
    const r = await fetch(`${clean}/health`, { signal: AbortSignal.timeout(8000) });
    return { reachable: r.ok, status: r.status, body: (await r.json().catch(() => null)) as unknown };
  }, { reachable: false, status: -1, body: null });
  const discovery = await timed(async () => {
    const r = await fetch(`${clean}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(8000) });
    return { reachable: r.ok, status: r.status, body: (await r.json().catch(() => null)) as unknown };
  }, { reachable: false, status: -1, body: null });
  const unauth = await timed(
    () => mcpPost(clean, { jsonrpc: "2.0", id: "verify-unauth", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-live", version: "1" } } }, null, null),
    { ok: false, status: -1, sessionId: null, wwwAuthenticate: null, body: null, rawSnippet: "" },
  );
  const unauthDenial = {
    attempted: true,
    status: unauth.status,
    deniedAsExpected: unauth.status === 401 && isMcpError(unauth.body),
    wwwAuthenticate: (unauth.wwwAuthenticate ?? "").slice(0, 200),
  };
  let initialize: Record<string, unknown> = { attempted: false };
  let sessionId: string | null = null;
  if (callerKey) {
    const init = await timed(
      () => mcpPost(clean, { jsonrpc: "2.0", id: "verify-init", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-live", version: "1" } } }, callerKey, null),
      { ok: false, status: -1, sessionId: null, wwwAuthenticate: null, body: null, rawSnippet: "" },
    );
    sessionId = init.sessionId;
    const initBody = init.body as Record<string, unknown> | null;
    const serverInfo = initBody && typeof initBody === "object" && (initBody as Record<string, unknown>).result
      ? ((initBody as Record<string, unknown>).result as Record<string, unknown>)
      : null;
    initialize = {
      attempted: true,
      status: init.status,
      protocolOk: init.ok && !isMcpError(init.body) && Boolean(serverInfo && (serverInfo as Record<string, unknown>).serverInfo),
      serverInfo: serverInfo ? (serverInfo as Record<string, unknown>).serverInfo ?? null : null,
      sessionBound: init.sessionId !== null,
    };
    // Spec handshake: notifications/initialized before tools/list (best-effort).
    await timed(
      () => mcpPost(clean, { jsonrpc: "2.0", method: "notifications/initialized" }, callerKey, sessionId),
      { ok: false, status: -1, sessionId: null, wwwAuthenticate: null, body: null, rawSnippet: "" },
    );
  } else {
    initialize = { attempted: false, reason: "no caller credential visible to tool runtime" };
  }
  let toolsList: Record<string, unknown> = { attempted: false };
  if (callerKey && (initialize as Record<string, unknown>).protocolOk) {
    const tl = await timed(
      () => mcpPost(clean, { jsonrpc: "2.0", id: "verify-tools", method: "tools/list", params: {} }, callerKey, sessionId),
      { ok: false, status: -1, sessionId: null, wwwAuthenticate: null, body: null, rawSnippet: "" },
    );
    const tlBody = tl.body as Record<string, unknown> | null;
    const tools = tlBody && typeof tlBody === "object" && (tlBody as Record<string, unknown>).result
      ? (((tlBody as Record<string, unknown>).result as Record<string, unknown>).tools as unknown[])
      : null;
    // NOTE: the raw tools/list body (200 full tool schemas, ~500KB) is
    // intentionally NOT embedded - count + canary presence is the evidence.
    toolsList = { attempted: true, status: tl.status, count: Array.isArray(tools) ? tools.length : null, hasVerifyTool: Array.isArray(tools) ? tools.some((t) => (t as Record<string, unknown>).name === "paperclipVerifyLiveMCP") : false };
  } else {
    toolsList = { attempted: false, reason: "initialize did not complete" };
  }
  let harmlessCall: Record<string, unknown> = { attempted: false };
  if (callerKey && (toolsList as Record<string, unknown>).count) {
    const hc = await timed(
      () => mcpPost(clean, { jsonrpc: "2.0", id: "verify-call", method: "tools/call", params: { name: "paperclipGetServerInfo", arguments: {} } }, callerKey, sessionId),
      { ok: false, status: -1, sessionId: null, wwwAuthenticate: null, body: null, rawSnippet: "" },
    );
    const hcBody = hc.body as Record<string, unknown> | null;
    harmlessCall = { attempted: true, status: hc.status, callOk: hc.ok && !isMcpError(hc.body), bodySnippet: JSON.stringify(hcBody ?? null).slice(0, 500) };
  } else {
    harmlessCall = { attempted: false, reason: "tools/list did not complete" };
  }
  // App domain, documented separately so nobody confuses Core UI with MCP.
  const appDomain = await timed(async () => {
    const r = await fetch(`${PUBLIC_APP_BASE_DEFAULT}/api/health`, { signal: AbortSignal.timeout(8000) });
    return { reachable: r.ok, status: r.status, serves: "core-app", body: (await r.json().catch(() => null)) as unknown };
  }, { reachable: false, status: -1, serves: "core-app", body: null });
  return { base: clean, publicHealth, discovery, unauthDenial, initialize, toolsList, harmlessCall, appDomain };
}

async function policyMirror(): Promise<Record<string, unknown>> {
  try {
    const [policy, sums] = await Promise.all([
      fs.readFile("/paperclip/vps-ops/policy/POLICY.md", "utf8").catch(() => ""),
      fs.readFile("/paperclip/vps-ops/policy/SHA256SUMS", "utf8").catch(() => ""),
    ]);
    const firstLine = policy.split("\n")[0] ?? "";
    const version = /policy\s+(v[\d.]+)/i.exec(firstLine + "\n" + policy.slice(0, 2000))?.[1]
      ?? /v3\.\d+/.exec(policy.slice(0, 2000))?.[0] ?? "unknown";
    const supervisor = /supervisor\s+([\d.]+)/i.exec(policy.slice(0, 2000))?.[1] ?? "unknown";
    return { present: policy.length > 0, policyVersion: version, supervisorVersion: supervisor, sha256sumsLines: sums.split("\n").filter(Boolean).length };
  } catch (e) {
    return { present: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// BUG-01 fix: internal `pending` is NEVER a pass. Terminal classification only.
// - terminal success (succeeded/planned-only/dryRun report, no errorCode) -> "pass"
// - terminal denial/failure when success was expected -> "fail"
// - pending/timeout/missing evidence -> "unverified"
export function classifySmokeOutcome(resultText: string): "pass" | "fail" | "unverified" {
  const t = resultText;
  // A literal `"errorCode": null` is success metadata, not a denial: only a
  // non-null errorCode value (or explicit denial tokens) means failure.
  const hasErrorCode = /"errorcode"\s*:\s*"(?![Nn][Uu][Ll][Ll]")[^"]+"/i.test(t);
  if (/auth_failed|permission_denied|not_allowlisted|run_context_required|idempotency_conflict|version_conflict/i.test(t) || hasErrorCode) return "fail";
  if (/"ok"\s*:\s*false/i.test(t)) return "fail";
  if (/planned-only/i.test(t)) return "pass";
  if (/"(status|state)"\s*:\s*"(succeeded|ok)"/i.test(t)) return "pass";
  return "unverified";
}

export function commentCanarySkipReason(
  issueStatus: unknown,
  hasLiveExecution: boolean,
  requestIdProvided: boolean,
): string | null {
  if (requestIdProvided) return "requestId replay suppresses comment writes; use a fresh smoke invocation";
  if (issueStatus !== "backlog") return "comment canary is restricted to backlog test issues; terminal or active issues are never reopened";
  if (hasLiveExecution) return "issue already has a live execution; comment canary would be unsafe";
  return null;
}

export function createLiveVerifyTools(client: PaperclipApiClient): LiveVerifyToolDefinition[] {
  return [
    makeTool(
      "paperclipVerifyLiveMCP",
      "Identify the ACTUALLY RUNNING public MCP over the real public transport: configured endpoint (MCP_PUBLIC_BASE_URL or paperclip-mcp.kompaszbiorek.pl), public /health, OAuth discovery, unauthenticated MCP denial (401), authenticated initialize + tools/list + harmless tools/call with the caller's own credential class, running image + commit, artifact digest, tool manifest, bridge capabilities, supervisor + policy digests, deploy marker, auth-pass + auth-denial probes, rollback state. LIVE_VERIFIED requires live public MCP protocol evidence - never /health alone. Verdict: LIVE_VERIFIED | STAGING_ONLY | SOURCE_RUNTIME_MISMATCH | AUTH_FAILED | DEPLOY_INCOMPLETE | ROLLBACK_REQUIRED | UNVERIFIED - always with concrete evidence.",
      z.object({
        expectedCommit: z.string().min(1).max(128).optional().nullable(),
        expectedToolCount: z.number().int().positive().optional().nullable(),
      }),
      async ({ expectedCommit, expectedToolCount }) => {
        const companyId = client.resolveCompanyId();
        const gw = await gatewayHealth();
        const mcpBase = resolvePublicMcpBase();
        const publicProbe = await probePublicMcpTransport(mcpBase, client.callerApiKey ?? null);
        const apiHealth = await getJsonOrNull(client, "/health");
        const api = isRecord(apiHealth) ? apiHealth : null;
        const runningCommit = api && typeof api.commit === "string" ? (api.commit as string) : null;
        const envCommit = process.env.PAPERCLIP_BUILD_COMMIT || null;
        const envVersion = process.env.PAPERCLIP_BUILD_VERSION || null;
        const manifest = toolManifestDigest();
        const caps = capabilitiesDocument() as Record<string, unknown>;
        const mirror = await policyMirror();
        // Auth pass: caller token must read its own company.
        let authPass: Record<string, unknown> = { ok: false };
        try {
          const me = await client.requestJson("GET", `/companies/${companyId}`);
          authPass = { ok: true, companyId: isRecord(me) ? ((me as Record<string, unknown>).id ?? companyId) : companyId };
        } catch (e) {
          authPass = { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
        }
        // Auth denial: an invalid bearer must NOT read the company (direct fetch).
        let authDenial: Record<string, unknown> = { ok: false };
        try {
          const base = process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api";
          const r = await fetch(`${base.replace(/\/+$/, "")}/companies/${companyId}`, {
            headers: { Authorization: "Bearer invalid-token-probe-000000000000", Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          authDenial = { ok: !r.ok, status: r.status, denied: !r.ok };
        } catch (e) {
          authDenial = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        // Rollback state: candidates dir + blocklist hint from capabilities-side ledger is
        // supervisor-/state-local; report what is visible from the MCP host.
        const evidence = {
          endpoint: {
            configured: process.env.MCP_PUBLIC_BASE_URL || null,
            effectiveMcpBase: mcpBase,
            appDomain: PUBLIC_APP_BASE_DEFAULT,
            routes: {
              app: `${PUBLIC_APP_BASE_DEFAULT} -> named tunnel rule 0 -> paperclip:3100 (Core UI+API, NOT MCP)`,
              mcp: `${mcpBase} -> named tunnel rule 1 -> paperclip:3101 -> socat fwd -> gateway:3101 (public MCP)`,
            },
          },
          transport: gw,
          publicTransport: publicProbe,
          oauth: { enabled: true, discovery: "/.well-known/oauth-authorization-server + oauth-protected-resource" },
          runningImage: { commit: runningCommit, version: api && typeof api.status === "string" ? (api as Record<string, unknown>).commit ?? null : runningCommit, envVersion, envCommit },
          toolManifest: { ...manifest, names: undefined, manifestDigest: manifest.digest, toolCount: manifest.count },
          bridgeManifest: { bridge: caps.bridge, policyVersion: caps.policyVersion, supervisorVersion: caps.supervisorVersion },
          policyMirror: mirror,
          authPass,
          authDenial,
        };
        const failures: string[] = [];
        if (!gw.reachable) failures.push("gateway loopback unreachable");
        const ph = publicProbe.publicHealth as Record<string, unknown>;
        const ud = publicProbe.unauthDenial as Record<string, unknown>;
        const pi = publicProbe.initialize as Record<string, unknown>;
        const pt = publicProbe.toolsList as Record<string, unknown>;
        const pc = publicProbe.harmlessCall as Record<string, unknown>;
        if (!ph.reachable) failures.push(`public MCP transport unreachable: GET ${mcpBase}/health failed`);
        else if (!ud.deniedAsExpected) failures.push(`public MCP denial broken: unauthenticated POST ${mcpBase}/mcp did not return 401 Unauthorized (status=${String(ud.status)})`);
        if (pi.attempted === false) failures.push("public MCP authenticated initialize not attempted: no caller credential visible to tool runtime");
        else if (!pi.protocolOk) failures.push(`public MCP protocol failed: authenticated initialize over ${mcpBase}/mcp did not complete (status=${String(pi.status)})`);
        else if (!(pt.count as number)) failures.push(`public MCP tools/list failed over ${mcpBase}/mcp (status=${String(pt.status)})`);
        else if (!pc.callOk) failures.push(`public MCP harmless tools/call failed over ${mcpBase}/mcp (status=${String(pc.status)})`);
        if (!authPass.ok) failures.push("auth pass probe failed");
        if (!authDenial.ok) failures.push("auth denial probe failed (invalid bearer accepted or probe error)");
        if (expectedCommit && runningCommit && expectedCommit !== runningCommit) failures.push(`commit mismatch: expected ${expectedCommit}, running ${runningCommit}`);
        if (envCommit && runningCommit && envCommit !== runningCommit) failures.push(`source/runtime mismatch: env ${envCommit} vs running ${runningCommit}`);
        if (expectedToolCount && manifest.count < expectedToolCount) failures.push(`tool manifest short: ${manifest.count} < expected ${expectedToolCount}`);
        let verdict: string;
        if (!authPass.ok) verdict = "AUTH_FAILED";
        else if (failures.some((f) => f.startsWith("source/runtime") || f.startsWith("commit mismatch"))) verdict = "SOURCE_RUNTIME_MISMATCH";
        else if (failures.length > 0) verdict = "DEPLOY_INCOMPLETE";
        else verdict = "LIVE_VERIFIED";
        return { verdict, failures, evidence, note: "No SHA is compared mechanically across unrelated components; the commit/manifest/policy relations above are the release-manifest evidence." };
      },
    ),
    makeTool(
      "paperclipMCPRunSmokeTest",
      "Controlled public-MCP smoke sequence over the real transport with the caller's auth class. A comment canary runs only on an idle backlog issue with no caller-supplied requestId; terminal/active issues and requestId replays skip it. The canary disables reopen/resume/interrupt and verifies status is unchanged after cleanup. Other steps cover read, unauthorized-write denial, idempotency, audit, manifest, and artifact match.",
      z.object({
        workspaceId: z.string().uuid().optional().nullable(),
        issueId: z.string().min(1).optional().nullable(),
        agentId: z.string().uuid().optional().nullable(),
        operatorRunId: z.string().uuid().optional().nullable(),
        requestId: z.string().uuid().optional().nullable(),
        timeoutSec: z.number().int().min(5).max(300).optional().default(90),
        expectedToolCount: z.number().int().positive().optional().nullable(),
      }),
      async ({ workspaceId, issueId, agentId, operatorRunId, requestId, timeoutSec, expectedToolCount }) => {
        type Step = { name: string; status: "pass" | "fail" | "skip" | "unverified"; evidence: unknown };
        const steps: Step[] = [];
        const { randomUUID } = await import("node:crypto");
        const smokeId: string = requestId ?? randomUUID();
        const deadline = Date.now() + (timeoutSec ?? 90) * 1000;
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        async function readHostOp(rid: string): Promise<string | null> {
          try {
            const { createHostQueryTools } = await import("./host-query.js");
            const get = createHostQueryTools().find((t) => t.name === "paperclipHostGetOperation");
            if (!get) return null;
            const out = await get.execute({ requestId: rid });
            return out.content[0]?.text ?? null;
          } catch {
            return null;
          }
        }
        // 1. read
        try {
          const h = await getJsonOrNull(client, "/health");
          steps.push({ name: "read", status: isRecord(h) ? "pass" : "fail", evidence: h });
        } catch (e) {
          steps.push({ name: "read", status: "fail", evidence: e instanceof Error ? e.message : String(e) });
        }
        // 2. authorized dryRun write (host rollback dryRun is report-only per policy v3.5+;
        // needs full host context, otherwise honestly skipped). BUG-01 FIX: the
        // intent is submitted once under smokeId, then POLLED to a terminal
        // state. pending at the deadline -> UNVERIFIED (never PASS); terminal
        // denial when success was expected -> FAIL.
        let dryRunTerminal: string | null = null;
        // Without a live host context, a comment canary is restricted to an
        // idle backlog issue and cannot be replayed with a supplied requestId.
        let canary: { issueId: string; marker: string; commentId: string | null; originalStatus: string } | null = null;
        if (agentId && issueId && operatorRunId) {
          try {
            const { createHostTools } = await import("./host-ops.js");
            const op = createHostTools().find((t) => t.name === "paperclipHostOperation");
            if (!op) throw new Error("paperclipHostOperation not registered");
            const out = await op.execute({ operation: "mcp.rollback", dryRun: true, reason: "smoke probe", requestId: smokeId, agentId, issueId, operatorRunId });
            let text = out.content[0]?.text ?? "";
            if (/\bpending\b/i.test(text) && !/errorcode/i.test(text)) {
              // Poll the EXISTING request (never re-submit) until terminal or timeout.
              for (;;) {
                if (Date.now() >= deadline) break;
                await sleep(3000);
                const reread = await readHostOp(smokeId);
                if (reread === null) break;
                text = reread;
                if (!/\bpending\b/i.test(text) || /errorcode|succeeded|failed|planned-only/i.test(text)) break;
              }
            }
            dryRunTerminal = text;
            const verdict = classifySmokeOutcome(text);
            const hasEvidence = text.length > 20 && (/replayed|planned-only|operationid|evidenceReference/i.test(text) || verdict === "fail");
            steps.push({
              name: "authorized_write_dryrun",
              status: verdict === "pass" ? "pass" : verdict === "fail" ? "fail" : "unverified",
              evidence: { requestId: smokeId, terminal: verdict !== "unverified", classification: verdict, evidencePresent: hasEvidence, text: text.slice(0, 800) },
            });
          } catch (e) {
            steps.push({ name: "authorized_write_dryrun", status: "fail", evidence: { requestId: smokeId, error: e instanceof Error ? e.message.slice(0, 500) : String(e) } });
          }
        } else if (issueId) {
          const issue = requestId ? null : await getJsonOrNull(client, `/issues/${enc(issueId)}`);
          const status = isRecord(issue) && typeof issue.status === "string" ? issue.status : null;
          const hasLiveExecution = Boolean(isRecord(issue) && (issue.executionRunId || issue.checkoutRunId));
          const skipReason = commentCanarySkipReason(status, hasLiveExecution, Boolean(requestId));
          if (skipReason) {
            steps.push({ name: "authorized_write_dryrun", status: "skip", evidence: { mode: "comment-canary", issueId, reason: skipReason } });
          } else {
            const marker = `[mcp-smoke ${smokeId}] authorized write canary — safe to delete`;
            try {
              await client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/comments`, {
                body: { body: marker, interrupt: false, reopen: false, resume: false },
              });
              canary = { issueId, marker, commentId: null, originalStatus: status! };
              steps.push({ name: "authorized_write_dryrun", status: "pass", evidence: { mode: "comment-canary", issueId, marker } });
            } catch (e) {
              steps.push({ name: "authorized_write_dryrun", status: "fail", evidence: { mode: "comment-canary", issueId, error: e instanceof Error ? e.message.slice(0, 500) : String(e) } });
            }
          }
        } else {
          steps.push({ name: "authorized_write_dryrun", status: "skip", evidence: "needs issueId (comment canary) or agentId+issueId+operatorRunId (host dryRun); pass one to exercise an authorized disposable write" });
        }
        // 3. read-after-write: re-read the SAME requestId (must NOT re-execute).
        // PASS requires a terminal replayed result identical to step 2 — not
        // mere record existence. pending -> UNVERIFIED (SMOKE-02/05).
        if (agentId && issueId && operatorRunId && dryRunTerminal !== null) {
          try {
            const text = (await readHostOp(smokeId)) ?? "";
            const replayed = /replayed/.test(text);
            const terminal = !/\bpending\b/i.test(text) || /succeeded|failed|planned-only|errorcode/i.test(text);
            const sameOutcome = classifySmokeOutcome(text) === classifySmokeOutcome(dryRunTerminal);
            const ok = replayed && terminal && sameOutcome && text.length > 20;
            steps.push({
              name: "read_after_write",
              status: !terminal ? "unverified" : ok ? "pass" : "fail",
              evidence: { requestId: smokeId, replayed, terminal, sameOutcome, text: text.slice(0, 800) },
            });
          } catch (e) {
            steps.push({ name: "read_after_write", status: "fail", evidence: e instanceof Error ? e.message.slice(0, 500) : String(e) });
          }
        } else if (canary) {
          const c = canary;
          try {
            const listed = await client.requestJson<Record<string, unknown>>("GET", `/issues/${encodeURIComponent(c.issueId)}/comments?limit=50`);
            const items: Array<Record<string, unknown>> = Array.isArray((listed as { comments?: unknown }).comments)
              ? ((listed as { comments: Array<Record<string, unknown>> }).comments)
              : Array.isArray(listed)
                ? (listed as unknown as Array<Record<string, unknown>>)
                : [];
            const hit = items.find((item) => JSON.stringify(item?.body ?? "").includes(c.marker));
            const commentId = hit && typeof hit.id === "string" ? hit.id : null;
            let cleanedUp = false;
            let deleteError: string | null = null;
            if (commentId) {
              try {
                await client.requestJson("DELETE", `/issues/${encodeURIComponent(c.issueId)}/comments/${encodeURIComponent(commentId)}`);
                cleanedUp = true;
              } catch (e) {
                deleteError = e instanceof Error ? e.message.slice(0, 300) : String(e);
              }
            }
            const afterIssue = await getJsonOrNull(client, `/issues/${encodeURIComponent(c.issueId)}`);
            const statusUnchanged = isRecord(afterIssue) && afterIssue.status === c.originalStatus;
            c.commentId = commentId;
            steps.push({
              name: "read_after_write",
              status: commentId && cleanedUp && statusUnchanged ? "pass" : "fail",
              evidence: { mode: "comment-canary", found: Boolean(commentId), commentId, cleanedUp, statusUnchanged, deleteError },
            });
          } catch (e) {
            steps.push({ name: "read_after_write", status: "fail", evidence: { mode: "comment-canary", error: e instanceof Error ? e.message.slice(0, 500) : String(e) } });
          }
        } else if (dryRunTerminal === null) {
          steps.push({ name: "read_after_write", status: "skip", evidence: "same context as step 2 required" });
        } else {
          steps.push({ name: "read_after_write", status: "unverified", evidence: { requestId: smokeId, reason: "step 2 produced no terminal result to read back" } });
        }
        // 4. unauthorized-write denial: mutating host op WITHOUT operatorRunId must fail closed.
        // PASS requires a proper, justified denial (errorCode + remediation owner), SMOKE-07.
        try {
          const { createHostTools } = await import("./host-ops.js");
          const op = createHostTools().find((t) => t.name === "paperclipHostOperation");
          if (!op) throw new Error("paperclipHostOperation not registered");
          const out = await op.execute({ operation: "mcp.rollback", agentId: "22222222-2222-2222-2222-222222222222", issueId: "KOMAA-000" });
          const text = out.content[0]?.text ?? "";
          const proper = /auth_failed|run_context_required|permission_denied|capability_removed/i.test(text) && /remediationowner|requiredaction|safehint/i.test(text);
          steps.push({ name: "unauthorized_write_denied", status: proper ? "pass" : "fail", evidence: text.slice(0, 500) });
        } catch (e) {
          steps.push({ name: "unauthorized_write_denied", status: "fail", evidence: e instanceof Error ? e.message.slice(0, 500) : String(e) });
        }
        // 5. idempotency: digest determinism (pure) + same requestId never
        // re-executes (SMOKE-08) + same requestId with a DIFFERENT payload
        // fails closed with IDEMPOTENCY_CONFLICT (SMOKE-09).
        try {
          const { payloadDigestForIntent } = await import("./host-ops.js");
          const a = payloadDigestForIntent({ operation: "ps", target: "paperclip" });
          const b = payloadDigestForIntent({ target: "paperclip", operation: "ps" });
          const c = payloadDigestForIntent({ operation: "ps", target: "paperclip-db" });
          const pure = a === b && a !== c;
          let replay: boolean | null = null;
          let conflict: boolean | null = null;
          let contextNote: string | null = null;
          if (agentId && issueId && operatorRunId) {
            // Same requestId + same payload must replay (read-only check).
            const reread = await readHostOp(smokeId);
            replay = reread !== null && /replayed|pending|planned-only|succeeded|failed|errorcode/i.test(reread);
            // Same requestId + different payload must conflict WITHOUT executing.
            try {
              const { createHostTools } = await import("./host-ops.js");
              const op = createHostTools().find((t) => t.name === "paperclipHostOperation");
              if (!op) throw new Error("paperclipHostOperation not registered");
              const out = await op.execute({ operation: "ps", target: "paperclip-db", reason: "smoke conflict probe", requestId: smokeId, agentId, issueId, operatorRunId });
              const text = out.content[0]?.text ?? "";
              conflict = /idempotency_conflict/i.test(text);
            } catch (e) {
              conflict = /idempotency_conflict/i.test(e instanceof Error ? e.message : String(e));
            }
          } else if (issueId) {
            // P0 2026-10-17: live session-level idempotency through the
            // workspace-exec operationId lane (works with a board key or the
            // caller's own live run): same operationId + same argv replays;
            // same operationId + changed argv conflicts without re-executing.
            try {
              const { createWorkspaceNativeTools } = await import("./workspace-native.js");
              const exec = createWorkspaceNativeTools(client).find((t) => t.name === "paperclipWorkspaceExec");
              if (!exec) throw new Error("paperclipWorkspaceExec not registered");
              const argvSame = ["node", "-e", `console.log("mcp-smoke idempotency ${smokeId}")`];
              const argvChanged = ["node", "-e", `console.log("mcp-smoke changed payload ${smokeId}")`];
              const firstOut = await exec.execute({ issueId, argv: argvSame, operationId: smokeId });
              const firstText = firstOut.content[0]?.text ?? "";
              if (/errorCode/.test(firstText)) {
                contextNote = `workspace exec idempotency probe unavailable: ${firstText.slice(0, 300)}`;
              } else {
                const replayOut = await exec.execute({ issueId, argv: argvSame, operationId: smokeId });
                const replayText = replayOut.content[0]?.text ?? "";
                replay = /"replayed": true/.test(replayText);
                const conflictOut = await exec.execute({ issueId, argv: argvChanged, operationId: smokeId });
                const conflictText = conflictOut.content[0]?.text ?? "";
                conflict = /idempotency_conflict/i.test(conflictText);
              }
            } catch (e) {
              contextNote = e instanceof Error ? e.message.slice(0, 300) : String(e);
            }
          }
          // Without a live execution context only the pure digest determinism is
          // provable — report UNVERIFIED, never a vacuous PASS (MCP-REG-040).
          const idempotencyContextAvailable = Boolean((agentId && issueId && operatorRunId) || replay !== null);
          const ok = pure && replay === true && conflict === true;
          steps.push({
            name: "idempotency",
            status: idempotencyContextAvailable ? (ok ? "pass" : "fail") : "unverified",
            evidence: {
              orderInsensitive: a === b,
              payloadSensitive: a !== c,
              replayWithoutReexecution: replay,
              conflictOnChangedPayload: conflict,
              note: contextNote ?? (idempotencyContextAvailable ? "workspace-exec operationId lane: same request replays, changed payload conflicts" : "digest determinism verified; replay/conflict need issueId (workspace exec lane) or a live operator context"),
            },
          });
        } catch (e) {
          steps.push({ name: "idempotency", status: "fail", evidence: e instanceof Error ? e.message : String(e) });
        }
        // 6. audit: company activity reachable.
        try {
          const companyId = client.resolveCompanyId();
          const act = await getJsonOrNull(client, `/companies/${companyId}/activity?limit=5`);
          steps.push({ name: "audit", status: act !== null ? "pass" : "fail", evidence: act !== null ? "activity stream reachable" : "activity stream unreachable" });
        } catch (e) {
          steps.push({ name: "audit", status: "fail", evidence: e instanceof Error ? e.message : String(e) });
        }
        // 7. manifest.
        const manifest = toolManifestDigest();
        const want = expectedToolCount ?? 150;
        steps.push({ name: "manifest", status: manifest.count >= want ? "pass" : "fail", evidence: { toolCount: manifest.count, digest: manifest.digest, expected: want } });
        // 8. artifact match.
        try {
          const h = await getJsonOrNull(client, "/health");
          const runningCommit = isRecord(h) && typeof h.commit === "string" ? (h.commit as string) : null;
          const envCommit = process.env.PAPERCLIP_BUILD_COMMIT || null;
          const match = Boolean(runningCommit && envCommit && runningCommit === envCommit);
          steps.push({ name: "artifact", status: match ? "pass" : "fail", evidence: { runningCommit, envCommit } });
        } catch (e) {
          steps.push({ name: "artifact", status: "fail", evidence: e instanceof Error ? e.message : String(e) });
        }
        void workspaceId;
        const failed = steps.filter((s) => s.status === "fail").length;
        const unverified = steps.filter((s) => s.status === "unverified").length;
        const skipped = steps.filter((s) => s.status === "skip").length;
        // Strict verdicts (KOMAA-797 audit): a skipped REQUIRED step is never a PASS.
        const verdict = failed > 0 ? "SMOKE_FAIL" : unverified > 0 ? "SMOKE_UNVERIFIED" : skipped > 0 ? "SMOKE_PARTIAL_PASS" : "SMOKE_FULL_PASS";
        return {
          verdict,
          fullPass: verdict === "SMOKE_FULL_PASS",
          failed,
          unverified,
          skipped,
          requestId: smokeId,
          steps,
          resume: "Reusing requestId suppresses comment-canary writes; host dry-run replay is idempotent via the supervisor requestId ledger.",
        };
      },
    ),
  ];
}
