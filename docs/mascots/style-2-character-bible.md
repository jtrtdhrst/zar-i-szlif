# STYLE_2_V0 Character Bible — Iskra & Szlif (provisional Soft Geometry V2)

Status: WORKING SPECIFICATION. Not owner-approved final style. STYLE_2 is a
provisional working profile until an exact owner reference is pinned.

## Shared grammar (family coherence)

- Canvas `viewBox="0 0 512 512"`, transparent background, no baked text/labels.
- Soft geometric construction: custom ellipses + hand-tuned paths, not stock
  circle-animals. Small expressive eyes, restrained mouths.
- Flat fills only. No gradients, no 3D, no offset shadows.
- Shared accents: turquoise `#2BB8A6` (Iskra scarf / Szlif notebook cover) and
  cream `#F7E8D3`/`#F4EFE3` light shapes. Same ink treatment, same eye scale.
- Silhouette must read as a single flat near-black (`#111111`) tone at 64px and 32px.

## Palette (5 functional groups + neutral white highlights)

| group | hex | use |
|---|---|---|
| ember orange | `#E2702D` | Iskra body/head/tail/ears |
| deep ember | `#B94F1D` | Iskra fringe, feet |
| cream | `#F7E8D3` | Iskra belly/muzzle/inner ear/tail tip/hand |
| turquoise | `#2BB8A6` | Iskra scarf, Szlif notebook (family tie) |
| deep turquoise | `#1E8A7D` | scarf knot/band shading |
| slate indigo | `#3A4668` | Szlif body/head/wings |
| deep slate | `#2C3550` | Szlif tuft/tail/grooves |
| steel | `#8FA3C4` | Szlif wing/belly grooves |
| ochre | `#D99A2B` | Szlif beak (distinct, readable on slate) |
| deep ochre | `#A96F1D` | beak ridge |
| ink | `#2B2A33` / `#23262E` | eyes/nose/mouth/lines |
| paper | `#F4EFE3` | notebook pages |
| white | `#FFFFFF` | eye highlights only |

## Iskra — fox NPC (reserved, never player-selectable)

Role: upbeat inventor / idea-starter. Polish name stays "Iskra".
Signature (all three required): asymmetric fringe (left spikes deeper/longer,
left ear larger), large integrated tail curling to viewer-left with cream tip,
tilted turquoise scarf (~8 deg) with knot + hanging end on viewer-right.
Proportions: head rx88/ry80 at cy178; torso rx82/ry105 at cy355; total height
~12–462. Right arm raised with cream hand (expressive gesture).
Geometry rules (enforced by the renderer, not just by eye):
- Every ear base vertex sits **inside** the head ellipse, so no ear can float
  free of the head; the left ear is the larger one and roots deepest.
- The raised right arm overlaps the torso by a real margin at its root and ends
  in a cream paw (`r=14`) centred on the arm tip, clear of the muzzle and head
  outline so the paw never merges with the face.
- The rendered character must be **one connected piece**: the renderer fails the
  build if an export splits into more than one connected component at any
  exported size.
Forbidden: symmetric fringe, detached/blob tail, straight scarf, infantile
oversized eyes (eye ry <= 14 at 512), floating ear or floating paw.

## Szlif — raven NPC (reserved, never player-selectable)

Role: calm analytic, subtle ironic expression. Polish name stays "Szlif".
Signature: distinct ochre wedge beak pointing viewer-right with ridge line,
three-spike head-feather tuft swept back-left, heavy-lidded single visible eye
(three-quarter pose) + ironic brow tick, fanned triple tail feathers, turquoise
notebook with plan-check glyph held under right wing stub.
Proportions: torso rx95/ry118 at cy300 (centre cx256); head rx82/ry75 at cy160
with its centre **offset +20 px right of the torso centre (cx276)**.
Three-quarter read (all three required, do not re-centre the head):
- head centre right of the torso centre, so the skull mass leans back-left;
- single visible eye right of the head centre (cx288) with the heavy lid and
  the ironic brow tick above it;
- ochre wedge beak rooted inside the head and projecting well past its right
  edge (tip x404), never centred on the face.
Forbidden: generic songbird beak, symmetric parrot look, second full eye
(breaks three-quarter read), centred beak, backpack/school clichés.

## Poses / expressions (from same masters, v0)

Baseline: front three-quarter standing/perched. v0 ships baseline only;
happy / thinking / confused variants reuse master landmarks in next iteration.

## Selection rationale

Iskra-A (upright herald, tail curl left) + Szlif-A (perched sentinel):
both upright, same eye line (~y160–196), complementary orange/slate masses,
shared turquoise accent at same height band (y300–350). Dynamic pounce (B)
and lecturer (B) poses reserved for pose-library iteration.

## Export profile

`source.svg` -> transparent PNG 512/256/128/64/32 via the one canonical
command `npm run mascots` -> `scripts/mascots/export.mjs` (`@resvg/resvg-js` +
`pngjs`, committed devDependencies; the earlier sharp-based renderer is not in
this tree). Manifest validates dimensions, RGBA alpha, transparent corners,
SHA256. Contact sheet pairs both characters at 256/128/64/32.

Silhouette sketches export at 256/128/64/32 (`silhouettes/png/<id>-<size>.png`)
so the "reads as a single flat near-black tone at 64px and 32px" rule is
testable, not asserted.

Manifest (`assets/mascots/style-2/manifest.json`) hashes **every** delivered
file, including the 8 editable SVG sources (2 masters + 6 silhouette sketches)
and the 2 `character.json` contracts, so the Engineer can verify the source
they consume against the manifest. The Engineer consumes `export-512.png` +
`character.json`; `source.svg` stays the editable source of truth.

The renderer fails (exit non-zero) on: transparent-corner violations, a master
or a silhouette that renders as more than one connected piece at any exported
size, and any missing output. Every export also records its
`connectedComponents` count and its `detachedParts` count in the manifest, so
a detached part is visible as data even where it is not a hard failure. A
component below 1 % of the largest one counts as anti-aliasing noise, not a
part.
