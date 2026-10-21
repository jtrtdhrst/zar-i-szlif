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

## V6 anatomy rebuild (2026-10-21, this run)

The V5 art still carried the anatomy defects named in the review comment. This
run rebuilt both masters and recomposed the scene from them.

| Named defect (V5) | V6 fix in the source |
| --- | --- |
| Iskra body without articulated legs | `leg-near` / `leg-far` are thigh + bent knee + shin, each ending in a `sock-near` / `sock-far` cream sock; the torso ends in a rounded rump, so the legs read as legs and not as a hem |
| Iskra scarf read as a blob | `scarf` is a thick band across the neck, `scarf-knot` a bulky knot at the throat, `scarf-end` a wide ribbon flying out behind the head |
| Iskra fringe read as a facial stripe | `fringe-lock` is rooted on the crown, sweeps diagonally across the far eye and flicks out over the cheek; the far eye is drawn after the lock, so the eye stays readable |
| Szlif crest and tail poor | `crest-1..3` are slim feathers raked back over the nape; `tail` is a three-tip fan instead of the torn-paper sawtooth; `wing-primary-1..3` are wide separated primaries |
| Szlif legs poor | `leg-near` / `leg-far` are thicker with a visible knee bend, ending in `foot-near` / `foot-far` splayed toes |
| Szlif eye read as a googly white dot | `eye` is a small amber almond with an ink `pupil` and a slate `brow` ridge; the amber survives the dark/camp theme, so the eye is readable on the dark head and on the light-blue dark-theme head |

Three render / inspect / fix cycles were run against the real 512 px, 64 px and
32 px exports, not against the source geometry. `exports/iterations/` keeps the
real before/after rasters used as iteration proof: `before-*` is the
owner-rejected V5 anatomy, `iter1-after-*` the first V6 rebuild, `iter2-after-*`
the final V6 art.

## Known defects in this candidate (after the V6 rebuild)

* Iskra's head is still large relative to the body — a deliberate mascot
  proportion, but the body reads soft next to it; a reviewer may want a smaller
  head or a heavier chest.
* Iskra's scarf end is a wide ribbon but it does not flutter.
* Szlif's tail fan and the three wing primaries overlap into one dark mass at
  the lower back; the fan tips are clear at 64 px and merge at 32 px.
* At 32 px the fringe lock, the scarf knot and the toe separation are gone: the
  32 px read is "fox with a scarf" and "bird with a bill", not the full detail.
* Iskra direction B and direction C are exploration artifacts: B's head is oversized and
  C reads as an emblem rather than a character. Both are documented alternatives, **not**
  proposed as masters. Their concept pair scenes keep the concept-level art; the
  deliverable pair is `scenes/iskra-szlif-vignette.svg`, recomposed from the
  refined masters.
* Szlif direction C's crest plates still read slightly like antennae.
* The scene's ground shadow is a flat ellipse — scene dressing, not a character element.
* The scene file legitimately exceeds 22 paths / 5 colours because it composes two
  characters; the per-character masters stay inside the budget.
