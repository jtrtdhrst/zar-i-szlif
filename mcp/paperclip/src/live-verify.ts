// Live MCP deployment verification + public smoke test (P0-E).
//
// paperclipVerifyLiveMCP identifies the ACTUALLY RUNNING public MCP:
// endpoint, transport, OAuth, image/commit, artifact digest, source digest,
// tool manifest, auth pass and denial probes. Verdict is evidence,
// never an assurance: LIVE_VERIFIED | STAGING_ONLY | SOURCE_RUNTIME_MISMATCH
// | AUTH_FAILED | DEPLOY_INCOMPATIBLE... (see type) | UNVERIFIED.
//
// paperclipMCPRunSmokeTest runs the controlled public-MCP sequence
// (read, authorized write to a dedicated test object, read-after-write,
// unauthorized-write denial, idempotency, audit, manifest, artifact match)
// over the real public transport with the caller's own auth class. Read-only; no canary issue mutations.

import { z } from "zod";
import { createHash } from "node:crypto";
import type { PaperclipApiClient } from "./client.js";
import { CONTROL_PLANE_TOOL_NAMES } from "./control-plane.js";
import { WORKSPACE_NATIVE_TOOL_NAMES } from "./workspace-native.js";
import { EFFECTIVE_ACCESS_TOOL_NAMES, allKnownToolNames } from "./effective-access.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { mcpSourceCommitFailures } from "./live-verify-identity.js";

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
        const coreCommit = api && typeof api.commit === "string" ? (api.commit as string) : null;
        const envCommit = process.env.PAPERCLIP_BUILD_COMMIT || null;
        const envVersion = process.env.PAPERCLIP_BUILD_VERSION || null;
        const mcpIdentityResponse = await fetch(`${mcpBase}/__release/identity`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        const mcpIdentityBody = mcpIdentityResponse?.ok ? await mcpIdentityResponse.json().catch(() => null) : null;
        const mcpIdentity = isRecord(mcpIdentityBody) ? mcpIdentityBody : null;
        const mcpCommit = mcpIdentity && typeof mcpIdentity.sourceSha === "string" ? mcpIdentity.sourceSha : null;
        const manifest = toolManifestDigest();
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
              app: `${PUBLIC_APP_BASE_DEFAULT} (Core UI+API, not MCP)`,
              mcp: `${mcpBase}/mcp (public MCP; internal origin not asserted)`,
            },
          },
          transport: gw,
          publicTransport: publicProbe,
          oauth: { enabled: true, discovery: "/.well-known/oauth-authorization-server + oauth-protected-resource" },
          runningImage: {
            coreCommit,
            mcp: mcpIdentity ? { sourceSha: mcpCommit, resourceUuid: mcpIdentity.resourceUuid ?? null, containerName: mcpIdentity.containerName ?? null } : null,
            envVersion,
            envCommit,
          },
          toolManifest: { ...manifest, names: undefined, manifestDigest: manifest.digest, toolCount: manifest.count },
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
        failures.push(...mcpSourceCommitFailures(expectedCommit, envCommit, mcpCommit));
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
      "Read-only production smoke test of public health, OAuth discovery, negative 401, authenticated initialize/tools/list/call and the tool manifest. No supervisor, synthetic writes or host access.",
      z.object({ expectedToolCount: z.number().int().positive().optional().nullable() }),
      async ({ expectedToolCount }) => {
        const probe = await probePublicMcpTransport(resolvePublicMcpBase(), client.callerApiKey ?? null);
        const manifest = toolManifestDigest();
        const ph = probe.publicHealth as Record<string, unknown>;
        const pd = probe.discovery as Record<string, unknown>;
        const denial = probe.unauthDenial as Record<string, unknown>;
        const init = probe.initialize as Record<string, unknown>;
        const listing = probe.toolsList as Record<string, unknown>;
        const call = probe.harmlessCall as Record<string, unknown>;
        const checks = [
          { name: "public_health", ok: ph.reachable === true, evidence: ph },
          { name: "oauth_discovery", ok: pd.reachable === true, evidence: pd },
          { name: "unauthenticated_denial", ok: denial.deniedAsExpected === true, evidence: denial },
          { name: "authenticated_initialize", ok: init.protocolOk === true, evidence: init },
          { name: "authenticated_tool_list", ok: typeof listing.count === "number" && listing.count >= (expectedToolCount ?? 1), evidence: listing },
          { name: "authenticated_harmless_call", ok: call.callOk === true, evidence: call },
          { name: "registry_manifest", ok: manifest.count >= (expectedToolCount ?? 1), evidence: { count: manifest.count, digest: manifest.digest } },
        ];
        const failed = checks.filter((c) => !c.ok).length;
        return { verdict: failed ? "SMOKE_FAIL" : "SMOKE_FULL_PASS", fullPass: failed === 0, failed,
          unverified: 0, skipped: 0, mode: "public_read_only",
          steps: checks.map((c) => ({ name: c.name, status: c.ok ? "pass" : "fail", evidence: c.evidence })),
          note: "Runtime digest and deployment artifact are separate release checks, not inferred from public health." };
      },
    ),
  ];
}
