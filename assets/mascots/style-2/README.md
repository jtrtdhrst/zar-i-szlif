# Mascots STYLE_2 — deterministic SVG → PNG pipeline

Canonical root: `assets/mascots/style-2/<character>/`. One source of truth per
character; no duplicate SSOT. Current `source.svg` masters are provisional
Engineer fixtures (`sourceId: engineer-fixture-v0`); Designer replaces them
with approved masters keeping `id`/`species`/`role`/`styleVersion` stable,
then re-runs the pipeline.

## Layout per character

- `source.svg` — editable master (grouped: tail/wing, body, head, facial-features, accessories)
- `character.json` — metadata (`id`, `species`, `role`, `styleVersion`, `palette`, …)
- `exports/export-{512,256,128,64,32}.png` — transparent renders (committed, reviewable)
- `exports/manifest.json` — source/output SHA256, renderer versions, per-size stats, bbox
- `exports/contact-sheet.png` — horizontal strip of the five sizes

## Install / run

```sh
npm install --include=dev   # NOTE: plain `npm install` skips devDeps when NODE_ENV=production
npm run mascots              # validate + render + verify all characters (exit 0 = PASS)
node scripts/mascots/export.mjs --character iskra   # single character
node --test tests/mascot-pipeline.test.mjs           # pipeline tests
```

The CLI validates `character.json` schema and rejects unsafe SVG input
(`<!ENTITY>`, `<script>`, `<foreignObject>`, event handlers, remote refs),
renders via `@resvg/resvg-js`, then verifies each PNG: exact dimensions,
transparent background, non-blank pixels, content fully inside the canvas
(clipping check), and records SHA256. Any failure — including a missing
output file — exits non-zero. Output is byte-reproducible across runs.
