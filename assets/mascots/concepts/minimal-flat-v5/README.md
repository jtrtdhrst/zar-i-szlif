# Żar i Szlif — mascot art V5 (owner-rejection rework)

**Status: CANDIDATE — no art approval, no owner acceptance, no production migration.**

This set replaces the **rejected** V4 candidate (`2a09273490ebbe73fead95f09378057d67a903ec`).
The owner rejected V4 on its actual appearance: a monolithic orange fox torso, flipper-like
floating paws, a mask-like forehead stripe, an ambiguous plan card, and a penguin-adjacent
raven. V4 stays in `../minimal-flat-v4/` as the **negative visual baseline / technical
fixture** and is never shipped.

## What changed, and why

| Rubric defect in the rejected V4 | Fix in V5 |
| --- | --- |
| monolithic single-blob fox torso | compact upright torso with two clearly separated forelegs, a distinct planted sock and a distinct raised foreleg |
| floating cream circles instead of paws | one connected foreleg ending in a cream mitten that **grips** the plan sheet |
| forehead mask stripe | a rust lock **rooted on the crown**, sweeping diagonally **across the far eye** and tapering below it, plus a separate cowlick flick that breaks the silhouette |
| small unreadable plan card | a large turquoise plan sheet with ink lines, held up in the mitten |
| scarf as a bib bar | a band that wraps **under the chin and round the neck**, a bulky off-axis knot, a narrow flying end |
| duck/penguin raven | a heavy **straight** ochre bill with a down hook, a wedge head tilted down, three **broad** raked-back crest feathers, a shaggy throat hackle |
| weak wing and tail | a slate folded wing whose **stepped primary tips break the back outline**, a **wide open** fanned tail |
| stubby bird legs | long thin legs with splayed feet (three forward toes, one back) |
| two unrelated stickers | a composed scene: the fox presents the plan, the raven leans in with his bill aimed at it |

## Three directions per character (different construction grammars, not recolours)

| # | language | construction rule | Iskra | Szlif |
| --- | --- | --- | --- | --- |
| A | soft-round / soft-angular | organic curves, tapered muzzle, small eyes | `directions/iskra-a.svg` — **selected** | `directions/szlif-a.svg` — **selected** |
| B | angular editorial | faceted planes, straight edges, slit eyes | `directions/iskra-b.svg` — low prowling courier | `directions/szlif-b.svg` — hunched perched thinker |
| C | reduced emblematic | few large primitives, oversized signature shape | `directions/iskra-c.svg` — badge-like emblem with a disc tail | `directions/szlif-c.svg` — tall long-necked sentinel |

A/B/C differ in silhouette, proportion, pose and face language — not in hue.

## Selected pair and scene

* `masters/iskra-master.svg` — direction A, refined (22 paths / 5 colours).
* `masters/szlif-master.svg` — direction A, refined (18 paths / 5 colours).
* `scenes/iskra-szlif-vignette.svg` — composed **from the two masters** by `compose.mjs`
  (deterministic affine placement), so the scene can never drift from the masters.

```
node compose.mjs scenes/iskra-szlif-vignette.svg "0 0 512 512" \
  "props/ground.svg:97.5,178.6,0.62" \
  "masters/szlif-master.svg:-66,187.3,0.62,12,89,466.3" \
  "masters/iskra-master.svg:192,171.2,0.62"
```

## Reproduce the evidence

```
npm i @resvg/resvg-js@2.6.2 pngjs
NODE_PATH=./node_modules node render.mjs
```

`render.mjs` is deterministic: SVG → PNG (512/256/128/64/32), black silhouettes (64/32),
white / `#16202E` dark / `#22405C` camp composites, contact sheets, a 32/64 px proof sheet
with nearest-neighbour zooms, a **V4-rejected-vs-V5 comparison sheet at equal dimensions**,
a real 375 px phone + desktop light/dark/camp context sheet, and `exports/manifest.json`
with the SHA256 of every source and every export.

## Source budget

| source | paths | colours |
| --- | --- | --- |
| `directions/iskra-a.svg` | 22 | 5 |
| `directions/iskra-b.svg` | 21 | 5 |
| `directions/iskra-c.svg` | 18 | 5 |
| `directions/szlif-a.svg` | 18 | 5 |
| `directions/szlif-b.svg` | 18 | 5 |
| `directions/szlif-c.svg` | 17 | 5 |
| `masters/iskra-master.svg` | 22 | 5 |
| `masters/szlif-master.svg` | 18 | 5 |
| `scenes/iskra-szlif-vignette.svg` | 41 (two characters) | 10 (two characters) |

Every character shape is a named `<path id="character-part">`. No raster, gradients,
filters, scripts, external references or animation.

## Gates

* **ART_DIRECTOR_GATE** — open. Requires an independent CMO/CEO verdict on the exact
  candidate SHA after inspecting the real images. The Designer does not award this.
* **TECHNICAL_UI_QA_GATE** — open, independent (editable source, alpha, clipping,
  light/dark/camp fidelity, real 32/64 px).
* **OWNER_VISIBILITY_GATE** — open, owned by Harness (KOMAA-1093) for the original
  owner team in Penpot. Not satisfied by this repository set.
* **RELEASE_GATE** — open, CTO. `assets/mascots/style-2/` (production) is untouched.

## Known defects in this candidate

* Iskra's fringe lock crosses the far eye, but the lock is still a fairly upright
  brown band; a lower, more diagonal sweep would read as hair even more clearly.
* Iskra's scarf end is a simple ribbon; it does not yet flutter.
* Iskra direction B and direction C are exploration artifacts: B's head is oversized and
  C reads as an emblem rather than a character. Both are documented alternatives, **not**
  proposed as masters.
* Szlif direction C's crest plates still read slightly like antennae.
* The scene's ground shadow is a flat ellipse — scene dressing, not a character element.
* The scene file legitimately exceeds 22 paths / 5 colours because it composes two
  characters; the per-character masters stay inside the budget.
