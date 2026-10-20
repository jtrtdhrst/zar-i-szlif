# Żar i Szlif — mascot Minimal Flat V3 (DESIGN CANDIDATE)

**Original, unapproved visual redesign.** This does not replace current STYLE_2 assets or authorize deployment.

## Assets and checks
- [iskra.svg](iskra.svg): 20 semantic editable vector shapes, 5 colors; asymmetrical fringe, waving paw, integrated tail and scarf.
- [szlif.svg](szlif.svg): 19 semantic editable vector shapes, 5 colors; crest, hooked beak, tiny eye, notebook.
- Transparent 512×512 SVGs; no embedded raster, gradients or scripts.
- Validate using `node assets/mascots/concepts/minimal-flat-v3/validate.mjs`.

## Penpot source and access discrepancy
- Penpot file: `6769b9bc-1b9c-81d1-8008-d1c8a66be27f`
- MCP token team: `fa45bb82-5782-8177-8008-cb9105f337f9`
- Owner's dashboard team: `fa45bb82-5782-8177-8008-cb89bd5343d6`
- Accessing owner's team using the configured Penpot MCP returned HTTP 404. Owner visibility is **not verified**; correct the team/instance/token mismatch without disclosing credentials.
- Current accessible-team editor link: https://penpot.kompaszbiorek.pl/#/workspace?team-id=fa45bb82-5782-8177-8008-cb9105f337f9&file-id=6769b9bc-1b9c-81d1-8008-d1c8a66be27f&page-id=6769b9bc-1b9c-81d1-8008-d1c8a66be280

## Definition of Done before app integration
1. Owner opens the editable Penpot master in the intended team; Designer and UI QA have executable Penpot MCP tools.
2. Independent visual readback at 512/128/64/32 and side-by-side comparison to the actual approved STYLE_2 reference. No detached parts, no illegible faces, no clipping.
3. 5 flat colors per character, <=22 editable elements, alpha-safe exports, SHA-256 manifest and one deterministic build process.
4. UI QA verifies pixels/structure; CMO or CEO reviews visual direction; CTO reviews code. Structural PASS is **not** artistic PASS.
5. After approval migrate into the existing canonical mascot pipeline, without a second production source of truth.

Responsibilities: Designer art, UI QA visual verification, Harness Penpot/MCP team access, Engineer exporter, CTO integration. No final style approval is claimed.

## V4 alternatives — independently editable source, NOT approved

- [iskra-alternative-v4.svg](iskra-alternative-v4.svg) — 20 original paths, 5 functional flat fills. Longer projected fox muzzle, larger swept tail on opposite side, different ear/fringe articulation and waving paw; materially different geometry, not a recolor.
- [szlif-alternative-v4.svg](szlif-alternative-v4.svg) — 19 original paths, 5 fills. Crest/beak/wing redesigned and eye shifted; bird silhouette still subject to independent raven-recognition and personality review.
- The same sources have been imported through native Penpot shape writes into the existing V3 file, separately on page `40000000-2026-4000-8000-000000000001`. Authoritative snapshot readback: revn 7; 20 fox + 19 raven individually editable paths; user-team visibility remains **unverified**.
- V4 Penpot: https://penpot.kompaszbiorek.pl/#/workspace?team-id=fa45bb82-5782-8177-8008-cb9105f337f9&file-id=6769b9bc-1b9c-81d1-8008-d1c8a66be27f&page-id=40000000-2026-4000-8000-000000000001
- Original V3 page remains unchanged, with version snapshots preserved.
- A local renderer pass over the exact V4 SVG path geometry at sizes 512/128/64/32 found **one connected 8-neighbor component** per character at every size, with transparent corners and no clipping. This proves geometry only, not beauty.

**CURRENT VISUAL DECISION: changes requested for V3; V4 is still a comparison candidate, not the finished answer.** Independent CMO/CEO art approval and user-team visibility both remain mandatory. Do not merge a technically compliant pair solely because it uses 19/20 parts. See Paperclip KOMAA-1094 `visual-rejection-v3` and the updated company skill for exact review criteria.
