---
title: Integracje, MCP i produkcja — kontrakty
type: source
tags: [integracje, mcp, cloudflare, produkcja]
sources: [raw/DOKUMENTACJA-INTEGRACJI.md, raw/PROMPT-SYSTEMOWY.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-20
---

# Integracje, MCP i produkcja

**MCP endpoint** `/mcp` w `kompas-ui-plugin/cloudflare-worker/src/public-ui.ts`, narzędzie `zapisz_dane_kompasu` (whitelist pól, dwuetapowy zapis z potwierdzeniem), proxy katalogów `/api/activities`, `/api/skills` z cache `caches.default` + IndexedDB.

**OAuth Google** `drive.file` — `oauth.ts`, `google-handler.ts`, `widget-auth.ts`.

**Panel Google Sheets** `/panel` (`panel-handler.ts`) — arkusz jako trwały stan drużyny, landing 2 opcje (istniejący arkusz / kopia szablonu `SHEETS_TEMPLATE_FILE_ID`), zapis przez `POST /panel/save` (`values.append`) dopiero po podglądzie.

**Produkcja**: Worker `wtyczka-rr`, domeny `interfejs.kompaszbiorek.pl` (docelowa), `wtyczka.kompaszbiorek.pl/ui` (fallback), `panel.kompaszbiorek.pl` (Worker `panel-kompaszbiorek`). Deploy: `npm run build` → `node build-worker.mjs` → `wrangler deploy --dry-run` → `deploy --keep-vars` (lokalny wrangler).

**ChatGPT**: wtyczka + Apps SDK, serwer mostu `kompas-ui-plugin/server/index.ts`, skill `chatgpt-apps`.

> Źródła: `raw/DOKUMENTACJA-INTEGRACJI.md`, `raw/PROMPT-SYSTEMOWY.md`, `raw/documentation.md`.

