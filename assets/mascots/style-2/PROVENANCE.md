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

- Canonical committed renderer: `npm run mascots` -> `scripts/mascots/export.mjs`
  (`@resvg/resvg-js` + `pngjs`, both committed devDependencies — no ephemeral
  tool dir, no host-specific path, nothing to install by hand).
- It produces **every** PNG in this tree, so nothing shipped here is an
  unverifiable copy: character exports, character contact sheets, the set pair
  sheet, the silhouette exports and the silhouette sheet.
- Outputs: `<character>/exports/export-{512,256,128,64,32}.png`,
  `<character>/exports/contact-sheet.png`, `<character>/exports/manifest.json`,
  `manifest.json` (set index: character + silhouette source hashes, export
  hashes, per-character manifest hash), `contact-sheet.png` (pair sheet),
  `silhouettes/png/*-{512,256,128,64,32}.png`, `silhouettes/sheet.png`.
- The original sharp-based renderer (KOMAA-1010 branch only, never committed,
  `Cannot find module 'sharp'`) is superseded by the command above, which is the
  only renderer in the tree.
- Branch: `KOMAA-1010` delivered the masters; this branch (`KOMAA-1011`) is the
  generator branch that renders them.

## Review state

- Designer self-QA: PASS (`qa.json`); independent UI QA on the art: **CHANGES**
  (KOMAA-1010, candidate `fc241a6`) — art items F1/F2/C3/C4 are the Designer's.
  The pipeline item F3 (a renderer that could not run) is fixed on this branch:
  the committed command above renders every PNG. C1/C2 (32px silhouette exports,
  source SVGs hashed in the manifest) are satisfied here by the pipeline; the
  Designer's own manifest/script remain theirs on KOMAA-1010.
- Polish strings untouched: "Iskra", "Szlif", "Żar i Szlif" preserved.
