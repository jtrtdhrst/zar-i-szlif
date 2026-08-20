---
title: WSPÓLNY KONTEKST — kanon wiedzy Kompas Zbiórek
type: source
tags: [kontekst, kontrakt, governance]
sources: [raw/WSPOLNY_KONTEKST.md]
created: 2026-08-20
updated: 2026-08-20
---

# WSPÓLNY KONTEKST — streszczenie

Jedyné obowiązujące źródło wiedzy dla wszystkich agentów (nadrzędne względem sprzecznych źródeł). Wersja z `raw/WSPOLNY_KONTEKST.md` (169 linii).

## Project context (warstwa A stała)

- Produkt: Kompas Zbiórek — wtyczka ChatGPT + interfejs `https://interfejs.kompaszbiorek.pl`, metoda SENS→DZIAŁANIE→REFLEKSJA, karta zbiórki jako samowystarczalny artefakt (dane+obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja)
- Repo: `https://github.com/miloszspyrka-code/kompas-zbiorek`, workspace `isolated_workspace` + `git_worktree` (`baseRef=main`, parent `.paperclip-worktrees`)
- Produkcja: `kompaszbiorek.pl`, `wtyczka.kompaszbiorek.pl/ui`, Worker `wtyczka-rr`, domena docelowa `interfejs.kompaszbiorek.pl`
- Invarianty: MCP `/mcp`, OAuth `drive.file`, Cloudflare D1, brak write do `main` bez worktree
- Delivery: Engineer→QA→Done, max 2 aktywne deliverable, `BLOCKER/OWNER/ACTION` dla zablokowanych

## Sekcje i routing ról

Lazy-load: CEO/COO/CTO/Engineer/UI QA/Designer/CMO ładują różne sekcje (tabela w źródle). `docs/AI-REPO-MAP.md` jest routing table — wersja w WSPOLNY_KONTEKST jest skrótem.

## Mapa systemu — skrót REPO MAP

Kanoniczne lokalizacje: `kompas-ui-plugin/web/src/static-app-v2.js` (render), `styles.css`, `cloudflare-worker/src/public-ui.ts` (MCP), `oauth.ts`/`panel-handler.ts`, `server/index.ts`, `e2e/`, `lighthouserc.json`, `kompas-ui-design/opendesign`, `onboarding-emails/`. Komendy: `npm run build`, `npm run test:all`.

## Integracje i API

Baza aktywności RR (odczyt+filtry), `pobierzSprawnosciRR` (1 poziom, 1 call/odpowiedź), API daty zablokowane (`Europe/Warsaw`), stopnie planowane, Google Sheets panel `/panel` (arkusz jako trwały stan), ChatGPT Canvas zależny od interfejsu. Szczegóły w [[wiki/sources/integracje-mcp]].

## Cykl doskonalenia, Design, Produkcja

4 etapy: Planowanie→Realizacja→Analiza→Decyzja (mapowanie 00–06). Brand DNA mapa/topografia, bez poziomic/gradientów. Produkcja: Worker `wtyczka-rr`, kolejność `build → build-worker.mjs → wrangler deploy --dry-run → deploy --keep-vars`.

## Wykonanie kontraktowe

CONTEXT-FIRST: `PAPERCLIP_WAKE_PAYLOAD_JSON`→HANDOFF→REPO MAP→targeted reads→code. STARTUP I/O BUDGET: 1 odczyt heartbeat, git `branch --show-current`+`status --short`, bez szerokiego discovery, autorytatywność mutacji (bez potwierdzającego GET).

> Źródło: `raw/WSPOLNY_KONTEKST.md` — pełny tekst kanoniczny.
