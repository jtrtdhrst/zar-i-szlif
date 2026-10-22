/**
 * mantic MCP — Cloudflare Worker.
 *
 * Ten sam zestaw narzędzi co stdio serwer (`mcp/mantic/src`, Mautic 7),
 * tylko transport: MCP Streamable HTTP (Web Standard) zamiast stdio.
 * Moduły narzędzi są współdzielone z wersją stdio — jedno źródło prawdy.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { MauticApiClient } from "../../src/api/client.js";
import { allToolDefinitions, dispatchTool } from "../../src/tools/index.js";

export interface Env {
  MAUTIC_BASE_URL: string;
  MAUTIC_CLIENT_ID: string;
  MAUTIC_CLIENT_SECRET: string;
  MAUTIC_TOKEN_ENDPOINT: string;
  MCP_AUTH_TOKEN: string;
}

/** Token klienta trzymany per-isolate (MauticApiClient cache'uje token OAuth). */
let cachedClient: MauticApiClient | undefined;

function apiClient(env: Env): MauticApiClient {
  if (!cachedClient) {
    cachedClient = new MauticApiClient({
      baseUrl: env.MAUTIC_BASE_URL,
      clientId: env.MAUTIC_CLIENT_ID,
      clientSecret: env.MAUTIC_CLIENT_SECRET,
      tokenEndpoint: env.MAUTIC_TOKEN_ENDPOINT,
    });
  }
  return cachedClient;
}

/** Porównanie stałoczasowe bez zależności od node:crypto (Worker bez nodejs_compat). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }),
    { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const header = request.headers.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!env.MCP_AUTH_TOKEN || !safeEqual(token, env.MCP_AUTH_TOKEN)) return unauthorized();

    const server = new Server(
      { name: "mantic-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allToolDefinitions as never,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      try {
        return (await dispatchTool(
          req.params.name,
          apiClient(env),
          req.params.arguments ?? {},
        )) as never;
      } catch (error) {
        if (error instanceof McpError) throw error;
        if (axios.isAxiosError(error)) {
          const message = MauticApiClient.extractErrorMessage(error);
          return {
            content: [{ type: "text", text: `Mautic API Error: ${message}` }],
            isError: true,
          } as never;
        }
        throw new McpError(ErrorCode.InternalError, `Unexpected error: ${error}`);
      }
    });

    // Tryb bezstanowy: nowy serwer + transport na żądanie (jak w bridge.mjs).
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
