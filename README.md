# Żar i Szlif

**Aplikacja dla instruktorów Royal Rangers** wspierająca planowanie, realizację, refleksję i doskonalenie zbiórek. Projekt obejmuje aplikację, publiczną stronę WWW, produktowy MCP oraz integracje infrastrukturalne.

> **Stan wdrożenia (22.10.2026):** obecny `main` nie zawiera jeszcze całej reorganizacji przedstawionej poniżej. Struktura jest kandydatem w [PR #74](https://github.com/miloszspyrka-code/zar-i-szlif/pull/74) i wymaga niezależnego review CTO, CI i zatwierdzonego merge. Dokumentacja nie jest dowodem, że usługi działają na VPS albo zostały skonfigurowane w Coolify.

## Kod i odpowiedzialność

| Ścieżka | Przeznaczenie | Właściciel |
| --- | --- | --- |
| `app/web/` | Aplikacja produktu / panel | Engineer |
| `app/website/` | Publiczna strona WWW | Engineer / właściciel WWW |
| `app/mcp-worker/` | Produktowy MCP, OAuth, wyszukiwanie i RAG | MCP Engineer |
| `app/cloudflare-worker/` | Pozostałe API i OAuth produktu | Engineer |
| `app/plugin/` | Kod współdzielony produktu | Właściciel komponentu |
| `mcp/mantic/` | Własna integracja Mantic/Mautic MCP | Harness |
| `mcp/qdrant/` | Hostowy Qdrant MCP | Harness |
| `mcp/penpot/` | Hostowy Penpot MCP | Harness |
| `mcp/plasmic/` | Hostowy Plasmic MCP | Harness |
| `mcp/supabase/` | Hostowy Supabase MCP | Harness |
| `mcp/ubuntu/` | Hostowy Ubuntu MCP | Harness |
| `mcp/paperclip/` | Paperclip MCP / gateway | Harness |
| `supabase/` | Schemat i migracje **bazy produktu**, nie serwer MCP | Engineer |
| `ops/coolify/` | Oddzielne targety i konfiguracje buildów | Harness + CTO |

**Wycofane:** OpenDesign MCP i OpenCode MCP jako osobne serwery — nie przywracać ich katalogów, obrazów ani targetów wdrożenia. OpenCode jako środowisko wykonawcze agentów pozostaje bez zmian. Foldery `_branches/` to wyłącznie źródła porównawcze, nie katalogi buildów.

## Git i dostarczanie zmian

- Aktualna decyzja Paperclip Wiki z 22.10.2026 przewiduje **jedno repozytorium**: `miloszspyrka-code/zar-i-szlif`. Jedyną gałęzią integracyjną jest `main`.
- Agent pracuje w prawidłowym repo i izolowanej, przypisanej do issue gałęzi; nie tworzy osobnej trwałej gałęzi produkcyjnej dla MCP, aplikacji ani Harnessa.
- Każdy kandydat wymaga testów dla własnej usługi, zapisanego SHA, niezależnej decyzji CTO i PR do `main`. Nie publikować bezpośrednio do `main`.
- Wdrożenia są **per usługa**. Zmiana produktu nie restartuje wszystkich MCP. Sprawdzaj build, digest, zdrowie usługi, właściwy transport MCP, autoryzowane `initialize` / `tools/list` i rollback.
- Nie usuwaj gałęzi z niezintegrowanym kodem, otwartym PR, aktywnym worktree lub nierozwiązanym zadaniem. Po potwierdzonym merge i braku zależności usuń zbędne gałęzie.
- Wszystkie zadania Paperclip wymagają watchdogów. Nie zmieniaj konfiguracji modeli agentów bez wyraźnego polecenia.

## Status komponentów

- Frontend produktu: Dockerfile `ops/coolify/Dockerfile` (kontekst root, port 80).
- WWW: kandydat `app/website/Dockerfile` (kontekst root, port 80), **niezweryfikowany produkcyjnie**.
- Produktowy `app/mcp-worker/`: obecnie Cloudflare Worker wymagający KV i Workers AI — **nie jest kontenerem Coolify bez osobnej adaptacji**.
- Mantic: istniejący Dockerfile uruchamia tryb stdio; brak potwierdzonego transportu HTTP.
- Plasmic: osobny kandydat kontenerowy port 8091; wymaga rzeczywistych testów WAB end-to-end.
- Qdrant, Penpot, Supabase, Ubuntu i Paperclip MCP: odzysk źródeł lub gotowość produkcyjna nie jest jeszcze w pełni potwierdzona.

## Dokumentacja kanoniczna

- [Architektura monorepo, gałęzie, wdrażanie](docs/architecture/monorepo-branches-and-deploy.md)
- [Manifest targetów Coolify](ops/coolify/targets.json)
- [Inwentaryzacja gałęzi i SHA](docs/architecture/branch-inventory-20261022.json)
- [Instrukcje agentów](AGENTS.md)
- **Paperclip Wiki:** `wiki/concepts/mcp-github-branch-migration-20261022.md` jest bieżącym źródłem decyzji. Lokalna dokumentacja w repo jest jej odzwierciedleniem, a nie substytutem walidacji działającego runtime.

**Zasada danych:** Supabase/Postgres jest jedynym źródłem prawdy domenowej; brak danych należy wykazać jawnie, bez generowania fikcyjnej treści.
