/** Żar i Szlif: isolated, knowledge-only MCP transport for Cloudflare Workers.
 * Legacy Kompas UI is intentionally not registered or exposed.
 * OAuth grant storage is a SEPARATE OAUTH_KV namespace; Supabase remains SSOT.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { createGoogleAuthHandler, type GoogleAuthHandlerEnv } from "../../cloudflare-worker/src/google-handler.js";
import { dcrRedirectUriError } from "../../cloudflare-worker/src/dcr.js";
import { resolveCanonicalScope, type VerifiedGrant } from "../../cloudflare-worker/src/identity.js";
import { QdrantClient } from "../../plugin/knowledge/qdrant.js";
import { workersAiEmbed } from "../../plugin/knowledge/embeddings.js";
import { COLLECTION_NAME } from "../../plugin/knowledge/schema.js";
import { SEARCH_KNOWLEDGE_TOOL, GET_KNOWLEDGE_SOURCE_TOOL, COMPANY_SEARCH_TOOL, COMPANY_FETCH_TOOL,
  searchKnowledge, getKnowledgeSource, companySearch, companyFetch } from "../../plugin/knowledge/mcp-tools.js";
import { canonicalOrigin, requestHostAllowed } from "./config.js";
import { PRODUCT_GOOGLE_SCOPES, PRODUCT_SERVER_INFO } from "./product-auth.js";

const READ_SCOPE = "knowledge.read";
const SCOPES = [READ_SCOPE, "offline_access"];
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

interface Env extends GoogleAuthHandlerEnv {
  MCP_PUBLIC_ORIGIN: string;
  MCP_ALLOWED_REDIRECT_URIS?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  AI?: { run(model: string, input: { text: string[] }): Promise<{ data: number[][] }> };
}
type VerifiedContext = ExecutionContext & { props?: unknown };

function makeKnowledgeServer(env: Env, grant: VerifiedGrant | null | undefined, origin: string): McpServer {
  const scope = resolveCanonicalScope(grant); // fail closed before any database request
  const backend = () => {
    if (!env.QDRANT_URL?.trim() || !env.AI?.run) {
      throw new Error("Knowledge backend unavailable: QDRANT_URL and Workers AI must both be configured");
    }
    return {
      client: new QdrantClient({
        baseUrl: env.QDRANT_URL.trim().replace(/\/+$/, ""),
        apiKey: env.QDRANT_API_KEY || undefined,
        collection: COLLECTION_NAME,
      }),
      embed: workersAiEmbed(env.AI),
    };
  };
  const meta = {
    securitySchemes: [{ type: "oauth2", issuer: origin, scopes: [READ_SCOPE] }],
  };
  const server = new McpServer(
    { name: "Żar i Szlif", version: "0.1.0" },
    { instructions: "Odpowiadaj na pytania o Żar i Szlif na podstawie dostępnej, autoryzowanej bazy wiedzy. Korzystaj z search_knowledge i get_knowledge_source; nie zakładaj dostępu do cudzych drużyn." },
  );

  server.registerTool("search_knowledge", {
    title: "Wyszukaj wiedzę Żar i Szlif",
    description: "Wyszukuje semantycznie w bazie wiedzy produktu wyłącznie w zakresie zweryfikowanej tożsamości użytkownika.",
    inputSchema: {
      query: z.string().trim().min(1).max(500),
      topK: z.number().int().min(1).max(20).optional(),
      minScore: z.number().min(0).max(1).optional(),
      sourceIds: z.array(z.string()).optional(),
    },
    annotations,
    _meta: meta,
  }, async (args) => {
    const b = backend();
    const results = await searchKnowledge(b.client, b.embed, scope, args);
    return { structuredContent: { results }, content: [{ type: "text", text: JSON.stringify({ results }) }] };
  });

  server.registerTool("get_knowledge_source", {
    title: "Pobierz źródło wiedzy",
    description: GET_KNOWLEDGE_SOURCE_TOOL.description,
    inputSchema: {
      source_id: z.string().trim().min(1),
      document_id: z.string().trim().min(1).max(256),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations,
    _meta: meta,
  }, async (args) => {
    const b = backend();
    const result = await getKnowledgeSource(b.client, scope, args);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("search", {
    title: "Szukaj dokumentów",
    description: "Zwraca uchwyty do autoryzowanych dokumentów, zgodnie z kontraktem ChatGPT Company Knowledge.",
    inputSchema: {
      query: z.string().trim().min(1).max(500),
      topK: z.number().int().min(1).max(20).optional(),
      minScore: z.number().min(0).max(1).optional(),
      sourceIds: z.array(z.string()).optional(),
    },
    annotations,
    _meta: meta,
  }, async (args) => {
    const b = backend();
    const result = await companySearch(b.client, b.embed, scope, args);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("fetch", {
    title: "Pobierz dokument",
    description: "Pobiera dokument wskazany uchwytem zwróconym przez search, z weryfikacją zakresu dostępu.",
    inputSchema: { id: z.string().trim().min(1).max(512) },
    annotations,
    _meta: meta,
  }, async (args) => {
    const b = backend();
    const result = await companyFetch(b.client, scope, args);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  // Imported descriptors are checked for names to keep the knowledge contract in sync.
  if (SEARCH_KNOWLEDGE_TOOL.name !== "search_knowledge" ||
      COMPANY_SEARCH_TOOL.name !== "search" || COMPANY_FETCH_TOOL.name !== "fetch") {
    throw new Error("Shared MCP knowledge tool names changed; update product adapter");
  }
  return server;
}

// Reuse the audited Google OIDC consent, PKCE, and CSRF implementation, but expose
// ONLY the login paths; NOT its legacy panel, UI or catalog proxies.
// Brand and Google scopes are overridden: the product asks only for identity
// (openid/email/profile) — no Drive/Calendar access — and never shows legacy branding.
const upstreamGoogle = createGoogleAuthHandler({
  widgetHtml: "",
  serverInfo: PRODUCT_SERVER_INFO,
  googleScopes: PRODUCT_GOOGLE_SCOPES,
});
const loginHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, name: "Żar i Szlif MCP" });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("Żar i Szlif MCP — connect at /mcp", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const authorize = url.pathname === "/authorize" && (request.method === "GET" || request.method === "POST");
    const callback = url.pathname === "/callback" && request.method === "GET";
    if (!authorize && !callback) return new Response("Not found", { status: 404 });
    // The reused upstream auth flow includes CSRF protection and consent, unlike a raw redirect.
    return upstreamGoogle.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

function createProvider(origin: string, redirects: string) {
  const apiHandler = {
    async fetch(request, env, ctx) {
      if (!requestHostAllowed(request.url, origin)) return new Response("Invalid Host", { status: 400 });
      const scope = (ctx as VerifiedContext).props as VerifiedGrant | undefined;
      let server: McpServer;
      try { server = makeKnowledgeServer(env, scope, origin); }
      catch { return new Response("Unauthorized MCP grant", { status: 401 }); }
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      try { return await transport.handleRequest(request); }
      finally { await transport.close(); }
    },
  } satisfies ExportedHandler<Env>;
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler: loginHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: SCOPES,
    clientRegistrationCallback: ({ clientMetadata }) => {
      const error = dcrRedirectUriError(clientMetadata.redirect_uris, redirects);
      return error ? { code: "invalid_redirect_uri", description: error, httpStatus: 400 } : undefined;
    },
    resourceMetadata: {
      resource: origin + "/mcp",
      authorization_servers: [origin],
      scopes_supported: SCOPES,
      resource_name: "Żar i Szlif",
    },
  });
}

let cached: { origin: string; redirectUris: string; provider: ReturnType<typeof createProvider> } | undefined;
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = canonicalOrigin(env.MCP_PUBLIC_ORIGIN);
    if (!requestHostAllowed(request.url, origin)) return new Response("Invalid Host", { status: 400 });
    if (!env.OAUTH_KV || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.COOKIE_ENCRYPTION_KEY) {
      return new Response("MCP authentication configuration missing", { status: 503 });
    }
    const redirects = env.MCP_ALLOWED_REDIRECT_URIS ?? "";
    if (!cached || cached.origin !== origin || cached.redirectUris !== redirects) {
      cached = { origin, redirectUris: redirects, provider: createProvider(origin, redirects) };
    }
    return cached.provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
