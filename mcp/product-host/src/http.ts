// HTTP surface:
//   GET  /health                                  public liveness/readiness
//   GET  /                                        public service info
//   GET  /.well-known/oauth-protected-resource    RFC 9728 protected-resource metadata
//   POST /mcp                                     Streamable HTTP MCP (stateless, bearer auth)
//   GET/DELETE /mcp                               405 by design (no SSE stream, no sessions)
//
// POST /mcp without a valid Supabase Auth access token returns 401 with the
// RFC 9728 challenge pointing at the metadata document above.

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthError, type Authenticator } from "./auth.ts";
import { SERVICE_NAME, SERVICE_VERSION, type Config } from "./config.ts";
import type { Logger } from "./logger.ts";
import { createProductMcpServer } from "./mcp-server.ts";
import type { SprawnoscRepository } from "./supabase.ts";

const MAX_BODY_BYTES = 256 * 1024;

export interface AppDeps {
  config: Config;
  logger: Logger;
  authenticate: Authenticator;
  repository: SprawnoscRepository;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function protectedResourceMetadata(config: Config): Record<string, unknown> {
  return {
    resource: `${config.publicOrigin}/mcp`,
    // Client-visible origin on purpose: the internal Supabase service URL is
    // not resolvable by any MCP client.
    authorization_servers: [`${config.supabasePublicUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile"],
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (size === 0) throw new HttpError(400, "request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

export function createApp(deps: AppDeps): Server {
  const { config, logger, authenticate, repository } = deps;
  const challenge = `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource"`;

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let actor: { sub: string };
    try {
      actor = authenticate(req.headers.authorization);
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : "invalid_token";
      logger.warn("rejected mcp request", { reason });
      sendJson(
        res,
        401,
        { error: "invalid_token", error_description: "a valid Supabase Auth access token is required" },
        { "www-authenticate": challenge },
      );
      return;
    }

    const body = await readJsonBody(req);

    const mcpServer = createProductMcpServer({
      repository,
      accessToken: extractToken(req.headers.authorization),
      logger,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void mcpServer.close().catch(() => {});
    };
    res.on("close", close);

    logger.debug("mcp request", { actor: actor.sub, method: req.method });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  return createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

      try {
        if (method === "GET" && pathname === "/health") {
          sendJson(res, 200, { ok: true, name: SERVICE_NAME, version: SERVICE_VERSION });
          return;
        }
        if (method === "GET" && pathname === "/") {
          sendJson(res, 200, {
            name: SERVICE_NAME,
            version: SERVICE_VERSION,
            mcp: "/mcp",
            transport: "streamable-http (stateless)",
            auth: "Supabase Auth access token in the Authorization header",
          });
          return;
        }
        if (method === "GET" && pathname === "/.well-known/oauth-protected-resource") {
          sendJson(res, 200, protectedResourceMetadata(config));
          return;
        }
        if (pathname === "/mcp") {
          if (method !== "POST") {
            sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
            return;
          }
          await handleMcp(req, res);
          return;
        }
        sendJson(res, 404, { error: "not_found" });
      } catch (error) {
        if (error instanceof HttpError) {
          if (!res.headersSent) sendJson(res, error.status, { error: error.message });
          else res.end();
          return;
        }
        logger.error("unhandled request failure", {
          path: pathname,
          reason: error instanceof Error ? error.name : typeof error,
        });
        if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
        else res.end();
      }
    })();
  });
}

function extractToken(header: string | undefined): string {
  const match = /^Bearer[ ]+(\S+)$/i.exec((header ?? "").trim());
  return match?.[1] ?? "";
}
