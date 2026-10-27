import { fetchAgentMe as fetchAgentMeWithRetry } from "./identity-retry.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { z } from "/app/packages/mcp-server/node_modules/zod/index.js";
import { StreamableHTTPServerTransport } from "/app/packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";
import { createPaperclipMcpServer } from "/paperclip/mcp-patch/src/index.ts";
import { allLiveToolNames } from "/paperclip/mcp-patch/src/live-verify.ts";
import { profileToolNames } from "/paperclip/mcp-patch/src/execution-broker.ts";
import { resolvePrincipal, describePrincipal, jwtRunId, isVerifiedOwnerBoardGrant } from "./principal.mjs";
import { createOriginResolver } from "./public-origin.mjs";
import { getReleaseIdentity } from "./release-identity.mjs";
import { loadSkills } from "./skills.mjs";

const HOST = process.env.MCP_HOST || "0.0.0.0";
const PORT = Number(process.env.MCP_PORT || 3101);
const API_URL = (process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api").replace(/\/+$/, "");
const PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
// One gateway, several public hostnames (canonical + alias). OAuth metadata
// must be self-consistent per host; only listed origins may override the
// canonical origin, so a spoofed Host/X-Forwarded-Host cannot rewrite it.
const ORIGIN_RESOLVER = createOriginResolver({
  publicBaseUrl: PUBLIC_BASE_URL,
  publicOrigins: process.env.MCP_PUBLIC_ORIGINS || "",
});

// KOMAA-1415: the llm-wiki plugin is Board-gated in Paperclip 2026.1012.0. The
// gateway projects its own enrolled Board credential ONLY for these exact
// agent ids and ONLY for the wiki plugin data/actions routes (enforced again
// in client.ts). The credential never leaves this process.
const WIKI_BOARD_AGENT_IDS = new Set(
  (process.env.PAPERCLIP_MCP_WIKI_BOARD_AGENT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

// --- Minimal OAuth 2.1 + MCP Protected Resource layer for Claude Web custom connectors ---
// Claude.ai supports only OAuth (CIMD/DCR), not static Bearer. This bridge issues
// short-lived OAuth access tokens bound to a Paperclip API key (pcp_...).
const OAUTH_ACCESS_TTL_SEC = Number(process.env.OAUTH_ACCESS_TTL_SEC || 3600);
const OAUTH_REFRESH_TTL_SEC = Number(process.env.OAUTH_REFRESH_TTL_SEC || 30 * 24 * 3600);
const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const oauthClients = new Map(); // client_id -> { client_secret, redirect_uris }
const oauthCodes = new Map(); // code -> { clientId, redirectUri, challenge, method, paperclipToken, scope, resource, expiresAt }
const oauthAccess = new Map(); // access_token -> { paperclipToken, scope, clientId, expiresAt }
const oauthRefresh = new Map(); // refresh_token -> { paperclipToken, scope, clientId, expiresAt }
const OAUTH_STORE_PATH = "/paperclip/mcp-gateway/oauth-store.json";
function saveOAuthStore() {
  try {
    const now = Date.now();
    const live = (m) => [...m.entries()].filter(([, v]) => !v.expiresAt || v.expiresAt > now);
    writeFileSync(OAUTH_STORE_PATH, JSON.stringify({ clients: live(oauthClients), access: live(oauthAccess), refresh: live(oauthRefresh) }), { mode: 0o600 });
  } catch {}
}
(function loadOAuthStore() {
  try {
    const j = JSON.parse(readFileSync(OAUTH_STORE_PATH, "utf8"));
    for (const [k, v] of j.clients || []) oauthClients.set(k, v);
    for (const [k, v] of j.access || []) oauthAccess.set(k, v);
    for (const [k, v] of j.refresh || []) oauthRefresh.set(k, v);
    // Legacy entries predate audience binding: backfill with the canonical
    // audience so they survive a restart without breaking live clients.
    const legacyAudience = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/mcp` : null;
    if (legacyAudience) {
      for (const [, v] of oauthAccess) if (v && !v.audience) v.audience = legacyAudience;
      for (const [, v] of oauthRefresh) if (v && !v.audience) v.audience = legacyAudience;
    }
  } catch {}
})();

const URL_TOKENS_PATH = "/paperclip/mcp-gateway/url-tokens.json";
let urlTokens = {};
try { urlTokens = JSON.parse(readFileSync(URL_TOKENS_PATH, "utf8")); } catch {}
function urlTokenFromRequest(req, url) {
  const q = url.searchParams.get("token");
  if (q && Object.hasOwn(urlTokens, q)) return q;
  const m = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]{16,})$/);
  if (m && Object.hasOwn(urlTokens, m[1])) return m[1];
  return null;
}

function publicBaseUrl(req) {
  const origin = ORIGIN_RESOLVER.resolve(req);
  if (origin) return origin;
  const forwardedProto = (req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORT}`).split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

function resourceUrl(req) {
  return `${publicBaseUrl(req)}/mcp`;
}

// 2026-10-16 (MCP-REG-028/029): advertise exactly what we enforce.
const SCOPES_SUPPORTED = ["mcp"];
function requestedScopeUnsupported(scope) {
  const requested = String(scope || "").split(/\s+/).filter(Boolean);
  return requested.some((s) => !SCOPES_SUPPORTED.includes(s));
}
function resourceMatches(req, resourceParam) {
  if (!resourceParam) return true;
  const norm = (u) => String(u).replace(/\/+$/, "");
  return norm(resourceParam) === norm(resourceUrl(req)) || norm(resourceParam) === norm(publicBaseUrl(req));
}

function protectedResourceMetadata(req) {
  return {
    resource: resourceUrl(req),
    resource_name: "Paperclip MCP",
    authorization_servers: [publicBaseUrl(req)],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

function authorizationServerMetadata(req) {
  const base = publicBaseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["mcp"],
    service_documentation: `${base}/health`,
  };
}

function unauthorizedMcp(res, req) {
  const meta = `${publicBaseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  sendJson(res, 401, {
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  }, { "www-authenticate": `Bearer resource_metadata="${meta}", scope="mcp"` });
}

function base64urlSha256(input) {
  return createHash("sha256").update(input).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function newOpaque(prefix, bytes = 32) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function sendHtml(res, status, html) {
  const payload = Buffer.from(html, "utf8");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": payload.length });
  res.end(payload);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function readRawBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request body exceeds limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBodyParams(req) {
  const raw = await readRawBody(req);
  const ctype = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!raw.trim()) return {};
  if (ctype === "application/json") return JSON.parse(raw);
  if (ctype === "application/x-www-form-urlencoded" || !ctype) {
    try { return Object.fromEntries(new URLSearchParams(raw)); }
    catch { return JSON.parse(raw); }
  }
  try { return JSON.parse(raw); }
  catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

function resolveOauthPaperclipToken(bearer, req) {
  if (!bearer) return null;
  const entry = oauthAccess.get(bearer);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    oauthAccess.delete(bearer);
    return null;
  }
  // Audience binding (RFC 8707): a token minted for one resource is not valid
  // for another host/path. Legacy tokens without audience are backfilled at load.
  if (entry.audience && req) {
    const norm = (u) => String(u).replace(/\/+$/, "");
    if (norm(entry.audience) !== norm(resourceUrl(req))) return null;
  }
  return entry.paperclipToken;
}

function authorizePage({ error, defaults, hasDefault }) {
  const d = defaults || {};
  const hidden = ["client_id", "redirect_uri", "state", "scope", "resource", "code_challenge", "code_challenge_method", "response_type"]
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(d[k] || "")}" />`).join("\n");
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />`
    + `<title>Paperclip MCP — autoryzacja</title><style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8eaf0;display:flex;justify-content:center;padding:32px;margin:0}a{color:#8ab4ff}form{background:#171a21;border:1px solid #2a2f3a;border-radius:12px;padding:24px;max-width:520px;width:100%}input[type=text],input[type=password]{width:100%;padding:10px;border-radius:8px;border:1px solid #333a47;background:#0f1115;color:#fff;box-sizing:border-box}button{background:#4f7cff;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:600}button.secondary{background:#2a2f3a}.err{background:#3a1d1d;border:1px solid #7a2f2f;border-radius:8px;padding:10px;margin-bottom:12px}code{word-break:break-all}</style></head><body>`
    + `<form method="post" action="/oauth/authorize"><h2>Paperclip MCP — połącz Claude Web</h2>`
    + `<p>Wklej własny klucz Paperclip Board lub klucz uprawnionego agenta. Sesja OAuth zachowa tożsamość i uprawnienia wybranego klucza; nie przejmie tożsamości serwera.</p>`
    + (error ? `<div class="err">${escapeHtml(error)}</div>` : "")
    + hidden
    + `<label>Paperclip API key<br /><input type="password" name="paperclip_token" placeholder="pcp_..." autocomplete="off" required /></label><br /><br />`
    + `<button type="submit">Autoryzuj i wróć do Claude</button>`
    // No shared server-key OAuth consent button: each external caller authenticates individually.
    + `<p style="opacity:.7;font-size:13px">client_id: <code>${escapeHtml(d.client_id || "")}</code><br />redirect_uri: <code>${escapeHtml(d.redirect_uri || "")}</code></p>`
    + `</form></body></html>`;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Fail fast on missing/mistyped identity: silently falling back to a default
// agent or company would misattribute every MCP call that follows.
function requireEnvUuid(name) {
  const value = process.env[name];
  if (!value || !UUID_RE.test(value.trim())) {
    console.error(`FATAL: ${name} must be set to a valid UUID`);
    process.exit(1);
  }
  return value.trim();
}

const COMPANY_ID = requireEnvUuid("PAPERCLIP_COMPANY_ID");
const RUN_CONTEXT = {
  companyId: COMPANY_ID,
  agentId: requireEnvUuid("PAPERCLIP_MCP_AGENT_ID"),
};

const SERVER_AGENT_API_KEY = (() => {
  try {
    const value = readFileSync("/paperclip/instances/default/secrets/remote-mcp-agent-key", "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
})();
if (!SERVER_AGENT_API_KEY) {
  console.error("[paperclip-mcp-gateway] remote-mcp-agent-key missing: /agents/* bedzie 401");
}

const SERVER_BOARD_API_KEY = (() => {
  try {
    const value = readFileSync("/paperclip/instances/default/secrets/remote-mcp-board-key", "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
})();
if (!SERVER_BOARD_API_KEY) {
  console.error("[paperclip-mcp-gateway] remote-mcp-board-key missing: /plugins/* bedzie 403 dla kluczy agentow");
}

const SKILL_DEFINITIONS = [
  { name: "paperclip", path: "/app/skills/paperclip/SKILL.md" },
  { name: "paperclip-plan-dag", path: "/app/paperclip-public-mcp/plugin-skills/paperclip-plan-dag/SKILL.md" },
  { name: "paperclip-execute", path: "/app/paperclip-public-mcp/plugin-skills/paperclip-execute/SKILL.md" },
  { name: "paperclip-observe", path: "/app/paperclip-public-mcp/plugin-skills/paperclip-observe/SKILL.md" },
  { name: "paperclip-repair", path: "/app/paperclip-public-mcp/plugin-skills/paperclip-repair/SKILL.md" },
];

const SKILLS = loadSkills(SKILL_DEFINITIONS);
const SKILLS_BY_URI = new Map(SKILLS.map((skill) => [skill.uri, skill]));

const SkillsListRequestSchema = z.object({
  method: z.literal("skills/list"),
  params: z.object({ cursor: z.string().optional() }).optional(),
});
const SkillsGetRequestSchema = z.object({
  method: z.literal("skills/get"),
  params: z.object({ uri: z.string() }),
});

const AUTH_CACHE_TTL_MS = 30_000;
const AUTH_CACHE_MAX_ENTRIES = 1000;
const authCache = new Map();

function authCacheGet(key) {
  const expires = authCache.get(key);
  if (expires === undefined) return false;
  if (expires <= Date.now()) {
    authCache.delete(key);
    return false;
  }
  return true;
}

function authCacheSet(key) {
  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldest = authCache.keys().next();
    if (!oldest.done) authCache.delete(oldest.value);
  }
  authCache.set(key, Date.now() + AUTH_CACHE_TTL_MS);
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function bearerToken(req) {
  const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

// Fixed-window rate limiter for the expensive POST /mcp path. Legit callers
// are keyed by token hash (fair per user behind the shared tunnel IP);
// anonymous/invalid callers are keyed by source IP to slow auth floods.
const RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.MCP_RATE_LIMIT_MAX_REQUESTS || 120);
const RATE_LIMIT_MAX_CLIENTS = 1000;
const rateLimitBuckets = new Map();

function rateLimitKey(req, token) {
  if (token) return `tok:${createHash("sha256").update(token).digest("hex")}`;
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "";
  const ip = firstForwarded || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

function checkRateLimit(req, token) {
  if (!Number.isFinite(RATE_LIMIT_MAX_REQUESTS) || RATE_LIMIT_MAX_REQUESTS <= 0) {
    return { allowed: true, retryAfterSec: 0 };
  }
  const now = Date.now();
  const windowMs = Number.isFinite(RATE_LIMIT_WINDOW_MS) && RATE_LIMIT_WINDOW_MS > 0
    ? RATE_LIMIT_WINDOW_MS
    : 60_000;
  const key = rateLimitKey(req, token);
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + windowMs };
    rateLimitBuckets.set(key, bucket);
    if (rateLimitBuckets.size > RATE_LIMIT_MAX_CLIENTS) {
      const oldest = rateLimitBuckets.keys().next();
      if (!oldest.done) rateLimitBuckets.delete(oldest.value);
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

async function authenticate(token) {
  const key = createHash("sha256").update(token).digest("hex");
  if (authCacheGet(key)) return true;

  // Agent keys (pcp_...) don't allow GET /companies (list) — they return
  // 403 "Board access required" — but they DO allow GET /companies/:id.
  // Board keys (pcp_board_...) allow both. Try scoped first, then list.
  try {
    const scoped = await fetch(`${API_URL}/companies/${COMPANY_ID}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (scoped.ok) {
      authCacheSet(key);
      return true;
    }
  } catch { /* fall through to list check */ }
  try {
    const response = await fetch(`${API_URL}/companies`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) return false;
  } catch { return false; }

  authCacheSet(key);
  return true;
}

async function authenticateBoard(token) {
  const key = `board:${createHash("sha256").update(token).digest("hex")}`;
  if (authCacheGet(key)) return true;
  const response = await fetch(`${API_URL}/companies`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(`Paperclip board-key validation failed (${response.status})`);
  const companies = await response.json();
  if (!Array.isArray(companies) || !companies.some((company) => company.id === COMPANY_ID)) return false;
  authCacheSet(key);
  return true;
}

async function resolveAgentContext(token, rawBoardToken, rawRunId) {
  const runId = typeof rawRunId === "string" ? rawRunId.trim() : "";
  if (runId && (!UUID_RE.test(runId) || jwtRunId(token) !== runId || rawBoardToken)) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (runId) headers["X-Paperclip-Run-Id"] = runId;
  const agentResponse = await fetch(`${API_URL}/agents/me`, { headers, signal: AbortSignal.timeout(5000) });
  if (agentResponse.status === 401 || agentResponse.status === 403) return null;
  if (!agentResponse.ok) throw new Error(`Paperclip agent identity lookup failed (${agentResponse.status})`);
  const agent = await agentResponse.json();
  if (!UUID_RE.test(agent.id || "") || agent.companyId !== COMPANY_ID) return null;

  const boardApiKey = typeof rawBoardToken === "string" ? rawBoardToken.trim() : "";
  if (boardApiKey && (Buffer.byteLength(boardApiKey) > 2048 || !(await authenticateBoard(boardApiKey)))) return null;
  return { agentId: agent.id, runId: runId || null, boardApiKey: boardApiKey || null };
}

// --- Per-caller principal binding (KOMAA-850: cross-agent token reuse) -------
// The public /mcp route used to inject the gateway's own service credentials
// into every caller-authenticated session, so two different agents executed
// under one shared identity. Every MCP session is now bound to the principal
// that the caller actually presented.
// Production MCP never runs the legacy shared-credential observation mode.
const PRINCIPAL_MODE = "enforce";
const SERVICE_TOKENS = [
  SERVER_AGENT_API_KEY,
  process.env.PAPERCLIP_API_KEY,
  process.env.OAUTH_DEFAULT_PAPERCLIP_TOKEN,
].filter((value) => typeof value === "string" && value.trim().length > 0);

// Bounded transient-only retry. Never retry credential denial or change the caller.
const fetchAgentMe = (token, runId) => fetchAgentMeWithRetry(token, runId, { apiUrl: API_URL });

async function resolveMcpPrincipal(token, rawBoardToken, rawRunId) {
  return resolvePrincipal(
    {
      serviceTokens: SERVICE_TOKENS,
      serviceAgentKey: SERVER_AGENT_API_KEY,
      serviceBoardKey: SERVER_BOARD_API_KEY,
      serviceAgentId: RUN_CONTEXT.agentId,
      companyId: COMPANY_ID,
      authenticateBoard,
      fetchAgentMe,
    },
    { token, rawBoardToken, rawRunId },
  );
}

// Legacy (pre-fix) session credentials, used only while
// PAPERCLIP_MCP_PRINCIPAL_MODE=observe to compare behaviour before enforcing.
function legacySessionCredentials(token, agentContext) {
  return {
    apiKey: token,
    agentApiKey: agentContext ? token : SERVER_AGENT_API_KEY,
    boardApiKey: agentContext ? agentContext.boardApiKey : SERVER_BOARD_API_KEY,
    agentId: agentContext?.agentId || RUN_CONTEXT.agentId,
    runId: agentContext?.runId || null,
  };
}

async function handleMcp(req, res, token, bodyOverride, agentContext = null, principal = null) {
  let body = bodyOverride;
  if (body === undefined && req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: error instanceof Error ? error.message : "Parse error" },
        id: null,
      });
      return;
    }
  }

  // --- Scoped tools/list projection (128-tool provider fix) ---
  // Full registry stays at 200 (backward compatible default). Model-limited
  // clients request a subset: /mcp?profile=minimal|agent|board|full,
  // /mcp?tools=a,b,c, /mcp?exclude=x,y. Env PAPERCLIP_MCP_TOOL_PROFILE and
  // PAPERCLIP_MCP_TOOL_FILTER apply as server defaults. No unrestricted
  // generic-exec endpoint: every projected tool keeps its own schema + auth.
  let toolAllowlist = null;
  try {
    const u = new URL(req.url || "/mcp", "http://localhost");
    const profile = (u.searchParams.get("profile") || process.env.PAPERCLIP_MCP_TOOL_PROFILE || "full").trim();
    const toolsParam = u.searchParams.get("tools");
    const excludeParam = u.searchParams.get("exclude");
    const envFilter = (process.env.PAPERCLIP_MCP_TOOL_FILTER || "").trim();
    const all = allLiveToolNames();
    if (toolsParam) {
      const want = new Set(toolsParam.split(",").map((s) => s.trim()).filter(Boolean));
      toolAllowlist = new Set(all.filter((n) => want.has(n)));
    } else if (excludeParam) {
      const ex = new Set(excludeParam.split(",").map((s) => s.trim()).filter(Boolean));
      toolAllowlist = new Set(all.filter((n) => !ex.has(n)));
    } else if (profile !== "full") {
      const valid = new Set(["minimal", "agent", "board", "full"]);
      toolAllowlist = new Set(profileToolNames(valid.has(profile) ? profile : "full", all));
    } else if (envFilter) {
      const want = new Set(envFilter.split(",").map((s) => s.trim()).filter(Boolean));
      toolAllowlist = new Set(all.filter((n) => want.has(n)));
    }
    if (toolAllowlist && (process.env.MCP_PROJECTION_LOG || "1") !== "0") {
      console.log(`[paperclip-mcp] tools projection: ${toolAllowlist.size}/${all.length} (profile=${profile}${toolsParam ? ` tools=${toolsParam.slice(0, 80)}` : ""}${excludeParam ? ` exclude=${excludeParam.slice(0, 80)}` : ""})`);
    }
  } catch (e) {
    console.error("[paperclip-mcp] projection fallback to full registry:", e?.message || e);
    toolAllowlist = null;
  }

  const session = principal && principal.ok
    ? {
      apiKey: token,
      agentApiKey: principal.agentApiKey,
      boardApiKey: principal.boardApiKey,
      agentId: principal.agentId,
      runId: principal.runId,
      principalKind: principal.kind,
    }
    : legacySessionCredentials(token, agentContext);
  const { server } = createPaperclipMcpServer({
    apiUrl: API_URL,
    apiKey: session.apiKey,
    agentApiKey: session.agentApiKey,
    boardApiKey: session.boardApiKey,
    companyId: COMPANY_ID,
    agentId: session.agentId,
    runId: session.runId,
    principalKind: session.principalKind ?? null,
    wikiBoardApiKey: session.agentId && WIKI_BOARD_AGENT_IDS.has(session.agentId) ? SERVER_BOARD_API_KEY : null,
  }, toolAllowlist ? { toolAllowlist } : undefined);
  console.log(
    `[paperclip-mcp] session principal kind=${session.principalKind || "legacy"} agentId=${session.agentId || "none"} `
    + `runId=${session.runId || "none"} boardAuthorized=${Boolean(session.boardApiKey)} mode=${PRINCIPAL_MODE}`,
  );
  // NOTE: single-company mode — createPaperclipMcpServer() exposes the full
  // 200-tool registry with auto companyId by default; ?profile=agent|board|minimal
  // projects a model-limit-safe subset per connection (see execution-broker.ts).

  server.server.setRequestHandler(SkillsListRequestSchema, async () => ({
    skills: SKILLS.map((skill) => skill.entry),
  }));
  server.server.setRequestHandler(SkillsGetRequestSchema, async ({ params }) => {
    const skill = SKILLS_BY_URI.get(params.uri);
    if (!skill) throw new Error(`Unknown skill URI: ${params.uri}`);
    return { skill: skill.entry };
  });
  for (const skill of SKILLS) {
    server.registerResource(
      skill.name,
      skill.uri,
      { title: `${skill.entry.frontmatter.name} skill`, mimeType: "text/markdown" },
      async (uri) => ({
        contents: [{ uri: uri.href || skill.uri, mimeType: "text/markdown", text: skill.content }],
      }),
    );
  }
  server.server.registerCapabilities({
    extensions: { "io.modelcontextprotocol/skills": {} },
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleOAuthRegister(req, res) {
  let params;
  try { params = await readBodyParams(req); }
  catch { return sendJson(res, 400, { error: "invalid_request" }); }
  const redirectUris = Array.isArray(params.redirect_uris) ? params.redirect_uris
    : typeof params.redirect_uris === "string" ? [params.redirect_uris] : [];
  const clientId = `paperclip-${randomUUID()}`;
  const clientSecret = newOpaque("pcsec_", 24);
  oauthClients.set(clientId, { client_secret: clientSecret, redirect_uris: redirectUris });
  saveOAuthStore();
  sendJson(res, 201, {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_name: params.client_name || "Claude",
  });
}

function redirectAllowed(stored, redirectUri) {
  try {
    const u = new URL(redirectUri);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    if (u.protocol !== "https:") return false;
    if (!stored || stored.length === 0) return true; // CIMD / lenient
    return stored.includes(redirectUri);
  } catch { return false; }
}

async function handleOAuthAuthorize(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  if (req.method === "GET") {
    if ((q.response_type || "code") !== "code") {
      return sendHtml(res, 400, `<h1>unsupported_response_type</h1><p>Tylko response_type=code.</p>`);
    }
    if (!q.client_id || !q.redirect_uri) {
      return sendHtml(res, 400, `<h1>invalid_request</h1><p>Brak client_id lub redirect_uri.</p>`);
    }
    const stored = oauthClients.get(q.client_id);
    if (!redirectAllowed(stored?.redirect_uris, q.redirect_uri)) {
      return sendHtml(res, 400, `<h1>invalid_request</h1><p>redirect_uri nie jest dozwolone dla tego client_id.</p>`);
    }
    if (requestedScopeUnsupported(q.scope)) {
      return sendHtml(res, 400, `<h1>invalid_scope</h1><p>Dozwolone scope: mcp.</p>`);
    }
    if (!resourceMatches(req, q.resource)) {
      return sendHtml(res, 400, `<h1>invalid_target</h1><p>resource nie wskazuje na ten serwer MCP.</p>`);
    }
    const hasDefault = Boolean(process.env.PAPERCLIP_API_KEY || process.env.OAUTH_DEFAULT_PAPERCLIP_TOKEN);
    return sendHtml(res, 200, authorizePage({ defaults: { ...q, response_type: "code" }, hasDefault }));
  }

  // POST — form submit
  let p;
  try { p = await readBodyParams(req); }
  catch { return sendHtml(res, 400, `<h1>invalid_request</h1>`); }
  const params = { ...q, ...p };
  const stored = oauthClients.get(params.client_id);
  if (!params.client_id || !params.redirect_uri || !redirectAllowed(stored?.redirect_uris, params.redirect_uri)) {
    return sendHtml(res, 400, `<h1>invalid_request</h1><p>Zły client_id / redirect_uri.</p>`);
  }
  if (requestedScopeUnsupported(params.scope)) {
    return sendHtml(res, 400, `<h1>invalid_scope</h1><p>Dozwolone scope: mcp.</p>`);
  }
  if (!resourceMatches(req, params.resource)) {
    return sendHtml(res, 400, `<h1>invalid_target</h1><p>resource nie wskazuje na ten serwer MCP.</p>`);
  }
  let paperclipToken = (params.paperclip_token || "").trim();
  if (params.use_default) {
    return sendHtml(res, 403, authorizePage({
      error: "Shared server credentials cannot authorize an external OAuth owner session. Use your own Paperclip credential.",
      defaults: params,
      hasDefault: false,
    }));
  }
  if (!paperclipToken) {
    const hasDefault = Boolean(process.env.PAPERCLIP_API_KEY || process.env.OAUTH_DEFAULT_PAPERCLIP_TOKEN);
    return sendHtml(res, 400, authorizePage({ error: "Wprowadź własny klucz Paperclip Board dla tej firmy.", defaults: params, hasDefault: false }));
  }
  // External OAuth for this owner-facing endpoint grants Board authority by
  // default only when the caller's OWN key already has Board authority.
  // Agent/service keys still work through their separate direct MCP channels.
  const ok = await isVerifiedOwnerBoardGrant(paperclipToken, authenticateBoard);
  if (!ok) {
    const hasDefault = Boolean(process.env.PAPERCLIP_API_KEY || process.env.OAUTH_DEFAULT_PAPERCLIP_TOKEN);
    return sendHtml(res, 403, authorizePage({ error: "To połączenie OAuth wymaga własnego klucza z uprawnieniami Board do bieżącej firmy. Klucze agentów nie nadają uprawnień Board.", defaults: params, hasDefault: false }));
  }
  const code = newOpaque("pcmc_", 24);
  oauthCodes.set(code, {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    challenge: params.code_challenge || null,
    method: params.code_challenge_method || "plain",
    paperclipToken,
    scope: params.scope || "mcp",
    resource: params.resource || null,
    audience: resourceUrl(req),
    expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
  });
  const dest = new URL(params.redirect_uri);
  dest.searchParams.set("code", code);
  if (params.state) dest.searchParams.set("state", params.state);
  res.writeHead(302, { location: dest.toString() });
  res.end();
}

async function handleOAuthToken(req, res) {
  let p;
  try { p = await readBodyParams(req); }
  catch { return sendJson(res, 400, { error: "invalid_request" }); }
  // client_secret_basic support
  const basic = (req.headers.authorization || "").match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const [bid, bsec] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
      if (bid && !p.client_id) p.client_id = bid;
      if (bsec && !p.client_secret) p.client_secret = bsec;
    } catch { /* ignore */ }
  }
  if (p.grant_type === "authorization_code") {
    const entry = oauthCodes.get(p.code);
    if (!entry || entry.expiresAt <= Date.now()) {
      oauthCodes.delete(p.code);
      return sendJson(res, 400, { error: "invalid_grant", error_description: "bad or expired code" });
    }
    if (p.client_id && entry.clientId && p.client_id !== entry.clientId) {
      return sendJson(res, 400, { error: "invalid_grant", error_description: "client mismatch" });
    }
    if (p.redirect_uri && entry.redirectUri && p.redirect_uri !== entry.redirectUri) {
      return sendJson(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
    }
    const stored = p.client_id ? oauthClients.get(p.client_id) : null;
    if (stored && p.client_secret && stored.client_secret !== p.client_secret) {
      return sendJson(res, 401, { error: "invalid_client" });
    }
    if (entry.challenge) {
      if (!p.code_verifier) return sendJson(res, 400, { error: "invalid_request", error_description: "missing code_verifier" });
      const expected = entry.method === "S256" ? base64urlSha256(p.code_verifier) : p.code_verifier;
      if (expected !== entry.challenge) return sendJson(res, 400, { error: "invalid_grant", error_description: "PKCE failed" });
    }
    oauthCodes.delete(p.code);
    const access = newOpaque("mcp_at_");
    const refresh = newOpaque("mcp_rt_");
    const now = Date.now();
    oauthAccess.set(access, { paperclipToken: entry.paperclipToken, scope: entry.scope, clientId: entry.clientId, audience: entry.audience || resourceUrl(req), expiresAt: now + OAUTH_ACCESS_TTL_SEC * 1000 });
    oauthRefresh.set(refresh, { paperclipToken: entry.paperclipToken, scope: entry.scope, clientId: entry.clientId, audience: entry.audience || resourceUrl(req), expiresAt: now + OAUTH_REFRESH_TTL_SEC * 1000 });
    saveOAuthStore();
    return sendJson(res, 200, { access_token: access, token_type: "Bearer", expires_in: OAUTH_ACCESS_TTL_SEC, refresh_token: refresh, scope: entry.scope });
  }
  if (p.grant_type === "refresh_token") {
    const entry = oauthRefresh.get(p.refresh_token);
    if (!entry || entry.expiresAt <= Date.now()) {
      oauthRefresh.delete(p.refresh_token);
      return sendJson(res, 400, { error: "invalid_grant", error_description: "bad refresh token" });
    }
    const access = newOpaque("mcp_at_");
    oauthAccess.set(access, { paperclipToken: entry.paperclipToken, scope: entry.scope, clientId: entry.clientId, audience: entry.audience || resourceUrl(req), expiresAt: Date.now() + OAUTH_ACCESS_TTL_SEC * 1000 });
    saveOAuthStore();
    return sendJson(res, 200, { access_token: access, token_type: "Bearer", expires_in: OAUTH_ACCESS_TTL_SEC, refresh_token: p.refresh_token, scope: entry.scope });
  }
  return sendJson(res, 400, { error: "unsupported_grant_type" });
}


// --- Runtime MCP proxy (Paperclip Core plugin-tool result repair) -------------
// Core projects plugin tool results as `structuredContent: resultRecord?.data ?? null`.
// For providerType "paperclip_plugin" the dispatcher wraps the worker payload as
// { pluginId, toolName, result }, so `data` is undefined and Core emits
// `structuredContent: null`. The MCP client rejects that (CallToolResult expects a
// record), so every plugin tool call fails for the agent although the side effect ran.
// This proxy forwards the request to Core unchanged and removes the invalid null field.
const PAPERCLIP_ROOT = API_URL.replace(/\/api$/, "");
async function proxyRuntimeMcp(req, res, url) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const headers = {
    "content-type": req.headers["content-type"] || "application/json",
    accept: req.headers.accept || "application/json, text/event-stream",
  };
  for (const name of ["authorization", "mcp-protocol-version", "mcp-session-id", "x-paperclip-run-id", "x-paperclip-board-api-key", "x-paperclip-agent-id"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  let upstream;
  try {
    upstream = await fetch(PAPERCLIP_ROOT + url.pathname + url.search, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    sendJson(res, 502, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "upstream MCP unreachable: " + String(error) } });
    return;
  }
  const text = await upstream.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON (SSE) passthrough */ }
  if (parsed && parsed.result && parsed.result.structuredContent === null) {
    delete parsed.result.structuredContent;
  }
  const out = parsed ? JSON.stringify(parsed) : text;
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
    "cache-control": "no-store",
  });
  res.end(out);
}

const httpServer = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, x-paperclip-board-api-key, x-paperclip-run-id",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      });
      res.end();
      return;
    }
    // --- OAuth discovery (public, no auth) ---
    if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return sendJson(res, 200, protectedResourceMetadata(req), { "access-control-allow-origin": "*" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
      return sendJson(res, 200, authorizationServerMetadata(req), { "access-control-allow-origin": "*" });
    }
    if (req.method === "GET" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return handleOAuthAuthorize(req, res, url);
    }
    if (req.method === "POST" && (url.pathname === "/oauth/authorize" || url.pathname === "/authorize")) {
      return handleOAuthAuthorize(req, res, url);
    }
    if (req.method === "POST" && (url.pathname === "/oauth/register" || url.pathname === "/register")) {
      return handleOAuthRegister(req, res);
    }
    if (req.method === "POST" && (url.pathname === "/oauth/token" || url.pathname === "/token")) {
      return handleOAuthToken(req, res);
    }
    if (req.method === "GET" && url.pathname === "/__release/identity") {
      const identity = getReleaseIdentity();
      if (!identity) {
        sendJson(res, 503, { error: "release identity unavailable" }, { "cache-control": "no-store" });
      } else {
        sendJson(res, 200, identity, { "cache-control": "no-store" });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "paperclip-mcp", transport: "streamable-http", wiki: true, oauth: true });
      return;
    }
    if (req.method === "POST" && (url.pathname.startsWith("/mcp/gateways/") || url.pathname === "/mcp/runtime-tools")) {
      await proxyRuntimeMcp(req, res, url);
      return;
    }
    const urlTok = urlTokenFromRequest(req, url);
    const standaloneRoute = url.pathname === "/mcp/opencode";
    const principalRoute = url.pathname === "/mcp/principal";
    if (url.pathname !== "/mcp" && !standaloneRoute && !principalRoute && !urlTok) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
      sendJson(res, 405, { error: "Method not allowed; use GET/POST/DELETE" }, { allow: "GET, POST, DELETE" });
      return;
    }

    const presented = bearerToken(req) || (standaloneRoute ? null : urlTok);
    const oauthPaperclip = standaloneRoute ? null : resolveOauthPaperclipToken(presented, req) || (urlTok ? urlTokens[urlTok].paperclipToken : null);
    const effective = oauthPaperclip || presented;
    const rate = checkRateLimit(req, effective);
    if (!rate.allowed) {
      sendJson(res, 429, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "MCP rate limit exceeded, retry later" },
        id: null,
      }, { "retry-after": String(rate.retryAfterSec) });
      return;
    }
    if (!effective || !(await authenticate(effective))) {
      unauthorizedMcp(res, req);
      return;
    }
    // Existing OAuth access/refresh credentials are grandfathered only as
    // credentials, not as Board grants. Agent-key OAuth tokens must reconnect
    // with the owner's verified Board key before invoking any tool.
    if (oauthPaperclip && oauthAccess.has(presented)) {
      const boardAuthorized = await isVerifiedOwnerBoardGrant(effective, authenticateBoard);
      if (!boardAuthorized) {
        sendJson(res, 403, { error: "Board authorization required for the owner OAuth MCP connection" });
        return;
      }
    }

    // --- Principal binding: one session, one identity -------------------------
    const principal = await resolveMcpPrincipal(
      effective,
      req.headers["x-paperclip-board-api-key"],
      req.headers["x-paperclip-run-id"],
    );
    if (!principal.ok) {
      console.warn(`[paperclip-mcp] principal unresolved (${principal.reason}) route=${url.pathname}`);
      sendJson(res, 403, { error: "caller identity could not be bound to a Paperclip principal", reason: principal.reason });
      return;
    }
    if (principalRoute) {
      sendJson(res, 200, { ...describePrincipal(principal), mode: PRINCIPAL_MODE });
      return;
    }
    if (standaloneRoute && principal.kind !== "agent") {
      // The standalone route is agent-only by contract.
      sendJson(res, 403, { error: "agent, run or board credential is invalid" });
      return;
    }
    if (PRINCIPAL_MODE === "observe") {
      const legacyContext = standaloneRoute
        ? await resolveAgentContext(
          effective,
          req.headers["x-paperclip-board-api-key"],
          req.headers["x-paperclip-run-id"],
        )
        : null;
      console.warn(`[paperclip-mcp] observe mode: session runs with legacy shared credentials (kind=${principal.kind})`);
      await handleMcp(req, res, effective, undefined, legacyContext, null);
      return;
    }
    await handleMcp(req, res, effective, undefined, null, principal);
  })().catch((error) => {
    console.error("MCP request failed", error);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal MCP error", requestId: randomUUID() });
    else res.end();
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Paperclip MCP listening on http://${HOST}:${PORT}/mcp`);
});
