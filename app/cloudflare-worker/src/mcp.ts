// Produkcyjny entrypoint MCP na Cloudflare Workers (KOMAA-446).
//
// JEDEN Worker-compatible MCP entrypoint: ten sam `createPluginServer` i ten sam
// rdzeń retrieval (`app/plugin/knowledge`) co lokalna Wtyczka / MCP — zero drugiej
// implementacji wyszukiwania i zero drugiego wektora (kolekcja `kompas-knowledge-v1`).
//
// Transport: Streamable HTTP w wariancie web-standardowym
// (`WebStandardStreamableHTTPServerTransport`, bezstanowy). To kanoniczny
// transport dla ChatGPT / MCP Inspector; sesja nie jest potrzebna, bo cały scope
// pochodzi z grantu OAuth w `ctx.props` per request.
//
// Auth: OAuth 2.1 (PKCE S256 + DCR) z biblioteki `@cloudflare/workers-oauth-provider`
// — Worker jest AS-em dla klienta MCP, Google jest upstream IdP. `/mcp` bez
// poprawnego Bearer nigdy nie dochodzi do `fetch()` poniżej (biblioteka odpowiada
// 401 + `WWW-Authenticate` z `resource_metadata`), więc zapytanie do Qdrant
// zawsze ma zweryfikowaną tożsamość — fail-closed, nie „pusty wynik".
//
// Scope (user/workspace) jest w 100% server-derived: `resolveCanonicalScope` z
// propsów grantu. Argumenty klienta nie mogą go nadpisać (`assertNoClientScope`
// w `knowledge/mcp-tools`).

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPluginServer } from "../../plugin/server.js";
import { QdrantClient } from "../../plugin/knowledge/qdrant.js";
import { workersAiEmbed, type EmbedFn } from "../../plugin/knowledge/embeddings.js";
import { COLLECTION_NAME } from "../../plugin/knowledge/schema.js";
import { resolveCanonicalScope, type VerifiedGrant } from "./identity";
import { getGoogleAppId, injectWidgetAuth, type WidgetAuthConfig } from "./widget-auth";

/** Kanoniczny resource URI widgetu w Workerze (deprecated alias w server.ts). */
const WIDGET_URI_LEGACY = "ui://kompas-zbiorek/workspace.html";

/** Custom_domain route'y tego samego Workera poza kanonicznym MCP originem.
 *  Musi odpowiadać `routes` w `wrangler.jsonc` / `wrangler.panel.jsonc`. */
const SIBLING_HOSTS = ["panel.kompaszbiorek.pl"];

export interface KompasMcpEnv {
  /** Kanoniczny origin AS, np. `https://mcp-kompas.kompaszbiorek.pl` (scheme + host). */
  MCP_PUBLIC_ORIGIN?: string;
  /** Allowlist `redirect_uri` dla DCR (RFC 7591) — patrz `dcr.ts`. Fail-closed. */
  MCP_ALLOWED_REDIRECT_URIS?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  EMBEDDING_ALLOW_LEXICAL?: string;
  AI?: { run(model: string, input: { text: string[] }): Promise<{ data: number[][] }> };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLOUD_PROJECT_NUMBER?: string;
  TEMPLATE_FILE_ID?: string;
  SHEETS_TEMPLATE_FILE_ID?: string;
  GOOGLE_PICKER_API_KEY?: string;
}

/**
 * Qdrant provider FOR THE EXISTING ChatGPT MCP server. This is not a second
 * server, a second OAuth provider, or the Paperclip agent-memory collection.
 *
 * No URL -> MCP knowledge tools remain present but fail closed on call.
 * With a URL, require an authenticated HTTPS product-collection connection and
 * matching Workers AI bge-m3 embeddings (1024 dimensions). Never silently
 * send locally synthesized lexical vectors into the production collection.
 */
export function knowledgeBackend(env: KompasMcpEnv): { client: QdrantClient; embed: EmbedFn } | null {
  const rawUrl = (env.QDRANT_URL ?? "").trim();
  if (!rawUrl) return null;

  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error("Invalid product QDRANT_URL"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Product QDRANT_URL must be an HTTPS origin without credentials, path, or query");
  }
  if (!(env.QDRANT_API_KEY ?? "").trim()) {
    throw new Error("Product QDRANT_API_KEY is required for MCP knowledge retrieval");
  }
  if (!env.AI?.run) {
    throw new Error("Workers AI binding is required for product Qdrant bge-m3 retrieval");
  }

  const client = new QdrantClient({
    baseUrl: url.origin,
    apiKey: env.QDRANT_API_KEY,
    collection: COLLECTION_NAME,
  });
  return { client, embed: workersAiEmbed(env.AI) };
}

/** Kanoniczny host AS z konfiguracji; błędna wartość to błąd konfiguracji (głośno). */
export function canonicalOrigin(env: KompasMcpEnv): string {
  const origin = (env.MCP_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!origin) throw new Error("MCP_PUBLIC_ORIGIN is required in production: the OAuth resource identifier would otherwise be unconfigured.");
  // `new URL` rzuca własnym "Invalid URL" dla originu bez schematu — łapiemy,
  // żeby operator dostał komunikat z nazwą zmiennej, a nie gołą bibliotekę.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`MCP_PUBLIC_ORIGIN is invalid: ${JSON.stringify(origin)}. Expected an origin like https://mcp-kompas.kompaszbiorek.pl (scheme + host only, no path/query/credentials).`);
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`MCP_PUBLIC_ORIGIN is invalid: ${JSON.stringify(origin)}. Expected an origin like https://panel.kompaszbiorek.pl (https + host only, no path/query/credentials).`);
  }
  return origin;
}

// Narzędzia komend interfejsu i katalogu aktywności — Worker-only, ale na tym
// samym serwerze MCP co narzędzia wiedzy (jeden handshake, jeden tool list).
const COMMAND_TOOLS = [
  ["cofnij", "Cofnij", "Cofa ostatnią zaakceptowaną zmianę i przechodzi do poprzedniego etapu.", "undo"],
  ["aktualizuj_kontekst", "Aktualizuj kontekst", "Otwiera kontekst drużyny, aby użytkownik mógł zaktualizować dane systemu.", "context"],
  ["poprzedni_etap", "Poprzedni etap", "Przechodzi do poprzedniego etapu cyklu.", "previous"],
  ["nastepny_etap", "Następny etap", "Przechodzi do następnego etapu cyklu.", "next"],
] as const;

const ACTIVITY_CATEGORIES = ["ruchowa", "logiczna", "kreatywna", "harcerska", "terenowa", "przyrodnicza", "muzyczna", "integracyjna", "duchowa", "inna"] as const;
const ACTIVITY_LEVELS = ["odkrywcy", "zwiadowcy", "wedrownicy", "wszystkie_poziomy"] as const;
const ACTIVITIES_API = "https://zabawy.kompaszbiorek.pl/api/activities";

/** Katalog aktywności (zewnętrzne API RR) —kształt strukturalny, nie `any`. */
interface ActivitiesPayload {
  meta?: { total?: number };
  data?: unknown[];
  [key: string]: unknown;
}

async function findActivities(args: Record<string, unknown>): Promise<ActivitiesPayload> {
  const url = new URL(ACTIVITIES_API);
  const categories = Array.isArray(args.category) ? args.category.filter((c): c is string => typeof c === "string") : [];
  if (categories.length) url.searchParams.set("category", categories.join(","));
  for (const key of ["level", "participants"]) {
    if (args[key] !== undefined && args[key] !== "") url.searchParams.set(key, String(args[key]));
  }
  const upstream = await fetch(url);
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new Error(`Baza Aktywności RR zwróciła błąd ${upstream.status}.`);
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as ActivitiesPayload) : { data: [payload] };
}

function registerWorkerTools(server: McpServer): void {
  server.registerTool(
    "filtruj_aktywnosci",
    {
      title: "Filtruj aktywności",
      description: "Pobiera aktywności z Bazy Aktywności RR zgodne z filtrami i otwiera ich widok w Kompasie.",
      inputSchema: {
        category: z.array(z.enum(ACTIVITY_CATEGORIES)).optional(),
        level: z.enum(ACTIVITY_LEVELS).optional(),
        participants: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI_LEGACY },
        uiAction: "filter",
        "openai/toolInvocation/invoking": "Wyszukuję aktywności…",
        "openai/toolInvocation/invoked": "Wyniki są gotowe.",
      },
    },
    async (args) => {
      try {
        const activities = await findActivities(args as Record<string, unknown>);
        const count = activities.meta?.total ?? activities.data?.length ?? 0;
        return { structuredContent: activities, content: [{ type: "text" as const, text: `Znaleziono: ${count} aktywności.` }] };
      } catch (cause) {
        return { isError: true, content: [{ type: "text" as const, text: cause instanceof Error ? cause.message : "Nie udało się pobrać aktywności." }] };
      }
    },
  );

  for (const [name, title, description, uiAction] of COMMAND_TOOLS) {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: {
          ui: { resourceUri: WIDGET_URI_LEGACY },
          uiAction,
          "openai/toolInvocation/invoking": `${title}…`,
          "openai/toolInvocation/invoked": `${title}: wykonano w interfejsie Kompasu.`,
        },
      },
      async () => ({
        structuredContent: { uiAction },
        content: [{ type: "text" as const, text: `${title}: wykonano w interfejsie Kompasu.` }],
      }),
    );
  }
}

export interface KompasMcpOptions {
  /** Bundle UI osadzony w worker.js; token Google wstrzykiwany per request. */
  widgetHtml: string;
}

/**
 * `apiHandler` dla `OAuthProvider` (apiRoute `/mcp`). Biblioteka dostarcza
 * `ctx.props` = propsy zweryfikowanego grantu; bez nich request nie trafia tu.
 */
export function createKompasMcpHandler(options: KompasMcpOptions): ExportedHandler<KompasMcpEnv> {
  const { widgetHtml } = options;
  return {
    async fetch(request, env, ctx): Promise<Response> {
      const origin = canonicalOrigin(env);
      // Ochrona przed DNS-rebinding: Host musi być kanonicznym originem albo
      // adresem samego Workera. `SIBLING_HOSTS` to pozostałe custom_domain
      // route'y tego samego Workera (host widgetu), żeby zmiana kanonicznego
      // originu nie wyłączyła istniejącego `/mcp` na panelu. Reklama zasobu
      // w metadanych zostaje jednoznaczna — tylko `MCP_PUBLIC_ORIGIN`.
      const host = new URL(request.url).hostname;
      const allowedHosts = new Set([new URL(origin).hostname, ...SIBLING_HOSTS]);
      if (!allowedHosts.has(host) && !host.endsWith(".workers.dev")) {
        return new Response("Host not allowed", { status: 400 });
      }

      // Kanoniczny scope (fail-closed): bez zweryfikowanego `sub` nie ma zapytania.
      const props = (ctx as ExecutionContext & { props?: unknown }).props;
      const scope = resolveCanonicalScope(props as VerifiedGrant | null | undefined);
      const backend = knowledgeBackend(env);
      const grant = (props ?? {}) as VerifiedGrant & { accessToken?: string; accessTokenExpiresAt?: number };

      const server = createPluginServer({
        // Widget UI dostaje token Google tylko w odpowiedzi na `resources/read`
        // zalogowanego użytkownika (Google Picker); nigdy w modelu ani w logu.
        readBundle: async () => {
          const auth: WidgetAuthConfig = {
            authenticated: typeof grant.accessToken === "string" && grant.accessToken.length > 0,
            accessToken: grant.accessToken,
            expiresAt: grant.accessTokenExpiresAt,
            appId: getGoogleAppId(env),
            templateFileId: env.TEMPLATE_FILE_ID ?? null,
            sheetsTemplateFileId: env.SHEETS_TEMPLATE_FILE_ID ?? null,
            developerKey: env.GOOGLE_PICKER_API_KEY ?? null,
          };
          return injectWidgetAuth(widgetHtml, auth);
        },
        knowledge: backend ? { client: backend.client, embed: backend.embed, props: scope } : undefined,
        securityIssuer: origin,
        securityScopes: ["kompas.read", "offline_access"],
      });
      registerWorkerTools(server);

      // Stateless Streamable HTTP: one transport for this request, same MCP app.
      // IMPORTANT: POST tools/call uses SSE. Closing the transport immediately
      // after handleRequest() returns terminates the response before ChatGPT can
      // consume the JSON-RPC frame. Close only after the response body is read
      // or abandoned (same lifecycle as the SDK's stateless handler).
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        request.signal.removeEventListener("abort", finish);
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      };
      request.signal.addEventListener("abort", finish, { once: true });
      try {
        const response = await transport.handleRequest(request);
        if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
          finish();
          return response;
        }
        const reader = response.body.getReader();
        const monitoredBody = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                finish();
              } else if (value !== undefined) {
                controller.enqueue(value);
              }
            } catch (error) {
              finish();
              controller.error(error);
            }
          },
          async cancel(reason) {
            finish();
            await reader.cancel(reason).catch(() => {});
          },
        });
        return new Response(monitoredBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        finish();
        throw error;
      }
    },
  };
}
