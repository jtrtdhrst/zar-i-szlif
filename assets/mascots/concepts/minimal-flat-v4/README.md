# Minimal-flat V4 — mascot direction set (Żar i Szlif)

Working directory for the three-art-direction exploration that replaces the rejected V3 art
(see KOMAA-1094, review document `visual-rejection-v3`).

## Layout

- `directions/*.svg` — one editable, semantic, flat-vector source per direction
  (`iskra-a|b|c`, `szlif-a|b|c`). No raster, filters, gradients or scripts; every shape is a
  named `<path id="character-direction-part">` so it stays editable in any vector tool.
- `masters/` — the two selected masters (populated after direction selection).
- `scenes/` — paired interaction vignettes (fox proposes, raven evaluates).
- `render.mjs` — deterministic renderer: SVG → PNG at 512/128/64/32, pure-black silhouette
  renders at 64/32, white/dark/camp-scene background renders at 128/64, plus labelled
  contact sheets and `exports/manifest.json` (SHA256 of every source and export).
- `exports/` — generated PNGs, contact sheets and the manifest. Regenerate, never hand-edit.

## Reproduce

```bash
cd assets/mascots/concepts/minimal-flat-v4
npm i @resvg/resvg-js@2.6.2 pngjs   # renderer deps
node render.mjs
```

Requires no system fonts (labels use a built-in 3×5 bitmap font) and no browser.

## Palette

| role | Iskra | Szlif |
| --- | --- | --- |
| primary | `#E2702D` | `#232833` |
| secondary | `#B94F1D` | `#3C4757` |
| light | `#F7E8D3` | `#D7DCE3` |
| accent | `#2BB8A6` (tilted scarf) | `#E2A03F` (bill, feet) |
| ink | `#2B2A33` | `#232833` |

Shared `ink` + shared `accent` keep the two characters in one family; hue is not the
differentiator — silhouette and gesture are.

## Status

Directions are **candidates under review**, not approved brand art. Approval is a separate
independent gate (CMO/CEO art verdict on exact commit SHA + contact sheet), followed by a
separate technical UI-QA gate and an owner-visibility check on the real Penpot team
(KOMAA-1093). Nothing here is a release.
