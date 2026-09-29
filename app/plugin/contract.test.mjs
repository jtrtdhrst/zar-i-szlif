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

// ---- KOMAA-385 RAG2: wiedza end-to-end (live ingest -> scoped retrieval -> MCP) ----
import { knowledgeBackend } from "./dist/index.js";
import { bearerSubject } from "./dist/auth.js";
import { deterministicEmbed } from "./dist/knowledge/embeddings.js";
import { QdrantClient } from "./dist/knowledge/qdrant.js";
import { syncCorpus, syncDocument } from "./dist/knowledge/pipeline.js";
import { DENIED_TEXT, assertNotDenied } from "./dist/knowledge/denylist.js";
import { loadAllowedDocuments } from "./dist/knowledge/sources.js";
import { validatePayload, contentHash, chunkId } from "./dist/knowledge/schema.js";
import { dirname as _dirname, join as _join } from "node:path";
import { fileURLToPath as _furl } from "node:url";

const repoRoot = _join(_dirname(_furl(import.meta.url)), "../..");
const TOKEN_A = "E2E-USER-A-token";
const TOKEN_B = "E2E-USER-B-token";

async function rpcAuth(method, params, token) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "));
    return { status: res.status, body: JSON.parse(data.slice("data: ".length)) };
  }
  return { status: res.status, body: JSON.parse(text) };
}

async function seedLiveCorpus() {
  const backend = knowledgeBackend();
  await backend.client.ensureCollection();
  const docs = loadAllowedDocuments(repoRoot, "test:contract");
  assert.ok(docs.length >= 5, `realne źródła S3-S6 muszą się załadować (jest ${docs.length})`);
  const state = new Map();
  const first = await syncCorpus(backend.client, backend.embed, docs, state);
  assert.ok(first.every((r) => r.upserted === r.chunks), "pierwszy ingest zapisuje wszystko");
  // Idempotencja: powtórka = same id, zero nowych embeddingów (liczone realnie).
  const calls = { n: 0 };
  const counting = async (texts) => { calls.n += texts.length; return deterministicEmbed()(texts); };
  const second = await syncCorpus(backend.client, counting, docs, state);
  assert.ok(second.every((r) => r.upserted === 0 && r.skipped === r.chunks), "drugi ingest to no-op");
  assert.equal(calls.n, 0);
  return { backend, docs };
}

test("RAG tools/list: schematy, adnotacje, oauth2 securitySchemes", async () => {
  const { body } = await rpc("tools/list", {});
  const search = body.result.tools.find((t) => t.name === "search_knowledge");
  const source = body.result.tools.find((t) => t.name === "get_knowledge_source");
  assert.ok(search && source, "oba narzędzia wiedzy muszą być listowane");
  assert.deepEqual(search.inputSchema.required, ["query"]);
  assert.equal(search.inputSchema.properties.query.maxLength, 500);
  assert.equal(search.annotations.readOnlyHint, true);
  assert.equal(search.annotations.destructiveHint, false);
  assert.equal(search.annotations.openWorldHint, false);
  assert.equal(search._meta.securitySchemes[0].type, "oauth2");
  assert.deepEqual(source.inputSchema.required, ["source_id", "document_id"]);
  assert.equal(source._meta.securitySchemes[0].type, "oauth2");
});

test("RAG unauthorized: brak Bearer = błąd przed jakimkolwiek query", async () => {
  for (const params of [
    { name: "search_knowledge", arguments: { query: "logowanie" } },
    { name: "get_knowledge_source", arguments: { source_id: "help-page", document_id: "help-page" } },
  ]) {
    const { body } = await rpc("tools/call", params);
    assert.ok(body.error || body.result?.isError, `oczekiwany 401/fail-closed dla ${params.name}`);
  }
});

test("RAG live: ingest -> scoped retrieval -> MCP response ze źródłem", async () => {
  await seedLiveCorpus();
  const { body } = await rpcAuth("tools/call", {
    name: "search_knowledge",
    arguments: { query: "logowanie Google pomoc", minScore: 0 },
  }, TOKEN_A);
  assert.ok(!body.error, `search nie może failować: ${JSON.stringify(body.error)}`);
  const results = body.body?.result ?? body.result;
  assert.ok(results.structuredContent.results.length > 0, "live retrieval zwraca trafienia");
  const hit = results.structuredContent.results[0];
  assert.ok(hit.source_id && hit.document_id && hit.text.length > 0, "hit ma attribution (źródło+dokument+tekst)");
  assert.match(results.content[0].text, new RegExp(hit.source_id));
});

test("RAG live-smoke: ścieżka skryptu przechodzi na emulacji (jednorazowy live nie może zawieść)", async () => {
  // Uruchomienie przeciw prawdziwemu Qdrantowi kosztuje jednorazową akcję boardową
  // (sekret), więc cała ścieżka `scripts/rag-live-smoke.mjs` musi być sprawdzona
  // na tej samej emulacji REST, na której klient zobaczy produkcyjne odpowiedzi.
  const { createMemoryFetch } = await import("./dist/knowledge/memory.js");
  const { runKnowledgeSmoke } = await import("./dist/knowledge/smoke.js");
  const client = new QdrantClient({ baseUrl: "memory://smoke", fetchFn: createMemoryFetch() });
  const owner = bearerSubject(`Bearer ${TOKEN_A}`);

  const report = await runKnowledgeSmoke(client, deterministicEmbed(), owner);
  assert.equal(report.cleanedUp, true, "smoke sprzata po sobie");
  assert.ok(report.topHit?.source_id && report.topHit.chunk_id && report.topHit.text.length > 0,
    "odpowiedź MCP z atrybucją źródła (DoD: 'MCP response ze źródłem')");
  assert.ok(report.sourceChunks > 0, "get_knowledge_source zwraca chunki");
  assert.ok(report.privateVisibleToOwner > 0, "wlasciciel widzi wlasny chunk");
  assert.equal(report.privateVisibleToAlien, 0, "obcy token nie widzi prywatnego chunka");

  // Powtorka na tej samej kolekcji = brak zasmiecenia po sprzataniu (ta sama sciezka kodu).
  const again = await runKnowledgeSmoke(client, deterministicEmbed(), owner);
  assert.equal(again.topHit?.document_id, report.topHit.document_id, "smoke jest powtarzalne");
  // Smoke nie udaje passu: każde zalozenie to throw, nie log.
  await assert.rejects(runKnowledgeSmoke(client, deterministicEmbed(), ""), /ownerSub/);
});

test("RAG filter: kształt zgodny z Qdrant 1.19.1 (bez min_should/min_count/filtra w warunku)", async () => {
  const { buildAuthFilter } = await import("./dist/knowledge/schema.js");
  const { createMemoryFetch } = await import("./dist/knowledge/memory.js");
  const { QdrantClient } = await import("./dist/knowledge/qdrant.js");
  const auth = { userId: bearerSubject(`Bearer ${TOKEN_A}`), workspaceIds: ["ws-1"] };
  const wire = JSON.stringify([buildAuthFilter(auth)]);
  // Prawdziwy Qdrant 1.19.1 odpowiada 400 na `min_should`/`min_count`/`filter`
  // wewnątrz warunku złożonego — na `/points/search` i `/points/query`.
  for (const bad of ["min_should", "min_count", '"filter"']) {
    assert.ok(!wire.includes(bad), `filtr nie może zawierać ${bad}: ${wire}`);
  }
  // Emulacja musi odrzucać ten sam kształt co silnik, inaczej suite przepuści zepsuty filtr.
  const client = new QdrantClient({ baseUrl: "memory://shape", fetchFn: createMemoryFetch() });
  await client.upsertPoints([{
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", vector: [0, 1],
    payload: {
      source_id: "help-page", document_id: "d", chunk_id: "c0", tenant: "kompas-zbiorek",
      user_id: auth.userId, workspace_id: null, visibility: "user", content_type: "help",
      content_hash: "h", source_version: "v", updated_at: new Date().toISOString(), text: "t",
    },
  }]);
  await assert.rejects(
    client.searchScoped([0, 1], auth, { extraFilter: { should: [{ key: "source_id", match: { value: "x" } }], min_should: { conditions: 1 } } }),
    /unsupported condition key "min_should"/,
  );
  // Kształt akceptowany nadal działa i respektuje widoczność.
  const own = await client.searchScoped([0, 1], auth);
  assert.equal(own.result.length, 1, "własny chunk widoczny");
  const alien = await client.searchScoped([0, 1], { userId: bearerSubject(`Bearer ${TOKEN_B}`), workspaceIds: [] });
  assert.equal(alien.result.length, 0, "obcy user nie widzi cudzego chunka");
});

test("RAG scroll: klient normalizuje oba kształty odpowiedzi (points / tablica)", async () => {
  const { createMemoryFetch } = await import("./dist/knowledge/memory.js");
  const { QdrantClient } = await import("./dist/knowledge/qdrant.js");
  const auth = { userId: "u", workspaceIds: [] };
  const point = { id: "p1", payload: { chunk_id: "c0", text: "t" } };
  // Prawdziwy 1.19.0 (live, smoke) odpowiada `result: {points, next_page_offset}`.
  const wire = await new QdrantClient({ baseUrl: "memory://s", fetchFn: createMemoryFetch() }).scrollScoped(auth, { limit: 1 });
  assert.ok(Array.isArray(wire.result), "scroll musi zwracać tablicę punktów");
  // Starsza emulacja/stary klient: goły array w `result` — ten sam kontrakt wyjściowy.
  const legacy = new QdrantClient({
    baseUrl: "mock://s",
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ result: [point] }), text: async () => "" }),
  });
  const res = await legacy.scrollScoped(auth, { limit: 1 });
  assert.deepEqual(res.result, [point], "goły array w result też się normalizuje");
});

test("RAG source: get_knowledge_source zwraca chunki + update/delete/no-result", async () => {
  const { backend } = await seedLiveCorpus();
  const got = await rpcAuth("tools/call", {
    name: "get_knowledge_source", arguments: { source_id: "help-page", document_id: "help-page" },
  }, TOKEN_A);
  const sc = (got.body.body?.result ?? got.body.result).structuredContent;
  assert.ok(sc.chunks.length > 0, "dokument help-page ma chunki");
  // Update: zmiana treści = re-embed zmienionych.
  const upd = await syncDocument(backend.client, backend.embed, {
    sourceId: "help-page", documentId: "help-page",
    rawText: "Pomoc: logowanie przez Google. Nowy akapit o odzyskiwaniu konta. ".repeat(60),
    sourceVersion: "test:update",
  }, { knownHashes: {}, prevCount: 1 });
  assert.ok(upd.upserted > 0, "update embedduje zmienione chunki");
  // Delete: pusty tekst = purge dokumentu.
  await syncCorpus(backend.client, backend.embed, [{
    sourceId: "help-page", documentId: "help-page", rawText: "   ", sourceVersion: "test:delete",
  }], new Map());
  const after = await rpcAuth("tools/call", {
    name: "get_knowledge_source", arguments: { source_id: "help-page", document_id: "help-page" },
  }, TOKEN_A);
  assert.equal((after.body.body?.result ?? after.body.result).structuredContent.chunks.length, 0, "po delete brak chunków");
  // No-result: zapytanie bez sensownej treści przy ostrym progu.
  const none = await rpcAuth("tools/call", {
    name: "search_knowledge", arguments: { query: "xyqqz nieistniejący frazes", minScore: 0.99 },
  }, TOKEN_A);
  assert.equal((none.body.body?.result ?? none.body.result).structuredContent.results.length, 0);
});

test("RAG leakage negatives: cross-user/tenant/denylist niewidzialne", async () => {
  const { backend } = await seedLiveCorpus();
  const subA = bearerSubject(`Bearer ${TOKEN_A}`);
  const alien = {
    id: "11111111-2222-3333-4444-555555555555",
    vector: (await deterministicEmbed()( ["sekretny plan użytkownika A"] ))[0],
    payload: {
      source_id: "help-page", document_id: "cudzy-dokument", chunk_id: "c0",
      tenant: "kompas-zbiorek", user_id: subA, workspace_id: null, visibility: "user",
      content_type: "help", content_hash: await contentHash("sekretny plan użytkownika A"),
      source_version: "test:leak", updated_at: new Date().toISOString(), text: "sekretny plan użytkownika A",
    },
  };
  const foreignTenant = { ...alien, id: "22222222-3333-4444-5555-666666666666",
    payload: { ...alien.payload, tenant: "inny-produkt", visibility: "global", user_id: null } };
  const denylisted = { ...alien, id: "33333333-4444-5555-6666-777777777777",
    payload: { ...alien.payload, source_id: "paperclip-issues", visibility: "global", user_id: null } };
  await backend.client.upsertPoints([alien, denylisted]);
  // Obcy tenant odrzucany już przy zapisie (fail-closed write, V1 §5).
  await assert.rejects(backend.client.upsertPoints([foreignTenant]), /tenant must be/);
  // Obrona w głąb na odczycie: nawet gdyby silnik zwrócił nadmiarowy hit,
  // post-filtr retrieval go tnie (canned fetch omija write-validation).
  const { retrieve } = await import("./dist/knowledge/retrieval.js");
  const stubFetch = async () => ({ ok: true, status: 200,
    json: async () => ({ result: [
      { score: 0.99, payload: foreignTenant.payload },
      { score: 0.98, payload: denylisted.payload },
      { score: 0.9, payload: { ...denylisted.payload, source_id: "help-page", tenant: "kompas-zbiorek" } },
    ] }),
    text: async () => "ok" });
  const stubClient = new QdrantClient({ baseUrl: "memory://stub", fetchFn: stubFetch });
  const stubHits = await retrieve(stubClient, deterministicEmbed(), "sekretny plan", { userId: subA, workspaceIds: [] }, { minScore: 0 });
  assert.equal(stubHits.length, 1, "post-filtr tnie obcy tenant i denylist");
  assert.equal(stubHits[0].source_id, "help-page");
  const asB = await rpcAuth("tools/call", {
    name: "search_knowledge", arguments: { query: "sekretny plan użytkownika", minScore: 0 },
  }, TOKEN_B);
  const textsB = JSON.stringify((asB.body.body?.result ?? asB.body.result).structuredContent);
  assert.ok(!textsB.includes("sekretny plan użytkownika A"), "użytkownik B nie widzi chunka A");
  assert.ok(!textsB.includes("paperclip-issues"), "denylistowany content nigdy nie wraca");
  assert.ok(!textsB.includes("inny-produkt"), "obcy tenant niewidzialny");
  const asA = await rpcAuth("tools/call", {
    name: "search_knowledge", arguments: { query: "sekretny plan użytkownika", minScore: 0 },
  }, TOKEN_A);
  assert.ok(JSON.stringify((asA.body.body?.result ?? asA.body.result).structuredContent).includes("sekretny plan użytkownika A"),
    "właściciel widzi własny chunk");
  await backend.client.deletePoints([alien.id, foreignTenant.id, denylisted.id]);
});

test("RAG malformed: client-scope/prototype/object-key negatives", async () => {
  // Warstwa walidacji odrzuca client override scope (izolacja z tokenu).
  const { validateSearchArgs } = await import("./dist/knowledge/mcp-tools.js");
  for (const key of ["tenant", "userId", "user_id", "workspaceIds", "workspace_id", "workspaces"]) {
    assert.throws(() => validateSearchArgs({ query: "x", [key]: "cudzy-scope" }), /niedozwolony/);
  }
  // Przez transport MCP nieznane klucze są stripowane przez inputSchema
  // (zod) — override nie dociera do silnika: B z cudzym user_id widzi nic.
  const stripped = await rpcAuth("tools/call", {
    name: "search_knowledge", arguments: { query: "sekretny plan użytkownika", minScore: 0, user_id: bearerSubject(`Bearer ${TOKEN_A}`) },
  }, TOKEN_B);
  assert.ok(!JSON.stringify(stripped.body.result ?? stripped.body).includes("sekretny plan użytkownika A"),
    "stripowany scope override nie wycieka");
  // Prototype pollution: __proto__ jako klucz nie eskaluje scope ani nie crashuje.
  const polluted = JSON.parse('{"query":"logowanie","__proto__":{"user_id":"evil"}}');
  const { body } = await rpcAuth("tools/call", { name: "search_knowledge", arguments: polluted }, TOKEN_A);
  assert.ok(!JSON.stringify(body).includes("evil"), "__proto__ nie wstrzykuje scope");
  // Nieznane źródło + zły topK/minScore = czytelny błąd.
  for (const args of [
    { query: "x", sourceIds: ["drive-user"] }, { query: "x", topK: 99 },
    { query: "x", minScore: 5 }, { query: "   " }, { query: "x".repeat(501) },
  ]) {
    const { body: b } = await rpcAuth("tools/call", { name: "search_knowledge", arguments: args }, TOKEN_A);
    assert.ok(b.error || b.result?.isError, `malformed musi być odrzucony: ${JSON.stringify(args).slice(0, 60)}`);
  }
  // Fail-closed payload: denylist źródła + niekompletny payload.
  await assert.rejects(syncDocument(new QdrantClient({ baseUrl: "memory://x", fetchFn: (await import("./dist/knowledge/memory.js")).createMemoryFetch() }), deterministicEmbed(), {
    sourceId: "paperclip-issues", documentId: "d", rawText: "sekret", sourceVersion: "v",
  }), /not allowed/);
  assert.ok(validatePayload({}).length > 0, "pusty payload invalid");
  assert.ok(validatePayload({ source_id: "h", document_id: "d", chunk_id: await chunkId("d", 0), tenant: "zły", visibility: "global", content_type: "help", content_hash: "h", source_version: "v", updated_at: new Date().toISOString() }).length > 0, "zły tenant invalid");
  assert.throws(() => assertNotDenied("ops/runbook.md"), /denied/);
  assert.throws(() => assertNotDenied("AGENTS.md"), /denied/);
});

// ---- Review R2: denylista na ścieżce zapisu + na zindeksowanym korpusie ----

test("R2 write path: denylista blokuje zapis, a odrzucone dokumenty zostają poza kolekcją", async () => {
  const { createMemoryFetch } = await import("./dist/knowledge/memory.js");
  const client = new QdrantClient({ baseUrl: "memory://denylist", fetchFn: createMemoryFetch() });
  const scope = { userId: "u", workspaceIds: [] };
  const before = (await client.scrollScoped(scope, { limit: 200 })).result.length;
  for (const doc of [
    { documentId: "ops/runbook.md", rawText: "zdeniadowana ścieżka operacyjna" },
    { documentId: "help-page", rawText: "klucz sk-ant-abcdefghijklmnopqrst w treści" },
    { documentId: "help-page", rawText: "runbook Paperclipa: kroki operacyjne agenta" },
  ]) {
    // Ten sam dokument przez źródła (read path) i przez pipeline (write path).
    await assert.rejects(
      syncDocument(client, deterministicEmbed(), { sourceId: "help-page", sourceVersion: "test:deny", ...doc }),
      /denied/,
    );
  }
  const after = (await client.scrollScoped(scope, { limit: 200 })).result.length;
  assert.equal(after, before, "dokument odrzucony na zapisie nie zostawia punktu w kolekcji");
});

test("R2 korpus: każdy zindeksowany chunk spełnia politykę denylisty", async () => {
  const { backend } = await seedLiveCorpus();
  const res = await backend.client.scrollScoped(
    { userId: bearerSubject(`Bearer ${TOKEN_A}`), workspaceIds: [] }, { limit: 500 },
  );
  const points = res.result;
  assert.ok(points.length >= 5, `skan korpusu nie może być pusty (jest ${points.length} chunków)`);
  for (const p of points) {
    const text = p.payload.text ?? "";
    for (const re of DENIED_TEXT) {
      assert.ok(!re.test(text), `zindeksowano treść denylistowaną (${re}) w ${p.payload.document_id}`);
    }
    assert.doesNotThrow(() => assertNotDenied(p.payload.document_id, text),
      `zindeksowany dokument łamie denylistę: ${p.payload.document_id}`);
  }
});

test("B1 fail-closed: prawdziwy QDRANT_URL bez realnego embeddera nie konstruuje backendu", async () => {
  const { resetKnowledgeBackend } = await import("./dist/index.js");
  const prevUrl = process.env.QDRANT_URL;
  const prevFlag = process.env.EMBEDDING_ALLOW_LEXICAL;
  const prevAi = globalThis.AI;
  const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    process.env.QDRANT_URL = "https://qdrant.example.invalid";
    delete process.env.EMBEDDING_ALLOW_LEXICAL;
    resetKnowledgeBackend();
    // Bez Workers AI i bez jawnej zgody na leksykę lepszy jest upadek niż ciche zatrucie kolekcji bge-m3.
    assert.throws(() => knowledgeBackend(), /refusing to write lexical vectors/);
    process.env.EMBEDDING_ALLOW_LEXICAL = "1";
    assert.equal(knowledgeBackend().embedder, "lexical-explicit");
    resetKnowledgeBackend();
    globalThis.AI = { run: async () => ({ data: [new Array(1024).fill(0)] }) };
    assert.equal(knowledgeBackend().embedder, "workers-ai", "prod runtime = Workers AI bge-m3");
  } finally {
    globalThis.AI = prevAi;
    restore("QDRANT_URL", prevUrl);
    restore("EMBEDDING_ALLOW_LEXICAL", prevFlag);
    resetKnowledgeBackend();
  }
});
