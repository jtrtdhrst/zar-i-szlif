# Architektura monorepo, segmentacja MCP i cykl wdrożeniowy — 2026-10-22

## Decyzja i stan faktyczny

**JEDNO repo:** `miloszspyrka-code/zar-i-szlif`. Jedyną gałęzią integracyjną/produkcyjną jest `main`. Gałęzie agentów to niezależne gałęzie robocze; bez autoryzowanego PR, testów i niezależnego review CTO nie mogą trafić na main. PR #74 jest **draft i źródłem zmian oczekujących na merge**, a nie aktualnym produkcyjnym `main`. Zamknięte PR #71 i #73 wymagające osobnego repo Harnessa są nieaktualne. Żadne zadanie nie upoważnia do zmiany modeli Paperclip ani kodu Paperclip/OpenCode Core.

**WYCOFANE:** `OpenDesign MCP` oraz `OpenCode MCP` — nie mają żadnej docelowej usługi Coolify, katalogu MCP ani aktywnej konfiguracji builda. Źródła zaimportowane poprzednio w `mcp/opendesign/`, `mcp/opencode/`, historyczny mostek `dev/integrations/opencode-mcp/` oraz build OpenDesign w legacy design-stack zostały usunięte z kandydata PR #74. Historia oryginalnych gałęzi GitHub nadal istnieje, ale nie podlega merge ani deployowi. **OpenCode jako runtime/model provider agentów pozostaje nienaruszony** (np. `opencode.json`); decyzja dotyczy wyłącznie nieużywanego dodatkowego MCP. Nie usuwać brandingu/UI produktu tylko dlatego, że nazwa katalogu lub opisy historycznie wspominają OpenDesign.

## Kanoniczne katalogi

```text
zar-i-szlif/
├── app/
│   ├── web/                  aplikacja produktu
│   ├── website/              publiczna strona produktu
│   ├── mcp-worker/           produktowy OAuth MCP / RAG
│   ├── cloudflare-worker/    API i OAuth produktu (inne niż MCP produktu)
│   └── plugin/               istniejący współdzielony kod produktu
├── mcp/
│   ├── mantic/               własny Mantic / Mautic MCP
│   ├── qdrant/               własny serwer Qdrant MCP
│   ├── penpot/               własny Penpot MCP
│   ├── plasmic/              własny Plasmic MCP
│   ├── supabase/             hostowy konektor Supabase MCP
│   ├── ubuntu/               hostowy Ubuntu MCP
│   └── paperclip/            Paperclip MCP / gateway
├── supabase/                 schemat/migracje BAZY PRODUKTU; NIE Supabase MCP
├── ops/coolify/              manifest targetów, Dockerfile aplikacji
└── docs/architecture/       instrukcje i manifest gałęzi
```

Nie dopisywać ponownie katalogów `mcp/opendesign/` ani `mcp/opencode/`. Historyczne alternatywne wersje w `mcp/plasmic/_branches/` służą WYŁĄCZNIE do uzgadniania implementacji, nie do buildu ani deployu.

## Root budowania w Coolify — osobna usługa na każde wdrożenie

Wszystkie wybierają **TO SAMO** repo GitHub i **TYLKO zatwierdzone main**. `Base Directory` jest ustawieniem kontekstu aplikacji Coolify, nie mylić z folderem źródłowym.

| Usługa | Kod źródłowy | Coolify Base Directory | Dockerfile / kontekst | Port | Stan |
|---|---|---|---|---|---|
| Aplikacja produktu | `app/web/` | `/` | `ops/coolify/Dockerfile` / root `/` | 80 | plik builda istnieje |
| Strona WWW produktu | `app/website/` | `/` | `app/website/Dockerfile` / root `/` | 80 | build istnieje w PR #74; niezweryfikowany produkcyjnie |
| MCP produktu | `app/mcp-worker/` | brak gotowego Coolify | brak gotowego Dockerfile | — | **Cloudflare Worker obecnie; nie przenosić pozornie do Coolify** |
| Mantic MCP | `mcp/mantic/` | `/mcp/mantic` (planowane) | `mcp/mantic/Dockerfile` / `/mcp/mantic` | brak HTTP | Dockerfile stdio, wymagany wrapper HTTP i test |
| Qdrant MCP | `mcp/qdrant/` | `/mcp/qdrant` (docelowo) | brak gotowego Dockerfile | — | źródła serwera niepełne |
| Penpot MCP | `mcp/penpot/` | `/mcp/penpot` (docelowo) | brak gotowego Dockerfile | — | źródła serwera niepełne |
| Plasmic MCP | `mcp/plasmic/` | `/mcp/plasmic` | `mcp/plasmic/Dockerfile.mcp` / `/mcp/plasmic` | 8091 | testy i obraz niezależny od wycofanego OpenDesign, wymagane live WAB E2E |
| Supabase MCP | `mcp/supabase/` | `/mcp/supabase` (docelowo) | brak gotowego Dockerfile | — | źródła konektora niepełne |
| Ubuntu MCP | `mcp/ubuntu/` | `/mcp/ubuntu` (docelowo) | brak gotowego Dockerfile | — | źródła konektora niepełne |
| Paperclip MCP | `mcp/paperclip/` | `/mcp/paperclip` (docelowo) | brak gotowego Dockerfile | — | częściowy kod gateway; niezależny runtime do potwierdzenia |

Źródło maszynowe: **`ops/coolify/targets.json`**. Manifest NIE jest dowodem konfiguracji uruchomionej w panelu Coolify. Każda usługa osobno konfiguruje repo/main, Dockerfile, kontekst, ścieżki wyzwalające jej build, zmienne środowiskowe, health, poświadczenia, port, domene, rollback i readback SHA/digest. Push do `main` nie ma automatycznie restartować wszystkich usług.

**Wyjątek MCP produktu:** kod `app/mcp-worker/src/index.ts` używa Cloudflare OAuthProvider, Workers KV i Workers AI; zwykły Node/Docker nie zapewnia równoważnego runtime. Jego przeniesienie do Coolify jest osobnym zadaniem z testami OAuth/security, nie efektem segmentacji folderów.

## Inwentaryzacja zmian i reguły AI merge

- **Mantic:** `KOMAA-1102` → aktywna kandydacka kopia `mcp/mantic/` (34 pliki). Nie mylić stdio z gotowym HTTP MCP.
- **Plasmic:** baseline `ops/design-stack` → `mcp/plasmic/`, wersje `KOMAA-1084` i `KOMAA-1174` w `_branches/`. Reconcile do aktywnego Plasmic po sprawdzeniu zmiany WAB 412, kontraktów, bezpieczeństwa i testów; nie scalać całej mieszanej gałęzi. OpenDesign usunięty z aktywnego obrazu i komponowania.
- **Qdrant:** `KOMAA-411` wniósł skrypt testowy; nie stanowi serwera. Produktowe Qdrant/RAG `app/mcp-worker/` ma pozostać w produkcie. Ustalić właściwe źródło z VPS/Paperclip workspace.
- **Penpot / Supabase MCP / Ubuntu MCP:** brak zweryfikowanego pełnego serwera w zaimportowanych gałęziach; importować jedynie z autoryzowanego źródła, ze sprawdzonym testem i bez sekretów.
- **Paperclip MCP:** częściowy bridge z `dev/integrations/paperclip-mcp/`; nie jest jeszcze pełną odtworzoną produkcją gateway/supervisor.
- **OpenDesign MCP / OpenCode MCP:** **wycofane**, oryginalne branże pozostają jedynie w historii. Kategorycznie nie dodawać do manifestu Coolify. Sam runtime OpenCode nie jest wycofany.
- **Wszystkie pozostałe gałęzie:** zinwentaryzowane z SHA w `docs/architecture/branch-inventory-20261022.json`. Nie importować niesprawdzonych gałęzi UI/produktowej bazy do hostowych `mcp/**`.

## Workflow Paperclip — jeden cykl, bez pozornych sukcesów

1. **COO/Harness klasyfikuje** zadanie do folderu i rzeczywistego właściciela, tworzy czytelne subtasks/Definition of Done po angielsku, prawdziwe zależności DAG i watchdog (agent nadrzędny, ewentualnie wykonawca). Nie dodawać sztucznego `blockedBy` dla watchdogów.
2. **Wykonawca** pobiera `main`, sprawdza `git remote`, `git status`, `git rev-parse --show-toplevel` i poprawny subtree; zmienia kod na izolowanej gałęzi `issue/<id>-<service>`, nie na `main`, nie w przypadkowym worktree lub repo innego projektu.
3. **Testy i dowody:** test kontraktu usługi, statyczne bezpieczeństwo, CI, docker build jeśli usługa jest gotowa, regresja rzeczywistego MCP i test negatywny; PR zapisuje dokładny kandydacki SHA i informację, co zmieniono. Brak runu/testu ≠ PASS.
4. **Review:** niezależny CTO lub wyznaczony recenzent podejmuje **rzeczywistą decyzję** w natywnych stage'ach Paperclip. Każdy kolejny commit wymaga nowego review SHA.
5. **Merge:** po decyzji zatwierdzającej i wymaganym CI PR trafia do wspólnego `main`. Żadna gałąź "agent-main" nie jest produkcyjnym refem. Ochrona GitHub main / wymagane kontrole musi być zweryfikowana; sam zapis w Wiki jej nie egzekwuje.
6. **Wdrożenie:** tylko właściwa aplikacja Coolify dostaje nową wersję `main` z odtwarzalnego SHA; ręczne/automatyczne powiadomienie odbywa się tylko dla pasujących folderów. Dla MCP produktu aktualne wydanie nadal osobną ścieżką Cloudflare, dopóki nie ma sprawdzonego adaptera.
7. **Readback + zamknięcie:** dokładny SHA, image digest, port/domain, uwierzytelnione `initialize` + `tools/list`, bezpieczna operacja canary, health/restart policy, rollback do poprzedniego SHA. Dopiero później Done w Paperclip i cleanup starych branchy po upewnieniu się, że żadna unikalna zmiana nie zginęła.

### Testy repo / CI
- `node scripts/check-coolify-targets.mjs`: katalogi, oddzielne targety, Dockerfile, zabezpieczenie przed budowaniem `_branches/`.
- `node scripts/check-retired-mcp.mjs`: nie istnieją wycofane foldery MCP, nie ma wycofanych serwisów w Compose/Dockerfile i nie naruszono `opencode.json`.
- `Monorepo MCP and website source CI`: walidacja, testy Mantic i Plasmic, obraz strony; zielone CI != wdrożenie na VPS.

**Nie zmieniono agentowych przypisań modeli.**
