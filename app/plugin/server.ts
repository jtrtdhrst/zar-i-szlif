// Definicja serwera MCP Wtyczki / MCP Kompasu Zbiórek.
//
// Stabilny kontrakt: nazwa `Kompas Zbiórek`, wersja `0.1.0`, stałe
// server instructions. Zmiana nazwy/wersji to zmiana kontraktu —
// uzgadniaj z konsumentami (konfiguracje konektorów ChatGPT).
//
// Uzasadnienie adnotacji narzędzia pokaz_kompas_zbiorek:
// - readOnlyHint=true, destructiveHint=false, idempotentHint=true:
//   otwarcie lokalnego widoku demo nie zmienia żadnego stanu.
// - openWorldHint=false: tool nie wykonuje fetchy ani wywołań
//   zewnętrznych; serwuje wyłącznie lokalny bundle UI.
// Nazwa narzędzia jest ASCII, bo spec MCP wymaga [a-zA-Z0-9_-]{1,64}.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UI_MIME_TYPE, UI_RESOURCE_URI_LEGACY, UI_RESOURCE_URI_V1, uiResourceMeta } from "./ui.js";
import { OAUTH2_SECURITY_SCHEME, PUBLIC_SECURITY_SCHEME } from "./auth.js";
import type { RagAdapter } from "./rag.js";
import {
  GET_KNOWLEDGE_SOURCE_TOOL,
  SEARCH_KNOWLEDGE_TOOL,
  getKnowledgeSource,
  searchKnowledge,
  type TokenProps,
} from "./knowledge/mcp-tools.js";
import type { QdrantClient } from "./knowledge/qdrant.js";
import type { EmbedFn } from "./knowledge/embeddings.js";
import { RETRIEVAL_MAX_TOP_K } from "./knowledge/retrieval.js";
import { SOURCE_MAX_LIMIT } from "./knowledge/mcp-tools.js";

export const SERVER_NAME = "Kompas Zbiórek";
export const SERVER_VERSION = "0.1.0";
export const SERVER_INSTRUCTIONS =
  "Użyj narzędzia pokaz_kompas_zbiorek, gdy użytkownik chce otworzyć lub kontynuować pracę w Kompasie Zbiórek.";

export const TOOL_NAME = "pokaz_kompas_zbiorek";
export const widokSchema = z.enum(["dashboard", "plan", "problem"]);

export type PluginDeps = {
  readBundle: () => Promise<string>;
  // Adapter point dla przyszłych node'ów RAG; demo go nie używa.
  rag?: RagAdapter;
  // RAG end-to-end (KOMAA-385): backend + auth z tokenu, per request.
  // Brak `knowledge` = narzędzia wiedzy zwracają unavailable (fail-closed
  // dla anonima i tak: 401 z resolveAuth przed jakimkolwiek query).
  knowledge?: { client: QdrantClient; embed: EmbedFn; props: TokenProps | null };
};

export function createPluginServer(deps: PluginDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerResource(
    "kompas-workspace",
    UI_RESOURCE_URI_V1,
    { mimeType: UI_MIME_TYPE, _meta: uiResourceMeta() },
    async () => ({
      contents: [{ uri: UI_RESOURCE_URI_V1, mimeType: UI_MIME_TYPE, text: await deps.readBundle(), _meta: uiResourceMeta() }],
    }),
  );

  // Deprecated alias dla drugiego publishera (app/cloudflare-worker,
  // WIDGET_URI bez /v1/). Ten sam bundle; _meta wskazuje kanon.
  server.registerResource(
    "kompas-workspace-legacy",
    UI_RESOURCE_URI_LEGACY,
    { mimeType: UI_MIME_TYPE, _meta: { ...uiResourceMeta(), aliasOf: UI_RESOURCE_URI_V1, deprecated: true } },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI_LEGACY,
          mimeType: UI_MIME_TYPE,
          text: await deps.readBundle(),
          _meta: { ...uiResourceMeta(), aliasOf: UI_RESOURCE_URI_V1, deprecated: true },
        },
      ],
    }),
  );

  server.registerTool(
    TOOL_NAME,
    {
      title: "Pokaż Kompas Zbiórek",
      description: "Otwiera interaktywny, lokalny prototyp Kompasu Zbiórek z danymi demonstracyjnymi.",
      inputSchema: { widok: widokSchema.optional() },
      outputSchema: { widok: widokSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI_V1 },
        "openai/toolInvocation/invoking": "Otwieram Kompas Zbiórek…",
        "openai/toolInvocation/invoked": "Kompas Zbiórek jest gotowy.",
        securitySchemes: [PUBLIC_SECURITY_SCHEME],
      },
    },
    async ({ widok = "dashboard" }) => ({
      structuredContent: { widok },
      content: [{ type: "text" as const, text: "Otwieram lokalny prototyp Kompasu Zbiórek." }],
    }),
  );

  // RAG: narzędzia wiedzy ze scope z tokenu (server-derived, brak client override).
  server.registerTool(
    SEARCH_KNOWLEDGE_TOOL.name,
    {
      title: SEARCH_KNOWLEDGE_TOOL.title,
      description: SEARCH_KNOWLEDGE_TOOL.description,
      inputSchema: {
        query: z.string().max(500).describe("Pytanie w języku naturalnym (max 500 znaków)."),
        topK: z.number().int().min(1).max(RETRIEVAL_MAX_TOP_K).optional(),
        minScore: z.number().min(0).max(1).optional(),
        sourceIds: z.array(z.string()).optional(),
      },
      outputSchema: {
        results: z.array(
          z.object({
            text: z.string(),
            score: z.number(),
            source_id: z.string(),
            document_id: z.string(),
            chunk_id: z.string(),
            content_type: z.string(),
            source_version: z.string(),
            updated_at: z.string(),
            visibility: z.string(),
          }),
        ),
      },
      annotations: { ...SEARCH_KNOWLEDGE_TOOL.annotations, readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: {
        securitySchemes: [OAUTH2_SECURITY_SCHEME],
        "openai/toolInvocation/invoking": "Szukam w bazie wiedzy…",
        "openai/toolInvocation/invoked": "Wyniki z bazy wiedzy gotowe.",
      },
    },
    async (args) => {
      if (!deps.knowledge) throw new Error("knowledge backend unavailable");
      const results = await searchKnowledge(deps.knowledge.client, deps.knowledge.embed, deps.knowledge.props, args);
      const attribution = results.map((r) => `[${r.source_id}/${r.document_id}]`).join(", ");
      return {
        structuredContent: { results },
        content: [{ type: "text" as const, text: results.length === 0 ? "Brak wyników w bazie wiedzy." : `Znaleziono ${results.length}: ${attribution}` }],
      };
    },
  );

  server.registerTool(
    GET_KNOWLEDGE_SOURCE_TOOL.name,
    {
      title: GET_KNOWLEDGE_SOURCE_TOOL.title,
      description: GET_KNOWLEDGE_SOURCE_TOOL.description,
      inputSchema: {
        source_id: z.string().describe("Identyfikator źródła (np. help-page, legal)."),
        document_id: z.string().max(256).describe("Identyfikator dokumentu w źródle."),
        limit: z.number().int().min(1).max(SOURCE_MAX_LIMIT).optional(),
      },
      outputSchema: {
        source_id: z.string(),
        document_id: z.string(),
        chunks: z.array(
          z.object({
            chunk_id: z.string(),
            text: z.string(),
            content_type: z.string(),
            source_version: z.string(),
            updated_at: z.string(),
            visibility: z.string(),
          }),
        ),
      },
      annotations: { ...GET_KNOWLEDGE_SOURCE_TOOL.annotations, readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: {
        securitySchemes: [OAUTH2_SECURITY_SCHEME],
        "openai/toolInvocation/invoking": "Pobieram źródło wiedzy…",
        "openai/toolInvocation/invoked": "Źródło wiedzy gotowe.",
      },
    },
    async (args) => {
      if (!deps.knowledge) throw new Error("knowledge backend unavailable");
      const { source_id, document_id, chunks } = await getKnowledgeSource(deps.knowledge.client, deps.knowledge.props, args);
      return {
        structuredContent: { source_id, document_id, chunks },
        content: [{ type: "text" as const, text: `Źródło ${source_id}/${document_id}: ${chunks.length} chunków.` }],
      };
    },
  );

  return server;
}
