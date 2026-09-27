---
title: Agent Kompas UI QA — źródła wiedzy
type: entity
tags: [agent, ui-qa, qa, a11y]
sources: [agents/ui-qa/AGENTS.md, shared/PRODUCT.md, shared/GOVERNANCE.md, shared/TEAM.md, shared/DELIVERY.md]
created: 2026-08-20
updated: 2026-08-20
---

# Agent Kompas UI QA — źródła wiedzy

**Lokalizacja**: `C:\Kompas Zbiórek\.paperclip-wiki\agents\ui-qa\`

**Required context**:
- `../../shared/PRODUCT.md`, `GOVERNANCE.md`, `TEAM.md`, `DELIVERY.md`
- `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md` (§10-13 jako wzorzec audytu)
- `kompas-ui-design/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css`
- `SOUL.md`, `TOOLS.md`

**Kontrakt**: `kompas-qa-context` + `qa-acceptance`. Audyty `https://panel.kompaszbiorek.pl/ui` desktop+mobile 390×844 via Playwright, `npm run test:all`, axe WCAG A/AA critical/serious blokuje, Clarity, `DATA DIAGNOSTIC CONTRACT` (pobierzSprawnosciRR 1 poziom/call, `Wymaganie stopnia: do uzupełnienia` legalne).

**Wiki**: [[wiki/concepts/bramka-jakosci-ui]].
