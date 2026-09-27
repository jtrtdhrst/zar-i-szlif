import { readFile, writeFile } from "node:fs/promises";

const LOGO_URL = "https://baza-zabaw.milosz-spyrka.workers.dev/logo.png";
const widget = (await readFile("../web/dist/index.html", "utf8"))
  .replace(/<img[^>]*src="kompas-logo\.png"[^>]*>/, `<img src="${LOGO_URL}" alt="Kompas Zbiórek"/>`)
  .replace('<head>', `<head><link rel="icon" type="image/png" href="${LOGO_URL}"/>`);
const source = `// Wygenerowano przez build-worker.mjs — nie edytuj ręcznie.
// Serwer MCP Kompasu Zbiórek chroniony OAuth 2.1 (Google OpenID Connect).
// Logika OAuth znajduje się w src/oauth.ts oraz src/google-handler.ts.
import { createKompasOAuthProvider } from "./src/oauth.ts";
import { injectWidgetAuth } from "./src/widget-auth.ts";

const WIDGET_URI = "ui://kompas-zbiorek/workspace.html";
const WIDGET_HTML = ${JSON.stringify(widget)};
function getAppId(env) {
  if (env && env.GOOGLE_CLOUD_PROJECT_NUMBER) return env.GOOGLE_CLOUD_PROJECT_NUMBER;
  const match = /^(\\d+)-/.exec((env && env.GOOGLE_CLIENT_ID) || "");
  return match ? match[1] : null;
}
function serveWidget(props, env) {
  const hasToken = Boolean(props && props.accessToken);
  return injectWidgetAuth(WIDGET_HTML, {
    authenticated: hasToken,
    accessToken: hasToken ? props.accessToken : undefined,
    expiresAt: hasToken ? props.accessTokenExpiresAt || 0 : undefined,
    appId: getAppId(env),
    templateFileId: (env && env.TEMPLATE_FILE_ID) || null,
    developerKey: (env && env.GOOGLE_PICKER_API_KEY) || null,
  });
}
const OPEN_TOOL = {
  name: "pokaz_kompas_zbiorek",
  title: "Pokaż Kompas Zbiórek",
  description: "Otwiera interaktywny prototyp Kompasu Zbiórek z danymi demonstracyjnymi.",
  inputSchema: { type: "object", properties: { widok: { type: "string", enum: ["dashboard", "plan", "problem"] } } },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { resourceUri: WIDGET_URI }, "openai/toolInvocation/invoking": "Otwieram Kompas Zbiórek…", "openai/toolInvocation/invoked": "Kompas Zbiórek jest gotowy." }
};
const COMMAND_TOOLS = [
  ["cofnij", "Cofnij", "Cofa ostatnią zaakceptowaną zmianę i przechodzi do poprzedniego etapu.", "undo"],
  ["aktualizuj_kontekst", "Aktualizuj kontekst", "Otwiera kontekst drużyny, aby użytkownik mógł zaktualizować dane systemu.", "context"],
  ["poprzedni_etap", "Poprzedni etap", "Przechodzi do poprzedniego etapu cyklu.", "previous"],
  ["nastepny_etap", "Następny etap", "Przechodzi do następnego etapu cyklu.", "next"],
  ["filtruj_aktywnosci", "Filtruj aktywności", "Pobiera wszystkie aktywności z Bazy Aktywności RR zgodne z filtrami i otwiera ich widok w Kompasie.", "filter"]
].map(([name, title, description, uiAction]) => ({ name, title, description, inputSchema: name === "filtruj_aktywnosci" ? { type: "object", properties: { category: { type: "array", items: { type: "string", enum: ["ruchowa", "logiczna", "kreatywna", "harcerska", "terenowa", "przyrodnicza", "muzyczna", "integracyjna", "duchowa", "inna"] } }, level: { type: "string", enum: ["odkrywcy", "zwiadowcy", "wedrownicy", "wszystkie_poziomy"] }, participants: { type: "integer", minimum: 1 } } } : { type: "object", properties: {} }, _meta: { ui: { resourceUri: WIDGET_URI }, uiAction, "openai/toolInvocation/invoking": "Wyszukuję aktywności…", "openai/toolInvocation/invoked": "Wyniki są gotowe." } }));
const TOOLS = [OPEN_TOOL, ...COMMAND_TOOLS];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
function response(id, result) { return { jsonrpc: "2.0", id, result }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function safeUserProps(props) {
  const user = props && typeof props === "object" ? props : {};
  return { googleSub: user.googleSub || null, email: user.email || null, emailVerified: user.emailVerified === true, name: user.name || null };
}
const ACTIVITIES_API = "https://zabawy.kompaszbiorek.pl/api/activities";
async function findActivities(args) {
  const filters = args && typeof args === "object" ? args : {};
  const url = new URL(ACTIVITIES_API);
  if (Array.isArray(filters.category) && filters.category.length) url.searchParams.set("category", filters.category.join(","));
  for (const key of ["level", "participants"]) if (filters[key] !== undefined && filters[key] !== "") url.searchParams.set(key, String(filters[key]));
  const upstream = await fetch(url);
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new Error(payload?.message || "Baza Aktywności RR zwróciła błąd " + upstream.status + ".");
  return payload;
}

// Chroniony handler MCP. Dostęp wyłącznie z prawidłowym tokenem OAuth wydanym przez ten Worker.
// Tożsamość zalogowanego użytkownika (z Google) jest dostępna w ctx.props.
const MCP_HANDLER = {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
    let body;
    try { body = await request.json(); } catch { return json(error(null, -32700, "Nieprawidłowy JSON."), 400); }
    const user = safeUserProps(ctx && ctx.props);
    const messages = Array.isArray(body) ? body : [body];
    const replies = await Promise.all(messages.map(async (message) => {
      const { id, method, params = {} } = message || {};
      if (method === "initialize") return response(id, { protocolVersion: params.protocolVersion || "2025-03-26", capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: "Kompas Zbiórek", version: "0.1.0" }, instructions: "Użyj narzędzia pokaz_kompas_zbiorek, gdy użytkownik chce otworzyć lub kontynuować pracę w Kompasie Zbiórek." });
      if (method === "notifications/initialized") return null;
      if (method === "ping") return response(id, {});
      if (method === "tools/list") return response(id, { tools: TOOLS });
      if (method === "resources/list") return response(id, { resources: [{ uri: WIDGET_URI, name: "Kompas Zbiórek", description: "Interaktywny interfejs Kompasu Zbiórek", mimeType: "text/html;profile=mcp-app" }] });
      if (method === "resources/read" && params.uri === WIDGET_URI) return response(id, { contents: [{ uri: WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: serveWidget(ctx && ctx.props, env), _meta: { ui: { prefersBorder: false } } }] });
      if (method === "tools/call" && params.name === OPEN_TOOL.name) return response(id, { structuredContent: { widok: params.arguments?.widok || "dashboard", user }, content: [{ type: "text", text: "Otwieram Kompas Zbiórek." }] });
      if (method === "tools/call" && params.name === "filtruj_aktywnosci") {
        try {
          const activities = await findActivities(params.arguments);
          return response(id, { structuredContent: activities, content: [{ type: "text", text: "Znaleziono: " + (activities?.meta?.total ?? activities?.data?.length ?? 0) + " aktywności." }] });
        } catch (cause) {
          return response(id, { isError: true, content: [{ type: "text", text: cause instanceof Error ? cause.message : "Nie udało się pobrać aktywności." }] });
        }
      }
      const command = COMMAND_TOOLS.find((tool) => tool.name === params.name);
      if (method === "tools/call" && command) return response(id, { structuredContent: { uiAction: command._meta.uiAction }, content: [{ type: "text", text: command.title + ": wykonano w interfejsie Kompasu." }] });
      return error(id ?? null, -32601, "Nieznana metoda MCP.");
    })).then(items => items.filter(Boolean));
    return json(Array.isArray(body) ? replies : replies[0] ?? {});
  }
};

const _oauthProvider = createKompasOAuthProvider({ apiHandler: MCP_HANDLER, widgetHtml: WIDGET_HTML });
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    return _oauthProvider.fetch(request, env, ctx);
  }
};
`;
await writeFile("worker.js", source);
