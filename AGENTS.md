# Instrukcje dla agentów

## Physical repository isolation — PRODUCT vs HOST HARNESS (mandatory)

This Git repository is **the PRODUCT repository only**: `miloszspyrka-code/zar-i-szlif`.
A separate **owner-controlled private Harness repository** must hold the owner's internal
Paperclip MCP gateway, supervisor, OpenCode adapters, host MCP bridges, VPS/container
deployment sources and host-only infrastructure. A `product/mcp` branch or an
`app/mcp-worker` folder is NOT a substitute for a separate repository.

**Keep the distinction explicit:**
- `app/mcp-worker/**` is the user-facing Żar i Szlif PRODUCT MCP and remains here.
- `app/web/**`, product APIs, `app/cloudflare-worker/**`, product Supabase, branding
  and product frontend deployment under `ops/coolify/**` remain here.
- `dev/integrations/**` and `ops/design-stack/**` contain legacy mixed/internal
  integration material: do not add or modify host-related code in these directories;
  inventory/backup and move it safely to the separate Harness repository.
- Do not commit ANY owner-host gateway, supervisor, host MCP bridge, Paperclip/OpenCode
  control-plane implementation or local VPS configuration in this repository.

**Preflight before any task write:** determine whether it changes PRODUCT or HOST.
For HOST work, verify canonical Harness repository URL, git root/realpath, branch,
source SHA and live VPS source/service mapping. If cwd or git remote resolves to
`miloszspyrka-code/zar-i-szlif` or `paperclipai/paperclip`, **STOP** — no
commit, push or pretend deployment. Escalate repository provisioning/workspace
reassignment to CTO/Harness through the existing task rather than writing to the wrong repo.
Never equate a PR/worktree commit with a deployed VPS service. Never change an agent's
model as part of repository routing.

Product CI runs `scripts/assert-product-repo-boundary.mjs`. Deletion-only migration
of legacy host code is allowed, but new/modified host infrastructure in reserved paths
is blocked; additionally, all agents must respect this broader semantic rule.


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

Frontend/statyczny panel jest hostowany self-hosted przez **Coolify**
(`ops/coolify/Dockerfile` — Node 24 + nginx; build `npm --prefix app run build`,
publish `app/web/dist`; deploy z `main` przez webhook GitHub App). Platforma SaaS
nie jest używana. Zwykły frontend release nie wymaga żadnych sekretów
Cloudflare w GitHub Actions.

API/OAuth/MCP zostają na Cloudflare Worker. Zmiany `ops/coolify/**` są
klasyfikowane w `scripts/release-targets.mjs` jako frontend, więc przechodzą gate
frontendu.

Cloudflare dotyczy wyłącznie `app/cloudflare-worker/` (API/integracje/OAuth). Jego release jest osobnym workflow `.github/workflows/cloudflare-worker-release.yml` i uruchamia się automatycznie tylko po zmianach w `app/cloudflare-worker/**` albo ręcznie przez workflow dispatch.

Dla zmian Workera:

1. `npm run validate:worker`;
2. fail-closed asercja provenance (`GITHUB_SHA`, `refs/heads/main`);
3. Cloudflare `production-preflight`;
4. `wrangler deploy --keep-vars` dopiero po poprawnej autoryzacji produkcyjnej.

Nie dokładaj Cloudflare credential gate do ogólnego CI ani do frontendowego release.

### Target-aware release gate

`npm run validate:release` to dispatcher `scripts/release-targets.mjs`, **nie** alias `validate:frontend`. Klasyfikuje zmienione ścieżki względem `origin/main` i uruchamia gate'y tylko dla touched targetów: worker-only → `validate:worker` (bez gate'u frontendu), frontend-only → `validate:frontend` (bez `CLOUDFLARE_*`), mixed → oba, docs-only → `validate:code`. Niezklasyfikowana ścieżka **fail-closed** (`exit 2`), nigdy ciche pominięcie walidacji.

`--no-verify` nie jest normalną ścieżką żadnego targetu. Push do `main` pozostaje zablokowany.

### Provenance produkcji

Produkcja (frontend i Cloudflare) wdraża **jeden dokładnie zweryfikowany SHA na `origin/main`**. `scripts/assert-release-provenance.mjs` jest wspólną fail-closed asercją dla ścieżki lokalnej i CI: ref musi być `refs/heads/main`, wyrenderowany HEAD musi równać się kandydatowi SHA, a SHA musi być osiągalny z `origin/main` (przy `push` być tipem). Mutacja produkcji z lokalnego, zmiennego checkoutu jest niemożliwa.

`Cloudflare Worker Release` jest zserializowany (`concurrency: cloudflare-worker-production`, `cancel-in-progress: false`); build jest robiony raz w `verify-worker`, a `deploy-production` konsumuje ten sam artefakt z tego samego SHA.

## Git / review

Normalny repo-write powinien być wykonany na branchu/isolated worktree. Implementer dostarcza exact candidate SHA; niezależny review dotyczy tego SHA. Późniejszy commit wymaga ponownej weryfikacji.

Release: branch → PR → CI → merge do `main` → target-specific deploy. Push do `main` jest zablokowany lokalnie i niezalecany.

### Target-specific release gates

Przed merge do `main` standardowy workflow `CI` musi być PASS. Lokalny hook pre-push jest defense-in-depth i nie zastępuje CI.

Dla frontendu dodatkowym sygnałem release jest deployment Coolify (status aplikacji + obraz oznaczony SHA). Cloudflare readiness **nie jest** warunkiem frontendowego merge/release, chyba że kandydat zmienia `app/cloudflare-worker/**`.

Dla zmian Workera workflow `Cloudflare Worker Release` jest osobnym gate'em wdrożeniowym. Brak `CLOUDFLARE_API_TOKEN` lub `CLOUDFLARE_ACCOUNT_ID` blokuje tylko release Workera, nie release frontendu.

Merge/release prowadzi CTO/reviewer zgodnie z aktualną polityką repo, chyba że operator jawnie zdecyduje inaczej.

## Windows / encoding

Host agents = Windows/PowerShell, jeśli runtime nie mówi inaczej. Używaj PowerShell-native i jawnego UTF-8. Nie enumeruj całego `Env:` i nie wypisuj sekretów.

## Stop conditions

Ta sama mutacja failuje dwa razy → STOP retry i raport:

`BLOCKER / OWNER / EXACT ACTION`.

Nie obchodź security, credential boundary ani workspace policy ręcznymi workaroundami.
