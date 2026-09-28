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
import { UI_MIME_TYPE, UI_RESOURCE_URI_V1, uiResourceMeta } from "./ui.js";
import { PUBLIC_SECURITY_SCHEME } from "./auth.js";
import type { RagAdapter } from "./rag.js";

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

  return server;
}
