# KOMAA-385 RAG2 — disposition (JEDEN bounded task, brak child issues)

## Co dowieziono (branch `feature/rag-chatgpt-plugin`)
- Selektywny odzysk z donorów KOMAA-308…312 (diff, bez wholesale merge):
  `schema/embeddings/qdrant/pipeline/retrieval/mcp-tools` → `app/plugin/knowledge/`
  (nowa lokalizacja po KOMAA-377; importy `.js` dla NodeNext).
- Nowe, minimalne: `memory.ts` (in-memory emulacja REST Qdrant przez ten sam
  `fetchFn` — logika `QdrantClient` bez zmian), `sources.ts` (realne źródła
  S3–S6 + runtime-doc + denylista V1 §3 jako kod), fallback
  `deterministicEmbed()` (FNV worki, L2; prod = Workers AI bge-m3).
- MCP: `search_knowledge`, `get_knowledge_source` w `app/plugin/server.ts`
  (zod schemas, `readOnlyHint`, `securitySchemes: [oauth2]`); scope
  **wyłącznie z Bearer** (`bearerSubject` = sha256, server-derived, zero
  client override — nadmiarowe klucze stripuje schema albo odrzuca walidacja).
- Secret flow: `QDRANT_URL` + `QDRANT_API_KEY` z env (Vercel env w prod);
  brak `QDRANT_URL` = in-memory (dev/test). Fail-closed B1: `QDRANT_URL`
  bez bindingu Workers AI wymaga jawnego `EMBEDDING_ALLOW_LEXICAL=1`,
  inaczej start pada zamiast cicho truć kolekcję bge-m3 leksyką.
  Żadnych sekretów w kodzie/testach.
- DoD w `app/plugin/contract.test.mjs` (20 green): idempotencja 2x ingest
  (drugi sync przez liczący embed — zero re-embedów realnie),
  update/delete/no-result, cross-user/tenant leakage, denylist, malformed +
  `__proto__`, unauthorized, tools/schemas/annotations/securitySchemes,
  memory-backed ingest → scoped retrieval → MCP ze źródłem.
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

## Evidence (uczciwie)
- `npm run validate:code` green na finalnym SHA (lint + typecheck + 20 kontrakt
  + 1 repo-structure + 9 vitest). Testy mutacyjne: po usunięciu guardu
  denylisty z `syncDocument` test R2 pada (nie jest tautologiczny).
- `npm run validate:vercel`: gate kończy się **kodem 2** w tym checkoutcie
  (brak linku projektu Vercel: `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, brak
  `.vercel/project.json`; gate słusznie odmawia auto-linku) — NIE raportować
  jako pass. Blokada pierwszorzędna: KOMAA-383 (Harness Agent).
- Live Qdrant (`ingest → Qdrant → scoped retrieval → MCP ze źródłem`)
  NIE był uruchomiony: `QDRANT_URL`/`QDRANT_API_KEY` nie są projekowane do
  execution workspace. Blokada pierwszorzędna: **KOMAA-400** (Harness Agent,
  secret flow). Do czasu provisioningu jedynym dowodem ingestu jest E2E
  memory-backed na tym samym kodzie klienta.
- Niezależny review przez istniejący review stage: `request_changes` na
  `702114a` (B1/B2/B3 + R1/R2). B1, R1, R2 zamknięte kodem w `50933e4`;
  B2 (**KOMAA-400**) i B3 (**KOMAA-383**) to blokady zewnętrzne poza
  zasięgiem agenta. Status issue: `blocked` do czasu ich rozwiązania.
