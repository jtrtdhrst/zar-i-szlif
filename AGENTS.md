# Instrukcje dla agentów

## Zasada nadrzędna

Ten plik zawiera tylko reguły wspólne dla repo. Szczegóły roli, domeny i workflow utrzymują skille. **Nie kopiuj REPO MAP, design rules ani test contract do wielu promptów.**

Najważniejsze skille kontekstowe:

- technika/repo/data: `skills/kompas-technical-context/SKILL.md`;
- design/UI: `skills/kompas-design-context/SKILL.md`;
- UI QA: `skills/kompas-qa-context/SKILL.md`;
- email/brand: `skills/kompas-brand-email/SKILL.md`;
- iteracyjne UI: `skills/advanced-ui/SKILL.md`;
- Paperclip control-plane: aktualny core skill `paperclip`.

Dla konfliktu źródeł, niejasnego workspace, zadania cross-cutting albo incydentu Paperclip przeczytaj root `CONTEXT.md`. **Nie ładuj go automatycznie do prostego, dobrze zlokalizowanego taska.**

## Repo layout

- `app/` — jedyny runtime aplikacji.
- `dev/` — design system, integracje developerskie i quality tooling.
- `content/` — marketing i onboarding emails.
- `archive/` — materiały historyczne; nie są CURRENT.
- `skills/`, `registry/`, `scripts/`, `opencode.json` — tooling i kontrakty agentowe na root.

Przed broad discovery użyj `kompas-technical-context`, który utrzymuje kanoniczne lokalizacje plików.

## CONTEXT-FIRST

Startuj od bieżącego issue, wake payload/heartbeat context i `currentExecutionWorkspace`. Nie listuj całego boarda, goals, agentów ani repo na starcie bez konkretnej anomalii.

Przy sprzeczności źródeł obowiązuje: **bieżący issue/workspace → aktualny kod/runtime/test → `AGENTS.md` + właściwy skill → live Paperclip Wiki → lokalny mirror/history**. `TARGET` nie jest dowodem `CURRENT`.

Minimalny git preflight:

- `git branch --show-current`;
- `git status --short`;
- opcjonalnie `git rev-parse --show-toplevel`.

Dopiero przy niezgodności workspace/brancha rozszerz diagnostykę. Jeśli `currentExecutionWorkspace` nie wskazuje faktycznego checkoutu oczekiwanego repo, nie zaczynaj write — zwróć/routuj `WORKSPACE_FAIL / OWNER / EXACT ACTION`.

Po udanej mutacji nie wykonuj potwierdzającego GET bez potrzeby następnej decyzji.

## Repo vs execution harness

`process_lost`, `workspace_validation_failed`, kolizje `heartbeat_run_events` i błędy Paperclip run-scoped persistence/auth **nie są automatycznie bugami produktu**. Zachowaj worktree/diff i najpierw sklasyfikuj, czy problem leży w repo, providerze czy Paperclip/OpenCode harnessie.

Paperclip Ops może działać na primary workspace `/app`, który nie jest checkoutem `kompas-zbiorek`. Nie próbuj tworzyć git worktree produktu z nie-gitowego `/app`; dla repo-write użyj workspace wskazanego przez issue albo właściwego git workspace. External `instructionsRootPath` również nie jest execution workspace.

Trwałe guardraile i przykłady incydentów są w `CONTEXT.md`; szczegóły runów pozostają w Paperclip issues.

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

Nie wykonuj opportunistic refactoru i nie twórz meta/recovery tasków bez niezależnej wartości. Preferuj aktualizację istniejącego issue/runu zamiast tworzenia pracy dlatego, że Paperclip zaobserwował Paperclip.

## UI

Przy UI:

- runtime = `app/web/`;
- design system = `dev/design-system/`;
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

- Operacyjny router kontekstu i trwałe lekcje z incydentów: `CONTEXT.md`.
- Runtime/API/publiczne zachowanie: `app/documentation.md`.
- Repo overview: `README.md`.
- Trwała wiedza produktowa/architektoniczna: Paperclip Wiki.

Aktualizuj dokumentację tylko wtedy, gdy zmiana rzeczywiście modyfikuje jej kontrakt. Nie edytuj wielu dokumentów przy czystym CSS, refactorze lub zmianie bez wpływu na publiczne zachowanie.

## Deploy Cloudflare

Deploy nie jest automatycznym skutkiem każdej zmiany kodu. Wykonuj go tylko dla scoped/autoryzowanego release/deploy taska.

Dla aplikacji:

1. `npm run build` w `app/`;
2. `node build-worker.mjs` w `app/cloudflare-worker/`;
3. `npx wrangler deploy --dry-run`;
4. `npx wrangler deploy --keep-vars` dopiero przy autoryzowanym wdrożeniu.

Docelowy Worker repo: `wtyczka-rr`. Nie twórz zastępczego Workera jako obejścia problemu.

## Git / review

Normalny repo-write powinien być wykonany na branchu/isolated worktree. Implementer dostarcza exact candidate SHA; niezależny review dotyczy tego SHA. Późniejszy commit wymaga ponownej weryfikacji.

Merge/release prowadzi CTO/reviewer zgodnie z aktualną polityką repo, chyba że operator jawnie zdecyduje inaczej.

## Windows / encoding

Host agents = Windows/PowerShell, jeśli runtime nie mówi inaczej. Używaj PowerShell-native i jawnego UTF-8. Nie enumeruj całego `Env:` i nie wypisuj sekretów.

## Stop conditions

Ta sama mutacja failuje dwa razy → STOP retry i raport:

`BLOCKER / OWNER / EXACT ACTION`.

Nie obchodź security, credential boundary ani workspace policy ręcznymi workaroundami.
