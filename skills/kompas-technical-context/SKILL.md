---
name: kompas-technical-context
description: Stałe techniczne invarianty i mapa repo Kompas Zbiórek. Always-on dla CTO; używany też przez Engineer do minimalnego preflightu i lokalizacji plików bez broad discovery.
---

# Kompas Technical Context

## Technical invariants

Nie zmieniaj bez jawnego upoważnienia w zadaniu:

- MCP endpoint pozostaje `/mcp`.
- **Supabase/Postgres jest jedynym application source of truth.** Nie twórz nowej domenowej warstwy danych w Cloudflare D1 i nie traktuj D1 jako drugiego SSOT.
- Cloudflare Worker jest warstwą API, integracji i bezpiecznego dostępu do sekretów. Stan domenowy należy projektować względem Supabase/Postgres.
- Google OAuth nie może dostawać szerszych scope'ów bez jawnej potrzeby; istniejący flow używa `drive.file` tam, gdzie dotyczy plików Google.
- Docelowy Worker repo ma nazwę `wtyczka-rr`. Nie twórz zastępczego Workera tylko po to, aby ominąć problem z deployem.
- Bez scoped zlecenia deploya — brak wdrożenia produkcyjnego.
- Normalny repo-write wykonuj na branchu/isolated worktree. Direct write do `main` wymaga jawnej decyzji operatora.
- Controlled GitHub release path (KOMAA-260) jest CTO-only: Engineer i UI QA nie mają GitHub write (brak credential binding i brak GitHub App connection exposure dla tych ról; UI QA nie ma też capability `git`). CTO uzyskuje `git`/`gh` wyłącznie w serwerowo zweryfikowanym etapie release/integration (`dev/integrations/opencode-mcp/mcp-role-profiles.json` v5, egzekucja przez istniejącego `ctb-engineer`, bez nowego agenta) i wyłącznie z credentialem z secret binding (`GH_TOKEN`/`GITHUB_PERSONAL_ACCESS_TOKEN` via credential broker) — nigdy plaintext w repo, Wiki ani issue. Release i deploy/infra to osobne runy (kombinacja git+cloudflare jest celowo unenforceable). Release gate z `kompas-technical-domain-lead` obowiązuje: jawny candidate_sha == branch HEAD, QA/review PASS na exact SHA, acceptance PASS, brak unresolved blockers, DOC_IMPACT YES+canonical update albo NO+reason; po merge verify final SHA na main, evidence, delete feature branch, dopiero potem teardown.
- TARGET i CURRENT są rozdzielone: wymaganie z PRD nie jest dowodem wdrożenia; CURRENT potwierdzaj kodem, runtime albo testem.

## REPO MAP

Repo ma cztery warstwy. Nie odkrywaj ich ponownie broad scanem, jeśli zadanie wskazuje obszar.

### `app/` — runtime aplikacji

- UI: `app/web/`.
- Główny render: `app/web/src/static-app-v2.js`.
- Style: `app/web/src/styles.css`, `app/web/src/extended.css`.
- Build web: `app/web/scripts/build-static.mjs`.
- Targeted test logiki: `app/web/scripts/skill-completion-task-test.mjs`.
- Serwer ChatGPT/MCP: `app/server/index.ts`.
- Cloudflare/API/OAuth: `app/cloudflare-worker/`.
  - Worker/API: `app/cloudflare-worker/src/public-ui.ts`.
  - OAuth: `app/cloudflare-worker/src/oauth.ts`, `google-handler.ts`, `widget-auth.ts`, `workers-oauth-utils.ts`.
  - panel/integracje: `app/cloudflare-worker/src/panel-handler.ts`.
  - konfiguracja: `app/cloudflare-worker/wrangler.jsonc`.
  - build Workera: `app/cloudflare-worker/build-worker.mjs`.
- Dokumentacja runtime: `app/documentation.md`.
- Komendy aplikacji uruchamiaj z `app/`: `npm run build`, `npm run typecheck`, `npm run test:all`.
- Obecny `test:all` = build + typecheck + tracked targeted test. **Repo nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`; nie deklaruj ich jako istniejącego gate.** Niezależną walidację przeglądarkową wykonuje UI QA narzędziem task-scoped/on-demand.

### `dev/` — kod wspierający development

- Design system: `dev/design-system/`.
- Kanoniczne skrócone zasady marki: `dev/design-system/BRAND-DESIGN-SYSTEM-COMPRESSED.md`.
- Pełny brand system: `dev/design-system/BRAND-DESIGN-SYSTEM.md`.
- Design tokens: `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css`.
- Integracje developerskie: `dev/integrations/`.
- Profile OpenCode/MCP: `dev/integrations/opencode-mcp/mcp-role-profiles.json`.
- Dodatkowe testy/pipeline: `dev/quality/`.

### `content/` — treści

- Email onboarding: `content/onboarding-emails/html/`, `content/onboarding-emails/plain-text/`, `content/onboarding-emails/MAPA-AUTOMATYZACJI.md`.
- Marketing: `content/marketing/`.

### `archive/` — historia

- Materiały historyczne, stare snapshoty i audyty. Nie używaj ich jako CURRENT bez jawnego zadania porównawczego.

### Root repo

- `opencode.json` — konfiguracja agentów/MCP.
- `package.json`, `registry/`, `registry.json`, `scripts/` — tooling i registry UI.
- `skills/` — skille agentowe/developerskie.
- `.paperclip-wiki/` — lokalny mirror wiedzy Paperclip; przy konflikcie sprawdź live Wiki i runtime.

## Minimalny git preflight

Normalny przypadek: `git branch --show-current` + `git status --short`. Opcjonalnie `git rev-parse --show-toplevel`. Dopiero gdy branch/cwd nie zgadza się z currentExecutionWorkspace → `git worktree list`, `git remote -v`, `git rev-parse HEAD`.

## CTO routing contract

- Zmiana w `app/` → architektura/review CTO, implementacja domyślnie Engineer.
- Zmiana w `dev/integrations/` → MCP/integracje deleguj MCP Engineerowi, chyba że issue jawnie przypisuje CTO.
- Zmiana wizualna lub design system w `dev/design-system/` → Designer; CTO sprawdza tylko konsekwencje techniczne.
- Niezależna walidacja UI/browser → UI QA.
- `content/` → odpowiednia funkcja marketingowa/contentowa; CTO angażuj tylko przy kontraktach technicznych.
- `archive/` nie jest źródłem implementacji.

## Engineer test contract

- Uruchom najmniejszy istniejący zestaw testów pokrywający zmieniony zakres.
- Nie udawaj nieistniejącego test suite. Jeśli acceptance wymaga E2E, a repo nie zawiera suite, użyj task-scoped narzędzia przeglądarkowego albo zgłoś konkretny brak jako blocker zależnie od kryterium.
- Nie wykonuj pełnego niezależnego audytu akceptacyjnego — należy on do UI QA.
- Po zmianie UI: build + typecheck + właściwy istniejący targeted test/smoke; niezależny browser acceptance prowadzi UI QA.
