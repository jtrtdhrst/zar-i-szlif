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
  brak `QDRANT_URL` = in-memory (dev/test). Żadnych sekretów w kodzie/testach.
- DoD w `app/plugin/contract.test.mjs` (17/17 green): idempotencja 2x ingest,
  update/delete/no-result, cross-user/tenant leakage, denylist, malformed +
  `__proto__`, unauthorized, tools/schemas/annotations/securitySchemes,
  live ingest → scoped retrieval → MCP ze źródłem.
- Inspector smoke: `tools/list` = 3 tools; `tools/call search_knowledge`
  bez Bearer → `isError` fail-closed.

## Celowo pominięte (decyzje V2, nie dług)
- S1 (live API RR), S2/S7 (dane użytkownika/Drive) — brak SSOT/migracji; indeks tylko treści globalne.
- Wektory bge-m3 + prawdziwy Qdrant: wymaga alias-swap na nową kolekcję;
  live smoke z realnym Qdrant po stronie posiadacza sekretu.
- `ponytail:` w kodzie znaczą sufity (opaque-bearer sub, heurystyka leksykalna, brak HNSW).

## Evidence
`npm run validate:vercel` na finalnym SHA; niezależny review przez istniejący review stage.
