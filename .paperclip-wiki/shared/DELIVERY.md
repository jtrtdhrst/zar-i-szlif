# Delivery i produkcja

## Repo layout

- `app/` — jedyny runtime aplikacji: UI, serwer ChatGPT/MCP, Cloudflare Worker/API.
- `dev/` — design system, integracje developerskie i quality tooling.
- `content/` — marketing i onboarding emails.
- `archive/` — historia; nie jest CURRENT.
- Root — konfiguracja workspace, registry, scripts, skills i dokumentacja repo.

Szczegółową mapę plików utrzymuje skill `kompas-technical-context`. Nie kopiuj jej do każdego promptu.

## Architektura danych

- **Supabase/Postgres jest jedynym application source of truth.**
- Cloudflare Worker = API/integracje/sekrety, nie drugi SSOT domenowy.
- Nie twórz nowej domenowej warstwy Cloudflare D1.
- Pliki trafiają do Supabase Storage lub R2 zależnie od modułu.
- TARGET z PRD i CURRENT z runtime/kodu/testu są osobnymi warstwami.
- Brak danych = jawny stan `Brak danych`; nie generuj fikcyjnych rekordów integracji.

## Runtime

- UI: `app/web/`.
- Serwer ChatGPT/MCP: `app/server/`.
- Worker/API/OAuth: `app/cloudflare-worker/`.
- Konfiguracja Workera: `app/cloudflare-worker/wrangler.jsonc`.
- Dokumentacja runtime: `app/documentation.md`.

Przed decyzją o domenach/routingu czytaj aktualny `wrangler.jsonc` i stan Cloudflare. Nie traktuj historycznej domeny z komentarza lub starego promptu jako CURRENT.

## Build i verification

W `app/`:

- `npm run build` — build web + TypeScript server;
- `npm run typecheck` — typecheck server + web;
- `npm run test:skill-completion-task` — tracked targeted test logiki;
- `npm run test:all` — obecny tracked gate: build + typecheck + targeted test.

**Repo nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`.** Nie raportuj starego „92/92”, Playwright PASS ani Lighthouse PASS jako bieżącego dowodu. Browser/UI acceptance wykonuje UI QA task-scoped przez dostępne narzędzie przeglądarkowe. Jeśli release wymaga automatycznego E2E/Lighthouse, a suite nie istnieje, jest to jawny gap coverage.

## Deploy Cloudflare

Deploy tylko dla scoped/autoryzowanego zadania.

1. `npm run build` w `app/`.
2. `node build-worker.mjs` w `app/cloudflare-worker/`.
3. `npx wrangler deploy --dry-run` w `app/cloudflare-worker/`.
4. `npx wrangler deploy --keep-vars` dopiero przy autoryzowanym deployu.

Docelowy Worker w repo: `wtyczka-rr`. Nie twórz zastępczego Workera jako obejścia błędu. Po deployu podaj wersję zwróconą przez Wrangler i sprawdź faktyczny routing.

## Integracje i API

- Baza aktywności RR i sprawności: nie wymyślaj danych; używaj aktualnego kontraktu domenowego dla zadania.
- Google/OAuth: nie poszerzaj scope bez jawnej potrzeby; istniejący flow używa `drive.file` tam, gdzie dotyczy plików Google.
- MCP endpoint pozostaje `/mcp`, chyba że jawna decyzja architektoniczna mówi inaczej.
- Przy schema/data-layer przed implementacją zweryfikuj realny schema Supabase targeted, nie zgaduj z PRD.

## Delivery governance

- Implementer dostarcza dokładny candidate SHA i evidence.
- Review dotyczy dokładnego SHA względem aktualnego remote base.
- Późniejszy commit po review wymaga ponownej weryfikacji.
- Merge/release prowadzi CTO/reviewer zgodnie z aktualną polityką i jawną decyzją operatora.
- Historyczny branch, komentarz lub stary snapshot nie jest dowodem stanu produkcji.
