import { readFile, writeFile } from "node:fs/promises";

const LOGO_URL = "https://baza-zabaw.milosz-spyrka.workers.dev/logo.png";
const widget = (await readFile("../web/dist/index.html", "utf8"))
  .replace(/<img[^>]*src="kompas-logo\.png"[^>]*>/, `<img src="${LOGO_URL}" alt="Kompas Zbiórek"/>`)
  .replace('<head>', `<head><link rel="icon" type="image/png" href="${LOGO_URL}"/>`);

// Generowany entrypoint jest cienki: logika OAuth leży w src/oauth.ts, logika
// MCP w src/mcp.ts (ten sam createPluginServer + rdzeń retrieval co lokalna
// Wtyczka / MCP). Kanoniczny origin AS przychodzi z bindingu
// `MCP_PUBLIC_ORIGIN`, więc provider OAuth budujemy leniwie przy pierwszym
// request — nie ma go w module scope (brak process.env w Workers).
const source = `// Wygenerowano przez build-worker.mjs — nie edytuj ręcznie.
// Serwer MCP Kompasu Zbiórek chroniony OAuth 2.1 (Google OpenID Connect).
// Logika OAuth znajduje się w src/oauth.ts oraz src/google-handler.ts;
// logika MCP (Streamable HTTP + RAG) w src/mcp.ts.
import { createKompasOAuthProvider } from "./src/oauth.ts";
import { canonicalOrigin, createKompasMcpHandler } from "./src/mcp.ts";

const WIDGET_HTML = ${JSON.stringify(widget)};
const apiHandler = createKompasMcpHandler({ widgetHtml: WIDGET_HTML });

// ponytail: jeden provider na isolate — env jest stały w obrębie wdrożenia;
// upgrade = provider per env, gdyby pojawiły się warianty konfiguracji.
let _provider = null;

export default {
  async fetch(request, env, ctx) {
    _provider ??= createKompasOAuthProvider({ apiHandler, widgetHtml: WIDGET_HTML, canonicalOrigin: canonicalOrigin(env) });
    const url = new URL(request.url);
    if (url.hostname === "wtyczka.kompaszbiorek.pl") {
      const target = new URL(request.url);
      target.hostname = "panel.kompaszbiorek.pl";
      target.protocol = "https:";
      return Response.redirect(target.href, 308);
    }
    return _provider.fetch(request, env, ctx);
  }
};
`;
await writeFile("worker.js", source);
