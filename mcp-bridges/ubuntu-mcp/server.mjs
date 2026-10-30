// ubuntu-mcp-bridge: private authenticated Streamable HTTP MCP -> mcp-ssh-manager stdio.
// Paperclip Tool Gateway -> POST /mcp (Bearer) -> stdio child -> SSH -> Ubuntu.
// No secrets in code/logs. Audit JSONL with redaction. Stateless HTTP (multi-session safe).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.BRIDGE_PORT || "8765");
const TOKEN_FILE = process.env.BRIDGE_TOKEN_FILE || "/bridge-config/bridge-bearer-token";
const CHILD_CMD = process.env.BRIDGE_CHILD_CMD || "node";
const CHILD_ARGS = (process.env.BRIDGE_CHILD_ARGS || "/opt/mcp-ssh-manager/src/index.js").split(" ").filter(Boolean);
const AUDIT_FILE = process.env.BRIDGE_AUDIT_FILE || "/audit/ubuntu-mcp-audit.jsonl";
const CALL_TIMEOUT_MS = Number(process.env.BRIDGE_CALL_TIMEOUT_MS || "120000");

const token = readFileSync(TOKEN_FILE, "utf8").trim();
if (!token) { console.error("empty bearer token"); process.exit(1); }

function redact(value) {
  if (typeof value === "string") {
    let s = value;
    s = s.replace(/pcp_[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]");
    s = s.replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]");
    s = s.replace(/("?(?:password|secret|token|api[_-]?key|passphrase|sudoPassword)"?\s*[:=]\s*"?)[^",\s}]{4,}("?)/gi, "$1[REDACTED]$2");
    return s.length > 4000 ? s.slice(0, 4000) + "...[truncated]" : s;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = redact(v);
    return o;
  }
  return value;
}
function audit(entry) {
  try { appendFileSync(AUDIT_FILE, JSON.stringify({ t: new Date().toISOString(), ...redact(entry) }) + "\n"); }
  catch (e) { console.error("audit write failed", e.message); }
}

// ---- stdio child supervision (single channel, serialized queue) ----
let child = null;
let seq = 0;
const pending = new Map(); // id -> {resolve,reject,timer,payload}
let buf = "";
function startChild() {
  child = spawn(CHILD_CMD, CHILD_ARGS, { stdio: ["pipe", "pipe", "inherit"] });
  child.on("exit", (code) => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(`child exited (${code})`)); }
    pending.clear();
    setTimeout(() => { console.error("respawning stdio child"); startChild(); }, 1000);
  });
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = msg.id !== undefined ? pending.get(String(msg.id)) : null;
      if (p) { clearTimeout(p.timer); pending.delete(String(msg.id)); p.resolve(msg); }
    }
  });
}
startChild();

function childCall(payload) {
  return new Promise((resolve, reject) => {
    if (!child || child.exitCode !== null) return reject(new Error("child unavailable"));
    const id = payload.id ?? `b${++seq}`;
    const msg = { ...payload, id };
    const timer = setTimeout(() => { pending.delete(String(id)); reject(new Error("child call timeout")); }, CALL_TIMEOUT_MS);
    pending.set(String(id), { resolve, reject, timer });
    child.stdin.write(JSON.stringify(msg) + "\n", (e) => { if (e) { clearTimeout(timer); pending.delete(String(id)); reject(e); } });
  });
}
function childNotify(payload) {
  if (child && child.exitCode === null) child.stdin.write(JSON.stringify(payload) + "\n");
}

// ---- HTTP ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { chunks.push(c); n += c.length; if (n > 4 * 1024 * 1024) { req.destroy(); reject(new Error("body too large")); } });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function authed(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return false;
  const got = Buffer.from(h.slice(7)); const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

const server = createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    const ok = child && child.exitCode === null;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, service: "ubuntu-mcp-bridge", sshManager: "3.8.6", childAlive: ok, pending: pending.size }));
    return;
  }
  if (req.url !== "/mcp" || req.method !== "POST") {
    res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not_found" })); return;
  }
  if (!authed(req)) {
    const h = req.headers.authorization || "";
    const scheme = h ? h.split(" ")[0] : "none";
    audit({ event: "http_auth_denied", scheme, path: req.url, method: req.method });
    res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return;
  }
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad_json" })); return;
  }
  const t0 = Date.now();
  const isCall = payload.method === "tools/call" && payload.params?.name;
  try {
    if (payload.id === undefined) { childNotify(payload); res.writeHead(202, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return; }
    const out = await childCall(payload);
    if (isCall) {
      const err = out.error ? String(out.error.message || out.error).slice(0, 500) : null;
      audit({ event: "tool_call", tool: payload.params.name, args: payload.params.arguments || {}, error: err, ms: Date.now() - t0, pending: pending.size });
    }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
  } catch (e) {
    if (isCall) audit({ event: "tool_call", tool: payload.params.name, args: payload.params.arguments || {}, error: String(e.message).slice(0, 500), ms: Date.now() - t0 });
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id ?? null, error: { code: -32000, message: `bridge: ${e.message}` } }));
  }
});
server.listen(PORT, "0.0.0.0", () => console.log(`ubuntu-mcp-bridge listening on 0.0.0.0:${PORT} (private container networks only, no published ports)`));
