# Kompas Zbiórek

> **CURRENT OWNER ARCHITECTURE — 2026-10-22:** All code lives in this **one GitHub monorepo**. `main` is the only approved integration/release branch: feature branches become PRs and reach `main` only after passing CI and independent CTO/Paperclip approval. The earlier plan for a separate private Harness repository is cancelled. See [full branch policy and Coolify map](docs/architecture/monorepo-branches-and-deploy.md), [all remote branch SHA inventory](docs/architecture/branch-inventory-20261022.json) and [machine-readable Coolify targets](ops/coolify/targets.json). Candidate segmentation in [PR #74](https://github.com/miloszspyrka-code/zar-i-szlif/pull/74) is not production until approved.

## Aktualne katalogi monorepo (2026-10-22)

```text
app/web/          # aplikacja produktu — Coolify: /, ops/coolify/Dockerfile, :80
app/website/      # strona produktu — Coolify: /, app/website/Dockerfile, :80
app/mcp-worker/   # MCP produktu — obecnie Cloudflare, NIE gotowy kontener Coolify
mcp/mantic/       # własny Mantic MCP; STDIO image, HTTP wrapper jeszcze do ustalenia
mcp/qdrant/       # własny Qdrant MCP — niepełne źródła
mcp/penpot/       # własny Penpot MCP — niepełne źródła
mcp/plasmic/      # własny Plasmic MCP; kontekst Coolify /mcp/plasmic
mcp/supabase/     # własny Supabase MCP — nie mylić z produktem supabase/
mcp/ubuntu/       # własny Ubuntu MCP — niepełne źródła
mcp/opencode/     # integracje OpenCode MCP
mcp/paperclip/    # integracje Paperclip MCP
mcp/opendesign/   # dodatkowy OpenDesign bridge
```

Katalogi `_branches/` przechowują wersje do późniejszej konsolidacji przez model AI, nie runtime. Każdy działający MCP/produkt ma własny pipeline i aplikację Coolify, **nie** wspólny deploy wszystkiego z każdego push. Nie podłączaj do produkcyjnego Coolify usług, dla których nie ma zweryfikowanego Dockerfile/HTTP entrypointu i testu live.

Aplikacja dla instruktorów Royal Rangers wspierająca cykl **Planowanie → Realizacja → Refleksja → Doskonalenie**. Główna wartość produktu to prostsze planowanie, brak pustej kartki i ciągłość pracy między aktywnościami. AI jest opcjonalnym interfejsem, nie źródłem decyzji domenowych.

## Struktura repozytorium

```text
app/                       # jedyny katalog runtime aplikacji
├── web/                   # UI
├── plugin/                # Wtyczka / MCP Kompasu Zbiórek
└── cloudflare-worker/     # API/integracje/Cloudflare

branding/                  # kanoniczny folder brandingu produktu; obecnie pusty

dev/                       # kod wspierający rozwój aplikacji
├── design-system/         # OpenDesign/design tokens
├── integrations/          # Paperclip/OpenCode MCP i integracje developerskie
└── quality/               # dodatkowe testy/pipeline poza runtime

content/                   # treści niebędące kodem runtime
├── marketing/
└── onboarding-emails/

archive/                   # materiały historyczne i audyty
├── legacy/
└── ui-audits/

.paperclip-wiki/           # lokalny mirror wiedzy Paperclip
registry/                  # kanoniczny rejestr UI @kompas
scripts/                   # tooling repozytorium
skills/                    # skille developerskie/agentowe
```

Root repo pozostaje możliwie płaski: konfiguracja workspace, registry, tooling, dokumentacja oraz wydzielony `branding/`. Kod produkcyjny pozostaje w `app/`.

## Kanon architektury

- **Supabase/Postgres jest jedynym application source of truth.**
- Cloudflare Worker jest warstwą API, integracji i bezpiecznego dostępu do sekretów; nie jest drugim źródłem prawdy domenowej.
- Nie twórz nowej domenowej warstwy Cloudflare D1.
- Pliki trafiają do Supabase Storage lub R2 zależnie od modułu.
- Wymagania sprawności pochodzą z oficjalnego źródła RR; nie wolno ich wymyślać.
- Brak danych jest jawnym stanem `Brak danych`, a nie pretekstem do generowania fikcyjnej treści.
- TARGET i CURRENT są rozdzielone: PRD opisuje stan docelowy, a stan wdrożenia trzeba potwierdzać w kodzie/runtime/testach.

## Onboarding — TARGET

1. Po rejestracji Google: imię i nazwisko → szczep → drużyna → panel.
2. Pierwszy mail po rejestracji prosi o dodanie nadawcy do ważnych/kontaktów albo odpowiedź na wiadomość.
3. Checklist w aplikacji: dodaj osoby do drużyny → dodaj plan roczny → zaplanuj pierwszą zbiórkę.
4. Potwierdzenie zapisu do newslettera jest osobnym zadaniem komunikacyjnym.

## Szybki start

```bash
# instalacja całego repozytorium
npm ci

# lokalny serwer aplikacji v0
npm run dev
```

Root udostępnia jeden kontrakt npm dla panelu: `npm run lint`, `npm run typecheck`,
`npm test` i `npm run build`. Wdrożony interfejs panelu jest dostępny pod
`https://panel.kompaszbiorek.pl`; kod aplikacji znajduje się w `app/`, a Worker
Cloudflare panelu w `app/cloudflare-worker/`.

Kanoniczny release produkcyjny opisuje `docs/production-release.md`. Frontend
`app/web/dist` jest hostowany self-hosted przez Coolify (`ops/coolify/Dockerfile`,
deploy z `main` przez GitHub App). Cloudflare Worker ma osobny workflow i jest
wdrażany tylko przy zmianach w `app/cloudflare-worker/**`; brak Cloudflare
credentials nie blokuje release frontendu.

## Frontend self-hosted (Coolify)

Target frontendu to self-hosted Coolify, nie platforma SaaS:

- build: `npm --prefix app run build` w `ops/coolify/Dockerfile` (Node 24) — kontekst
  to **root repozytorium**;
- publish directory: `app/web/dist` — runtime to nginx (`ops/coolify/nginx.conf`);
- deploy: `main` + webhook push (źródło: GitHub App zainstalowana tylko na tym repo).

Ścieżka `/panel` przekierowuje do kanonicznego Workera Cloudflare pod
`panel.kompaszbiorek.pl`, który obsługuje OAuth, API i zapis do Google.

Obecny `app/npm run test:all` wykonuje build, typecheck i istniejący targeted test logiki. Repo **nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`**; browser acceptance jest osobną warstwą QA i nie należy udawać historycznego Playwright/Lighthouse gate jako bieżącego stanu.

## Kanoniczne lokalizacje

| Obszar | Ścieżka |
|---|---|
| Render statyczny | `app/web/src/static-app-v2.js` |
| Style | `app/web/src/styles.css`, `app/web/src/extended.css` |
| Build web | `app/web/scripts/build-static.mjs` |
| Targeted test logiki | `app/web/scripts/skill-completion-task-test.mjs` |
| MCP/API Worker | `app/cloudflare-worker/src/public-ui.ts` |
| OAuth | `app/cloudflare-worker/src/oauth.ts`, `google-handler.ts`, `widget-auth.ts` |
| Build Worker | `app/cloudflare-worker/build-worker.mjs` |
| Wtyczka / MCP Kompasu Zbiórek | `app/plugin/index.ts` |
| Dodatkowe testy/pipeline | `dev/quality/` |
| Branding produktu | `branding/` (obecnie pusty; jedyne kanoniczne miejsce na przyszłe źródła brandingu) |
| Techniczny design system / tokeny | `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
| Maile onboardingowe | `content/onboarding-emails/` |
| Marketing | `content/marketing/` |
| Integracje developerskie | `dev/integrations/` |

## Delivery governance

- `main` jest gałęzią stanu produktu.
- Implementacja repo-write powinna kończyć się wskazaniem dokładnego `candidate_sha`.
- Niezależny review ma dotyczyć dokładnie tego SHA; późniejszy commit wymaga ponownego review.
- Merge po PASS należy do roli CTO/reviewera, chyba że operator jawnie zdecyduje inaczej.

## Wiedza projektowa

Aktualny kanon produktu, architektury, onboardingu i decyzji utrzymywany jest w Paperclip Wiki. Mirror `.paperclip-wiki/` w repo służy do pracy lokalnej, ale przy konflikcie należy sprawdzić aktualną stronę wiki i stan runtime.
