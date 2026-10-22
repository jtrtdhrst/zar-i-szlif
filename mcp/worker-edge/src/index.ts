/**
 * Wspólna krawędź MCP dla usług, których silnik nie da się uruchomić w runtime
 * Cloudflare Workers (Python, TCP/Postgres, surowe SSH).
 *
 * Worker: sprawdza Bearer token → przekazuje JSON-RPC do silnika (UPSTREAM_URL,
 * zwykle przez Cloudflare Tunnel) → zwraca odpowiedź strumieniowo (SSE).
 * Kod silnika zostaje w repo w katalogu usługi (mcp/<usługa>/), publiczny
 * endpoint usługi jest Workera.
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
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createEdgeWorker() {
  return {
    async fetch(request: Request, env: EdgeEnv): Promise<Response> {
      const header = request.headers.get("authorization") ?? "";
      const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
      const incoming = new URL(request.url);
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
            headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
          },
        );
      }

      // Ścieżka z żądania idzie do upstreamu (Langfuse: /api/public/mcp,
      // pozostałe: /mcp); pochodzenie z UPSTREAM_URL.
      const upstreamBase = new URL(env.UPSTREAM_URL);
      const upstream = new URL(upstreamBase.origin + (incoming.pathname === "/" ? upstreamBase.pathname : incoming.pathname));
      for (const [key, value] of incoming.searchParams) {
        if (env.UPSTREAM_TOKEN_PARAM && key === env.UPSTREAM_TOKEN_PARAM) continue;
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
      const session = request.headers.get("mcp-session-id");
      if (session) headers.set("mcp-session-id", session);

      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
      const res = await fetch(upstream.toString(), {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });

      const out = new Headers();
      const contentType = res.headers.get("content-type");
      if (contentType) out.set("content-type", contentType);
      const outSession = res.headers.get("mcp-session-id");
      if (outSession) out.set("mcp-session-id", outSession);
      return new Response(res.body, { status: res.status, headers: out });
    },
  };
}

export default createEdgeWorker;
