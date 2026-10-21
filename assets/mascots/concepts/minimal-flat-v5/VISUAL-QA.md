# V5 — Visual QA Controller (implementation and acceptance)

**State: technical QA ready; original-owner Penpot, live multimodal critique and independent art/owner review NOT complete. Candidate is NOT production-approved.**

## Reproduction

```sh
cd assets/mascots/concepts/minimal-flat-v5
npm ci --no-audit --no-fund
npm run qa:technical
npm run contrast
npm run qa:release
```

`qa:technical` runs the original editable SVG renderer, 512/256/128/64/32 PNGs, light/dark/camp backgrounds, black silhouettes, real phone and desktop mockups, 230 structural/provenance/negative checks and 41 Node tests (as of 2026-10-21).
`qa:release` is **supposed to fail** until real evidence from the correct Penpot team and independent reviewers is supplied. Do not modify this expected negative outcome to make CI green.

## Fixed failures

- Replaced dead /tmp/mrender/node_modules symlink with reproducible local package-lock and npm ci.
- The renderer now refuses to silently drop a required A/B/C direction, master or scene.
- All three raven directions use a high-contrast optical dark/camp preview treatment while keeping the canonical editable SVG unchanged.
- The phone dark and desktop camp contexts now render the same readable raven, rather than reusing an invisible dark sprite.
- Four real independently testable UI context PNGs are hashed in manifest.json (phone 375 light/dark, desktop light/camp).
- V5 comparison cannot silently skip rejected V4. Isolated verification copies the exact V4 negative baseline; missing baseline fails closed.
- Output reproducibility is checked for source sprites AND contact sheets/context panels, not sprites alone.
- Native-browser Penpot capture checks the authenticated session, actual file team via get-file RPC, file revision, page tree, path count, raster count and PNG bytes. A staging file cannot masquerade as owner-visible.
- Multimodal critique uses actual screenshot bytes and an explicit seven-metric scoring rubric, but is not equivalent to formal CMO/UI QA/owner approval.
- Release gate compares screenshot/export pixel hashes, Pixelmatch tolerance, native editability, two actual changed-image iterations, and claimed Git candidate SHA against local HEAD/commit/manifest provenance.

## Verifiable source and execution

Canonical original-owner team: fa45bb82-5782-8177-8008-cb89bd5343d6.
Current Penpot MCP principal only has staging team fa45bb82-5782-8177-8008-cb9105f337f9; owner team currently returns HTTP 404. Harness issue KOMAA-1093 owns credential/shared-team recovery. Never bypass ACL or promote staging file as owner-visible.

To capture a REAL screenshot, inject PENPOT_BROWSER_CDP_URL for an existing authorized CDP browser, then run:

```sh
node penpot-capture.mjs '<owner-visible-Penpot-file-URL>' '<owner-file-UUID>' exports/penpot-owner-capture.png
```

To obtain image critique, inject VISION_API_BASE, VISION_API_KEY and VISION_MODEL securely, then run:

```sh
node vision-review.mjs exports/penpot-owner-capture.png '<full-40-digit-candidate-commit>' exports/vision-report.json
```

**Tests use mock CDP and mock VLM servers for error contracts; this does not establish that remote browser/model accounts work.**

## Release contract

Release requires authentic original-owner native editable Penpot file, actual 512/128/64/32 exports and screenshot, bound SHA/image evidence, independent CMO first-class art review, independent UI QA, explicit owner approval on exact new candidate, canonical app integration, CTO approval and successful production CI.
Historic V4 SHA 2a09273490ebbe73fead95f09378057d67a903ec is owner-rejected; V5 is only a candidate. Pixelmatch and code tests never establish beauty.
Existing work ownership: Designer KOMAA-1094; Penpot access Harness KOMAA-1093; independent UI QA KOMAA-1095; app integration KOMAA-1100; preserve dependency KOMAA-1146.

## Live Penpot MCP staging roundtrip (2026-10-21)

- Source candidate Git SHA: `9b6665cc6620e4e20cdef1567998e9af7e6d8816`.
- **STAGING ONLY**, connected team `fa45bb82-5782-8177-8008-cb9105f337f9` (NOT original owner team).
- Project `6769b9bc-1b9c-81d1-8008-d07af8f5f6e6`, file `6769b9bc-1b9c-81d1-8008-d3045900550a`, page `6769b9bc-1b9c-81d1-8008-d30459009dff`.
- Parsed real V6 master SVG cubic paths and sent native path content through headless Penpot MCP. Readback verified **22 named Iskra + 22 named Szlif = 44 path shapes**, 5 functional fill colors per character, no image shapes and no raster fills.
- Penpot `update_shapes` changed **Iskra / scarf** `#2BB8A6 → #269C90`; server file snapshot rev3 independently confirmed the mutation. The shape was then restored to original `#2BB8A6`; readback at rev4 confirmed restoration and preserved all 44 paths.
- Immutable saved version snapshot `6769b9bc-1b9c-81d1-8008-d30569499d17` at rev4 preserves this native write/readback checkpoint.
- This is a real Penpot API/DB/editability test, NOT a screenshot or pixel-fidelity test of the Penpot editor, and NOT owner-visible delivery. Original owner-team access remains HTTP 404 (KOMAA-1093). The full release gate remains BLOCKED until authentic owner-team screenshot/export/model/reviews.
