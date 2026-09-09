---
title: AGENTS.md i MAPA SYSTEMU — zasady wykonawcze
type: source
tags: [agents, mapa-systemu, workflow]
sources: [raw/AGENTS.md, raw/MAPA-SYSTEMU.md]
created: 2026-08-20
updated: 2026-08-20
---

# AGENTS.md i MAPA SYSTEMU — streszczenie

## AGENTS.md (raw/AGENTS.md)

Wykonanie kontraktowe odwołuje się do WSPOLNY_KONTEKST sekcji Project context/REPO MAP/Wykonanie kontraktowe/STARTUP I/O BUDGET. Minimalny preflight git + brak potwierdzającego GET. Advanced UI (`skills/advanced-ui/SKILL.md`), status via Paperclip MCP (`skills/status`). Realizacja end-to-end, screenshoty dla UI, hierarchia informacji przed dekoracją. Zakres edycji tylko `C:\Kompas Zbiórek`. Stały sposób pracy 5 kroków: PRD→porównanie→minimalna zmiana→testy/build→documentation.md. Karta zbiórki samowystarczalna; tabele dla powtarzalnych danych. Cloudflare Worker `panel-kompaszbiorek`, publiczny system `https://panel.kompaszbiorek.pl` (`/ui` i `/mcp`), kolejność build/deploy: `npm run build` w `app/` → `node build-worker.mjs` → `npx tsc --noEmit` → `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars` w `app/cloudflare-worker/`. Baza aktywności: `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`. Bramka jakości UI: `npm run test:all` (Playwright desktop+mobile 390×844, axe WCAG A/AA critical/serious blokuje, Lighthouse prog access≥0.9 best-practices≥0.9).

## MAPA SYSTEMU.md (raw/MAPA-SYSTEMU.md)

Pliki produktu: PRD, Prompt systemowy, historyczne materiały `00`–`06`, SZABLON GOOGLE DOCS, Dokumentacje API (sprawności, data/godzina, baza aktywności). Bieżący stan (CURRENT/AS-IS): Planowanie → Realizacja → Analiza → Decyzja (zob. `STATE.md`); tylko Planowanie ma checkpointy Cel i sprawności / Przebieg / Przygotowanie. Etapy 2–4 nie mają zatwierdzonych podzadań ani bramek. Docelowy kontrakt (TARGET): Planowanie → Realizacja → Refleksja → Doskonalenie (zob. `PRODUCT.md`). `00`–`06` zachowuje traceability metodologii, nie definiuje user-facing flow. Status integracji: Google Sheets wdrożone, data/godzina zablokowana, sprawności v14 zweryfikowane, stopnie planowane, baza aktywności kontrakt MVP.

> Źródła: `raw/AGENTS.md`, `raw/MAPA-SYSTEMU.md`.
