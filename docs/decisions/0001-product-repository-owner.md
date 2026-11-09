---
title: Product repository boundary
status: accepted
date: 2026-11-09
---
# ADR 001: Product owns application-specific implementation and MCP

## Context
Two related repositories exist. The Product root README at GitHub SHA `98cd058155dbf4c268777246fc510324f98f7dc5` explicitly reserves application UI, product logic and application-specific MCP for Product. Harness owns standalone infrastructure services. User reaffirmed separate Product and Harness knowledge scopes on 2026-11-09.

## Decision
Product source and API implementation, product-specific MCP, business data contracts and user-facing product experiences belong to `miloszspyrka-code/zar-i-szlif`, not to `harness-zar-i-szlif`. Cross-repository dependency analysis must query both indexes.

## Consequences
Any Product contract change needs actual provider/consumer and deployment evidence, not a diagram-only match. Do not migrate general-purpose infrastructure MCP into Product.

## Evidence and scope
- Repo root `README.md` at Product Git SHA `98cd0581`.
- `docs/architecture/CURRENT-RUNTIME-2026-11-09.md`.
- Scope: `app/`, `product/`, `mcp/`, `ops/`, `tests/`.
