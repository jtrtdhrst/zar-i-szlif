---
title: Worker wtyczka-rr — runtime produkcyjny
type: entity
tags: [cloudflare, worker, produkcja, cache]
sources: [raw/WSPOLNY_KONTEKST.md, raw/DOKUMENTACJA-INTEGRACJI.md]
created: 2026-08-20
updated: 2026-08-20
---

# Worker wtyczka-rr

Docelowy Worker Cloudflare `panel-kompaszbiorek`, publiczny system `https://panel.kompaszbiorek.pl` (`/ui` dla UI, `/mcp` dla MCP). Architektura: widget statyczny (`static-app-v2.js`) + `localStorage` (szkic `kompas-zbiorek-draft-v1`); Worker serwuje UI i proxy `/api/activities`, `/api/skills` z dwuwarstwowym cache (`caches.default` + IndexedDB) oraz narzędziem MCP `zapisz_dane_kompasu` (whitelist pól, dwuetapowy zapis z potwierdzeniem). Cache nie synchronizuje się między urządzeniami; bez sieci i cache — czytelny stan braku danych.

Deploy: `wtyczka-rr` jedyny cel; `npm run build` → `node build-worker.mjs` → `wrangler deploy --dry-run` → `deploy --keep-vars` (lokalny wrangler).

