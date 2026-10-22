import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 3001);
const TOKEN_FILE = process.env.MCP_TOKEN_FILE || '/run/secrets/mcp-token';
const NATIVE_URL = process.env.NATIVE_MCP_URL || 'http://penpot-mcp:4401/mcp';
const HEADLESS_URL = process.env.HEADLESS_MCP_URL || 'http://penpot-headless:3000/mcp';
const DOC_TOOLS = new Set(['high_level_overview', 'penpot_api_info']);
const sessions = new Map();
let headlessToolNames = null;
let headlessToolsAt = 0;

function readToken() {
  try { return readFileSync(TOKEN_FILE, 'utf8').trim(); }
  catch { return ''; }
}

const bootToken = readToken();
if (!bootToken) throw new Error('MCP auth token is unavailable');

function logEvent(event, detail) {
  // Sanitized: never log query strings, tokens, or request bodies.
  try {
    process.stderr.write(JSON.stringify({ t: new Date().toISOString(), event, ...detail }) + '\n');
  } catch {}
}

function validToken(supplied) {
  // Re-read per request so a token rotation does not require a rebuild.
  const expected = readToken();
  if (!supplied || !expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function parseBody(raw) {
  if (!raw?.trim()) return null;
  try { return JSON.parse(raw); } catch {}
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    try { return JSON.parse(line.slice(6)); } catch {}
  }
  return null;
}

async function postUpstream(base, token, payload, sessionId, protocolVersion, timeoutMs = 120000) {
  const url = new URL(base);
  url.searchParams.set('userToken', token);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': 'penpot-mcp-router/1.0',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (protocolVersion || payload?.params?.protocolVersion) {
    headers['mcp-protocol-version'] = protocolVersion || payload.params.protocolVersion;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || 'application/json',
    sessionId: response.headers.get('mcp-session-id') || sessionId,
    protocolVersion: response.headers.get('mcp-protocol-version') || protocolVersion,
    body: parseBody(raw),
    raw,
  };
}

function sendJson(res, status, body, sessionId, protocolVersion) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (sessionId) res.setHeader('mcp-session-id', sessionId);
  if (protocolVersion) res.setHeader('mcp-protocol-version', protocolVersion);
  res.end(body === null ? '' : JSON.stringify(body));
}

function sendUpstream(res, upstream, clientSessionId, protocolVersion) {
  res.statusCode = upstream.status;
  res.setHeader('content-type', upstream.contentType);
  if (clientSessionId) res.setHeader('mcp-session-id', clientSessionId);
  const version = protocolVersion || upstream.protocolVersion;
  if (version) res.setHeader('mcp-protocol-version', version);
  res.end(upstream.raw || '');
}

function pruneSessions() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of sessions) if (session.lastSeen < cutoff) sessions.delete(id);
}

async function streamNative(req, res, token, session) {
  const url = new URL(NATIVE_URL);
  url.searchParams.set('userToken', token);
  const headers = { accept: req.headers.accept || 'text/event-stream', 'user-agent': 'penpot-mcp-router/1.0' };
  if (session.nativeSessionId) headers['mcp-session-id'] = session.nativeSessionId;
  if (session.protocolVersion) headers['mcp-protocol-version'] = session.protocolVersion;
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  const upstream = await fetch(url, { method: 'GET', headers, signal: controller.signal });
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'text/event-stream',
    ...(session.nativeSessionId ? { 'mcp-session-id': session.nativeSessionId } : {}),
  });
  if (upstream.body) {
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
    }
  }
  res.end();
}

async function closeNativeSession(token, session) {
  const url = new URL(NATIVE_URL);
  url.searchParams.set('userToken', token);
  const headers = { 'user-agent': 'penpot-mcp-router/1.0' };
  if (session.nativeSessionId) headers['mcp-session-id'] = session.nativeSessionId;
  if (session.protocolVersion) headers['mcp-protocol-version'] = session.protocolVersion;
  return fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
}

async function getHeadlessTools(token, protocolVersion) {
  const now = Date.now();
  if (headlessToolNames && now - headlessToolsAt < 30000) return headlessToolNames;
  const response = await postUpstream(HEADLESS_URL, token, {
    jsonrpc: '2.0', id: `router-tools-${randomUUID()}`, method: 'tools/list', params: {},
  }, null, protocolVersion, 15000);
  const tools = response.body?.result?.tools;
  if (response.status < 200 || response.status >= 300 || !Array.isArray(tools)) {
    throw new Error('headless tools unavailable');
  }
  headlessToolNames = new Set(tools.map((tool) => tool.name));
  headlessToolsAt = now;
  return headlessToolNames;
}

async function fetchHeadlessToolList(token, requestBody, protocolVersion) {
  const response = await postUpstream(HEADLESS_URL, token, requestBody, null, protocolVersion, 15000);
  const tools = response.body?.result?.tools;
  if (response.status < 200 || response.status >= 300 || !Array.isArray(tools)) {
    throw new Error('headless tools unavailable');
  }
  headlessToolNames = new Set(tools.map((tool) => tool.name));
  headlessToolsAt = Date.now();
  return { response, tools };
}

async function probeNativePlugin(token, session) {
  try {
    const result = await postUpstream(NATIVE_URL, token, {
      jsonrpc: '2.0',
      id: `router-probe-${randomUUID()}`,
      method: 'tools/call',
      params: { name: 'execute_code', arguments: { code: 'return {ok:true};' } },
    }, session?.nativeSessionId || null, session?.protocolVersion, 10000);
    const text = JSON.stringify(result.body || {});
    return result.status >= 200 && result.status < 300 &&
      !result.body?.error && !result.body?.result?.isError &&
      !/No Penpot instance connected|suspended by the browser/i.test(text);
  } catch {
    return false;
  }
}

function jsonRpcToolError(id, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: { isError: true, content: [{ type: 'text', text: message }] },
  };
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  if (!validToken(url.searchParams.get('userToken'))) {
    logEvent('auth_rejected', { method: req.method, path: url.pathname, hasSession: Boolean(req.headers['mcp-session-id']) });
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
    return;
  }
  const earlySessionId = req.headers['mcp-session-id'];
  const earlySession = earlySessionId ? sessions.get(earlySessionId) : undefined;
  if (req.method === 'GET') {
    // Streamable HTTP clients may open a GET SSE channel on an established session.
    // Proxy it to native when the session is native; otherwise there is no stream to serve.
    if (earlySession?.mode === 'native' && earlySession.nativeSessionId) {
      try {
        await streamNative(req, res, url.searchParams.get('userToken'), earlySession);
      } catch {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"upstream_unavailable"}');
      }
    } else {
      res.writeHead(405, { allow: 'POST, DELETE' }).end();
    }
    return;
  }
  if (req.method === 'DELETE') {
    if (earlySessionId) sessions.delete(earlySessionId);
    if (earlySession?.mode === 'native' && earlySession.nativeSessionId) {
      try {
        const closed = await closeNativeSession(url.searchParams.get('userToken'), earlySession);
        res.writeHead(closed.status).end(await closed.text());
      } catch {
        res.writeHead(204).end();
      }
    } else {
      res.writeHead(204).end();
    }
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST, DELETE' }).end();
    return;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) {
      res.writeHead(413).end();
      return;
    }
  }
  let body;
  try { body = JSON.parse(raw); }
  catch {
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
    return;
  }

  const token = url.searchParams.get('userToken');
  const clientSessionId = req.headers['mcp-session-id'];
  const requestedProtocol = req.headers['mcp-protocol-version'] || body.params?.protocolVersion;
  pruneSessions();
  const session = clientSessionId ? sessions.get(clientSessionId) : undefined;
  if (session) session.lastSeen = Date.now();
  const protocolVersion = requestedProtocol || session?.protocolVersion;

  if (body.method === 'initialize') {
    try {
      const native = await postUpstream(NATIVE_URL, token, body, null, protocolVersion, 15000);
      if (native.status >= 200 && native.status < 300 && native.body && !native.body.error) {
        const nativeSessionId = native.sessionId || null;
        const id = nativeSessionId || randomUUID();
        const version = native.protocolVersion || body.params?.protocolVersion || '2025-06-18';
        sessions.set(id, { mode: 'native', nativeSessionId, pluginConnected: null, protocolVersion: version, lastSeen: Date.now() });
        logEvent('initialize', { route: 'native', client: body.params?.clientInfo?.name || 'unknown' });
        sendJson(res, native.status, native.body, id, version);
        return;
      }
    } catch {}

    const headless = await postUpstream(HEADLESS_URL, token, body, null, protocolVersion, 15000);
    const id = randomUUID();
    const version = headless.protocolVersion || body.params?.protocolVersion || '2025-06-18';
    sessions.set(id, { mode: 'headless', nativeSessionId: null, pluginConnected: false, protocolVersion: version, lastSeen: Date.now() });
    logEvent('initialize', { route: 'headless', client: body.params?.clientInfo?.name || 'unknown' });
    sendJson(res, headless.status, headless.body, id, version);
    return;
  }

  if (body.method === 'notifications/initialized') {
    if (session?.mode === 'headless' || !session?.nativeSessionId) {
      res.writeHead(202).end();
      return;
    }
    const initialized = await postUpstream(NATIVE_URL, token, body, session.nativeSessionId, protocolVersion, 15000);
    sendUpstream(res, initialized, clientSessionId, protocolVersion);
    return;
  }

  if (body.method === 'tools/list') {
    if (session?.mode === 'headless') {
      try {
        const headless = await fetchHeadlessToolList(token, body, protocolVersion);
        sendJson(res, headless.response.status, headless.response.body, clientSessionId, protocolVersion);
      } catch {
        sendJson(res, 503, { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32000, message: 'Headless Penpot RPC is unavailable' } }, clientSessionId, protocolVersion);
      }
      return;
    }

    // The two list fetches are independent — run them concurrently.
    const [headless, nativeList] = await Promise.all([
      fetchHeadlessToolList(token, body, protocolVersion).catch(() => null),
      session?.mode === 'native'
        ? postUpstream(NATIVE_URL, token, body, session.nativeSessionId, protocolVersion, 15000).catch(() => null)
        : null,
    ]);
    const nativeTools = nativeList?.body?.result?.tools || [];
    if (session?.mode === 'native') {
      session.pluginConnected = await probeNativePlugin(token, session);
    }

    const visibleNative = session?.pluginConnected
      ? nativeTools
      : nativeTools.filter((tool) => DOC_TOOLS.has(tool.name));
    const tools = [
      ...visibleNative,
      ...(headless?.tools || []).map((tool) => ({
        ...tool,
        description: `[Headless RPC; works without an open Penpot tab] ${tool.description || ''}`.trim(),
      })),
    ];
    if (!session?.pluginConnected && !headless) {
      logEvent('tools_list_unavailable', { mode: session?.mode || 'none' });
      sendJson(res, 503, { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32000, message: 'Headless Penpot RPC is unavailable' } }, clientSessionId, protocolVersion);
      return;
    }
    logEvent('tools_list', { mode: session?.mode || 'none', plugin: Boolean(session?.pluginConnected), toolCount: tools.length });
    sendJson(res, 200, { jsonrpc: '2.0', id: body.id ?? null, result: { tools } }, clientSessionId, protocolVersion);
    return;
  }

  if (body.method === 'tools/call') {
    const toolName = body.params?.name;
    const headlessNames = await getHeadlessTools(token, protocolVersion).catch(() => new Set());
    if (headlessNames.has(toolName)) {
      logEvent('tools_call', { tool: toolName, route: 'headless', mode: session?.mode || 'none' });
      const headless = await postUpstream(HEADLESS_URL, token, body, null, protocolVersion, 120000);
      sendUpstream(res, headless, clientSessionId, protocolVersion);
      return;
    }

    if (session?.mode === 'headless') {
      sendJson(res, 200, jsonRpcToolError(body.id, 'The native MCP server is unavailable. Use one of the headless RPC tools returned by tools/list.'), clientSessionId, protocolVersion);
      return;
    }

    if (session?.mode === 'native' && session.pluginConnected === false && !DOC_TOOLS.has(toolName)) {
      session.pluginConnected = await probeNativePlugin(token, session);
    }
    if (session?.mode === 'native' && session.pluginConnected === false && !DOC_TOOLS.has(toolName)) {
      sendJson(res, 200, jsonRpcToolError(body.id, 'No active Penpot plugin session. Use the headless RPC tools in this same MCP connection; they do not require a browser tab.'), clientSessionId, protocolVersion);
      return;
    }

    logEvent('tools_call', { tool: toolName, route: 'native', mode: session?.mode || 'none' });
    const native = await postUpstream(NATIVE_URL, token, body, session?.nativeSessionId || null, protocolVersion, 120000);
    const nativeText = JSON.stringify(native.body || {});
    if (/No Penpot instance connected|suspended by the browser/i.test(nativeText) && session) {
      session.pluginConnected = false;
    }
    sendUpstream(res, native, clientSessionId, protocolVersion);
    return;
  }

  if (session?.mode === 'headless') {
    const headless = await postUpstream(HEADLESS_URL, token, body, null, protocolVersion, 120000);
    sendUpstream(res, headless, clientSessionId, protocolVersion);
    return;
  }
  const native = await postUpstream(NATIVE_URL, token, body, session?.nativeSessionId || null, protocolVersion, 120000);
  sendUpstream(res, native, clientSessionId, protocolVersion);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    logEvent('internal_error', { message: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    if (res.headersSent) res.destroy();
    else res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"internal"}');
  });
}).listen(PORT, '0.0.0.0');
