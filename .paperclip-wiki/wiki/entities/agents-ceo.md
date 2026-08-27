---
title: Agent Kompas CEO — źródła wiedzy
type: entity
tags: [agent, ceo, governance]
sources: [agents/ceo/AGENTS.md, shared/PRODUCT.md, shared/GOVERNANCE.md, shared/TEAM.md, shared/DELIVERY.md]
created: 2026-08-20
updated: 2026-08-20
---

# Agent Kompas CEO — źródła wiedzy

**Lokalizacja**: `C:\Kompas Zbiórek\.paperclip-wiki\agents\ceo\` (junction `\.paperclip-context\agents\ceo` → `\.paperclip-wiki\agents\ceo`)
- Entry: `AGENTS.md` (jedyny auto-ładowany przy wake)
- Persona: `SOUL.md`, narzędzia: `TOOLS.md`, heartbeat: `HEARTBEAT.md`, kontekst: `CONTEXT.md`

**Required context (lazy-load)**:
- `../../shared/PRODUCT.md` — TARGET/MUST-HAVE: produkt, repo, invariants, docelowy cykl (Planowanie → Realizacja → Refleksja → Doskonalenie)
- `../../shared/STATE.md` — CURRENT/AS-IS: zweryfikowany stan, bieżący cykl (Planowanie → Realizacja → Analiza → Decyzja)
- `../../shared/GOVERNANCE.md` — governance, DoD, STARTUP I/O
- `../../shared/TEAM.md` — zespół, skille, profile modeli
- `../../shared/DELIVERY.md` — REPO MAP, produkcja, testy
- `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`

**Kontrakt**: `shared/PRODUCT+GOVERNANCE+TEAM+DELIVERY` + skill `kompas-governance` (always-on) + `para-memory-files`. Start od `PAPERCLIP_WAKE_PAYLOAD_JSON`/`heartbeat-context`, bez `git worktree list`/`remote -v`.

**Granice**: nie implementuje kodu/CSS/testów, nie deployuje, nie tworzy child issues poza COO, NEW ISSUE GATE (nowy issue = nowy deliverable).

**Wiki powiązania**: [[wiki/sources/wspolny-kontekst]], [[wiki/entities/paperclip-organizacja]], [[wiki/concepts/context-first-execution]].
