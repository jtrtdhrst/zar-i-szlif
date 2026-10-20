# Minimal-flat V4 — mascot direction set, master pair and vignette (Żar i Szlif)

Working directory for the three-art-direction exploration that replaces the rejected V3 art
(see KOMAA-1094, review document `visual-rejection-v3`).

## Layout

- `directions/*.svg` — one editable, semantic, flat-vector source per direction
  (`iskra-a|b|c`, `szlif-a|b|c`). No raster, filters, gradients or scripts; every shape is a
  named `<path id="character-direction-part">` so it stays editable in any vector tool.
- `masters/` — the two selected masters, composed from the winning directions.
- `scenes/` — the paired interaction vignette (fox proposes, raven evaluates).
- `props/` — detached scene props (Szlif's plan notebook, the ground shadow) that are
  composed into masters/scenes, never rendered on their own.
- `compose.mjs` — deterministic affine placement of mascot SVGs (scale/translate/mirror),
  used to re-centre direction art into the master frame and to build the scene.
- `render.mjs` — deterministic renderer: SVG → PNG at 512/128/64/32, pure-black silhouette
  renders at 64/32, white/dark/camp-scene background renders at 128/64, plus labelled
  contact sheets and `exports/manifest.json` (SHA256 of every source and export).
- `exports/` — generated PNGs, contact sheets and the manifest. Regenerate, never hand-edit.

## The three design languages (per character)

| # | language | construction rule | Iskra | Szlif |
| --- | --- | --- | --- | --- |
| A | soft-round / soft-angular | organic curves, tapered muzzle, no hard corners | `iskra-a` | `szlif-a` |
| B | angular editorial | faceted planes, straight edges, slit eyes, sharp scarf | `iskra-b` | `szlif-b` |
| C | reduced emblematic | circle/hexagon skull, triangle ears, one oversized signature shape | `iskra-c` | `szlif-c` |

They differ in **construction grammar**, not in pose or hue: A is built from tapered organic
curves, B from straight-edged planes, C from a small set of large geometric primitives.

## Selected master pair

- `masters/iskra-master.svg` — direction A refined, 22 paths / 5 colours. Tilted turquoise
  scarf, asymmetric brow fringe, projecting snout, small almond eyes, tail integrated at
  the haunch, raised foreleg with an attached paw.
- `masters/szlif-master.svg` — direction A refined, 21 paths / 5 colours. Heavy wedge head,
  long down-hooked ochre bill with gape line, crest swept back along the crown, folded wing
  with stepped primary tips, fanned tail wedge, bent bird legs, and a turquoise plan notebook
  (family link to Iskra's scarf).
- `scenes/iskra-szlif-vignette.svg` — Iskra proposes with a raised paw, Szlif evaluates with
  the notebook. Composed from the two masters with `compose.mjs`, so the scene can never
  drift from the approved masters.

## Reproduce

```bash
cd assets/mascots/concepts/minimal-flat-v4
npm i @resvg/resvg-js@2.6.2 pngjs   # renderer deps
node compose.mjs masters/iskra-master.svg "0 0 512 512" \
  "--title=Iskra — master fox vector (direction A refined)" \
  "directions/iskra-a.svg:-55,16,1.05"
node compose.mjs masters/szlif-master.svg "0 0 512 512" \
  "--title=Szlif — master raven vector (direction A refined, with plan notebook)" \
  "directions/szlif-a.svg@szlif-a-branch:-44,-10,1.05" \
  "props/szlif-notebook.svg:-44,-10,1.05"
node compose.mjs scenes/iskra-szlif-vignette.svg "0 0 512 512" \
  "--title=Iskra proposes, Szlif evaluates — paired interaction vignette" \
  "props/ground.svg:0,0,1" \
  "masters/szlif-master.svg:-43,155,0.66" \
  "masters/iskra-master.svg:198,155,0.66"
node render.mjs
```

Requires no system fonts (labels use a built-in 3×5 bitmap font) and no browser.

## Palette

| role | Iskra | Szlif |
| --- | --- | --- |
| primary | `#E2702D` | `#232833` |
| secondary | `#B94F1D` | `#3C4757` |
| light | `#F7E8D3` | `#D7DCE3` |
| accent | `#2BB8A6` (tilted scarf) | `#E2A03F` (bill, feet) + `#2BB8A6` (notebook) |
| ink | `#2B2A33` | `#232833` |

Shared `ink` + shared turquoise accent keep the two characters in one family; hue is not the
differentiator — silhouette and gesture are.

## Status

Directions and masters are **candidates under review**, not approved brand art. Approval is a
separate independent gate (CMO/CEO art verdict on exact commit SHA + contact sheet), followed
by a separate technical UI-QA gate and an owner-visibility check on the real Penpot team
(KOMAA-1093). Nothing here is a release. Production assets under `assets/mascots/style-2/`
are untouched.
