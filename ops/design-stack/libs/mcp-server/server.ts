// Wspólny transport MCP (Etap 2/18): stdio (OpenCode lokalnie) +
// Streamable HTTP (zdalni klienci) z Bearer auth, rate limitingiem,
// limitem rozmiaru, timeoutami oraz /health i /ready.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodRawShape;
  /**
   * Adnotacje MCP (readOnlyHint/destructiveHint/idempotentHint). Platforma
   * klasyfikuje narzędzia właśnie po nich: bez adnotacji narzędzie zapisujące
   * wygląda jak read-only i omija politykę zatwierdzania zmian.
   */
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ServeOptions {
  name: string;
  version: string;
  tools: ToolDef[];
  httpPort?: number; // brak = tylko stdio
  authTokens?: string[]; // Bearer dla HTTP; puste = odmowa HTTP (poza /health)
  toolTimeoutMs?: number;
  maxBodyBytes?: number;
  rateLimitPerMin?: number;
  readyChecks?: Record<string, () => Promise<{ ok: boolean; detail?: string }>>;
  log?: (msg: string) => void;
}

function textResult(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

export function buildMcpServer(
  name: string,
  version: string,
  tools: ToolDef[],
  toolTimeoutMs: number,
  log: (msg: string) => void,
): McpServer {
  const server = new McpServer({ name, version });
  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema, annotations: t.annotations },
      async (args) => {
        const started = Date.now();
        try {
          const result = await Promise.race([
            Promise.resolve(t.handler(args as Record<string, unknown>)),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error(`TOOL_TIMEOUT ${t.name}`)), toolTimeoutMs),
            ),
          ]);
          log(`${t.name} ok ${Date.now() - started}ms`);
          return textResult({ ok: true, ...(result as object) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`${t.name} FAIL ${message.slice(0, 200)}`);
          return textResult({ ok: false, error: message });
        }
      },
    );
  }
  return server;
}

export async function serve(opts: ServeOptions): Promise<void> {
  const log = opts.log ?? ((m) => console.error(`[${opts.name}] ${m}`));
  const toolTimeoutMs = opts.toolTimeoutMs ?? 60_000;

  if (!opts.httpPort) {
    await buildMcpServer(opts.name, opts.version, opts.tools, toolTimeoutMs, log).connect(
      new StdioServerTransport(),
    );
    log("stdio ready");
    return;
  }

  // HTTP: każdy request dostaje świeży, bezstanowy transport (proste,
  // restartowalne, brak sesji do wyciekania między agentami).
  const hits = new Map<string, number[]>();
  const rateLimit = opts.rateLimitPerMin ?? 120;
  const maxBody = opts.maxBodyBytes ?? 1_000_000;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: opts.name }));
        return;
      }
      if (url.pathname === "/ready") {
        const checks: Record<string, unknown> = {};
        let allOk = true;
        for (const [k, fn] of Object.entries(opts.readyChecks ?? {})) {
          try {
            checks[k] = await fn();
            if (!(checks[k] as { ok: boolean }).ok) allOk = false;
          } catch (e) {
            allOk = false;
            checks[k] = { ok: false, detail: String(e).slice(0, 200) };
          }
        }
        res.writeHead(allOk ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: allOk, checks }));
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404).end("not found");
        return;
      }
      // Auth (Etap 2/15): brak tokenów = HTTP API wyłączone.
      const tokens = opts.authTokens?.filter(Boolean) ?? [];
      const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (tokens.length === 0 || !tokens.includes(got)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const ip = req.socket.remoteAddress ?? "?";
      const now = Date.now();
      const window = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
      window.push(now);
      hits.set(ip, window);
      if (window.length > rateLimit) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end("method not allowed");
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > maxBody) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "body_too_large" }));
          return;
        }
        chunks.push(c as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcp = buildMcpServer(opts.name, opts.version, opts.tools, toolTimeoutMs, log);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch((e) => {
      log(`http FAIL ${String(e).slice(0, 200)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal" }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.httpPort, "0.0.0.0", resolve));
  log(`http ready on 0.0.0.0:${opts.httpPort} (bez publikacji portów; TLS/sieć zapewnia infra)`);
}
