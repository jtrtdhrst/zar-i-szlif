# Minimal-flat V4 — mascot direction set, master pair, vignette and optical-size sprites (Żar i Szlif)

Working directory for the mascot art that replaces the rejected V3 art
(see KOMAA-1094, review document `visual-rejection-v3`).

## Layout

- `directions/*.svg` — one editable, semantic, flat-vector source per direction
  (`iskra-a|b|c`, `szlif-a|b|c`). **The directions are the source of truth for the
  art**; the masters below are composed from `iskra-a` / `szlif-a`. No raster,
  filters, gradients or scripts; every shape is a named `<path id="character-part">`.
- `masters/` — the two selected masters, composed from the winning directions.
- `scenes/` — the paired interaction vignette (fox proposes, raven evaluates).
- `optical/` — **derived** optical-size views (see below). Generated, never hand-edited.
- `props/` — detached scene props (the ground shadow) composed into scenes.
- `compose.mjs` — deterministic placement of mascot SVGs (scale/translate/rotate),
  with a path keep-list (`@only=`) and an auto-fit crop (`--fit=N`).
- `optical.mjs` — the optical-size recipes. Composes each optical view from master
  paths and writes `optical/*.svg`.
- `render.mjs` — deterministic renderer: SVG → PNG at 512/128/64/32, pure-black
  silhouette renders at 64/32, white/dark/camp-scene background renders at 128/64,
  labelled contact sheets, a small-size proof sheet and `exports/manifest.json`.
- `verify.mjs` — the release gate: provenance, editability, transparency, clipping,
  connectedness, reproducibility and the negative tests.
- `exports/` — generated PNGs, contact sheets and the manifest. Regenerate, never hand-edit.

## Optical-size sprites (why 32 px is not "the 512 px picture, smaller")

A 512-unit illustration scaled to 32 px drops every detail below ~8 units: the
fringe lock, the scarf knot and the plan card all disappear, and a two-character
vignette becomes two tiny figures separated by air. So the small sizes are **not**
a downscale of the full art — they are rendered from a *derived optical view*:

| sprite | 128 / 512 | 64 / 32 |
| --- | --- | --- |
| `iskra-master` | full master | `optical/iskra-optical.svg` — head-and-shoulders crop |
| `szlif-master` | full master | full master (the raven's read is a body read: bill, crest, fanned tail) |
| `iskra-szlif-vignette` | full scene | `optical/iskra-szlif-optical-vignette.svg` — both faces in one frame |

The optical views are **not a second source of truth**: every one of them is
composed from the approved master paths by `compose.mjs`, and `render.mjs`
re-derives each file on every run and byte-compares it with the file on disk.
A missing or stale optical view fails the render closed — it never silently falls
back to the full art and claims a 32 px PASS.

`exports/manifest.json` records, for **every** exported PNG, the exact source
path and SHA256 that produced it (`sourceFile`, `sourceSha256`, `view`), plus the
optical view's own provenance (`derivedFrom` + SHAs of the masters it was built from).

## The three design languages (per character)

| # | language | construction rule | Iskra | Szlif |
| --- | --- | --- | --- | --- |
| A | soft-round / soft-angular | organic curves, tapered muzzle, no hard corners | `iskra-a` | `szlif-a` |
| B | angular editorial | faceted planes, straight edges, slit eyes, sharp scarf | `iskra-b` | `szlif-b` |
| C | reduced emblematic | circle/hexagon skull, triangle ears, one oversized signature shape | `iskra-c` | `szlif-c` |

They differ in **construction grammar**, not in pose or hue. Directions B and C are
documented alternatives, **not** proposed as masters: B keeps the older flat-scarf
construction and C the older emblematic one, and both are weaker than A. They are
kept in the set as the required three contrasting directions.

## Selected master pair

- `masters/iskra-master.svg` — direction A refined, 22 paths / 5 colours. Projecting
  muzzle, small almond eyes, an **ink lock of hair** that crosses the far eye and
  tapers below it, a **cowlick tuft** breaking the crown line, a tilted turquoise
  scarf with a bulky knot and a hanging end, a raised foreleg with a cream mitten
  holding a **turquoise plan card** (crisp tilted sheet with an ink spine), and a
  broad plume tail with a cream tip.
- `masters/szlif-master.svg` — direction A refined, 19 paths / 5 colours. Wedge head
  tilted down with a **short heavy bill and a down hook** (not a toucan bill), flat
  crown with three **broad raked-back crest feathers**, shaggy throat hackles,
  broad shoulders tapering to a narrow rump, a folded wing whose **stepped primary
  tips break the back outline**, an **open fanned tail**, a **small dark eye**,
  bent bird legs and a turquoise plan notebook gripped in a talon.
- `scenes/iskra-szlif-vignette.svg` — Iskra proposes with the raised mitten holding
  the plan card, Szlif leans in and evaluates, beak angled down at what she offers,
  notebook gripped in his talon. Composed from the two masters with `compose.mjs`.

## Reproduce

```bash
cd assets/mascots/concepts/minimal-flat-v4
npm i @resvg/resvg-js@2.6.2 pngjs   # renderer deps

# 1. masters (composed from the direction sources)
node compose.mjs masters/iskra-master.svg "0 0 512 512" \
  "--title=Iskra — master fox vector (direction A refined)" \
  "directions/iskra-a.svg:0,0,1"
node compose.mjs masters/szlif-master.svg "0 0 512 512" \
  "--title=Szlif — master raven vector (direction A refined, with plan notebook)" \
  "directions/szlif-a.svg:0,0,1"

# 2. the paired scene
node compose.mjs scenes/iskra-szlif-vignette.svg "0 0 512 512" \
  "--title=Iskra proposes, Szlif evaluates — paired interaction vignette" \
  "props/ground.svg:101,71,0.7" \
  "masters/szlif-master.svg:60,150,0.58,6,217,379" \
  "masters/iskra-master.svg:250,120,0.58,-4,383,381"

# 3. derived optical-size views, then the renders and the gate
node optical.mjs
node render.mjs
NODE_PATH=./node_modules node verify.mjs
```

Requires no system fonts (labels use a built-in 3×5 bitmap font) and no browser.
`compose.mjs` layer syntax: `<src>[@only=ids]:<tx>,<ty>,<scale>[,<deg>[,<px>,<py>]]` —
`deg` rotates the placed layer about the scene-space pivot `(px,py)`, `only` keeps
just the listed semantic path ids, and `--fit=N` crops the viewBox to the placed
geometry with N units of padding.

## Proof sheets

| sheet | what it shows |
| --- | --- |
| `exports/sheet-directions.png` | the six directions at 512/128/64/32 plus black silhouettes |
| `exports/sheet-backgrounds.png` | each direction on white / dark / camp-scene backgrounds |
| `exports/sheet-pair.png` | masters and scene at 512/128/64/32 + silhouette + camp |
| `exports/sheet-proof.png` | **the optical-size proof**: the exact 32 px and 64 px sprites next to their 8× / 4× nearest-neighbour zooms, labelled. The zoom is an inspection aid and is never presented as the result. |

Every sheet sizes each column to its own widest cell, so a 32 px sprite is not
padded out to the width of a 512 px column.

## Palette

| role | Iskra | Szlif |
| --- | --- | --- |
| primary | `#E2702D` | `#232833` |
| secondary | `#B94F1D` | `#3C4757` |
| light | `#F7E8D3` | `#D7DCE3` |
| accent | `#2BB8A6` (scarf, plan card) | `#E2A03F` (bill, feet) + `#2BB8A6` (notebook) |
| ink | `#2B2A33` (eyes, nose, fringe lock, cowlick) | `#232833` |

Shared `ink` + shared turquoise accent keep the two characters in one family; hue is not
the differentiator — silhouette and gesture are.

## What the gate checks (`verify.mjs`)

- every recorded source SHA still holds, and every export names the SVG it was
  actually rasterised from (`sourceFile` + `sourceSha256`);
- no raster, script, filter or gradient in any source; every shape is named;
- canonical art fits its own viewBox (nothing is cropped by the canvas);
- every sprite keeps a transparent background, has no clipped edge at 128 px and
  above, has no dust fragments and reads as one connected figure (or, for the
  vignette, keeps the pair together);
- the optical views exist, match their masters and are re-derivable;
- **negative tests**: a missing optical view and a stale optical view each make
  the renderer fail closed with a named error;
- a second render is byte-identical (the set is reproducible).

## Status

Directions and masters are **candidates under review**, not approved brand art. Approval is a
separate independent gate (CMO/CEO art verdict on exact commit SHA + contact sheet), followed
by a separate technical UI-QA gate and an owner-visibility check on the real Penpot team
(KOMAA-1093). Nothing here is a release. Production assets under `assets/mascots/style-2/`
are untouched.
