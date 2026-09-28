// Kontrakt MCP na poziomie Inspector: initialize -> tools/list (+schematy,
// adnotacje, _meta) -> tools/call (bez wymogu pobrania UI) -> resource read,
// plus endpointy auth/readiness. Celowane, bez pełnego E2E UI.
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./dist/index.js";
import { UI_RESOURCE_URI_LEGACY, UI_RESOURCE_URI_V1 } from "./dist/ui.js";
import { guardPrivateTool } from "./dist/auth.js";

const _server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => _server.on("listening", resolve));
const base = `http://127.0.0.1:${_server.address().port}`;
test.after(() => _server.close());

let id = 1;

async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const text = await res.text();
  // Streamable HTTP odpowiada ramką SSE (`data: {...}`); wyciągnij JSON-RPC.
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "));
    return { status: res.status, body: JSON.parse(data.slice("data: ".length)) };
  }
  return { status: res.status, body: JSON.parse(text) };
}

test("initialize zwraca stabilny serverInfo", async () => {
  const { status, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "contract-test", version: "0.0.0" },
  });
  assert.equal(status, 200);
  assert.equal(body.result.serverInfo.name, "Kompas Zbiórek");
  assert.equal(body.result.serverInfo.version, "0.1.0");
  assert.match(body.result.instructions ?? "", /pokaz_kompas_zbiorek/);
  await rpc("notifications/initialized", {});
});

test("tools/list: schematy, adnotacje i kanoniczny resourceUri", async () => {
  const { body } = await rpc("tools/list", {});
  const tool = body.result.tools.find((t) => t.name === "pokaz_kompas_zbiorek");
  assert.ok(tool, "tool pokaz_kompas_zbiorek musi istnieć");
  assert.deepEqual(tool.inputSchema.properties.widok.enum, ["dashboard", "plan", "problem"]);
  assert.deepEqual(tool.outputSchema.properties.widok.enum, ["dashboard", "plan", "problem"]);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.annotations.openWorldHint, false);
  assert.equal(tool._meta.ui.resourceUri, UI_RESOURCE_URI_V1);
  // Lokalny kontrakt securitySchemes (auth.ts:PUBLIC_SECURITY_SCHEME) —
  // exact assert, nie tylko Array.isArray.
  assert.equal(tool._meta.securitySchemes.length, 1);
  assert.equal(tool._meta.securitySchemes[0].type, "none");
  assert.equal(tool._meta.securitySchemes[0].requiresAuth, false);
});

test("tools/call działa bez pobierania UI (default + jawny widok)", async () => {
  const dflt = await rpc("tools/call", { name: "pokaz_kompas_zbiorek", arguments: {} });
  assert.equal(dflt.body.result.structuredContent.widok, "dashboard");
  const plan = await rpc("tools/call", { name: "pokaz_kompas_zbiorek", arguments: { widok: "plan" } });
  assert.equal(plan.body.result.structuredContent.widok, "plan");
  assert.equal(plan.body.result.content[0].type, "text");
});

test("tools/call nieznanego narzędzia zwraca błąd", async () => {
  const { body } = await rpc("tools/call", { name: "nie_ma_takiego", arguments: {} });
  assert.ok(body.error || body.result?.isError, "oczekiwany błąd JSON-RPC");
});

test("resource: kanoniczne URI + deprecated legacy alias (worker compat)", async () => {
  const list = await rpc("resources/list", {});
  const uris = list.body.result.resources.map((r) => r.uri);
  assert.ok(uris.includes(UI_RESOURCE_URI_V1));
  assert.ok(uris.includes(UI_RESOURCE_URI_LEGACY), "legacy alias musi być listowany do migracji workera");
  const read = await rpc("resources/read", { uri: UI_RESOURCE_URI_V1 });
  const content = read.body.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.equal(content._meta.ui.prefersBorder, false);
  assert.match(content.text, /<html/i);
});

test("legacy alias read zwraca ten sam bundle z _meta.aliasOf", async () => {
  const read = await rpc("resources/read", { uri: UI_RESOURCE_URI_LEGACY });
  const content = read.body.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.equal(content._meta.aliasOf, UI_RESOURCE_URI_V1);
  assert.equal(content._meta.deprecated, true);
  assert.match(content.text, /<html/i);
});

test("CSP: nagłówek GET / jest realną allowlistą", async () => {
  const res = await fetch(`${base}/`);
  const csp = res.headers.get("content-security-policy") ?? "";
  for (const d of ["default-src 'self'", "script-src", "style-src", "object-src 'none'", "frame-ancestors 'self'"]) {
    assert.ok(csp.includes(d), `CSP musi zawierać ${d} (aktualnie: ${csp})`);
  }
});

test("protected-resource: zły Host -> 400, X-Forwarded-Proto honorowane", async () => {
  const { request } = await import("node:http");
  // Review repro: Host: evil.example.com nie może być odbity w metadata.
  for (const evilHost of ["evil.example.com", "evil.example.com<script>"]) {
    const status = await new Promise((resolve, reject) => {
      const r = request(`${base}/.well-known/oauth-protected-resource`, { headers: { Host: evilHost } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      r.on("error", reject);
      r.end();
    });
    assert.equal(status, 400, `Host ${evilHost} musi dać 400`);
  }
  const fwd = await fetch(`${base}/.well-known/oauth-protected-resource`, { headers: { "X-Forwarded-Proto": "https" } });
  const prm = await fwd.json();
  assert.match(prm.resource, /^https:\/\//);
});

test("fail-closed: guardPrivateTool rzuca 401 dla anonima", async () => {
  const guarded = guardPrivateTool({ anonymous: true }, async () => "sekret");
  await assert.rejects(guarded, /unauthorized/);
  const ok = guardPrivateTool({ anonymous: false, bearerPresent: true }, async () => "sekret");
  assert.equal(await ok(), "sekret");
});
test("transport bezstanowy: GET/DELETE /mcp to 405", async () => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 405);
});

test("health, readiness i protected resource metadata", async () => {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ok, true);
  const readyRes = await fetch(`${base}/ready`);
  assert.equal(readyRes.status, 200);
  assert.equal((await readyRes.json()).checks.webBundle, true);
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.match(prm.resource, /\/mcp$/);
  assert.ok(prm.authorization_servers.includes("https://accounts.google.com"));
  assert.ok(prm.scopes_supported.includes("openid"));
});
