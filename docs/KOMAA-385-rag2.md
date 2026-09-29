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
  **AKTUALIZACJA KOMAA-408 (2026-09-29): live smoke URUCHOMIONY i przeszedł**
  na Qdrant Cloud 1.19.0 — patrz sekcja „Live run" niżej.
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
- Kandydat końcowy: HEAD brancha `feature/rag-chatgpt-plugin`. Exact SHA jest
  w watku issue, nie tutaj — każda edycja tego pliku unieważniałaby wpisany
  SHA. Poprzednia recenzja (`request_changes`) dotyczyła `702114a`; od tamtej
  pory doszło commity zamykające B1/B2/B3 + R1/R2.
- `npm run validate:code` green na finalnym SHA (lint + typecheck + 24 kontrakt
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
- ~~Live Qdrant NIE był uruchomiony (brak projekcji sekretów)~~ →
  URUCHOMIONY 2026-09-29 (KOMAA-408) — wynik w sekcji „Live run".
  Wniosek o nowym klastrze był zbyt wczesny: blokada wynikała z braku
  projekcji `QDRANT_URL`/`QDRANT_API_KEY`, a **nie** z braku kompatybilności.
  Blokada pierwszorzędna była wtedy **KOMAA-400** (Harness Agent,
  discovery-first) — **zamknięta** (`done` 2026-09-29; krawędź
  `KOMAA-400 -> KOMAA-385` zdjęta przez COO w KOMAA-421). Dziś jedyną żywą
  bramką jest **KOMAA-383** (projekcja `VERCEL_*`).
  Kryteria kompatybilności potwierdzone live na 1.19.0 (wszystkie trzy TAK):
  1. osiągalność REST Qdrant z sieci — potwierdzone z execution workspace
     (publiczny endpoint Cloud, nie wewnętrzny DNS `mcp-qdrant`); osiągalność
     z runtime **Vercel** prod pozostaje do potwierdzenia po projekcji env;
  2. uprawnienia pojedynczego sekretu — potwierdzone: ten sam klucz wykonuje
     `PUT /collections` + 7 payload-indexów + upsert/read/delete;
  3. współdzielenie klastra nie koliduje — potwierdzone: `long_term_memory`
     (384 hybryda) i `rag_knowledge` (256) nietknięte, produkt siedzi w
     osobnej kolekcji 1024/Cosine.
  Ścieżka smoke (to dlatego smoke
  nie woła wewnętrznego `retrieve()`, tylko `search_knowledge` /
  `get_knowledge_source`): ingest przez pipeline → odpowiedź MCP
  z `source_id`/`chunk_id` → chunki źródła → negatyw wycieku
  (`user`-scoped chunk widoczny dla właściciela, niewidoczny dla obcego
  tokenu, na filtrze silnika) → delete → asercja „po delete nic nie wraca".
  Zero dodatkowych sekretów, zero drugiego clustera, zero board-gated pracy
  poza tymi dwoma bindingami.
- Niezależny review przez istniejący review stage: `request_changes` na
  `702114a` (B1/B2/B3 + R1/R2). B1, R1, R2 zamknięte kodem w `50933e4`;
  B2 (**KOMAA-400**) zamknięte dowodem live 2026-09-29 (KOMAA-408); B3
  (**KOMAA-383**) to blokada zewnętrzna poza zasięgiem agenta — projekcja
  sekretów do Vercel prod.

## Live run — Qdrant Cloud 1.19.0 (2026-09-29, KOMAA-408)

Endpoint `https://3c398f47-…-0.aws.cloud.qdrant.io:6333`, cluster ID
`3c398f47-8921-4930-8ee4-9f3fd881f587`, aws/eu-central-1, 1 node, free tier.
Sekrety przekazane przez boarda w interakcji `76eb6858`, złożone do katalogu
sekretów jako propozycje `qdrant_url` / `qdrant_api_key` (do zatwierdzenia).

`node scripts/rag-live-smoke.mjs` → **PASS** (`EMBEDDING_ALLOW_LEXICAL=1`,
gęstościowy fallback — bez linku do Workers AI bge-m3 w tym runie):

| Etap smoke | Wynik live |
|---|---|
| `ensureCollection` (idempotentny PUT + 7 indeksów payload) | 200/409, wszystkie 7 założone |
| ingest przez pipeline | 1 chunk (`help-page/live-smoke`) |
| `search_knowledge` (MCP, z atrybucją) | topHit `score=0.577`, `source_id`+`chunk_id`+`text` obecne |
| `get_knowledge_source` | 1 chunk |
| negatyw wycieku: chunk `user`-scoped | widoczny dla właściciela (1), obcy token: **0** |
| sprzątanie | delete potwierdzony, `points_count=0` po smoke |

Kolekcje cudze nietknięte: `long_term_memory` (2 pkt, 384 hybryda) i
`rag_knowledge` (0 pkt, 256) — te same liczniki co przed smoke.

**Dwa realne błędy, których emulacja nie wykrywa** (poprawione w `8a13368`):
1. scroll zwraca `result: {points, next_page_offset}` (Qdrant ≥ 1.8), nie
   goły array — emulacja oddawała array i przepuszczała klienta, który na
   prawdziwym silniku by zwrócił `undefined`. Klient normalizuje oba
   kształty; test kontraktowy pilnuje obu.
2. stały UUID prywatnego punktu smoke miał 11 hex w ostatniej grupie
   (8-4-4-4-11) → prawdziwy silnik odrzucił upsert 400 („not a valid point
   ID"), emulacja przyjęła wszystko. Poprawiony + assert na kształt UUID,
   żeby literówka nie kosztowała kolejnego uruchomienia z sekretem.
   Id produkcyjne są bezpieczne — `pointId()` składa je z wycinka heksdigestu.
