---
title: Agent Kompas Engineer — źródła wiedzy (dostęp do dokumentacji)
type: entity
tags: [agent, engineer, dokumentacja, implementacja]
sources: [agents/engineer/AGENTS.md, shared/PRODUCT.md, shared/GOVERNANCE.md, shared/TEAM.md, shared/DELIVERY.md, raw/PRD-KOMPAS-ZBIOREK.md, raw/API-SPRAWNOSCI.md, raw/PRD-BAZA-AKTYWNOSCI-RR.md]
created: 2026-08-20
updated: 2026-08-20
---

# Agent Kompas Engineer — źródła wiedzy

**Lokalizacja**: `C:\Kompas Zbiórek\.paperclip-wiki\agents\engineer\` — **po dopisaniu `/engineer` jako źródło wiedzy**

**Required context (MA DOSTĘP DO DOKUMENTACJI)**:
- `../../shared/PRODUCT.md` — produkt, repo, invariants
- `../../shared/GOVERNANCE.md` — governance, DoD, STARTUP I/O
- `../../shared/STATE.md` — CURRENT/AS-IS (zweryfikowany stan)
- `../../shared/TEAM.md` — zespół, skille, profile modeli
- `../../shared/DELIVERY.md` — REPO MAP, produkcja, testy, integracje
- `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md` — branding 1:1 live v48 (forest/paper/gold/red) — **MUSI znać przed UI**
- `kompas-ui-design/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` — tokeny kanoniczne
- `Dokumentacja_API_SPRAWNOSCI.md` (v14), `PRD_I_DOKUMENTACJA_API_BAZY_AKTYWNOSCI_RR.md`, `dokumentacja-integracji-kompas-zbiorek.md` — **kontrakty API (sprawności, baza aktywności, panel) — MUSI znać przed implementacją wiersza sprawności/karty**
- `WSPOLNY_KONTEKST.md` — source of truth jeśli shared nie wystarcza
- `SOUL.md`, `TOOLS.md`

**Kontrakt**: `kompas-technical-context` (REPO MAP, invariants, engineer test contract). Kolejność źródeł: `PAPERCLIP_WAKE_PAYLOAD_JSON` → HANDOFF → REPO MAP → targeted reads → kod. Lokalizacje z REPO MAP, nie skanem.

**Zakres**: `C:\Kompas Zbiórek\kompas-ui-plugin\web` (UI), `kompas-ui-plugin\e2e` (Playwright), poprawki/refaktory.

**Wiki powiązania**: [[wiki/entities/repo-map]], [[wiki/sources/baza-aktywnosci]], [[wiki/sources/prd-kompas]], [[wiki/concepts/karta-zbiorki]] — to jest miejsce gdzie Engineer czyta dokumentację via wiki.
