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
- Kanon statusów wiedzy agentów (TARGET/PRODUCT, CURRENT/STATE, DELTA, UNAPPROVED): `shared/CONTEXT.md`.

## Paperclip MCP Wiki

Paperclip MCP udostępnia bezpieczny read/write path dla stron `wiki/**/*.md` przez
`paperclipWikiList`, `paperclipWikiSearch`, `paperclipWikiGetPage`,
`paperclipWikiGetMetadata`, `paperclipWikiProposeChange` i
`paperclipWikiApplyChange`.

- Odczyt: `List/Search → GetPage` (metadata można pobrać osobno).
- Przed edycją hash z `WikiList` traktuj wyłącznie jako wskazówkę. Zawsze użyj
  aktualnego hash zwróconego przez `WikiGetPage` lub `WikiGetMetadata`.
- Edycja: `GetPage → ProposeChange(expectedHash) → review → ApplyChange(expectedHash)`.
- `ApplyChange` nie może wymuszać zapisu. `WIKI_HASH_CONFLICT` oznacza zmianę
  równoległą i wymaga ponownego odczytu oraz nowej propozycji.
- Nie używaj narzędzi Wiki do `raw/`, plików runtime, skilli, sekretów,
  `AGENTS.md` ani ścieżek traversal. Szczegółowy kontrakt: [[wiki/concepts/paperclip-wiki-mcp]].
