# KOMAA-385 RAG2 — disposition (JEDEN bounded task, brak child issues)

## Co dowieziono (branch `feature/rag-chatgpt-plugin`)
- Selektywny odzysk z donorów KOMAA-308…312 (diff, bez wholesale merge):
  `schema/embeddings/qdrant/pipeline/retrieval/mcp-tools` → `app/plugin/knowledge/`
  (nowa lokalizacja po KOMAA-377; importy `.js` dla NodeNext).
- Nowe, minimalne: `memory.ts` (in-memory emulacja REST Qdrant przez ten sam
  `fetchFn` — logika `QdrantClient` bez zmian), `sources.ts` (realne źródła
  S3–S6 + runtime-doc + denylista V1 §3 jako kod), fallback
  `deterministicEmbed()` (FNV worki, L2; prod = Workers AI bge-m3).
  Emulacja **odrzuca każdy nieznany klucz warunku** (`min_should`, `filter`,
  `min_count`) tak jak prawdziwy silnik 400 — dzięki temu zielony suite na
  emulacji nie przepuszcza filtra, którego Qdrant nie zna (KOMAA-403).
- MCP: `search_knowledge`, `get_knowledge_source` w `app/plugin/server.ts`
  (zod schemas, `readOnlyHint`, `securitySchemes: [oauth2]`); scope
  **wyłącznie z Bearer** (`bearerSubject` = sha256, server-derived, zero
  client override — nadmiarowe klucze stripuje schema albo odrzuca walidacja).
- Secret flow: `QDRANT_URL` + `QDRANT_API_KEY` z env (Vercel env w prod);
  brak `QDRANT_URL` = in-memory (dev/test). Fail-closed B1: `QDRANT_URL`
  bez bindingu Workers AI wymaga jawnego `EMBEDDING_ALLOW_LEXICAL=1`,
  inaczej start pada zamiast cicho truć kolekcję bge-m3 leksyką.
  Żadnych sekretów w kodzie/testach.
- **Inwariant reuse-first (KOMAA-385, decyzja 2026-09-28):** kod jest
  backend-agnostyczny — klient gada z Qdrantem bezpośrednio po REST, adres
  i klucz wyłącznie z env. `mcp-qdrant` (`http://mcp-qdrant:8000/mcp`) to
  narzędzie agenta/admina/dev, **nie** backend produktu. Brak
  `QDRANT_URL`/`QDRANT_API_KEY` w runie agenta NIE jest dowodem na potrzebę
  drugiego klastra — wybór backendu i projekcja `secret_ref` należą do
  KOMAA-400. Guard: `tests/repo-structure.test.mjs`
  („product knowledge path is direct-to-Qdrant and env-addressed") — brak
  referencji do endpointu narzędziowego i brak zahardkodowanego URL Qdrant.
- DoD w `app/plugin/contract.test.mjs` (21 green): idempotencja 2x ingest
  (drugi sync przez liczący embed — zero re-embedów realnie),
  update/delete/no-result, cross-user/tenant leakage, denylist, malformed +
  `__proto__`, unauthorized, tools/schemas/annotations/securitySchemes,
  memory-backed ingest → scoped retrieval → MCP ze źródłem,
  kształt filtra zgodny z Qdrant 1.19.1 (bez `min_should`/`min_count`).
- Denylista V1 §3 w jednym module (`knowledge/denylist.ts`) egzekwowana na
  **ścieżce zapisu** (`syncDocument`) i na ścieżce odczytu (`sources.ts`),
  nie tylko przy czytaniu plików. Reguły treściowe celowo wąskie
  (`paperclip`/`runbook`/`toolInvocation` + materiał sekretowy): realna treść
  produktowa używa słów „token" i „sekret", więc zakaz słów odrzucałby
  wiedzę użytkownika. Test skanuje **zindeksowany korpus** (34 chunki) —
  każdy punkt musi spełniać politykę, skan nie może być pusty.
- Inspector smoke: `tools/list` = 3 tools; `tools/call search_knowledge`
  bez Bearer → `isError` fail-closed.

## Celowo pominięte (decyzje V2, nie dług)
- S1 (live API RR), S2/S7 (dane użytkownika/Drive) — brak SSOT/migracji; indeks tylko treści globalne.
- Wektory bge-m3 + prawdziwy Qdrant: wymaga alias-swap na nową kolekcję;
  live smoke (`scripts/rag-live-smoke.mjs`) uruchamia posiadacz sekretu
  (`QDRANT_URL` + `QDRANT_API_KEY` + `EMBEDDING_ALLOW_LEXICAL=1` dla leksyki);
  w tym checkoutcie live Qdrant NIE był uruchomiony — E2E jest memory-backed.
- `ponytail:` w kodzie znaczą sufity (opaque-bearer sub, heurystyka leksykalna, brak HNSW).
- Ścieżka live smoke (`knowledge/smoke.ts`) jest **ta sama** dla prawdziwego
  Qdranta i dla emulacji REST — różni się tylko `fetchFn`. Dzięki temu
  jednorazowy live nie może zawieść na błędzie skryptu: kontraktowy test
  przepuszcza pełną ścieżkę (ingest → MCP → negatyw wycieku → sprzątanie)
  bez sekretów. Zakres env smoke to dokładnie dwa sekrety
  (`QDRANT_URL`, `QDRANT_API_KEY`) + jawna flaga `EMBEDDING_ALLOW_LEXICAL=1`
  (nie sekret) — ścieżka `existing_instance` nie wymaga żadnej pracy poza
  bindingiem tych dwóch zmiennych.

## Evidence (uczciwie)
- `npm run validate:code` green na finalnym SHA (lint + typecheck + 22 kontrakt
  + 1 repo-structure + 9 vitest). Testy mutacyjne: po usunięciu guardu
  denylisty z `syncDocument` test R2 pada (nie jest tautologiczny).
  Dodatkowo po KOMAA-403: reintrodukcja `min_should` do filtra wywala kontrakt
  przez emulację (guard na kształcie, nie na konkretnej wartości).
  Po wyciągnięciu live smoke: zepsucie `buildAuthFilter` (gałąź `user_id`)
  wywala test ścieżki smoke komunikatem „filtr scope popsujony" — negatyw
  wycieku nie jest pozorny.
- `npm run validate:vercel`: gate kończy się **kodem 2** w tym checkoutcie
  (brak linku projektu Vercel: `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, brak
  `.vercel/project.json`; gate słusznie odmawia auto-linku) — NIE raportować
  jako pass. Blokada pierwszorzędna: KOMAA-383 (Harness Agent).
- Live Qdrant (`ingest → Qdrant → scoped retrieval → MCP ze źródłem`)
  NIE był uruchomiony — zgodnie z inwariantem reuse-first wynika to z braku
  projekcji `QDRANT_URL`/`QDRANT_API_KEY` w execution workspace, a **nie** z
  wniosku o nowym klastrze. Blokada pierwszorzędna: **KOMAA-400** (Harness
  Agent, discovery-first). Kryteria kompatybilności, które musi potwierdzić
  discovery (to one, nie zmiana kodu, decydują o reuse):
  1. osiągalność REST Qdrant z runtime produktu (Vercel), nie tylko z sieci
     Paperclip — wewnętrzny DNS typu `mcp-qdrant` nie wystarcza;
  2. uprawnienia pojedynczego sekretu: `PUT /collections`
     (`kompas-knowledge-v1`) + payload-indexy, albo kolekcja założona
     wcześniej przez admina;
  3. współdzielenie klastra nie koliduje z kolekcjami narzędzia
     (produkt: `kompas-knowledge-v1`, `tenant=kompas-zbiorek`).
   Do czasu projekcji jedynym dowodem ingestu jest E2E memory-backed na tym
   samym kodzie klienta.
  Jeden live run po projekcji zamyka całą linię B2 naraz (to dlatego smoke
  nie woła wewnętrznego `retrieve()`, tylko `search_knowledge` /
  `get_knowledge_source`): ingest przez pipeline → odpowiedź MCP
  z `source_id`/`chunk_id` → chunki źródła → negatyw wycieku
  (`user`-scoped chunk widoczny dla właściciela, niewidoczny dla obcego
  tokenu, na filtrze silnika) → delete → asercja „po delete nic nie wraca".
  Zero dodatkowych sekretów, zero drugiego clustera, zero board-gated pracy
  poza tymi dwoma bindingami.
- Niezależny review przez istniejący review stage: `request_changes` na
  `702114a` (B1/B2/B3 + R1/R2). B1, R1, R2 zamknięte kodem w `50933e4`;
  B2 (**KOMAA-400**) i B3 (**KOMAA-383**) to blokady zewnętrzne poza
  zasięgiem agenta. Status issue: `blocked` do czasu ich rozwiązania.
