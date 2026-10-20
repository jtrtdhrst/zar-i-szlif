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
