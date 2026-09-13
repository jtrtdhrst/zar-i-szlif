# Kontekst operacyjny repo

> Stan odniesienia: 2026-09-13. Ten plik jest routerem kontekstu dla pracy w repo, nie kolejnym PRD ani kopią Paperclip Wiki.

## Hierarchia źródeł

Gdy źródła są sprzeczne, używaj tej kolejności:

1. **Bieżący issue / wake payload / `currentExecutionWorkspace`** — definiuje scope konkretnego wykonania.
2. **Aktualny kod, runtime i testy** — rozstrzygają `CURRENT / AS-IS`.
3. **Root `AGENTS.md` + właściwy skill**, przede wszystkim `skills/kompas-technical-context/SKILL.md` dla aktualnej mapy repo i invariantów technicznych.
4. **Live Paperclip Wiki** — trwałe decyzje produktowe, architektoniczne i organizacyjne.
5. **`.paperclip-wiki/`** — lokalny mirror Wiki i bundle instrukcji; może być starszy niż bieżący refactor repo.
6. **`raw/`, `archive/`, stare branche i historyczne issue** — źródła historyczne, nigdy automatycznie `CURRENT`.

`TARGET` z PRD/Wiki nie jest dowodem wdrożenia. Jeśli nie ma bieżącego dowodu, stan należy opisać jako niepotwierdzony zamiast przenosić go z TARGET do CURRENT.

### Znany drift Wiki

Część starszych stron mirrora nadal może wskazywać m.in. `kompas-ui-plugin/...`, domenowy Cloudflare D1, historyczne E2E/Playwright/Lighthouse albo stare ścieżki Windows. Nie odtwarzaj tych założeń w kodzie tylko dlatego, że są w starszej stronie Wiki. Dla lokalizacji plików i aktualnych invariantów repo źródłem operacyjnym jest `kompas-technical-context`; przy ważnej decyzji produktowej sprawdź live Wiki.

## Aktualna rzeczywistość repo

- `app/` — jedyny runtime aplikacji: web, serwer ChatGPT/MCP i Cloudflare Worker.
- `dev/` — design system, integracje developerskie i quality tooling.
- `content/` — marketing i onboarding emails.
- `archive/` — materiały historyczne; nie są CURRENT.
- `skills/`, `registry/`, `scripts/`, `opencode.json` — warstwa tooling/agent contracts na root.
- `.paperclip-wiki/` — mirror wiedzy i external agent bundles, nie execution workspace.

**Supabase/Postgres jest jedynym application source of truth.** Cloudflare Worker jest warstwą API/integracji/sekretów; nie twórz nowej domenowej warstwy D1 jako drugiego SSOT.

Aktualny kontrakt testów w `app/` obejmuje build, typecheck i tracked targeted testy. Repo nie ma obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`; browser acceptance wymaga rzeczywistego task-scoped narzędzia/QA.

## Granica repo ↔ Paperclip execution harness

Kilka strumieni Paperclip pracuje na `miloszspyrka-code/kompas-zbiorek` (Core Product, Integrations & Data, Growth & Lifecycle, Release & Reliability) i normalnie używa izolowanego workspace/sandboxu na bazie `main`.

**Paperclip Ops jest innym środowiskiem.** Jego primary workspace to lokalny `/app` / project-primary i służy control-plane/runtime Paperclip. Nie traktuj `/app` jako checkoutu tego repo i nie próbuj tworzyć z niego git worktree produktu. Scoped konfiguracja agentów może używać osobnego git workspace wskazującego na `kompas-zbiorek`, ale musi być jawnie wybrany przez issue/workspace.

`instructionsRootPath` / external agent bundle również **nie jest execution workspace**. Instrukcje mówią agentowi jak pracować; `currentExecutionWorkspace` mówi gdzie wolno pisać.

Przed pierwszym repo-write wykonaj minimalny preflight: `git branch --show-current`, `git status --short`, opcjonalnie `git rev-parse --show-toplevel`. Jeśli cwd/repo/branch nie zgadza się z `currentExecutionWorkspace`, **nie edytuj** — najpierw napraw/routuj workspace.

## Guardraile z minionych incydentów

| Sygnał | Co oznacza | Właściwa reakcja |
|---|---|---|
| `process_lost`, „server may have restarted”, wiele agentów pada jednocześnie | problem harness/runtime, nie automatycznie bug produktu | zachowaj worktree/diff, nie resetuj artefaktów; bounded recovery i routing do Paperclip Ops/Harness |
| `workspace_validation_failed`, `missing_git_metadata`, `git_worktree_base_not_git_checkout` | zły link projektu/workspace albo próba użycia nie-gitowego base | nie obchodź walidacji; popraw project/workspace; nie buduj git worktree z `/app` |
| kolizja `heartbeat_run_events` / ten sam `seq` dla eventów jednego runu | persistence/order w Paperclip harness | nie zmieniaj aplikacji ani modelu, żeby „przeszedł test”; napraw harness i potwierdź regresję |
| legalny write z `X-Paperclip-Run-Id` zwraca 500 | control-plane/auth/audit path Paperclip | zachowaj auth i run-id; bez spoofingu/bypassu; fix po stronie Paperclip |
| provider odrzuca tool name `>64` | provider-facing mapowanie tool schemas | aliasowanie/routing należy do runtime adaptera, nie do semantyki produktu |
| `stale_active_run_evaluation` / `issue_productivity_review` mnoży meta-taski | orchestration churn | najpierw aktualizuj istniejący issue/run; nowy issue tylko dla niezależnie wartościowego deliverable |

Historyczne źródła tych guardraili: m.in. KOMAA-34/35, KOMAA-85/86, KOMAA-212, KOMAA-254, KOMAA-262/263 oraz bieżący fix KOMAA-265. Run IDs i chwilowe symptomy pozostają w Paperclip; do repo przenosimy tylko trwałą lekcję.

## Delivery contract

Dla repo-write: targeted context → najmniejsza kompletna zmiana → istniejący targeted verification → diff → commit/push → dokładny `candidate_sha` → niezależny review dokładnie tego SHA → handoff. Późniejszy commit wymaga ponownej weryfikacji.

Deploy nie jest skutkiem zwykłego merge. Wykonuj go wyłącznie w scoped release/deploy tasku.

Ta sama mutacja failuje dwa razy: zatrzymaj retry i zapisz `BLOCKER / OWNER / EXACT ACTION`. Nie twórz łańcucha recovery/review tylko dlatego, że Paperclip wykrył problem Paperclipa. Product output > orchestration.

## Utrzymanie tego pliku

Aktualizuj `CONTEXT.md` tylko, gdy zmienia się trwały kontrakt pracy albo pojawia się powtarzalny incident pattern, który powinien zmienić zachowanie kolejnych agentów. Szczegóły domenowe trzymaj w Wiki, szczegóły techniczne w odpowiednich skillach, a chwilowe runy i stack trace'y w Paperclip issues.
