# Product runtime — verified baseline (2026-11-09)

**Repo:** `miloszspyrka-code/zar-i-szlif`, GitHub `main` SHA: `98cd058155dbf4c268777246fc510324f98f7dc5` (GitHub verified on 2026-11-09).

## Confirmed live application release

- `https://panel.zariszlif.pl/healthz`: HTTP 200, body `ok`.
- `https://panel.zariszlif.pl/__release.json`: HTTP 200, reported `commit=98cd058155dbf4c268777246fc510324f98f7dc5`, `source=zar-i-szlif/main`.
- Coolify app `zar-i-szlif-web` UUID `k0vwdsjazxguvgmh4qixjgxn` is the deployed web application; its build source ref was reported as `ci-approved`. Check the current Coolify record and immutable digest before a release.
- This confirms **this web release only**. It does not prove that product-specific MCP, onboarding, business modules or any unfinished backlog item has passed E2E.

## Source boundaries

Product-specific UI, user domain logic, application web, schemas, content, user-facing MCP and product Workers belong to this repository. Standalone Hermes, Paperclip, Coolify, Opik, Hindsight, runner and general-purpose MCP services belong to `harness-zar-i-szlif`.

Observed root folders in the current repository snapshot: `app/`, `product/`, `content/`, `mcp/`, `registry/`, `ops/`, `tests/` and `www/`. Folder existence does **not** prove production deployment.

## Product history preserved

See [Paperclip Wiki source archive](../knowledge/PAPERCLIP-ARCHIVE-INDEX.md) for the original product PRD, onboarding, patrol/fundraising concepts, mascots, brand policies, privacy, Supabase and customer-facing MCP specification. These are historical source claims; verify currently merged implementation and deployed schema before use.

## Agent verification contract

1. Call Repowise `list_repos` and choose `product`; compare indexed SHA with the requested ref and deployed release.
2. For integration work, query `harness` too; verify real provider and consumer URLs, route registration, auth model and live image. Do not accept matching generic HTTP endpoints as proof.
3. Derive tests and impact from actual source, not from automatically generated prose.
4. Treat an unmerged PR, green CI or stale Paperclip Wiki page as **not deployed**.
5. Record missing evidence and separately classify implementation, review, release and live readback.

*Readback date 2026-11-09; this document must be refreshed after runtime change.*
