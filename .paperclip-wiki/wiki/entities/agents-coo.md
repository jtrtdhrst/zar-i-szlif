---
title: Agent Kompas COO — źródła wiedzy
type: entity
tags: [agent, coo, governance]
sources: [agents/coo/AGENTS.md, shared/PRODUCT.md, shared/GOVERNANCE.md, shared/TEAM.md, shared/DELIVERY.md]
created: 2026-08-20
updated: 2026-08-20
---

# Agent Kompas COO — źródła wiedzy

**Lokalizacja**: `C:\Kompas Zbiórek\.paperclip-wiki\agents\coo\`

**Required context**:
- `../../shared/PRODUCT.md`, `../../shared/GOVERNANCE.md`, `../../shared/TEAM.md`, `../../shared/DELIVERY.md`
- `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`

**Kontrakt**: `shared/*` + skills `issue-triage`, `kompas-governance`, `kompas-team-map`. Start od `PAPERCLIP_WAKE_PAYLOAD_JSON`/`heartbeat-context`/`inbox-lite`.

**Operacje**: NEW ISSUE GATE, wyznacza jednego ownera, child issues z polami OWNER/SCOPE/DO NOT TOUCH/DELIVERABLE/ACCEPTANCE/CONTEXT, routing via `kompas-team-map` (bez listowania agentów/goals).

**Granice**: nie implementuje kodu, nie deployuje.

**Wiki**: [[wiki/entities/paperclip-organizacja]], [[wiki/concepts/definition-of-done]].
