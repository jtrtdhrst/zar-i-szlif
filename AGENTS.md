# Instrukcje dla agentów

## OBOWIĄZUJĄCA DECYZJA WŁAŚCICIELA — 2026-10-22: JEDNO REPO, MAIN PO ZATWIERDZENIU

**Ta decyzja zastępuje wcześniejsze instrukcje o osobnym prywatnym repo Harnessa oraz zakazie `mcp/**` w repo produktu.** Cały kod Żar i Szlif oraz wszystkie własne integracje MCP mieszkają w JEDNYM repozytorium `miloszspyrka-code/zar-i-szlif`. Jedyna gałąź integracyjna i produkcyjna to `main`; agent tworzy izolowaną gałąź roboczą i PR do `main`, nigdy nie pushuje ani nie scala bezpośrednio do `main`. Merge następuje DOPIERO po realnym niezależnym review CTO zatwierdzającym dokładny SHA, przejściu wymaganego CI oraz pozytywnej decyzji wykonawczej w Paperclip. Nie zmieniać konfiguracji żadnych modeli.

Kanoniczne katalogi: `app/web/` = aplikacja produktu, `app/website/` = strona produktu, `app/mcp-worker/` = MCP produktu, `mcp/mantic/`, `mcp/qdrant/`, `mcp/penpot/`, `mcp/plasmic/`, `mcp/supabase/`, `mcp/ubuntu/` = własne MCP, oraz `mcp/paperclip/` = dodatkowa integracja. **OpenDesign MCP i OpenCode MCP wycofane; nie przywracać ich buildów, katalogów ani konfiguracji. Sam OpenCode agentów i jego modele pozostają bez zmian.** Katalogi `_branches/` przechowują **wersje źródłowe do ręcznego/modelowego scalenia**, nigdy nie są aktywnymi rootami wdrożenia. `supabase/` na root to baza produktu, nie konektor MCP.

Coolify: jedno repo, ale ODDZIELNA aplikacja/usługa na komponent z własnym `Base Directory`, kontekstem buildu, Dockerfile, healthcheckiem, triggerem ścieżek i rollbackiem. Patrz `ops/coolify/targets.json` i `docs/architecture/monorepo-branches-and-deploy.md`. Gotowy Dockerfile aplikacji to `ops/coolify/Dockerfile` (kontekst repo root, `app/web/dist`), strony `app/website/Dockerfile` (kontekst repo root). MCP produktu `app/mcp-worker/` jest w tej chwili Cloudflare Worker zależnym od KV/Workers AI, NIE działającym bezpośrednio jako kontener Coolify; wdrożenie Coolify wymaga osobnego sprawdzonego adaptera. Mantic obecnie stdio-only; nie udawać gotowego HTTP. Nie wdrażać z gałęzi PR ani z katalogów `_branches`.

Paperclip: właściciel modułu → realne testy i SHA → niezależny CTO → zatwierdzony merge main → tylko docelowy deploy → runtime SHA/digest i MCP tools/list. Każdy task ma watchdog; nie dodawać fałszywych blokad; nie modyfikować Paperclip/OpenCode Core. Wcześniejsze sprzeczne zapisy poniżej są historyczne, a niniejsza decyzja ma pierwszeństwo.

## Zasada nadrzędna

Ten plik zawiera tylko reguły wspólne dla repo. Szczegóły roli, domeny i workflow utrzymują skille. **Nie kopiuj REPO MAP, design rules ani test contract do wielu promptów.**

Najważniejsze skille kontekstowe:

- technika/repo/data: `skills/kompas-technical-context/SKILL.md`;
- design/UI: `skills/kompas-design-context/SKILL.md`;
- UI QA: `skills/kompas-qa-context/SKILL.md`;
- email/brand: `skills/kompas-brand-email/SKILL.md`;
- iteracyjne UI: `skills/advanced-ui/SKILL.md`;
- Paperclip control-plane: aktualny core skill `paperclip`.

## Repo layout — canonical Żar i Szlif source ownership

- `app/web/**` — product application (Engineer).
- `app/website/**` — public website (Engineer/website owner).
- `app/mcp-worker/**` — product MCP, OAuth, tools, retrieval and RAG (MCP Engineer). No first-party runtime imports escaping this root.
- `app/cloudflare-worker/**` and `app/plugin/**` — other product API/shared code, not host MCP.
- `mcp/mantic/**`, `mcp/qdrant/**`, `mcp/penpot/**`, `mcp/plasmic/**`, `mcp/supabase/**`, `mcp/ubuntu/**`, `mcp/paperclip/**` — host services (Harness Agent, independent CTO review).
- `supabase/**` — product DB migrations, not host Supabase MCP.
- `ops/coolify/**`, `docs/architecture/**` — deployment targets, release policy and branch inventory.
- `branding/**`, `dev/**`, `content/**`, `registry/**`, `scripts/**`, `skills/**` — supporting sources only when authorized by the actual task.

**Deprecated MCP servers:** no `mcp/opendesign/**` or `mcp/opencode/**`. Do not remove OpenCode itself or change any configured agent models. The historical `_branches/**` directories are never runtime/build targets.

Read `wiki/concepts/mcp-github-branch-migration-20261022.md` in Paperclip and `docs/architecture/monorepo-branches-and-deploy.md` on the candidate branch before structural changes.

## CONTEXT-FIRST

Startuj od bieżącego issue, wake payload/heartbeat context i `currentExecutionWorkspace`. Nie listuj całego boarda, goals, agentów ani repo na starcie bez konkretnej anomalii.

Minimalny git preflight:

- `git branch --show-current`;
- `git status --short`;
- `git rev-parse --show-toplevel`.

### Fresh-workspace gate — obowiązkowy przed repo-facing work

Przed pierwszą zmianą kodu, buildem, commitem, pushem albo wystawieniem kandydata:

1. `git fetch origin main`;
2. `git rev-list --count HEAD..origin/main` musi zwrócić `0`;
3. `git merge-base --is-ancestor origin/main HEAD` musi zakończyć się sukcesem;
4. repo root musi odpowiadać `currentExecutionWorkspace`;
5. kanoniczny layout produktu to `app/` (w tym `app/cloudflare-worker/`). Nie implementuj nowej pracy produktowej w historycznym `kompas-ui-plugin/`.

Jeśli którykolwiek warunek nie przechodzi: **nie produkuj kandydata, nie pushuj i nie uruchamiaj deployu**. Oznacz workspace jako stale/mismatched i przejdź na świeży isolated workspace z `baseRef=main`. `reuse_existing` nie jest uzasadnieniem do pracy na branchu będącym behind względem `origin/main`.

Po zmianie `main` przed finalnym handoff/review powtórz gate. Candidate SHA jest ważny tylko wtedy, gdy jego `origin/main` jest przodkiem i `HEAD..origin/main = 0`.

Dopiero przy niezgodności workspace/brancha rozszerz diagnostykę.

Po mutacji wykonaj celowy readback wymagany przez Definition of Done (zwłaszcza Git SHA, native Paperclip policy, artefakt release i runtime); unikaj wyłącznie zbędnych duplikatów odczytu.

## MCP / narzędzia

Używaj minimalnego surface potrzebnego do taska. Narzędzia specjalistyczne są task-scoped/on-demand zgodnie z rolą; nie włączaj kilku integracji „na zapas”.

- Git — repo/PR/review.
- Cloudflare — tylko infra/deploy scope.
- Playwright/browser — browser acceptance/UI QA.
- Shadcn/Storybook — design/UI discovery.
- Paperclip — control-plane issue/workspace/handoff.

Nie loguj sekretów, tokenów ani nagłówków Authorization.

## Data architecture

- **Supabase/Postgres jest jedynym application source of truth.**
- Cloudflare Worker jest warstwą API/integracji/sekretów, nie drugim SSOT domenowym.
- Nie twórz nowej domenowej warstwy Cloudflare D1.
- TARGET z PRD nie jest dowodem CURRENT; stan wdrożenia potwierdzaj kodem/runtime/testem.
- Nie wymyślaj danych integracji. `Brak danych` jest legalnym stanem.

## Realizacja

Gdy task jest wykonawczy, realizuj go end-to-end w jego scope:

1. targeted context;
2. najmniejsza kompletna zmiana;
3. istniejący targeted verification;
4. diff;
5. commit/push, jeśli task jest repo-write;
6. evidence + handoff.

Nie wykonuj opportunistic refactoru i nie twórz meta/recovery tasków bez niezależnej wartości.

## UI

Przy UI:

- runtime = `app/web/`;
- branding source = `branding/` (obecnie brak artefaktów; nie wymyślaj reguł marki);
- design system / implementacja tokenów = `dev/design-system/`;
- przed nowym reusable UI sprawdź `@kompas` registry;
- zachowaj responsywność, hierarchię informacji i minimum touch target 44×44 px;
- nie promuj app-specific business logic do design systemu/registry;
- niezależny browser acceptance należy do UI QA.

Szczegółowe reguły designu i QA są w odpowiednich skillach — nie duplikuj ich tutaj.

## Aktualny test contract

W `app/` istnieją:

- `npm run build`;
- `npm run typecheck`;
- `npm run test:skill-completion-task`;
- `npm run test:all` = build + typecheck + tracked targeted test.

**Repo nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`.** Nie raportuj Playwright/Lighthouse PASS bez realnego uruchomienia odpowiedniego narzędzia. Jeśli acceptance wymaga browser/E2E, użyj task-scoped browser tooling lub zgłoś konkretny coverage gap.

## Dokumentacja

- Runtime/API/publiczne zachowanie: `app/documentation.md`.
- Repo overview: `README.md`.
- Trwała wiedza produktowa/architektoniczna: Paperclip Wiki.

Aktualizuj dokumentację tylko wtedy, gdy zmiana rzeczywiście modyfikuje jej kontrakt. Nie edytuj wielu dokumentów przy czystym CSS, refactorze lub zmianie bez wpływu na publiczne zachowanie.

## Deployment targets — per-service, status-aware

**Not all source roots are deployable.** `main` is the only integration/release ref. The monorepo source split is still **draft PR #74**, not a production deployment.

| Target | Build / runtime | State |
| --- | --- | --- |
| Product app `app/web/` | Coolify; root Docker build `ops/coolify/Dockerfile`, port 80 | Existing target; verify live SHA |
| Public website `app/website/` | Candidate `app/website/Dockerfile` | PR #74 candidate; not production-verified |
| Product MCP `app/mcp-worker/` | Cloudflare Worker / KV / Workers AI | **Not** a ready Coolify/Node container |
| Mantic `mcp/mantic/` | Current entrypoint stdio | No verified HTTP wrapper |
| Plasmic `mcp/plasmic/` | Independent Docker image, port 8091 | Requires live WAB E2E |
| Qdrant, Penpot, Supabase, Ubuntu, Paperclip host MCP | Incomplete source/runtime evidence | Not deployable without proven build and live verification |

For exact per-service directories, Dockerfiles, build triggers and readiness flags use `ops/coolify/targets.json`. No single universal Cloudflare deployment rule exists for every MCP.

**Git workflow:** one canonical issue-owned branch, preserve active worktrees and unmatched commits, scoped changes and tests, candidate SHA, independent native CTO review, approved PR merge to `main`, then release only the affected service. No direct main push; no `--no-verify`; no automatic broad rebuild. The pre-push target classifier is defense-in-depth, not proof of production readiness. A branch deletion is maintenance, not a product release, but must still preserve active work and pass authorization.

**Post-deploy:** verify immutable source SHA, artifact digest, build path, service health, authorized MCP `initialize`/`tools/list` when relevant, negative auth tests and a tested rollback. Only mark the Paperclip issue done after readback and accepted evidence. Watchdog on every real task; no fabricated dependency or reviewer decision.

**Safety:** GitHub/About metadata and Coolify UI configuration are separate from repo files. Never report a README commit as an updated GitHub repository description, or a candidate Dockerfile as a deployed service.

## Windows / encoding

Host agents = Windows/PowerShell, jeśli runtime nie mówi inaczej. Używaj PowerShell-native i jawnego UTF-8. Nie enumeruj całego `Env:` i nie wypisuj sekretów.

## Stop conditions

Ta sama mutacja failuje dwa razy → STOP retry i raport:

`BLOCKER / OWNER / EXACT ACTION`.

Nie obchodź security, credential boundary ani workspace policy ręcznymi workaroundami.
