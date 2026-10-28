---
name: mascot-alpha-export
description: Turn an artistically accepted opaque mascot on a flat background into a verified RGBA PNG using only deterministic, non-destructive background extraction, test composites, ComfyUI persistence, and exact-byte readback. Use only after art QA passes.
compatibility: opencode
metadata:
  workflow: mascot-generation
  stage: export
---

# Mascot Alpha Export & Readback

## Entry gate
Input must already be **ART PASS**. Never use alpha extraction to conceal bad anatomy or a bad pose. Generator transparency may be ignored by `ArkCodexImageGen`, so treat opaque black as a source format, not an RGBA deliverable.

## Deterministic alpha extraction
1. Read the exact source bytes and confirm expected canvas, opaque background and a genuinely solid edge. Keep a pristine copy; operate on mutable `.copy()` buffers. Establish border background color by measurement rather than assuming each black-ish pixel is background.
2. Flood-fill only **edge-connected** background, with a threshold calibrated to the actual image (historical starting threshold ~40, *not* a universal constant). Never globally erase all black pixels: eyes, paws, markings and outlines may be dark.
3. Verify the filled region is nonempty and connected to image border, and surviving RGB subject pixels are unchanged. Inspect subject tips, hair tufts, ears, whisker-like protrusions, fingers, toes, tail attachment and dark components touching background.
4. If the foreground and background cannot be separated confidently, **reject the extraction** and return to source generation with clearer edge separation. Do not manually paint back deleted bits, infer an interior component or hide losses with a morphological opening.
5. Inspect alpha boundary on **white / dark gray / magenta** composite previews. Check no black halo, transparent holes, bitten contours or missing parts. Antialiased edge alpha is allowed; preserve genuine colors.

## Persist and verify
1. Export canonical final RGBA PNG and opaque preview (no art edits).
2. Validate decoded `mode == RGBA`, alpha of all corners == 0, nonempty subject, no unintended disconnected specks, complete canvas silhouette. A low alpha count alone is insufficient: review all relevant boundary regions.
3. If persisting via ComfyUI, POST verified asset to `/upload/image` (or use a documented upload method), then graph `LoadImage` → `JoinImageWithAlpha` → `SaveImage` with **actual verified node input semantics**. LoadImage requires staged input; do not assume one image channel carries alpha correctly without readback.
4. Retrieve output from the exact `prompt_id` and exact history filename/subfolder; test the actual `/view` bytes if providing a link. Compare the **same final RGBA before and after lossless roundtrip** (e.g. `maxdiff == 0`), not original opaque RGB against alpha composite.
5. Produce `TECHNICAL: PASS|FAIL|UNCERTAIN` with source/final checksums and exact artifact locations. Public URL only if HTTP readback succeeds; otherwise provide an actual retrievable attachment.

## Prohibited
No hand-painted fingers or feet, clone stamps, AI mask patchwork, fringe repainting, local shape grafts, guesswork restoration of dark elements or changing artistic content under cover of 'cleanup'. Isolated speck cleanup is allowed only with evidence that the character itself is unchanged.
