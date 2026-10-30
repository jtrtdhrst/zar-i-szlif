import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// mantic-mcp (stdio) -> MCP Streamable HTTP bridge.
// Lets Paperclip "Connect with a link" talk to the Mautic MCP server:
// Paperclip POSTs JSON-RPC (initialize / tools/list / tools/call) to /mcp,
// this bridge forwards everything to a long-lived mantic-mcp child process.
//
// NOTE: one facade Server + transport is created PER HTTP request (fully
// isolated, like Paperclip's own MCP gateway). Sharing a single
// StreamableHTTPServerTransport across requests breaks after `initialize`.

const PORT = Number(process.env.BRIDGE_PORT || 8090);
const HOST = process.env.BRIDGE_HOST || "0.0.0.0";
const BRIDGE_TOKEN = (process.env.BRIDGE_TOKEN || "").trim();
const CHILD_PATH = process.env.MANTIC_ENTRYPOINT || "/app/build/index.js";
const TOOL_CACHE_TTL_MS = 60_000;

function childEnv() {
  const env = { ...process.env };
  delete env.BRIDGE_TOKEN;
  return env;
}

let upstream = null; // SDK Client or null
let upstreamConnecting = null;
let toolCache = { at: 0, tools: [] };

async function connectUpstream() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CHILD_PATH],
    env: childEnv(),
  });
  const client = new Client(
    { name: "mantic-bridge-upstream", version: "1.0.0" },
    { capabilities: {} },
  );
  client.fallbackNotificationHandler = async () => {};
  transport.onclose = () => {
    if (upstream === client) upstream = null;
  };
  await client.connect(transport);
  upstream = client;
  await refreshTools(true);
  return client;
}

async function getUpstream() {
  if (upstream) return upstream;
  if (!upstreamConnecting) {
    upstreamConnecting = connectUpstream().finally(() => {
      upstreamConnecting = null;
    });
  }
  return upstreamConnecting;
}

function dropUpstream() {
  const current = upstream;
  upstream = null;
  toolCache = { at: 0, tools: [] };
  if (current) {
    void current.close().catch(() => {});
  }
}

async function refreshTools(force = false) {
  if (!force && Date.now() - toolCache.at < TOOL_CACHE_TTL_MS && toolCache.tools.length > 0) {
    return toolCache.tools;
  }
  const client = await getUpstream();
  const result = await client.listTools();
  toolCache = { at: Date.now(), tools: result.tools ?? [] };
  return toolCache.tools;
}

async function forward(name, args) {
  const client = await getUpstream();
  const result = await client.callTool({
    name,
    arguments: args ?? {},
  });
  const out = { content: result.content ?? [] };
  if (result.isError !== undefined) out.isError = result.isError;
  if (result._meta !== undefined) out._meta = result._meta;
  return out;
}

async function callUpstreamTool(name, args) {
  try {
    return await forward(name, args);
  } catch (error) {
    // Child may have died: reconnect once and retry.
    dropUpstream();
    return await forward(name, args);
  }
}

function createFacade() {
  const facade = new Server(
    { name: "mantic-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  facade.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await refreshTools(),
  }));

  facade.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callUpstreamTool(
        request.params.name,
        request.params.arguments,
      );
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Mautic bridge error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return facade;
}

function bearerToken(req) {
  const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function authorized(req) {
  if (!BRIDGE_TOKEN) return true;
  const token = bearerToken(req);
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(BRIDGE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4_000_000) throw new Error("Request body exceeds 4 MB");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "mantic-bridge",
        upstream: upstream ? "connected" : "pending",
        cachedTools: toolCache.tools.length,
      });
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed; use POST" }, { allow: "POST" });
      return;
    }
    if (!authorized(req)) {
      sendJson(
        res,
        401,
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        },
        { "www-authenticate": "Bearer" },
      );
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: error instanceof Error ? error.message : "Parse error" },
        id: null,
      });
      return;
    }

    const facade = createFacade();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: each POST stands alone
    });
    res.on("close", () => {
      void transport.close();
      void facade.close();
    });
    await facade.connect(transport);
    await transport.handleRequest(req, res, body);
  })().catch((error) => {
    console.error("Bridge request failed", error);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal bridge error" });
    else res.end();
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`mantic-bridge listening on http://${HOST}:${PORT}/mcp`);
});

// Warm up the upstream child so the first Paperclip probe is fast.
void getUpstream()
  .then(() => console.log(`Upstream mantic-mcp connected (${toolCache.tools.length} tools)`))
  .catch((error) => console.error("Upstream warm-up failed (will retry on demand)", error));
