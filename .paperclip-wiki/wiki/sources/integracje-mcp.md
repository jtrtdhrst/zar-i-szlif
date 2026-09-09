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

**Produkcja**: Worker `panel-kompaszbiorek`, publiczny system `https://panel.kompaszbiorek.pl` (`/ui` dla UI, `/mcp` dla MCP). Deploy: `npm run build` w `app/` → `node build-worker.mjs` w `app/cloudflare-worker/` → `npx tsc --noEmit` → `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars` (ostatni krok po autoryzacji).

**ChatGPT**: wtyczka + Apps SDK, serwer mostu `kompas-ui-plugin/server/index.ts`, skill `chatgpt-apps`.

**Paperclip MCP Wiki**: bezpieczny katalog stron `wiki/**/*.md` udostępnia
`paperclipWikiList`, `paperclipWikiSearch`, `paperclipWikiGetPage`,
`paperclipWikiGetMetadata`, `paperclipWikiProposeChange` i
`paperclipWikiApplyChange`. Przed edycją autorytatywny hash pobieraj przez
`GetPage`/`GetMetadata`, nie z listingu. Konflikt równoległej zmiany zwraca
`WIKI_HASH_CONFLICT`; `raw/` i traversal zwracają `WIKI_PATH_FORBIDDEN`.

Szczegółowy kontrakt: [[wiki/concepts/paperclip-wiki-mcp]].

> Źródła: `raw/DOKUMENTACJA-INTEGRACJI.md`, `raw/PROMPT-SYSTEMOWY.md`, `raw/documentation.md`.
