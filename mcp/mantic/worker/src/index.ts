/**
 * mantic MCP — Cloudflare Worker.
 *
 * Protokół MCP (Streamable HTTP) obsłużony ręcznie: bez @modelcontextprotocol/sdk
 * i bez axiosa — bundle ~15 KB zamiast 1,2 MB. Narzędzia są te same co w wersji
 * stdio (mcp/mantic/src), tylko transport i klient HTTP są Workerowe.
 */
import { allToolDefinitions, dispatchTool } from "../../src/tools/index.js";
import { MauticRequestError, MauticWorkerClient } from "./mautic-client.js";

export interface Env {
  MAUTIC_BASE_URL: string;
  MAUTIC_CLIENT_ID: string;
  MAUTIC_CLIENT_SECRET: string;
  MAUTIC_TOKEN_ENDPOINT: string;
  MCP_AUTH_TOKEN: string;
}

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "mantic-mcp", version: "2.0.0" };

let cachedClient: MauticWorkerClient | undefined;

function apiClient(env: Env): MauticWorkerClient {
  if (!cachedClient) {
    cachedClient = new MauticWorkerClient({
      baseUrl: env.MAUTIC_BASE_URL,
      clientId: env.MAUTIC_CLIENT_ID,
      clientSecret: env.MAUTIC_CLIENT_SECRET,
      tokenEndpoint: env.MAUTIC_TOKEN_ENDPOINT,
    });
  }
  return cachedClient;
}

/** Porównanie stałoczasowe bez node:crypto (Worker bez nodejs_compat). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, mcp-session-id",
      "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
    },
  });
}

async function handleRpc(request: JsonRpcRequest, env: Env): Promise<Response> {
  const { id, method, params } = request;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202 });
  }
  if (method === "ping") {
    return jsonResponse({ jsonrpc: "2.0", id, result: {} });
  }
  if (method === "tools/list") {
    return jsonResponse({ jsonrpc: "2.0", id, result: { tools: allToolDefinitions } });
  }
  if (method === "tools/call") {
    const name = String((params as { name?: string } | undefined)?.name ?? "");
    const args = ((params as { arguments?: unknown } | undefined)?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatchTool(name, apiClient(env) as never, args);
      return jsonResponse({ jsonrpc: "2.0", id, result });
    } catch (error) {
      const message =
        error instanceof MauticRequestError
          ? `Mautic API Error: ${error.message}`
          : `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      return jsonResponse({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: message }], isError: true },
      });
    }
  }

  if (isNotification) return new Response(null, { status: 202 });
  return jsonResponse(
    { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } },
    400,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization, content-type, mcp-session-id",
          "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
        },
      });
    }
    if (request.method !== "POST") {
      // Streamable HTTP: bez sesji SSE klient może zapytać tylko POST.
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST, OPTIONS" },
      });
    }

    const header = request.headers.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!env.MCP_AUTH_TOKEN || !safeEqual(token, env.MCP_AUTH_TOKEN)) {
      return jsonResponse(
        { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
        401,
      );
    }

    let payload: JsonRpcRequest;
    try {
      payload = (await request.json()) as JsonRpcRequest;
    } catch {
      return jsonResponse({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
    }
    return handleRpc(payload, env);
  },
};
