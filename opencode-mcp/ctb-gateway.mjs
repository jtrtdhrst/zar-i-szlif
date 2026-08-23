import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TOOL_CLASSES, classifyTool, ctbContextError, requiredScope, validateToolPathArguments } from "./ctb-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "..");
const runtimeDir = process.env.OPENCODE_MCP_RUNTIME_DIR || path.join(here, ".runtime");
const port = Number(process.env.PORT || 4097);
const issuer = (process.env.MCP_ISSUER || "https://opencode.kompaszbiorek.pl").replace(/\/+$/, "");
const serverUrl = (process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");
const operatorUsername = process.env.OPENCODE_MCP_USERNAME || "operator";
const operatorPassword = process.env.OPENCODE_MCP_PASSWORD || "";
const openCodeUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const openCodePassword = process.env.OPENCODE_SERVER_PASSWORD || "";
const allowedRoots = (process.env.OPENCODE_CTB_ALLOWED_ROOTS || workspaceRoot).split(path.delimiter).filter(Boolean);
const upstreamEntry = process.env.OPENCODE_MCP_UPSTREAM_ENTRY || path.join(here, "upstream", "dist", "index.js");
const skillsRoot = path.join(here, "skills");
const auditFile = path.join(runtimeDir, "ctb-audit.ndjson");
const registryFile = path.join(runtimeDir, "ctb-runs.json");
const accessTtlMs = 8 * 60 * 60 * 1000;
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;
const codeTtlMs = 10 * 60 * 1000;
const validScopes = new Set(["opencode:read", "opencode:session", "opencode:ctb:execute", "opencode:admin", "opencode:write"]);
const codes = new Map();
const sessions = new Map();
const attempts = new Map();

if (!operatorPassword || !openCodePassword) throw new Error("OPENCODE_MCP_PASSWORD and OPENCODE_SERVER_PASSWORD must be configured.");
if (!fs.existsSync(upstreamEntry)) throw new Error(`Missing upstream engine: ${upstreamEntry}`);
fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
const keyFile = path.join(runtimeDir, "signing.key");
const clientsFile = path.join(runtimeDir, "clients.json");
const refreshFile = path.join(runtimeDir, "refresh-tokens.json");
const signingKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : crypto.randomBytes(48).toString("hex");
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, signingKey, { mode: 0o600 });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
const clients = readJson(clientsFile, {});
const refreshTokens = readJson(refreshFile, {});
const runs = readJson(registryFile, {});
function persistRuns() { writeJson(registryFile, runs); }
function b64(value) { return Buffer.from(value).toString("base64url"); }
function random(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function sign(payload) { const encoded = b64(JSON.stringify(payload)); return `${encoded}.${crypto.createHmac("sha256", signingKey).update(encoded).digest("base64url")}`; }
function verify(token) { try { const [encoded, signature] = String(token).split("."); const expected = crypto.createHmac("sha256", signingKey).update(encoded).digest("base64url"); if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; } }
function resourceUrl() { return `${issuer}/mcp`; }
function scopes(scope) { return String(scope || "").split(/\s+/).filter((entry) => validScopes.has(entry)); }
function normalizedScope(scope) { const requested = scopes(scope); return requested.length ? requested.join(" ") : "opencode:read opencode:session"; }
function hasScope(token, required) { const actual = scopes(token?.scope); return actual.includes(required) || (required === "opencode:ctb:execute" && actual.includes("opencode:write")); }
function secureEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function allowedRedirect(value) { try { const url = new URL(value); return (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) || (url.protocol === "https:" && url.hostname === "chatgpt.com" && (url.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[^/]+$/.test(url.pathname))); } catch { return false; } }
function sendJson(res, status, body, headers = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(body)); }
function sendHtml(res, status, body) { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" }); res.end(body); }
async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw new Error("Request body is too large."); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function toolResult(data, text) { return { structuredContent: data, content: [{ type: "text", text: text || JSON.stringify(data) }] }; }
function tokenFromRequest(req) { const auth = String(req.headers.authorization || ""); return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("access_token") || ""; }
function mcpUnauthorized(res, id = null) { return sendJson(res, 401, rpcError(id, -32001, "Unauthorized"), { "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", scope="opencode:read opencode:session opencode:ctb:execute opencode:admin", error="invalid_token", error_description="Connect OpenCode with OAuth to continue"` }); }
function audit(event) { const safe = { timestamp: new Date().toISOString(), ...event }; fs.appendFileSync(auditFile, `${JSON.stringify(safe)}\n`, { mode: 0o600 }); }

class UpstreamEngine {
  constructor() { this.child = null; this.buffer = ""; this.nextId = 1; this.pending = new Map(); this.ready = null; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [upstreamEntry], { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OPENCODE_BASE_URL: serverUrl, OPENCODE_AUTO_SERVE: "false", OPENCODE_SERVER_USERNAME: openCodeUsername, OPENCODE_SERVER_PASSWORD: openCodePassword } });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.receive(chunk));
      child.stderr.on("data", (chunk) => process.stderr.write(`[opencode-upstream] ${chunk}`));
      child.once("error", reject);
      child.once("exit", () => { this.child = null; this.ready = null; for (const { reject: fail } of this.pending.values()) fail(new Error("UPSTREAM_ENGINE_EXITED")); this.pending.clear(); });
      this.call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kompas-ctb-adapter", version: "1.0.0" } }, true).then(() => { this.notify("notifications/initialized", {}); resolve(); }, reject);
    });
    return this.ready;
  }
  receive(chunk) { this.buffer += chunk; for (;;) { const index = this.buffer.indexOf("\n"); if (index < 0) return; const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1); if (!line) continue; let message; try { message = JSON.parse(line); } catch { continue; } const pending = this.pending.get(message.id); if (!pending) continue; this.pending.delete(message.id); message.error ? pending.reject(Object.assign(new Error(message.error.message), { data: message.error.data })) : pending.resolve(message.result); } }
  async call(method, params, skipReady = false) { if (!skipReady) await (this.ready || Promise.resolve()); if (!this.child) throw new Error("UPSTREAM_ENGINE_UNAVAILABLE"); const id = this.nextId++; const request = { jsonrpc: "2.0", id, method, params }; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(`${JSON.stringify(request)}\n`); }); }
  notify(method, params) { if (this.child) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`); }
}
const engine = new UpstreamEngine();

function skillCatalog() {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md"))).map((entry) => {
    const text = fs.readFileSync(path.join(skillsRoot, entry.name, "SKILL.md"), "utf8");
    const frontmatter = Object.fromEntries((/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || "").split(/\r?\n/).map((line) => line.split(/:\s*/, 2)).filter(([key]) => key));
    return { name: entry.name, version: frontmatter.version || "1.0.0", description: frontmatter.description || "", changeClass: frontmatter.change_class || "ctb", supportedModes: String(frontmatter.supported_modes || "").split(",").map((value) => value.trim()).filter(Boolean), path: path.join(skillsRoot, entry.name, "SKILL.md") };
  });
}

function exposeTool(tool) {
  const toolClass = classifyTool(tool.name);
  const securitySchemes = [{ type: "oauth2", scopes: [requiredScope(toolClass)] }];
  const inputSchema = { ...(tool.inputSchema || { type: "object" }), properties: { ...(tool.inputSchema?.properties || {}) } };
  if (toolClass === TOOL_CLASSES.WRITE || toolClass === TOOL_CLASSES.PRIVILEGED_WRITE || toolClass === TOOL_CLASSES.ADMIN) {
    inputSchema.properties.ctb = { type: "object", description: "Required CTB execution envelope: mode EXECUTE, changeClass ctb, paperclipIssueId, changeIntent, scope, acceptanceCriteria and idempotencyKey.", properties: { mode: { const: "EXECUTE" }, changeClass: { const: "ctb" }, paperclipIssueId: { type: "string" }, changeIntent: { type: "string" }, scope: { type: "string" }, acceptanceCriteria: { type: "string" }, idempotencyKey: { type: "string" } }, required: ["mode", "changeClass", "paperclipIssueId", "changeIntent", "scope", "acceptanceCriteria", "idempotencyKey"] };
  }
  return { ...tool, title: tool.title || tool.name, description: `[${toolClass}] ${tool.description || ""}`, inputSchema, securitySchemes, _meta: { ...(tool._meta || {}), securitySchemes, kompas: { toolClass, changeClass: toolClass === TOOL_CLASSES.READ || toolClass === TOOL_CLASSES.SESSION_CONTROL ? null : "ctb" } } };
}

async function validatePaperclipIssue(issueId) {
  const base = process.env.PAPERCLIP_API_URL;
  const token = process.env.PAPERCLIP_SERVICE_TOKEN;
  if (!base || !token) throw Object.assign(new Error("CTB_PAPERCLIP_VALIDATION_UNAVAILABLE"), { code: "CTB_PAPERCLIP_VALIDATION_UNAVAILABLE" });
  const response = await fetch(`${base.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(issueId)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error("CTB_PAPERCLIP_ISSUE_UNKNOWN"), { code: "CTB_PAPERCLIP_ISSUE_UNKNOWN" });
}

function recordRun(sessionId, ctb, directory, actor) {
  if (!sessionId || !ctb) return;
  if (!runs[sessionId]) runs[sessionId] = { runId: sessionId, paperclipIssueId: ctb.paperclipIssueId, changeClass: ctb.changeClass, mode: ctb.mode, changeIntent: ctb.changeIntent, acceptanceCriteria: ctb.acceptanceCriteria, idempotencyKey: ctb.idempotencyKey, directory, actor, createdAt: new Date().toISOString(), events: [], retries: 0 };
  persistRuns();
}
function eventFor(sessionId, event) { if (!sessionId || !runs[sessionId]) return; const run = runs[sessionId]; run.events.push({ runId: sessionId, paperclipIssueId: run.paperclipIssueId, sequence: run.events.length + 1, timestamp: new Date().toISOString(), errorCode: null, retry: 0, ...event }); persistRuns(); }
function extractSessionId(result) { const text = JSON.stringify(result); return /(?:ses|session)_[A-Za-z0-9_-]+/.exec(text)?.[0] || null; }

async function callTool(name, args, token) {
  if (name === "opencode_list_skills") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); return toolResult({ skills: skillCatalog().map(({ path: ignored, ...skill }) => skill) }, "Dostępne skille CTB."); }
  if (name === "opencode_get_skill") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const skill = skillCatalog().find((item) => item.name === args.name); if (!skill) throw Object.assign(new Error("SKILL_NOT_FOUND"), { code: "SKILL_NOT_FOUND" }); return toolResult({ ...skill, contract: fs.readFileSync(skill.path, "utf8") }, "Kontrakt skilla CTB."); }
  if (name === "opencode_ctb_get_run" || name === "opencode_ctb_get_events" || name === "opencode_ctb_get_metrics") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const run = runs[args.runId]; if (!run) throw Object.assign(new Error("CTB_RUN_NOT_FOUND"), { code: "CTB_RUN_NOT_FOUND" });
    const events = run.events || [];
    const metrics = { toolCalls: events.filter((event) => event.kind === "tool_call").length, failedToolCalls: events.filter((event) => event.status === "error").length, retryCount: events.reduce((total, event) => total + (event.retry || 0), 0), runDurationMs: Math.max(0, Date.now() - Date.parse(run.createdAt)), firstWriteAt: events.find((event) => event.kind === "file_write")?.timestamp || null, firstTestAt: events.find((event) => event.kind === "test")?.timestamp || null };
    return toolResult(name === "opencode_ctb_get_events" ? { runId: args.runId, events } : name === "opencode_ctb_get_metrics" ? { runId: args.runId, metrics } : { ...run, metrics }, "Telemetry CTB.");
  }
  const upstreamTools = await engine.call("tools/list", {});
  const upstream = upstreamTools.tools.find((tool) => tool.name === name);
  if (!upstream) throw Object.assign(new Error("UNKNOWN_TOOL"), { code: "UNKNOWN_TOOL" });
  const toolClass = classifyTool(name);
  if (!hasScope(token, requiredScope(toolClass))) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: requiredScope(toolClass) });
  const contextError = toolClass === TOOL_CLASSES.WRITE || toolClass === TOOL_CLASSES.PRIVILEGED_WRITE || toolClass === TOOL_CLASSES.ADMIN ? ctbContextError(args) : null;
  if (contextError) throw Object.assign(new Error(contextError.code), contextError);
  const ctb = args.ctb;
  if (ctb) await validatePaperclipIssue(ctb.paperclipIssueId);
  const forwarded = validateToolPathArguments(Object.fromEntries(Object.entries(args || {}).filter(([key]) => key !== "ctb")), allowedRoots, workspaceRoot);
  const startedAt = Date.now();
  audit({ principal: token.sub, paperclipIssueId: ctb?.paperclipIssueId || null, mode: ctb?.mode || "DIAGNOSE", changeClass: ctb?.changeClass || null, tool: name, directory: forwarded.directory, result: "started" });
  try {
    const result = await engine.call("tools/call", { name, arguments: forwarded });
    const sessionId = extractSessionId(result);
    recordRun(sessionId, ctb, forwarded.directory, token.sub);
    eventFor(sessionId, { kind: "tool_call", tool: name, durationMs: Date.now() - startedAt, status: "success" });
    audit({ principal: token.sub, paperclipIssueId: ctb?.paperclipIssueId || null, runId: sessionId, mode: ctb?.mode || "DIAGNOSE", changeClass: ctb?.changeClass || null, tool: name, directory: forwarded.directory, result: "success", durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    audit({ principal: token.sub, paperclipIssueId: ctb?.paperclipIssueId || null, mode: ctb?.mode || "DIAGNOSE", changeClass: ctb?.changeClass || null, tool: name, directory: forwarded.directory, result: "error", errorCode: error.code || "UPSTREAM_ERROR", durationMs: Date.now() - startedAt });
    throw error;
  }
}

async function handleMcp(req, res) {
  let message; try { message = JSON.parse(await body(req)); } catch { return sendJson(res, 400, rpcError(null, -32700, "Nieprawidłowy JSON-RPC.")); }
  const token = verify(tokenFromRequest(req)); if (!token || token.iss !== issuer || token.aud !== resourceUrl() || token.exp * 1000 <= Date.now()) return mcpUnauthorized(res, message?.id ?? null);
  const sessionId = String(req.headers["mcp-session-id"] || ""); const currentSessionId = sessionId && sessions.has(sessionId) ? sessionId : random(16); const headers = sessionId && sessions.has(sessionId) ? {} : { "mcp-session-id": currentSessionId }; sessions.set(currentSessionId, { updatedAt: Date.now() });
  const method = message.method; const id = message.id;
  if (method === "initialize") { await engine.start(); return sendJson(res, 200, rpcResult(id, { protocolVersion: message.params?.protocolVersion || "2025-03-26", capabilities: { tools: { listChanged: false }, resources: { subscribe: false }, prompts: { listChanged: false }, extensions: { "io.modelcontextprotocol/skills": {} } }, serverInfo: { name: "kompas-opencode-ctb", version: "1.0.0" }, instructions: "OpenCode is the CTB execution engine. DIAGNOSE and PLAN are read-only. Every write requires ctb.mode EXECUTE, ctb.changeClass ctb, a valid Paperclip issue, declared scope, acceptance criteria and idempotency key." }), headers); }
  if (method === "notifications/initialized" || String(method || "").startsWith("notifications/")) return sendJson(res, 202, {}, headers);
  if (method === "ping") return sendJson(res, 200, rpcResult(id, {}), headers);
  try {
    if (method === "tools/list") { await engine.start(); const upstream = await engine.call("tools/list", {}); const tools = upstream.tools.map(exposeTool); tools.push({ name: "opencode_list_skills", title: "Skille CTB", description: "Lista kontraktów skilli CTB.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }, { name: "opencode_get_skill", title: "Kontrakt skilla CTB", description: "Zwraca pełny kontrakt wskazanego skilla CTB.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }, ...["opencode_ctb_get_run", "opencode_ctb_get_events", "opencode_ctb_get_metrics"].map((name) => ({ name, title: name, description: "Read-only telemetry CTB z registry korelacji.", inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }))); return sendJson(res, 200, rpcResult(id, { tools }), headers); }
    if (method === "tools/call") return sendJson(res, 200, rpcResult(id, await callTool(message.params?.name, message.params?.arguments || {}, token)), headers);
    if (["resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get"].includes(method)) { if (!hasScope(token, "opencode:read")) return sendJson(res, 200, rpcResult(id, { isError: true, structuredContent: { errorCode: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }, content: [{ type: "text", text: "INSUFFICIENT_SCOPE" }] }), headers); await engine.start(); return sendJson(res, 200, rpcResult(id, await engine.call(method, message.params || {})), headers); }
    return sendJson(res, 400, rpcError(id ?? null, -32601, "Nieznana metoda MCP."), headers);
  } catch (error) { return sendJson(res, 200, rpcResult(id, { isError: true, structuredContent: { errorCode: error.code || "CTB_GATEWAY_ERROR", missing: error.missing, requiredScope: error.requiredScope }, content: [{ type: "text", text: error.message || "CTB gateway error." }] }), headers); }
}

function escape(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function loginPage(query, error = "") { const fields = ["client_id", "redirect_uri", "response_type", "scope", "state", "resource", "code_challenge", "code_challenge_method"].map((name) => `<input type="hidden" name="${name}" value="${escape(query.get(name))}">`).join(""); return `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Autoryzacja OpenCode CTB</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:8vh auto;padding:1.5rem;color:#162313}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin-top:1rem;font-weight:600}input{padding:.7rem;margin-top:.35rem}button{margin-top:1.5rem;padding:.8rem;background:#162313;color:#fff;border:0;border-radius:.4rem;font-weight:700}.error{color:#a5221c}</style><h1>Połącz OpenCode CTB</h1>${error ? `<p class="error">${escape(error)}</p>` : ""}<form method="post">${fields}<label>Login<input name="username" autocomplete="username" required></label><label>Hasło<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Autoryzuj</button></form></html>`; }
function authorizationError(res, query, error, description) { const redirectUri = query.get("redirect_uri"); if (allowedRedirect(redirectUri)) { const destination = new URL(redirectUri); destination.searchParams.set("error", error); destination.searchParams.set("error_description", description); destination.searchParams.set("iss", issuer); if (query.get("state")) destination.searchParams.set("state", query.get("state")); res.writeHead(302, { location: destination.toString(), "cache-control": "no-store" }); return res.end(); } return sendJson(res, 400, { error, error_description: description, iss: issuer }); }
function issueAccessToken(clientId, scope) { const now = Date.now(); return sign({ iss: issuer, sub: operatorUsername, aud: resourceUrl(), client_id: clientId, scope, iat: Math.floor(now / 1000), exp: Math.floor((now + accessTtlMs) / 1000), jti: random(12) }); }
async function handleAuthorize(req, res, url) { const query = url.searchParams; const clientId = query.get("client_id") || ""; const redirectUri = query.get("redirect_uri") || ""; const client = clients[clientId]; if (!client || !allowedRedirect(redirectUri) || !client.redirect_uris.includes(redirectUri)) return authorizationError(res, query, "unauthorized_client", "Unknown OAuth client or redirect URI."); if (query.get("response_type") !== "code" || query.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9._~-]{43,128}$/.test(query.get("code_challenge") || "")) return authorizationError(res, query, "invalid_request", "PKCE S256 is required."); if ((query.get("resource") || resourceUrl()) !== resourceUrl()) return authorizationError(res, query, "invalid_target", "Unknown resource."); if (req.method === "GET") return sendHtml(res, 200, loginPage(query)); const form = new URLSearchParams(await body(req)); const ip = String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "unknown"); if (!secureEqual(form.get("username"), operatorUsername) || !secureEqual(form.get("password"), operatorPassword)) { const count = (attempts.get(ip) || 0) + 1; attempts.set(ip, count); return count >= 10 ? sendJson(res, 429, { error: "too_many_attempts" }) : sendHtml(res, 401, loginPage(query, "Niepoprawny login lub hasło.")); } attempts.delete(ip); const code = random(36); codes.set(code, { clientId, redirectUri, scope: normalizedScope(query.get("scope")), codeChallenge: query.get("code_challenge"), expiresAt: Date.now() + codeTtlMs }); const destination = new URL(redirectUri); destination.searchParams.set("code", code); destination.searchParams.set("iss", issuer); if (query.get("state")) destination.searchParams.set("state", query.get("state")); res.writeHead(302, { location: destination.toString(), "cache-control": "no-store" }); res.end(); }
async function handleToken(req, res) { const form = new URLSearchParams(await body(req)); if (form.get("grant_type") === "authorization_code") { const code = String(form.get("code") || ""); const record = codes.get(code); codes.delete(code); if (!record || record.expiresAt < Date.now() || record.clientId !== form.get("client_id") || record.redirectUri !== form.get("redirect_uri")) return sendJson(res, 400, { error: "invalid_grant" }); const challenge = crypto.createHash("sha256").update(String(form.get("code_verifier") || "")).digest("base64url"); if (!secureEqual(challenge, record.codeChallenge)) return sendJson(res, 400, { error: "invalid_grant" }); const refresh = random(40); refreshTokens[refresh] = { clientId: record.clientId, scope: record.scope, expiresAt: Date.now() + refreshTtlMs }; writeJson(refreshFile, refreshTokens); return sendJson(res, 200, { access_token: issueAccessToken(record.clientId, record.scope), refresh_token: refresh, token_type: "Bearer", expires_in: Math.floor(accessTtlMs / 1000), scope: record.scope }); } if (form.get("grant_type") === "refresh_token") { const refresh = String(form.get("refresh_token") || ""); const record = refreshTokens[refresh]; delete refreshTokens[refresh]; writeJson(refreshFile, refreshTokens); if (!record || record.expiresAt < Date.now() || record.clientId !== form.get("client_id")) return sendJson(res, 400, { error: "invalid_grant" }); const next = random(40); refreshTokens[next] = { ...record, expiresAt: Date.now() + refreshTtlMs }; writeJson(refreshFile, refreshTokens); return sendJson(res, 200, { access_token: issueAccessToken(record.clientId, record.scope), refresh_token: next, token_type: "Bearer", expires_in: Math.floor(accessTtlMs / 1000), scope: record.scope }); } return sendJson(res, 400, { error: "unsupported_grant_type" }); }

const server = http.createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); try { if (url.pathname === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true, engine: "AlaeddineMessadi/opencode-mcp@1.11.0", policy: "ctb", issuer, allowedRoots }); if (url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") return sendJson(res, 200, { resource: resourceUrl(), authorization_servers: [issuer], scopes_supported: [...validScopes], resource_documentation: `${issuer}/health` }, { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" }); if ((url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") && req.method === "GET") return sendJson(res, 200, { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [...validScopes], authorization_response_iss_parameter_supported: true }, { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" }); if (url.pathname === "/oauth/register" && req.method === "POST") { const registration = JSON.parse(await body(req)); const redirectUris = Array.isArray(registration.redirect_uris) ? registration.redirect_uris : []; if (!redirectUris.length || !redirectUris.every(allowedRedirect)) return sendJson(res, 400, { error: "invalid_redirect_uri" }); const clientId = `dcr_${random(18)}`; clients[clientId] = { client_id: clientId, client_name: String(registration.client_name || "MCP client"), redirect_uris: redirectUris, token_endpoint_auth_method: "none", created_at: new Date().toISOString() }; writeJson(clientsFile, clients); return sendJson(res, 201, { ...clients[clientId], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }); } if (url.pathname === "/oauth/authorize" && ["GET", "POST"].includes(req.method || "")) return handleAuthorize(req, res, url); if (url.pathname === "/oauth/token" && req.method === "POST") return handleToken(req, res); if (url.pathname === "/mcp" && req.method === "POST") return handleMcp(req, res); return sendJson(res, 404, { error: "Not found" }); } catch (error) { console.error("[opencode-ctb] request failed", error instanceof Error ? error.message : error); return sendJson(res, 500, { error: "Internal server error" }); } });
server.listen(port, "127.0.0.1", () => console.log(`[opencode-ctb] listening on http://127.0.0.1:${port}/mcp`));
