# Żar i Szlif

**Żar i Szlif** to zatwierdzona publiczna nazwa aplikacji (decyzja 2026-10-13). „Kompas Zbiórek” pozostaje nazwą historyczną oraz technicznym identyfikatorem w istniejących repozytoriach, domenach, kluczach i ścieżkach. Nazwa nie oznacza zmiany URL ani automatycznie potwierdzonego deployu. Źródło decyzji dla repo: `branding/BRAND.md`.

Aplikacja dla instruktorów Royal Rangers wspierająca cykl **Planowanie → Realizacja → Refleksja → Doskonalenie**. Główna wartość produktu to prostsze planowanie, brak pustej kartki i ciągłość pracy między aktywnościami. AI jest opcjonalnym interfejsem, nie źródłem decyzji domenowych.

## Struktura repozytorium

```text
app/                       # jedyny katalog runtime aplikacji
├── web/                   # UI
├── plugin/                # Wtyczka / MCP Kompasu Zbiórek
└── cloudflare-worker/     # API/integracje/Cloudflare

branding/                  # zatwierdzona nazwa i kanon brandingu (BRAND.md)

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
`app/web/dist` jest publikowany przez integrację Vercel ↔ GitHub. Cloudflare Worker
ma osobny workflow i jest wdrażany tylko przy zmianach w `app/cloudflare-worker/**`;
brak Cloudflare credentials nie blokuje frontendowego release Vercel.

## Vercel i v0

Projekt Vercel musi wskazywać **root repozytorium**, nie katalog `app/`.
Konfiguracja w `vercel.json` ustawia:

- install command: `npm ci`;
- build command: `npm run build`;
- output directory: `app/web/dist`;
- framework: `Other` / brak frameworka.

Vercel publikuje statyczny interfejs i preview dla v0. Ścieżka `/panel` przekierowuje
do kanonicznego Workera Cloudflare pod `panel.kompaszbiorek.pl`, który obsługuje
OAuth, API i zapis do Google. Nie ustawiaj katalogu `app/` jako Root Directory.

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
| Branding produktu | `branding/BRAND.md` (kanoniczna decyzja o publicznej nazwie w repo) |
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
