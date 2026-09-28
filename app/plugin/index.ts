import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const widgetUri = "ui://kompas-zbiorek/workspace.html";
const server = new McpServer(
  { name: "Kompas Zbiórek", version: "0.1.0" },
  { instructions: "Użyj narzędzia pokaż_kompas_zbiórek, gdy użytkownik chce otworzyć lub kontynuować pracę w Kompasie Zbiórek." }
);

server.registerResource("kompas-workspace", widgetUri, {}, async () => ({
  contents: [{ uri: widgetUri, mimeType: "text/html;profile=mcp-app", text: await readFile(join(here, "../../web/dist/index.html"), "utf8"), _meta: { ui: { prefersBorder: false } } }]
}));

server.registerTool("pokaż_kompas_zbiórek", {
  title: "Pokaż Kompas Zbiórek",
  description: "Otwiera interaktywny, lokalny prototyp Kompasu Zbiórek z danymi demonstracyjnymi.",
  inputSchema: { widok: z.enum(["dashboard", "plan", "problem"]).optional() },
  _meta: { ui: { resourceUri: widgetUri }, "openai/toolInvocation/invoking": "Otwieram Kompas Zbiórek…", "openai/toolInvocation/invoked": "Kompas Zbiórek jest gotowy." }
}, async ({ widok = "dashboard" }) => ({
  structuredContent: { widok },
  content: [{ type: "text", text: "Otwieram lokalny prototyp Kompasu Zbiórek." }]
}));

const app = express();
app.use(express.json());
app.get("/", async (_req, res) => {
  res.type("html").send(await readFile(join(here, "../../web/dist/index.html"), "utf8"));
});
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/health", (_req, res) => res.json({ ok: true, name: "Kompas Zbiórek" }));
app.listen(8787, "127.0.0.1", () => console.log("Kompas Zbiórek MCP działa na http://127.0.0.1:8787/mcp"));
