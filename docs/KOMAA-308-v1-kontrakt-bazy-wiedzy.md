# KOMAA-308 V1 — Kontrakt bazy wiedzy i bezpieczeństwa (evidence)

## 1. Faktyczne źródła wiedzy użytkowej (CURRENT, zweryfikowane w kodzie)

| # | Źródło | Lokalizacja / adres | Charakter | Uwagi |
|---|--------|---------------------|-----------|-------|
| S1 | Katalog sprawności RR (oficjalne wymagania) | `https://wtyczka.kompaszbiorek.pl/api/skills?poziom=…&aspekt=…`, cache IndexedDB `kompas-catalog-v1` (TTL 24h) — ref `app/documentation.md`, `app/web/src/static-app-v2.js` | zewnętrzne, kanoniczne, READ-ONLY | Wymagań sprawności **nie wolno wymyślać** (README). Snapshot do indeksu tylko jako pochodna; SSOT = API. |
| S2 | Dane własne użytkownika (plany, aktywności, refleksje, drużyna, historia sprawności) | CURRENT: `localStorage["kompas-zbiorek-draft-v1"]`; TARGET SSOT: Supabase/Postgres (migracji brak — `supabase/README.md`) | per-user, prywatne | Indeksowalne dopiero po stronie serwera (po migracji do Supabase); nigdy z odczytu cudzego localStorage. |
| S3 | Treści marketingowe | `content/marketing/01_BRAND_PRODUCT.md, 02_AUDIENCE.md, 03_VOICE_RULES.md, 04_EXAMPLES.md` | globalne, publiczne | Jedyny indeksowalny katalog narracji produktowej. |
| S4 | Maile onboardingowe | `content/onboarding-emails/plain-text/*.txt` (+ odpowiedniki HTML, `MAPA-AUTOMATYZACJI.md`) | globalne, publiczne | Kanon: wariant plain-text (treść normatywna); HTML to prezentacja tego samego dokumentu. |
| S5 | Strona pomocy | `app/cloudflare-worker/strona-pomocy/worker.js` (serwis: `pomoc.kompaszbiorek.pl`) | globalne, publiczne | FAQ/logowanie/Picker/dokumenty/kontakt. |
| S6 | Dokumenty prawne | `app/cloudflare-worker/dokumenty-prawne/{polityka-prywatnosci,warunki-korzystania}/worker.js` | globalne, publiczne | Wersjonowane per deploy Workera. |
| S7 (warunkowe) | Dokumenty Google użytkownika (Picker, scope `drive.file`) | Google Drive przez `google-handler.ts` | per-user, prywatne | Tylko pliki explicite wybrane przez użytkownika (`kompas-picked-doc`); wymaga decyzji V2 (tak/nie). |

Brak istniejącej infrastruktury wektorowej: grep po `qdrant|pgvector|embedding|retriev|rag` w `app/server`, `app/cloudflare-worker/src`, `app/web/src`, `supabase`, `docs` — zero trafień. V1 definiuje wyłącznie kontrakt.

## 2. Allowlista indeksowania

- S1–S6 powyżej (S7 po decyzji V2).
- `app/documentation.md` — wyłącznie sekcje opisu zachowania runtime (nie historia zmian per issue).
## 3. Denylista (zabronione — bez wyjątków)

- Taski/issues Paperclip i ich komentarze; surowe dane tablicy.
- Logi (aplikacyjne, deploy, audytowe) i runbooki (`ops/`, CI logi).
- `AGENTS.md` na root i w podkatalogach, `skills/*`, `registry/*`, `scripts/*`, `opencode.json` — instrukcje agentowe/operacyjne.
- Mirror wiedzy `.paperclip-wiki/` i Paperclip Wiki operacyjna (poza wyciągami produktowymi explicite przeniesionymi do S3–S6).
- Sekrety/konfig: `.env*`, `wrangler.*.jsonc` vars, tokeny, `Authorization`, `TEMPLATE_FILE_ID`, klucze Google.
- Prompty systemowe i instrukcje MCP (`app/server/index.ts` `instructions`, teksty `toolInvocation`).
- Dev-notatki: `dev/`, `archive/`, `kompas-ui-plugin`, Storybook, pliki `*_test`, `_comment.md` robocze.
- Dane innego użytkownika (patrz §4) .

Egzekucja: pipeline indeksujący trzyma allowlistę ścieżek/URLi jako kod (nie konfigurowalną flagą); każdy nowy typ źródła wymaga zmiany kontraktu (kolejne V), nie cichego dodania.

## 4. Granice tenant/user/workspace i filtry autoryzacyjne

- Tożsamość (CURRENT, `google-handler.ts` + `oauth.ts`): użytkownik = `googleSub` (Google `sub`), email pomocniczo; token MCP wydaje wyłącznie Worker (OAuth 2.1, scope `kompas.read`); token Google nigdy nie jest tokenem MCP. `userId = props.googleSub` (linia ~547).
- Model scope: `tenant` = `kompas-zbiorek` (jeden produkt); `user_id` = `googleSub`; `workspace_id` = drużyna/szczep (`S.team`, po migracji Supabase — explicite `team_id`; stan CURRENT: draft jest implicitnie single-workspace per przeglądarka).
- Zasada: **prefilter autoryzacyjny przed retrieval, w silniku wektorowym (Qdrant payload filter), nigdy samo post-filtrowanie.** Zapytanie bez `user_id` z ważnego tokenu = odrzucane (fail-closed).
- Reguła widoczności chunków dla zapytania użytkownika U:
  - `visibility = "global"` (S1,S3–S6) → zawsze dozwolone;
  - `visibility = "user"` → tylko `owner_user_id = U`;
  - `visibility = "workspace"` → tylko `workspace_id ∈ workspaces(U)` z sesji/payloadu tokenu;
  - brak dopasowania = chunk niewidzialny (również dla agregacji/liczb — brak oracle przez counting).
- S1 (katalog RR) jest globalny, ale odpowiedzi RAG muszą oznaczać go jako wymagania oficjalne vs. treść użytkownika.
- S7: tylko `owner_user_id = U` + `source fileId` z allowlisty plików wybranych przez U; odwołanie zgody / usunięcie pliku = natychmiastowy delete (tombstone + purge, §6).

## 5. Metadata schema (obowiązkowe pola payloadu każdego punktu)

```
source_id: string        # S1..S6 (S7 po decyzji), np. "skills-catalog", "onboarding-emails", "help-page"
document_id: string      # stabilny id dokumentu w źródle, np. "skills:Puszczaństwo/Fizyczny",
                         #   "onboarding-email-2/model-sens", "help-page", "privacy-policy"
chunk_id: string         # determinystyczne: sha256(document_id + "#" + chunk_ordinal)[:32]
tenant: string           # zawsze "kompas-zbiorek" (v1; multi-tenant tylko przez zmianę kontraktu)
user_id: string|null     # googleSub właściciela; null = treść globalna
workspace_id: string|null# team_id (drużyna); null = poza kontekstem drużyny / treść globalna
visibility: enum         # "global" | "workspace" | "user"
content_type: enum       # "rr-requirement" | "user-plan" | "user-reflection" | "marketing" |
                         #   "onboarding-email" | "help" | "legal" | "runtime-doc"
content_hash: string     # sha256 znormalizowanego tekstu chunka (dedup + wykrywanie zmian)
source_version: string   # wersja źródła: S1 = data snapshotu API; S3–S6 = git SHA + ścieżka;
                         #   S6 = deploy-id Workera; S2 = revision rekordu Supabase
updated_at: string       # RFC3339, czas ostatniej materializacji chunka
```

Indeks Qdrant: payload-index na `(tenant, visibility, user_id, workspace_id, source_id, document_id, content_hash)`; filtr autoryzacyjny zawsze zawiera `tenant` + regułę §4.

## 6. Kontrakt update/delete, idempotencja, deduplikacja

- Idempotencja: klucz zapisu = `(source_id, document_id, chunk_ordinal, content_hash)`; ponowny zapis tego samego klucza = no-op (upsert po `chunk_id`).
- Zmiana treści dokumentu: nowe `content_hash` → re-chunk + re-embed; chunki o ordinalach znikniętych w nowej wersji usuwane w tej samej transakcji co upsert (brak sierot).
- Deduplikacja: przed zapisem sprawdź `(source_id, document_id, content_hash)`; identyczny chunk = no-op, bez nowego punktu i bez nowego embeddingu (oszczędność kosztów).
- Delete dokumentu: tombstone (`deleted_at`, usuwanie z wyników natychmiast) + fizyczny purge punktów w ≤24h; potwierdzenie purge zwracane do wywołującego sync.
- Kolejność: źródło → normalizacja tekstu → chunkowanie stabilne (stałe granice dla stałej treści) → hash → filtr denylisty → embed → upsert z pełnym payloadem §5. Chunk bez kompletnego payloadu nie trafia do kolekcji (fail-closed).
- Wersjonowanie kolekcji: jedna kolekcja `kompas-knowledge-v1`; zmiana schema/embed-model = nowa kolekcja + alias-swap, nie mutacja w miejscu.

## 7. Decyzje do V2–V6 (wejście implementacyjne) i non-goals V1

1. V2: decyzja S7 (Drive użytkownika tak/nie) + wybór silnika (Qdrant vs pgvector) — rekomendacja startowa: Qdrant (filtry payloadowe natywne dla §4).
2. V3: connector Supabase (S2) po pojawieniu się migracji — do tego czasu S2 NIE jest indeksowane.
3. V4: sync S1 (poll snapshotu API + `source_version` = timestamp snapshotu).
4. Non-goal V1: brak implementacji pipeline, brak wyboru modelu embedding, brak API MCP do retrieval (kontrakt danych gotowy, implementacja w V2–V6).

Weryfikacja V1: przegląd kontraktu vs. kod CURRENT — ścieżki/sekcje/api powyżej istnieją w repo; grep wektorowy pusty. Zero implementacji pipeline (zgodnie ze scope). Zapis do issue przez API był zablokowany (Cloudflare 1010 na wszystkich endpointach), więc kontrakt utrwalono jako dokument na branchu `KOMAA-308-v1-kontrakt-bazy-wiedzy`; treść komentarza do wklejenia do issue = ten plik.
