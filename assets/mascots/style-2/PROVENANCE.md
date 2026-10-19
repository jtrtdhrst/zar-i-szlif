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
- The canonical renderer also enforces the **single-piece rule** from the
  Character Bible: a master and a silhouette sketch must each render as one
  connected component at **every exported size** (512/256/128/64/32). The check
  was ported from the Designer's sharp renderer (not in this tree) into
  `scripts/mascots/export.mjs` so the detached-ear / isolated-paw class
  (UI QA F1/F2) cannot recur in the PNGs that are actually shipped. Every export
  records its `connectedComponents` count and its `detachedParts` count in the
  manifest. A component smaller than 1 % of the largest one is treated as
  anti-aliasing noise, not a part (measured on the accepted art: real detached
  parts are ~60 % of the body, stray alpha islands are ~0.03 %).
- Branch: `KOMAA-1010` delivered the masters; this branch (`KOMAA-1011`) is the
  generator branch that renders them, and the accepted `KOMAA-1010` art
  (candidate `a9299fb`) is merged in here as the single source of truth.

## Review state

- Designer self-QA: PASS (`qa.json`); independent UI QA on the art: **PASS**
  (KOMAA-1010, candidate `a9299fb`, 2026-10-19) — F1, F2, C1, C2, C3 and C4
  independently closed.
- The pipeline item F3 (a renderer that could not run) is fixed on this
  branch: the committed command above renders every PNG, and CI fails the build
  if a committed asset differs from the pipeline output.
- Open art finding routed to the Designer: the `Iskra silhouette C` sketch
  leaves a ~2 unit gap between the head ellipse and the body, so the head
  renders as a second connected component at 256 px and 512 px. The gap is
  pre-existing (identical in `fc241a6` and `a9299fb`); the Designer's own
  renderer bridged it by anti-aliasing at 256 px. The art is the Designer's
  artifact and was not edited here. The Designer's in-flight correction (body
  top raised to `236`) was re-verified against this pipeline in an isolated
  copy: the whole set then passes the single-piece gate at every size.
- Polish strings untouched: "Iskra", "Szlif", "Żar i Szlif" preserved.
