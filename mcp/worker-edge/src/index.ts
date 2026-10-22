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

      // Bez tokena i bez ruchu do silnika — dla watchdoga i monitoringu.
      if (incoming.pathname === "/health") {
        let upstream = "invalid";
        try {
          upstream = new URL(env.UPSTREAM_URL).host;
        } catch {
          /* zostaje "invalid" */
        }
        return json({ ok: true, upstream, auth: Boolean(env.MCP_AUTH_TOKEN) });
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
              "www-authenticate": `Bearer resource_metadata="${incoming.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
              "cache-control": "no-store",
            },
          },
        );
      }

      // Ścieżka z żądania idzie do upstreamu (Langfuse: /api/public/mcp,
      // pozostałe: /mcp); pochodzenie z UPSTREAM_URL.
      const upstreamBase = new URL(env.UPSTREAM_URL);
      const upstream = new URL(upstreamBase.origin + (incoming.pathname === "/" ? upstreamBase.pathname : incoming.pathname));
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
      // Caller identity is authoritative whenever the edge itself is not the
      // credential gate. Replacing a real OAuth/agent/board bearer with the
      // shared UPSTREAM_TOKEN silently collapses every caller into one service
      // identity and makes per-caller principal binding impossible.
      const callerCarriesUpstreamCredential = Boolean(bearer) && !env.MCP_AUTH_TOKEN && !env.UPSTREAM_TOKEN_PARAM;
      if (callerCarriesUpstreamCredential) {
        headers.set("authorization", `Bearer ${bearer}`);
      } else if (env.UPSTREAM_TOKEN && !env.UPSTREAM_TOKEN_PARAM) {
        headers.set("authorization", `Bearer ${env.UPSTREAM_TOKEN}`);
      } else if (bearer) {
        headers.set("authorization", `Bearer ${bearer}`);
      }
      // Nagłówki protokołu MCP (sesja + wersja) muszą przejść w obie strony.
      for (const name of ["mcp-session-id", "mcp-protocol-version"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      // Identity/run headers are part of the caller's credential scope. They
      // are forwarded only with the caller's own credential: attaching a run id
      // to a service-owned UPSTREAM_TOKEN would be an ambiguous binding (and
      // the gateway correctly rejects it). Dropping X-Paperclip-Run-Id entirely
      // turns every run-scoped agent call into a deterministic
      // 403 unresolved_identity.
      if (callerCarriesUpstreamCredential) {
        for (const name of ["x-paperclip-run-id", "x-paperclip-board-api-key", "x-paperclip-agent-id"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
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
      // OAuth discovery/authorize needs the challenge and redirect hop; the
      // client cannot re-authenticate if the edge strips them.
      for (const name of ["content-type", "mcp-session-id", "mcp-protocol-version", "www-authenticate", "location", "cache-control"]) {
        const value = res.headers.get(name);
        if (value) out.set(name, value);
      }
      return new Response(res.body, { status: res.status, headers: out });
    },
  };
}

// Cloudflare traktuje named export funkcji jako entrypoint RPC i wtedy nie
// dispatchuje HTTP (522). Dlatego wyłącznie default export.
export default createEdgeWorker();
