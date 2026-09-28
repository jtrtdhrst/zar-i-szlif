// Entrypoint Wtyczki / MCP: Express + Streamable HTTP `/mcp` (tryb bezstanowy).
//
// - Tool działa bez pobierania UI resource: resource to oddzielny odczyt.
// - GET/DELETE /mcp zwracają 405 (serwer bezstanowy, bez strumieni SSE).
// - GET / serwuje bundle UI z nagłówkiem CSP; brak bundla nie blokuje toola.
// - GET /ready raportuje gotowość; brak bundla => 503, tool nadal działa.
// - GET /.well-known/oauth-protected-resource: metadane RFC9728 dla
//   przyszłych prywatnych danych (issuer: istniejący stos Google OIDC).
// - Żadnych logów ciał requestów ani historii rozmów.

import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPluginServer } from "./server.js";
import { SERVER_NAME } from "./server.js";
import { uiCspHeader } from "./ui.js";
import { protectedResourceMetadata, publicResourceUrl, resolveAuth } from "./auth.js";
import { createStubRagAdapter } from "./rag.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "../../web/dist/index.html");

export function createApp() {
  const app = express();
  // Za TLS-terminating ingress: honoruj X-Forwarded-Proto z zaufanego proxy.
  app.set("trust proxy", "loopback");
  app.use(express.json());

  // Auth per request: kontekst dokładany do requestu; publiczne narzędzie
  // demo go nie wymaga (przyszłe prywatne narzędzia użyją requireAuth).
  app.use((req, _res, next) => {
    (req as { auth?: unknown }).auth = resolveAuth(req);
    next();
  });

  app.get("/", async (_req, res) => {
    try {
      res.type("html").set("Content-Security-Policy", uiCspHeader()).send(await readFile(bundlePath, "utf8"));
    } catch {
      res.status(503).json({ error: "ui_bundle_missing" });
    }
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    const server = createPluginServer({
      readBundle: () => readFile(bundlePath, "utf8"),
      rag: createStubRagAdapter(),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "method_not_allowed", allow: ["POST"] }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "method_not_allowed", allow: ["POST"] }));

  app.get("/health", (_req, res) => res.json({ ok: true, name: SERVER_NAME }));

  app.get("/ready", async (_req, res) => {
    let webBundle = true;
    try {
      await readFile(bundlePath, "utf8");
    } catch {
      webBundle = false;
    }
    const ok = webBundle;
    res.status(ok ? 200 : 503).json({ ok, checks: { webBundle } });
  });

  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    // Kanoniczny origin z konfiguracji (PLUGIN_PUBLIC_ORIGIN) albo
    // walidowany Host; nieprawidłowy Host -> 400 zamiast odbicia atakującego.
    const resource = publicResourceUrl(req);
    if (!resource) return res.status(400).json({ error: "invalid_host" });
    res.json(protectedResourceMetadata(resource));
  });

  return app;
}

// Nasłuch tylko przy bezpośrednim uruchomieniu (node plugin/dist/index.js),
// żeby testy mogły importować createApp() bez zajmowania portu.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  createApp().listen(8787, "127.0.0.1", () => console.log("Kompas Zbiórek MCP działa na http://127.0.0.1:8787/mcp"));
}
