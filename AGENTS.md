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

## Repo layout

- `app/` — jedyny runtime aplikacji; `app/plugin/` to Wtyczka / MCP Kompasu Zbiórek.
- `branding/` — jedyne kanoniczne miejsce na źródła brandingu produktu; obecnie celowo puste.
- `dev/` — techniczny design system, integracje developerskie i quality tooling.
- `content/` — marketing i onboarding emails.
- `archive/` — materiały historyczne; nie są CURRENT.
- `skills/`, `registry/`, `scripts/`, `opencode.json` — tooling i kontrakty agentowe na root.

Przed broad discovery użyj `kompas-technical-context`, który utrzymuje kanoniczne lokalizacje plików.

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

Po udanej mutacji nie wykonuj potwierdzającego GET bez potrzeby następnej decyzji.

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

## Deployment targets

Frontend/statyczny panel jest targetem **Vercel** i korzysta z integracji Vercel ↔ GitHub oraz `vercel.json`. Zwykły frontend release nie wymaga sekretów Cloudflare w GitHub Actions.

Cloudflare dotyczy wyłącznie `app/cloudflare-worker/` (API/integracje/OAuth). Jego release jest osobnym workflow `.github/workflows/cloudflare-worker-release.yml` i uruchamia się automatycznie tylko po zmianach w `app/cloudflare-worker/**` albo ręcznie przez workflow dispatch.

Dla zmian Workera:

1. `npm run validate:worker`;
2. fail-closed asercja provenance (`GITHUB_SHA`, `refs/heads/main`);
3. Cloudflare `production-preflight`;
4. `wrangler deploy --keep-vars` dopiero po poprawnej autoryzacji produkcyjnej.

Nie dokładaj Cloudflare credential gate do ogólnego CI ani do frontendowego Vercel release.

### Target-aware release gate

`npm run validate:release` to dispatcher `scripts/release-targets.mjs`, **nie** alias `validate:vercel`. Klasyfikuje zmienione ścieżki względem `origin/main` i uruchamia gate'y tylko dla touched targetów: worker-only → `validate:worker` (bez `VERCEL_*`), vercel-only → `validate:vercel` (bez `CLOUDFLARE_*`), mixed → oba, docs-only → `validate:code`. Niezklasyfikowana ścieżka **fail-closed** (`exit 2`), nigdy ciche pominięcie walidacji.

`--no-verify` nie jest normalną ścieżką żadnego targetu. Push do `main` pozostaje zablokowany.

### Provenance produkcji

Produkcja Vercel i Cloudflare wdraża **jeden dokładny zweryfikowany SHA na `origin/main`**. `scripts/assert-release-provenance.mjs` jest wspólną fail-closed asercją dla ścieżki lokalnej i CI: ref musi być `refs/heads/main`, wyrenderowany HEAD musi równać się kandydatowi SHA, a SHA musi być osiągalny z `origin/main` (przy `push` być tipem). Mutacja produkcji z lokalnego, zmiennego checkoutu jest niemożliwa.

`Cloudflare Worker Release` jest zserializowany (`concurrency: cloudflare-worker-production`, `cancel-in-progress: false`); build jest robiony raz w `verify-worker`, a `deploy-production` konsumuje ten sam artefakt z tego samego SHA.

## Git / review

Normalny repo-write powinien być wykonany na branchu/isolated worktree. Implementer dostarcza exact candidate SHA; niezależny review dotyczy tego SHA. Późniejszy commit wymaga ponownej weryfikacji.

Release: branch → PR → CI → merge do `main` → target-specific deploy. Push do `main` jest zablokowany lokalnie i niezalecany.

### Target-specific release gates

Przed merge do `main` standardowy workflow `CI` musi być PASS. Lokalny hook pre-push jest defense-in-depth i nie zastępuje CI.

Dla frontendu dodatkowym sygnałem release jest status deploymentu Vercel przypięty przez integrację GitHub. Cloudflare readiness **nie jest** warunkiem frontendowego merge/release, chyba że kandydat zmienia `app/cloudflare-worker/**`.

Dla zmian Workera workflow `Cloudflare Worker Release` jest osobnym gate'em wdrożeniowym. Brak `CLOUDFLARE_API_TOKEN` lub `CLOUDFLARE_ACCOUNT_ID` blokuje tylko release Workera, nie frontend Vercel.

Jeżeli do tego samego SHA raportuje kilka projektów Vercel, nie zgaduj który jest produkcyjny. Potwierdź projekt związany z właściwą domeną/środowiskiem i zgłoś duplikaty jako config drift.

Merge/release prowadzi CTO/reviewer zgodnie z aktualną polityką repo, chyba że operator jawnie zdecyduje inaczej.

## Windows / encoding

Host agents = Windows/PowerShell, jeśli runtime nie mówi inaczej. Używaj PowerShell-native i jawnego UTF-8. Nie enumeruj całego `Env:` i nie wypisuj sekretów.

## Stop conditions

Ta sama mutacja failuje dwa razy → STOP retry i raport:

`BLOCKER / OWNER / EXACT ACTION`.

Nie obchodź security, credential boundary ani workspace policy ręcznymi workaroundami.

## Agent Git Delivery (canonical policy, 2026-10-15)

For REPO_WRITE, Git review/integration and worktree cleanup, load the company `agent-git-delivery` skill and canonical Paperclip Wiki `wiki/concepts/agent-git-delivery-policy.md`. ONE independently accepted canonical issue outcome has ONE reusable branch/worktree and normally ONE PR, not one per run/retry/reviewer. First push only after candidate and target verification; additional pushes only after real changed candidate. New remote branches must be exactly `KOMAA-N` or incident-only `hotfix/KOMAA-N`; existing legacy PRs pre-adoption must be migrated with evidence, never bulk-deleted. All new branch naming, duplicate issue branch detection, canonical commit subjects and PR candidate gates are enforced by `scripts/assert-branch-policy.mjs`, pre-push and CI. Server-side GitHub branch protection remains a separate required control. Never delete dirty/unmerged worktrees.
