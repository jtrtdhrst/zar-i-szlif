# Provenance — KOMAA-1010 STYLE_2_V0 delivery

## Penpot discovery (G0)

- `GetAgentEffectiveTools(agent, toolFilter=penpot)` returned **0 tools**:
  no Penpot MCP is installed/exposed in this runtime.
- No existing mascot/Penpot assets found in the worktree
  (`grep iskra|szlif|maskot` over `*.md`: no hits; no `assets/` dir existed).
- Per skill failure-routing: Penpot evidence belongs to the existing
  Harness/Environment root; Designer continued with the editable-SVG
  source workflow in the project repo. No duplicate product issue created
  (creation is denied by runtime policy).
- STYLE_2 = provisional Soft Geometry V2. No owner-approved reference
  pinned; no claim of owner approval is made anywhere in these artifacts.

## Sources (all original, hand-authored)

- `assets/mascots/style-2/iskra/source.svg` — semantic grouped SVG
- `assets/mascots/style-2/szlif/source.svg` — semantic grouped SVG
- `assets/mascots/style-2/silhouettes/{iskra,szlif}-{a,b,c}.svg` — black sketches
- No screenshots, no stock icons, no reference crops in deliverables.

## Renderer (repeatable invocation)

- `node scripts/mascots/render-style-2.mjs` — resolves `sharp` from
  `SHARP_DIR`, then `./node_modules`, then the repo root, and fails with a
  readable message when none of them has it. sharp 0.35.5.
- The `sharp` **devDependency declaration** is not in this commit: it belongs
  to the existing Engineer-owned issue **KOMAA-1011** (reproducible SVG→PNG
  asset pipeline and validator). Until that lands, run the renderer with
  `SHARP_DIR=<dir-with-node_modules/sharp>` or after `npm i -D sharp`.
- Outputs: `exports/export-{512,256,128,64,32}.png` per character,
  `contact-sheet.png` (rows 256/128/64/32), `silhouettes/sheet.png` (3x2),
  `silhouettes/png/*-{256,128,64,32}.png`, `manifest.json` (SHA256, dimensions,
  RGBA alpha, transparent-corner + opaque-fraction checks, connected-component
  counts, and the SHA256 of all 8 editable SVG sources).
- Build gates (exit non-zero): transparent-corner violation, a master export
  that splits into more than one connected piece, a silhouette that splits at
  256 px, missing sharp.
- Branch: `KOMAA-1010`. Delivered commit SHA is posted on the issue thread.

## Review state

- Designer self-QA: PASS (`qa.json`); independent UI QA review: PENDING.
- Polish strings untouched: "Iskra", "Szlif", "Żar i Szlif" preserved.
