// Emailens MCP bridge (persistent): internal authorized Streamable-HTTP transport.
// Owns at most ONE emailens stdio child, spawned lazily and killed after
// IDLE_SECONDS without MCP traffic; the HTTP proxy itself stays up and
// respawns the backend on the next request. Logs to stderr only.
// Bearer token required on /mcp.
import express from "express";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOKEN = process.env.EMAILENS_BRIDGE_TOKEN || "";
if (!TOKEN) { console.error("[bridge] EMAILENS_BRIDGE_TOKEN is required"); process.exit(2); }
const PORT = Number(process.env.PORT || 3100);
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const EMAILENS_ENTRY = process.env.EMAILENS_ENTRY || "/usr/local/lib/node_modules/@emailens/mcp/dist/index.js";
const IDLE_SECONDS = (() => {
  const v = parseInt(process.env.IDLE_SECONDS || "600", 10);
  return Number.isFinite(v) && v >= 10 ? v : 600; // cannot be disabled, min 10s (tests)
})();

const log = (...a) => console.error("[bridge]", ...a);

function authed(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  const got = Buffer.from(h.slice(7));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- lazy backend: spawned on demand, killed after IDLE_SECONDS idle ----
let closing = false;
let child = null;
let lastActive = Date.now();
let bootQueue = null; // callbacks waiting for a boot
const touch = () => { lastActive = Date.now(); };

let nextId = 0;
let pending = null;
let rxBuf = "";
const queue = [];

function pump() {
  if (!child || pending || queue.length === 0) return;
  pending = queue.shift();
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: pending.id, method: pending.method, params: pending.params }) + "\n");
  } catch (e) {
    const p = pending; pending = null;
    p.reject(e);
    markDead();
  }
}
function mcpRequest(method, params, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      if (pending?.id === id) pending = null;
      reject(new Error(`backend timeout on ${method}`));
      pump();
    }, timeoutMs);
    queue.push({ id, method, params,
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); } });
    pump();
  });
}
function onChildData(d) {
  rxBuf += d.toString();
  let nl;
  while ((nl = rxBuf.indexOf("\n")) >= 0) {
    const line = rxBuf.slice(0, nl).trim();
    rxBuf = rxBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== pending?.id) continue;
    const p = pending; pending = null;
    if (msg.error) p.reject(new Error(`backend: ${JSON.stringify(msg.error).slice(0, 300)}`));
    else p.resolve(msg.result);
    pump();
  }
}
function markDead() {
  child = null;
  rxBuf = "";
  if (pending) { const p = pending; pending = null; p.reject(new Error("backend gone")); }
}
function killBackend(reason) {
  if (!child) return;
  log(`stopping backend (${reason})`);
  try { child.kill("SIGTERM"); } catch {}
  const dead = child;
  setTimeout(() => { try { dead.kill("SIGKILL"); } catch {} }, 5000).unref();
  markDead();
}
function ensureBackend(cb) {
  touch();
  if (child) return cb(null);
  if (bootQueue) return bootQueue.push(cb);
  bootQueue = [cb];
  log("spawning backend...");
  const c = spawn("node", [EMAILENS_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
  c.stderr.on("data", (d) => process.stderr.write(`[emailens] ${d}`));
  c.on("exit", (code, sig) => {
    log(`backend exited code=${code} sig=${sig}`);
    if (child === c) markDead(); // persistent: stay up, respawn lazily
  });
  c.stdout.on("data", onChildData);
  const t0 = Date.now();
  const tryInit = async () => {
    if (closing) return done(new Error("shutting down"));
    try {
      child = c;
      await mcpRequest("initialize", {
        protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "emailens-bridge", version: "0.10.0" },
      });
      c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      log(`backend ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      done(null);
    } catch (e) {
      child = null;
      if (Date.now() - t0 > 60000) { try { c.kill("SIGKILL"); } catch {} return done(new Error("backend boot timeout")); }
      child = c;
      setTimeout(tryInit, 1000);
    }
  };
  const done = (err) => { const q = bootQueue; bootQueue = null; q.forEach((f) => f(err)); };
  setTimeout(tryInit, 800);
}
// idle watcher: kill ONLY the backend (proxy stays, respawns on demand)
setInterval(() => {
  if (closing || !child) return;
  const idle = (Date.now() - lastActive) / 1000;
  if (idle > IDLE_SECONDS) killBackend(`idle ${Math.round(idle)}s > ${IDLE_SECONDS}s`);
}, 5000).unref();

// ---- per-session MCP server, all delegating to the (lazy) backend ----
function makeServer() {
  const server = new Server({ name: "emailens", version: "0.10.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    await new Promise((res, rej) => ensureBackend((e) => e ? rej(e) : mcpRequest("tools/list", {}).then(res, rej))));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    await new Promise((res, rej) => ensureBackend((e) => e ? rej(e) : mcpRequest("tools/call", { name: req.params.name, arguments: req.params.arguments || {} }).then(res, rej))));
  return server;
}
const sessions = new Map();
const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/healthz", (_req, res) => res.json({ ok: true, backend: !!child, uptime: Math.round(process.uptime()) }));

async function handlePost(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  touch();
  try {
    const sid = req.headers["mcp-session-id"];
    if (sid && sessions.has(sid)) { await sessions.get(sid).handleRequest(req, res, req.body); return; }
    const isInit = req.body?.method === "initialize";
    if (!sid && !isInit) {
      // Stateless one-shot for simple clients (Paperclip Apps check).
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await makeServer().connect(transport);
        await transport.handleRequest(req, res, req.body);
      } finally {
        try { await transport.close(); } catch {}
      }
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
      onsessionclosed: (id) => sessions.delete(id),
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await makeServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    log("POST error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: "bridge failure" });
  }
}
async function handleSession(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  // No touch(): an open SSE stream must not keep the backend alive.
  const t = req.headers["mcp-session-id"] && sessions.get(req.headers["mcp-session-id"]);
  if (!t) { res.status(404).json({ error: "unknown session" }); return; }
  try { await t.handleRequest(req, res); }
  catch (e) { log("session error:", e?.message || e); if (!res.headersSent) res.status(500).json({ error: "bridge failure" }); }
}
app.post(MCP_PATH, handlePost);
app.get(MCP_PATH, handleSession);
app.delete(MCP_PATH, handleSession);

const http = app.listen(PORT, "0.0.0.0", () => log(`listening on :${PORT}${MCP_PATH} (idle ${IDLE_SECONDS}s)`));

function shutdown(sig) {
  if (closing) return;
  closing = true;
  log(`received ${sig}`);
  killBackend("shutdown");
  setTimeout(() => { try { http.close(); } catch {} process.exit(0); }, 500).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
