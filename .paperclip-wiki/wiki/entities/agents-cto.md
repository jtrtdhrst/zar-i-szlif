---
title: Agent Kompas CTO — źródła wiedzy
type: entity
tags: [agent, cto, architektura]
sources: [agents/cto/AGENTS.md, shared/PRODUCT.md, shared/GOVERNANCE.md, shared/TEAM.md, shared/DELIVERY.md, raw/API-SPRAWNOSCI.md, raw/PRD-BAZA-AKTYWNOSCI-RR.md, raw/DOKUMENTACJA-INTEGRACJI.md]
created: 2026-08-20
updated: 2026-08-20
---

# Agent Kompas CTO — źródła wiedzy

**Lokalizacja**: `C:\Kompas Zbiórek\.paperclip-wiki\agents\cto\`

**Required context**:
- `../../shared/PRODUCT.md`, `GOVERNANCE.md`, `TEAM.md`, `DELIVERY.md`
- `Dokumentacja_API_SPRAWNOSCI.md` (v14), `PRD_I_DOKUMENTACJA_API_BAZY_AKTYWNOSCI_RR.md`, `dokumentacja-integracji-kompas-zbiorek.md` — **kontrakty API domenowych MUSI znać do review**
- `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md` — branding live
- `SOUL.md`, `TOOLS.md`

**Kontrakt**: `kompas-technical-context` (always-on) + `shared/*`. Minimalny git preflight `branch --show-current`+`status --short`.

**Zakres**: architektura, technical preflight, walidacja kontraktów `GET /api/activities` (filtry `category/level/energy/participants`, `Brak danych`) i `GET /api/skills` (1 poziom/call), nadzór nad Engineer/UI QA, `documentation.md`.

**Wiki**: [[wiki/entities/repo-map]], [[wiki/entities/integracje-api]], [[wiki/sources/baza-aktywnosci]].
