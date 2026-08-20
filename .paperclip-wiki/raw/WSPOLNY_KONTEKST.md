# WSPÓLNY KONTEKST — Kompas Zbiórek

Jedyne obowiązujące źródło wiedzy o projekcie dla wszystkich agentów. Nadrzędny względem sprzecznych źródeł. Nie wczytuj całego pliku: zacznij od sekcji dla swojej roli, resztę ładuj tylko dla zakresu zadania.

## Project context (warstwa A — stała)

Stały kontrakt projektu, wspólny dla wszystkich agentów. Nie odkrywaj go ponownie w każdym runie.

- **Produkt**: Kompas Zbiórek — wtyczka ChatGPT + własny interfejs (https://interfejs.kompaszbiorek.pl). Rdzeń metodyczny: SENS → DZIAŁANIE → REFLEKSJA. Karta zbiórki jest samowystarczalnym artefaktem roboczym (dane+obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja).
- **Repozytorium**: https://github.com/miloszspyrka-code/kompas-zbiorek
- **Workspace Paperclip**: `isolated_workspace` + `git_worktree`, `baseRef = main`, worktree parent `C:\Kompas Zbiórek\.paperclip-worktrees`. Główny managed checkout NIE jest targetem zapisu.
- **Produkcja**: strona publiczna https://kompaszbiorek.pl/; UI aplikacji https://wtyczka.kompaszbiorek.pl/ui; Worker Cloudflare `wtyczka-rr`; domena docelowa interfejsu `interfejs.kompaszbiorek.pl`.
- **Invarianty techniczne** (nie zmieniaj bez jawnego upoważnienia): MCP endpoint `/mcp`; Google OAuth scope `drive.file`; Cloudflare D1 w warstwie danych; struktura domen produkcyjnych; brak wdrożenia produkcyjnego bez scoped zlecenia deploya; brak bezpośredniego write do `main`.
- **Delivery**: domyślny strumień Engineer → QA → Done; maks. 2 aktywne wyniki produktu; nowe issue = nowy, niezależnie wartościowy deliverable; znany bloker zewnętrzny → czekanie pasywne, bez pętli recovery; Paperclip Ops i Kompas Product to osobne domeny; `shared_workspace` nie jest używany.
- **Definition of Done — write task**: poprawne isolated workspace → implementacja kompletna → odpowiednie testy → commit → push → commit SHA → jasna dyspozycja issue. **Blocked task**: zapis `BLOCKER / OWNER / EXACT ACTION`. Nie kończ runa bez jawnej dyspozycji.
- **Brand DNA**: charakter mapy/topografii/terenu; oszczędny żółto-złoty akcent; display serif; body geometryczny sans; hierarchia nad dekoracją.

Dynamiczne rzeczy (SHA, branch taska, run id, statusy, komentarze, Goal) dostarcza Paperclip w heartbeat-context — nie wpisuj ich tutaj i nie odtwarzaj ich ręcznie.

## Lazy-load według roli

| Rola | Ładuje sekcje |
|---|---|
| Wszyscy | Czym jest projekt, Zasady uniwersalne |
| CEO | Strategia: + PRD; retro: tylko dowody |
| COO | Triage: tylko projekt i zasady; nie czyta repo |
| CTO | Mapa systemu, Dokumentacja + testy, Integracje i API (zakres), Produkcja i wdrożenia |
| Engineer | PRD, Mapa systemu, dokumentacja modułu; wynik preflightu CTO |
| UI QA | Testy i bramka jakości UI, Design i branding, fragment PRD |
| Designer | Design i branding, fragment PRD |
| CMO | Dokumentacja integracji, materiały własnego zakresu |

## Czym jest projekt

Cyfrowy przewodnik dla drużyny harcerskiej (ZHR/ZHP, instruktorzy, drużynowi): katalog zbiórek opartych na sprawnościach, plan roczny, obecności, eksperymenty, przygotowanie i refleksja. Karta zbiórki jest samowystarczalnym artefaktem roboczym: dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja.

## Mapa systemu (REPO MAP)

**Routing table dla agentów: `docs/AI-REPO-MAP.md`** (zweryfikowane ścieżki + canonical commands). Poniższa sekcja to skrócona wersja; przy rozbieżności plik w `docs/` jest aktualniejszy.

- `PRD Kompas Zbiórek.md` — zakres, wymagania, kryteria akceptacji.
- `MAPA SYSTEMU.md` — rola plików produktu, aktualny kontrakt 4 etapów i granica materiału historycznego.
- `AGENTS.md` — zasady wykonawcze (Advanced UI, branding, wdrożenia, edycje).
- Cykl doskonalenia: `00_ANALIZA_PROBLEMU.md` … `06_CYKL_DOSKONALENIA.md`.
- Szablon treści dokumentu drużyny: `SZABLON GOOGLE DOCS.md` (podstawa struktury szablonu arkusza Google Sheets; nagłówki `[...]` to kontrakt struktury).
- **Architektura**: Widget (`kompas-ui-plugin/web`, `static-app-v2.js`) renderuje interfejs statycznie, dane robocze w `localStorage` (szkic `kompas-zbiorek-draft-v1`); Worker `wtyczka-rr` (`kompas-ui-plugin/cloudflare-worker`) serwuje UI i proxy katalogów (`/api/activities`, `/api/skills`) z dwuwarstwowym cache (Worker `caches.default` + IndexedDB) oraz narzędziem MCP `zapisz_dane_kompasu` (whitelist pól, dwuetapowy zapis z potwierdzeniem); serwer MCP (`kompas-ui-plugin/server`) to most do rozmowy ChatGPT. Cache nie synchronizuje się między urządzeniami; bez sieci i wpisu w cache — czytelny stan braku danych, nigdy wymyślona treść.

Lokalizacje (najwęższe źródło zamiast discovery):

| Obszar | Ścieżka |
|---|---|
| Aplikacja (render statyczny) | `kompas-ui-plugin/web/src/static-app-v2.js` |
| Style / design tokens w kodzie | `kompas-ui-plugin/web/src/styles.css`, `extended.css` |
| Build web | `kompas-ui-plugin/web/scripts/build-static.mjs` |
| MCP endpoint `/mcp` + `zapisz_dane_kompasu` | `kompas-ui-plugin/cloudflare-worker/src/public-ui.ts` |
| OAuth Google (`drive.file`) | `kompas-ui-plugin/cloudflare-worker/src/oauth.ts`, `google-handler.ts`, `widget-auth.ts`, `workers-oauth-utils.ts` |
| Panel Google Sheets | `kompas-ui-plugin/cloudflare-worker/src/panel-handler.ts` |
| Konfiguracja Workera | `kompas-ui-plugin/cloudflare-worker/wrangler.jsonc`, `wrangler.panel.jsonc` |
| Build/deply Workera | `kompas-ui-plugin/cloudflare-worker/build-worker.mjs` |
| Serwer mostu ChatGPT/MCP | `kompas-ui-plugin/server/index.ts` |
| Testy e2e (Playwright) | `kompas-ui-plugin/e2e/` (`ui`, `a11y`, `cache`, `panel`, `visual`, `helpers`) |
| Lighthouse | `kompas-ui-plugin/lighthouserc.json`, `scripts/run-lhci.mjs` |
| Design tokens (kanoniczne) | `kompas-ui-design/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
| Instrukcje brandingu AI | `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md` |
| Email assets | `onboarding-emails/html/`, `onboarding-emails/plain-text/`, `onboarding-emails/MAPA-AUTOMATYZACJI.md` |
| Dokumenty API | `Dokumentacja API SPRAWNOŚCI.md`, `Dokumentacja API DATY I GODZINY.md`, `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`, `dokumentacja-integracji-kompas-zbiorek.md` |

Komendy kanoniczne (`kompas-ui-plugin`): `npm run build`, `npm run test:all` (build + Playwright + Lighthouse), `test:ui`, `test:a11y`, `test:visual`, `test:lighthouse`, `test:ui:update`.

## Dokumentacja + testy / Testy i bramka jakości UI

- Dokumentacja techniczna: `documentation.md` (aktualny stan funkcji, architektura, ograniczenia, rejestr zmian).
- Testy: `npm run test:all` w `kompas-ui-plugin` (Playwright desktop + mobile 390×844, axe WCAG A/AA 2.1+2.2, screenshoty `e2e/visual.spec.ts`, cache) + Lighthouse (`lighthouserc.json`: accessibility ≥0.9 i best-practices ≥0.9 jako error, performance ≥0.5 warn).
- `npm run test:lighthouse` ustawia `CHROME_PATH` sam (Chromium z `npm run test:install`); nie uruchamiaj LHCI bez `CHROME_PATH`.
- Responsywność nie może być wyciszana `test.skip` zależnym od viewportu; desktop i mobile obowiązkowe.
- Naruszenia WCAG `critical`/`serious` blokują zakończenie zadania UI; napraw w kodzie, bez nieuzasadnionych `axe.exclude`.
- Baseliney screenshotów aktualizuj tylko przy zamierzonej zmianie zaakceptowanej przez użytkownika (`npm run test:ui:update`).
- Inspekcja produkcyjna przez Playwright MCP (`opencode.json` → `mcp.playwright`).

## Integracje i API — dokumentacja

| Integracja | Status | Zasada |
|---|---|---|
| Baza aktywności RR (`zabawy.kompaszbiorek.pl`) | odczyt przez Worker | tylko odczyt + filtry: `category` (multiselect), `level`, `energy`, `participants`; zwracaj wszystkie dopasowania, brak paginacji; brakujące pola → `Brak danych` |
| API sprawności (`sprawnosci.kompaszbiorek.pl`) | odczyt przez Worker | `pobierzSprawnosciRR`: jeden poziom, max 1 wywołanie na odpowiedź, bez ponowienia po błędzie; nie wymyślaj wymagań |
| API daty/godziny | zablokowane | strefa `Europe/Warsaw`; bez narzędzia nie zgaduj, potwierdź jeśli wpływa na decyzję |
| Stopnie RR | planowane | użyj oficjalnego dokumentu użytkownika albo `Wymaganie stopnia: do uzupełnienia z oficjalnego źródła` |
| Google Sheets (panel `/panel`) | wdrożone (faza 2) | trwały stan drużyny = arkusz Google Sheets; landing z 2 opcjami (istniejący arkusz / kopia szablonu `SHEETS_TEMPLATE_FILE_ID`), zapis karty przez `POST /panel/save` (mapowanie kolumn, `values.append`); zapis tylko po podglądzie i potwierdzeniu; awaria ≠ sukces |
| ChatGPT Canvas | zależny od interfejsu | tylko jawny artefakt; bez Canvas — Markdown |

Pełne kontrakty: `Dokumentacja API SPRAWNOŚCI.md` (v14), `Dokumentacja API DATY I GODZINY.md` (zablokowane — brak OpenAPI), `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`, `dokumentacja-integracji-kompas-zbiorek.md` (MCP + OAuth + panel Google Sheets + cache HTTP). Nie podłączaj ani nie udawaj integracji, której nie ma. Gdy API niedostępne — jawny, nieblokujący stan braku danych + edytowalny opis roboczy.

## Cykl doskonalenia (aktualny kontrakt produktu)

Aktualny cykl user-facing to **Planowanie → Realizacja → Analiza → Decyzja**. Źródłem AS-IS, zatwierdzonego TO-BE i DELTY jest [KOMAA-48](/KOMAA/issues/KOMAA-48).

- **Planowanie** ma wyłącznie checkpointy: **Cel i sprawności**, **Przebieg**, **Przygotowanie**. Są systemowe, nie są zadaniami użytkownika.
- Dla **Realizacji**, **Analizy** i **Decyzji** nie ma zatwierdzonych podzadań ani bramek; nie wolno ich dopowiadać.
- `00`–`06` oraz dawne 9 kroków są **HISTORYCZNYM/METODOLOGICZNYM** materiałem traceability, a nie bieżącym modelem produktu ani mapowaniem etapów.

## Design i branding

- Kanoniczny design system: `kompas-ui-design/opendesign/design-systems/kompas-rrp` (kolory/typografia: `colors_and_type.css`, `SKILL.md`, `README.md`, `brand/`).
- Instrukcje brandingu AI: `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md`.
- Zasady: bez poziomic, koncentrycznych kół, gradientów, offsetowych cieni i dwukolorowych pasków jako ozdobników kart; karty 8 px, formularze 48 px, CTA pigułka; czyste tło i kontrast na ciemnych panelach; nie dodawaj adnotacji o źródłach danych w UI; mobile bez poziomego przewijania.
- Tryb Advanced UI (skill `/ui`): `skills/advanced-ui/SKILL.md`.
- Status przez Paperclip MCP (skill `/status`): `skills/status/SKILL.md`.

## Produkcja i wdrożenia

- Docelowy Worker: `wtyczka-rr`; domeny: `interfejs.kompaszbiorek.pl` (docelowa), `wtyczka.kompaszbiorek.pl` (działający fallback `/ui`), `panel.kompaszbiorek.pl` (dedykowany Worker `panel-kompaszbiorek` — ten sam kod, docelowo panelowe logowanie i wybór arkusza). Nie wdrażaj na `kompas-zbiorek`, nie twórz zastępczych Workerów.
- Kolejność (stała): `npm run build` (kompas-ui-plugin) → `node build-worker.mjs` (cloudflare-worker) → `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars`. Wrangler = lokalna devDependency; nigdy globalny.
- Po wdrożeniu podaj adres produkcyjny + ID wersji. Wdrożenia produkcyjne prowadzi wyłącznie CTO.
- Jeśli wdrożenie zablokowane — nie udawaj wdrożenia; podaj przyczynę i gotowy krok do wznowienia.

## Wykonanie kontraktowe (CONTEXT-FIRST EXECUTION)

Nie odkrywaj ponownie informacji dostarczonych przez Paperclip. **EXECUTION ORDER** na starcie runa:

1. `PAPERCLIP_WAKE_PAYLOAD_JSON` / heartbeat-context / task context
2. HANDOFF (jeśli przekazano — format w `skills/kompas-governance/SKILL.md`)
3. REPO MAP (`docs/AI-REPO-MAP.md`)
4. targeted file reads
5. code

Broad discovery dopiero, gdy powyższe źródła są niewystarczające. Zasada: **Known context > targeted verification > broad discovery.**

Przed startem agenta sprawdź **Definition of Ready** (upstream DONE + deliverable + finalized workspace + credentials + assignee bez error; FAIL → `BLOCKER/OWNER/ACTION`, bez recovery issue). Kontrakt w `skills/kompas-governance/SKILL.md` wraz z: HANDOFF, szablonami zadań (FEATURE/BUGFIX/DESIGN/QA), CREDENTIAL PREFLIGHT (`BLOCKED_EXTERNAL`) i przepływem CI (ENGINEER → PUSH → CI → UI QA → DONE).

Nie zaczynaj normalnego taska od: listowania wszystkich issue/projektów/goals/agentów, szerokiego skanu repo, `git worktree list`, `git remote -v`, pełnego `git log`, `find` po całym systemie plików — chyba że task tego faktycznie wymaga. Use the narrowest source that already contains the answer.

## STARTUP I/O BUDGET

- Paperclip: 1 odczyt heartbeat-context; komentarze tylko inkrementalne.
- Git write task: `git branch --show-current` + `git status --short`; opcjonalnie `git rev-parse --show-toplevel`. I STOP. Głębsza diagnostyka (`git worktree list`, `git remote -v`) tylko przy anomalii względem currentExecutionWorkspace.
- Bez wyszukiwania po całym boardzie; bez discovery repo, gdy lokalizacja jest znana; bez list-agentów, gdy delegacja nie jest potrzebna; bez list-goals, gdy heartbeat-context podaje Goal; bez powtarzania komend kredencjałowych po ustalonym blokerze.
- **Autorytatywność mutacji**: udana odpowiedź mutacji jest wiążąca. Nie wykonuj potwierdzającego GET zaraz po PATCH/POST, chyba że odpowiedź jest niejednoznaczna albo kolejna decyzja wymaga świeżego stanu.
- Eskaluj od wąskiego wyszukania do szerokiego dopiero, gdy wąskie źródło nie wystarcza.

## Konteksty i skille per rola

| Agent | Always-on (kontekst/skill) | On-demand (tylko gdy zadanie dotyczy) |
|---|---|---|
| CEO | kompas-governance, para-memory-files | ceo-audit, ceo-retro, reflection-coach, doc-maintenance |
| COO | issue-triage, kompas-governance, kompas-team-map | task-planning, para-memory-files |
| CTO | kompas-technical-context, github-pr-workflow | prepare-mcp-integration, task-planning |
| Engineer | kompas-technical-context, github-pr-workflow | prepare-mcp-integration, chatgpt-apps |
| Designer | kompas-design-context, agent-browser | design-critique (jawny UX audit) |
| UI QA | kompas-qa-context, qa-acceptance, agent-browser | design-critique (jawny UX audit) |
| CMO | kompas-brand-email | narzędzia kampanii (Sender.net) |

Skille `kompas-*` są lekkimi kontraktami (nie frameworkami). Klucze pełne: `kompas-governance`, `kompas-technical-context`, `kompas-design-context`, `kompas-qa-context`, `kompas-brand-email`, `kompas-team-map` (w bibliotece firmy jako `local/<hash>/<slug>`).

## Profile modeli (koszt wykonania)

Task, rutyna i agent muszą faktycznie uruchamiać run z właściwym profilem — samo zapisanie reguły nie wystarcza.

| Profil | Typy pracy |
|---|---|
| `cheap` | heartbeat, rutyna, streszczenie, triage, status, wyszukiwanie plików, dokumentacja, prosty research, przygotowanie taska |
| `primary` | tworzenie rozwiązania, zmiana kodu, decyzja, analiza błędu, review |
| eskalacja do Deepseek Pro | tylko gdy `cheap`/`primary` nie rozwiązały problemu albo duże ryzyko kosztownego błędu |

Tworząc issue/rutynę pracy cheap, ustaw `assigneeAdapterOverrides.modelProfile = "cheap"`. Nie uruchamiaj pracy cheap na `primary`. Eskalację uzasadnij w komentarzu do issue.

## Zasady uniwersalne

1. Nie podłączaj integracji spoza zintegrowanych Apps (Cloudflare, Sender.net, Clarity, MagicUI, Git, Playwright).
2. Edytuj wyłącznie pliki w `C:\Kompas Zbiórek` (lub katalogach agentów zarządzanych przez Paperclip).
3. Zachowuj język polski.
4. Po zmianach aktualizuj `documentation.md` (funkcja, użycie, źródła danych, ograniczenia, testy).
5. Nie redukuj wymaganych pól karty zbiórki do demonstracyjnych skrótów; przy braku API pokaż jawny, nieblokujący stan braku danych.
6. Rozbieżności z tym plikiem rozstrzygaj na jego korzyść i zgłoś do CEO (document `ceo-feedback`).
