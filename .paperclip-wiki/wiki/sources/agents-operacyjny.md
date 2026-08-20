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

Wykonanie kontraktowe odwołuje się do WSPOLNY_KONTEKST sekcji Project context/REPO MAP/Wykonanie kontraktowe/STARTUP I/O BUDGET. Minimalny preflight git + brak potwierdzającego GET. Advanced UI (`skills/advanced-ui/SKILL.md`), status via Paperclip MCP (`skills/status`). Realizacja end-to-end, screenshoty dla UI, hierarchia informacji przed dekoracją. Zakres edycji tylko `C:\Kompas Zbiórek`. Stały sposób pracy 5 kroków: PRD→porównanie→minimalna zmiana→testy/build→documentation.md. Karta zbiórki samowystarczalna; tabele dla powtarzalnych danych. Cloudflare Worker `wtyczka-rr` + domena `interfejs.kompaszbiorek.pl`, kolejność build/deploy. Baza aktywności: `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`. Bramka jakości UI: `npm run test:all` (Playwright desktop+mobile 390×844, axe WCAG A/AA critical/serious blokuje, Lighthouse prog access≥0.9 best-practices≥0.9).

## MAPA SYSTEMU.md (raw/MAPA-SYSTEMU.md)

Pliki produktu: PRD, Prompt systemowy, 00–06 cykl, SZABLON GOOGLE DOCS, Dokumentacje API (sprawności, data/godzina, baza aktywności). Kolejność 4 etapy: Diagnoza (00+01) → Plan (02) → Działanie (03) → Refleksja (04+05+06). Reguła jednego przejścia. Granice źródeł. Status integracji: Google Sheets wdrożone, data/godzina zablokowana, sprawności v14 zweryfikowane, stopnie planowane, baza aktywności kontrakt MVP.

> Źródła: `raw/AGENTS.md`, `raw/MAPA-SYSTEMU.md`.
