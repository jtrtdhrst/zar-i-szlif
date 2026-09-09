# Kompas Zbiórek

Aplikacja dla instruktorów Royal Rangers wspierająca cykl **Planowanie → Realizacja → Refleksja → Doskonalenie**. Główna wartość produktu to prostsze planowanie, brak pustej kartki i ciągłość pracy między aktywnościami. AI jest opcjonalnym interfejsem, nie źródłem decyzji domenowych.

## Struktura repozytorium

```text
app/                       # jedyny katalog runtime aplikacji
├── web/                   # UI
├── server/                # serwer ChatGPT/MCP
└── cloudflare-worker/     # API/integracje/Cloudflare

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

Root repo pozostaje możliwie płaski: konfiguracja workspace, registry, tooling i dokumentacja. Kod produkcyjny nie powinien wracać na root.

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
# zależności repo/toolingu
pnpm install

# zależności aplikacji
cd app && npm install

# build + typecheck + tracked targeted test
npm run test:all

# dev
npm run dev
```

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
| Serwer ChatGPT/MCP | `app/server/index.ts` |
| Dodatkowe testy/pipeline | `dev/quality/` |
| Design tokens | `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
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
