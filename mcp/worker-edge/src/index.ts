/**
 * Wspólna krawędź MCP dla usług, których silnika nie da się uruchomić w runtime
 * Cloudflare Workers (Python, TCP/Postgres, surowe SSH, plugin websocket).
 *
 * Ten moduł obsługuje 8 osobnych Workerów z własną konfiguracją
 * (`wrangler.<usługa>.jsonc`), nazwą, domeną i sekretami;
 * kod i zależności są wspólne. Źródła silników leżą w repo w `mcp/<usługa>/`.
 *
 * Worker: sprawdza Bearer token → przekazuje JSON-RPC do silnika (UPSTREAM_URL,
 * przez Cloudflare Tunnel) → zwraca odpowiedź strumieniowo (SSE).
 */
export interface EdgeEnv {
  /** Token wymagany od klienta (pusty = weryfikacja po stronie silnika). */
  MCP_AUTH_TOKEN?: string;
  /** Publiczny URL silnika (przez tunnel). */
  UPSTREAM_URL: string;
  /** Token dla silnika (nagłówek Authorization). Pusty = przekaż nagłówek klienta. */
  UPSTREAM_TOKEN?: string;
  /** Nazwa parametru query dla tokenu (np. userToken dla Penpot). */
  UPSTREAM_TOKEN_PARAM?: string;
  /** Paperclip-only identity-preserving OAuth/auth proxy; NEVER combine with shared edge credentials. */
  PAPERCLIP_AUTH_PROXY?: string;
}

/** Górna granica na odpowiedź silnika; dłuższe wywołania i tak nie mają sensu. */
const UPSTREAM_TIMEOUT_MS = 120_000;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function createEdgeWorker() {
  return {
    async fetch(request: Request, env: EdgeEnv): Promise<Response> {
      const incoming = new URL(request.url);
      const paperclipAuthProxy = env.PAPERCLIP_AUTH_PROXY === "1";
      const invalidPaperclipAuth = paperclipAuthProxy && Boolean(
        env.MCP_AUTH_TOKEN || env.UPSTREAM_TOKEN || env.UPSTREAM_TOKEN_PARAM,
      );

      // Bez tokena i bez ruchu do silnika — dla watchdoga i monitoringu.
      if (incoming.pathname === "/health") {
        let upstream = "invalid";
        try {
          upstream = new URL(env.UPSTREAM_URL).host;
        } catch {
          /* zostaje "invalid" */
        }
        return json({ ok: !invalidPaperclipAuth, upstream, auth: Boolean(env.MCP_AUTH_TOKEN) }, invalidPaperclipAuth ? 503 : 200);
      }

      // A single shared credential would collapse every OAuth caller into the same
      // Paperclip principal. The upstream Paperclip gateway must authenticate the
      // original caller and validate any supplied board/run context itself.
      if (invalidPaperclipAuth) {
        return json({ error: "Paperclip identity proxy misconfigured" }, 503);
      }

      const header = request.headers.get("authorization") ?? "";
      const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
      const queryToken = env.UPSTREAM_TOKEN_PARAM ? incoming.searchParams.get(env.UPSTREAM_TOKEN_PARAM) ?? "" : "";
      const supplied = bearer || queryToken;

      if (env.MCP_AUTH_TOKEN && !safeEqual(supplied, env.MCP_AUTH_TOKEN)) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized" },
            id: null,
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "www-authenticate": "Bearer",
              "cache-control": "no-store",
            },
          },
        );
      }

      // Ścieżka z żądania idzie do upstreamu (Langfuse: /api/public/mcp,
      // pozostałe: /mcp); pochodzenie z UPSTREAM_URL.
      const upstreamBase = new URL(env.UPSTREAM_URL);
      // Penpot's public MCP entrypoint is /mcp, while its hybrid router is mounted
      // behind /mcp/stream. Do not send /mcp into Penpot's frontend SPA.
      const useConfiguredMcpPath = incoming.pathname === "/" ||
        (incoming.pathname === "/mcp" && upstreamBase.pathname === "/mcp/stream");
      const upstream = new URL(upstreamBase.origin + (useConfiguredMcpPath ? upstreamBase.pathname : incoming.pathname));
      for (const [key, value] of incoming.searchParams) {
        // Token klienta przepuszczamy tylko wtedy, gdy nie nadpisujemy go sekretem.
        if (env.UPSTREAM_TOKEN_PARAM && env.UPSTREAM_TOKEN && key === env.UPSTREAM_TOKEN_PARAM) continue;
        upstream.searchParams.set(key, value);
      }
      if (env.UPSTREAM_TOKEN_PARAM && env.UPSTREAM_TOKEN) {
        upstream.searchParams.set(env.UPSTREAM_TOKEN_PARAM, env.UPSTREAM_TOKEN);
      }

      const headers = new Headers();
      headers.set("content-type", request.headers.get("content-type") ?? "application/json");
      headers.set("accept", request.headers.get("accept") ?? "application/json, text/event-stream");
      if (env.UPSTREAM_TOKEN && !env.UPSTREAM_TOKEN_PARAM) {
        headers.set("authorization", `Bearer ${env.UPSTREAM_TOKEN}`);
      } else if (!env.UPSTREAM_TOKEN && bearer) {
        headers.set("authorization", `Bearer ${bearer}`);
      }
      if (paperclipAuthProxy) {
        // Never trust incoming X-Forwarded-* values from the client. Derive the
        // OAuth issuer and resource origin from the actual Worker request URL.
        headers.set("x-forwarded-host", incoming.host);
        headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));
        // The gateway binds run IDs to signed caller credentials and validates
        // board credentials. Forward their inputs; do NOT grant authority here.
        for (const name of ["x-paperclip-run-id", "x-paperclip-board-api-key"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
      }
      // Nagłówki protokołu MCP (sesja + wersja) muszą przejść w obie strony.
      for (const name of ["mcp-session-id", "mcp-protocol-version"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }

      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
      let res: Response;
      try {
        res = await fetch(upstream.toString(), {
          method: request.method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: timedOut ? `Upstream timeout (${UPSTREAM_TIMEOUT_MS} ms)` : "Upstream unreachable",
            },
            id: null,
          },
          504,
        );
      }

      const out = new Headers();
      for (const name of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
        const value = res.headers.get(name);
        if (value) out.set(name, value);
      }
      if (paperclipAuthProxy) {
        // OAuth requires 302 Location and RFC 9728 WWW-Authenticate challenges.
        // Neither Set-Cookie nor arbitrary upstream headers cross the boundary.
        for (const name of ["location", "www-authenticate"]) {
          const value = res.headers.get(name);
          if (value) out.set(name, value);
        }
        out.set("cache-control", "no-store");
      }
      return new Response(res.body, { status: res.status, headers: out });
    },
  };
}

// Cloudflare traktuje named export funkcji jako entrypoint RPC i wtedy nie
// dispatchuje HTTP (522). Dlatego wyłącznie default export.
export default createEdgeWorker();
