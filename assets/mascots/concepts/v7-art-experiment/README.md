# Żar i Szlif — V7 exploratory native-vector direction

**STATUS: EXPERIMENTAL DESIGN CANDIDATE. NOT RELEASED, NOT OWNER-APPROVED, NOT IMPORTED INTO OWNER PENPOT.**

This branch contains a non-destructive new native SVG art direction based on review of the real V6 master contact sheet. V6 in PR #61 remains unchanged.

- `masters/iskra-master.svg` — 21 semantic vector paths, 5 flat colors; compact integrated paws, clearer body, shorter asymmetrical scarf, smaller eye marks and a joined sweeping tail.
- `masters/szlif-master.svg` — 21 semantic vector paths, 5 flat colors; compact beak, restrained crest, simplified wing and two grounded feet.
- Both are source SVGs with paths, not image wrappers, screenshots, or rasterized facsimiles.
- Independent local raster evaluation generated actual 512, 128, 64 and 32 pixel PNGs, verified exactly one connected opaque silhouette for each character at every size. Their combined paired composition currently exists as a local exploration but is **not** yet committed here or Penpot-approved.

**Visual comparison:** V6 source art is pinned at `9b6665cc6620e4e20cdef1567998e9af7e6d8816` in existing PR #61. CMO/owner must judge the new V7 experiment and give real visual changes/approval before this becomes a master. Do not merge/deploy by virtue of art-shape/PNG tests.

**Outstanding production dependency:** Paperclip KOMAA-1093 cannot access original owner Penpot team `fa45bb82-5782-8177-8008-cb89bd5343d6` (HTTP 404 with connected staging principal). Existing pending Board authorization and independent QA remain intact. Don't copy the work into another team and call that user delivery.

## Deterministic pair assembly (no separate app renderer)

The committed `compose-v7.mjs` reads the two master SVG files plus `props/ground.svg`, validates the 21-path / 5-color single-character budgets, preserves the original editable vector paths with unique names and outputs `scenes/iskra-szlif-vignette.svg` using 512×512 group transforms. Run:

```bash
node assets/mascots/concepts/v7-art-experiment/compose-v7.mjs
```

The output file is **generated**, not a second source-of-truth and not a production renderer. It is currently available as a local ChatGPT visual review artifact, not a version accepted in Penpot or released into the app. The two masters were independently rasterized and checked at 512, 128, 64 and 32 pixels: 21 native paths / five colors each, one connected opaque silhouette per size, zero embedded rasters. User-facing output is still **NOT RELEASED** until original-owner Penpot access, CMO/UI QA and aesthetic acceptance.
