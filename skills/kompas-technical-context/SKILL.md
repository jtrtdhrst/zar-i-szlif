---
name: kompas-technical-context
description: Stałe techniczne invarianty i repo map Kompas Zbiórek. Always-on dla CTO; używany też przez Engineer do minimalnego preflightu i lokalizacji plików bez broad discovery.
---

# Kompas Technical Context

## Technical invariants

Nie zmieniaj bez jawnego upoważnienia w zadaniu:

- MCP endpoint pozostaje `/mcp`.
- Google OAuth scope pozostaje `drive.file` (panel Google Sheets).
- Cloudflare D1 pozostaje częścią warstwy danych.
- Struktura domen produkcyjnych pozostaje: `interfejs.kompaszbiorek.pl` (docelowa), `wtyczka.kompaszbiorek.pl` (fallback `/ui`), `panel.kompaszbiorek.pl`.
- Docelowy Worker produkcyjny: `wtyczka-rr`. Nie wdrażaj na `kompas-zbiorek`, nie twórz zastępczych Workerów.
- Bez scoped zlecenia deploya — brak wdrożenia produkcyjnego.
- Brak bezpośredniego write do `main`; write wyłącznie w isolated worktree.

## REPO MAP

- Ustawienia projektu / konfiguracja: `opencode.json` (MCP paperclip+cloudflare), `package.json` (root, devDeps testowe).
- UI plugin: `kompas-ui-plugin/`
  - build: `npm run build` w `kompas-ui-plugin` (web/scripts/build-static.mjs + tsc server).
  - aplikacja: `kompas-ui-plugin/web/src/static-app-v2.js` (główny render statyczny), `styles.css`, `extended.css`.
  - e2e Playwright: `kompas-ui-plugin/e2e/ui.spec.ts`, `a11y.spec.ts`, `cache.spec.ts`, `panel.spec.ts`, `visual.spec.ts`, `helpers.ts`.
  - Lighthouse: `kompas-ui-plugin/lighthouserc.json`, `scripts/run-lhci.mjs`.
  - lokalne komendy: `npm run test:all` (build + playwright + lighthouse), `test:ui`, `test:a11y`, `test:visual`, `test:lighthouse`, `test:ui:update`.
  - serwer mostu ChatGPT/MCP: `kompas-ui-plugin/server/index.ts`, `dist/`.
- Cloudflare Worker `wtyczka-rr`: `kompas-ui-plugin/cloudflare-worker/`
  - `src/public-ui.ts` (UI + `/mcp` + `zapisz_dane_kompasu`), `src/oauth.ts` + `src/google-handler.ts` + `src/widget-auth.ts` + `src/workers-oauth-utils.ts` (OAuth Google, scope drive.file), `src/panel-handler.ts` (panel Google Sheets).
  - konfiguracja: `wrangler.jsonc`, `wrangler.panel.jsonc`; build: `node build-worker.mjs`.
  - wdrożenie: `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars` (wrangler = lokalna devDependency).
- Design system: `kompas-ui-design/opendesign/design-systems/kompas-rrp/` (SKILL.md, README.md, `tokens/colors_and_type.css`, `brand/`).
- Dokumentacja produktu (root): `PRD Kompas Zbiórek.md`, `MAPA SYSTEMU.md`, `WSPÓLNY KONTEKST.md`, `documentation.md`, PRD Bazy Aktywności RR, dokumentacje API sprawności / dat / integracji.
- Email assets: `onboarding-emails/html/`, `onboarding-emails/plain-text/`, `onboarding-emails/MAPA-AUTOMATYZACJI.md`.

## Minimalny git preflight (techniczny)

Normalny przypadek: `git branch --show-current` + `git status --short`. Opcjonalnie `git rev-parse --show-toplevel`. Dopiero gdy branch/cwd nie zgadza się z currentExecutionWorkspace → `git worktree list`, `git remote -v`, `git rev-parse HEAD`.

## Engineer test contract

- Uruchom najmniejszy zestaw testów pokrywający zmieniony zakres.
- Nie wykonuj pełnego niezależnego audytu akceptacyjnego — należy on do UI QA.
- Po zmianie UI: build + testy e2e właściwe dla obszaru + smoke/regression własnej zmiany.