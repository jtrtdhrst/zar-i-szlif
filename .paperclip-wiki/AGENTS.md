# Kompas Zbiórek — LLM Wiki

## Purpose

This wiki is the durable knowledge layer for the Kompas Zbiórek product and its Paperclip agents.

## Source hierarchy

1. Current observable product/runtime state.
2. Explicit user product decisions.
3. Canonical Paperclip documents:
   - product-as-is
   - product-target
   - prd-coverage
   - workflow-control
4. Repository documentation and implementation evidence.
5. Historical issues, comments and audits.

Historical information must not overwrite newer verified state.

## Structure

- raw/ — raw imported source material
- wiki/sources/ — normalized source notes
- wiki/projects/ — project and initiative knowledge
- wiki/entities/ — durable entities, systems, integrations
- wiki/concepts/ — reusable domain concepts
- wiki/synthesis/ — cross-source synthesized knowledge
- wiki/index.md — navigation/index
- wiki/log.md — wiki maintenance log

## Rules

- Product output > orchestration.
- Do not invent missing product requirements.
- Separate AS-IS from TO-BE.
- Mark uncertain information explicitly.
- Prefer updating an existing durable page over creating duplicates.
- Do not store secrets, tokens, passwords or credentials.
- Do not treat issue status alone as proof of implementation.
- VERIFIED requires evidence.
- Never modify production systems from wiki maintenance.
