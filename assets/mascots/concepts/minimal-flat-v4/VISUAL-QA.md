# Visual QA Controller — Penpot mascot pipeline

## Implemented
- Stable local npm deps (no broken /tmp symlink); deterministic render/verify of 9 SVG source files to 512/128/64/32 PNGs.
- Real-pixel dark-mode contrast audit; optical preview raven colors corrected without modifying editable canonical SVG artwork.
- Authenticated CDP screenshot capture adapter checks the original owner Penpot team and refuses sign-in redirects or alternate-team sessions.
- Multimodal critique adapter binds exact PNG bytes, model invocation ID, candidate Git SHA, seven scored art criteria and actionable defects.
- Release controller cross-checks real Penpot exports, image sha256, Pixelmatch, native editability, team identity, VLM critique, two actual before/after image iterations and independent CMO/UI QA plus owner approval.
- Test suite includes real PNG readbacks and negative/mock adapter tests. Mock PASS is never treated as production acceptance.

## Commands
Run from assets/mascots/concepts/minimal-flat-v4:
npm ci
npm run qa:technical    # reproduce exports, source checks, tests
npm run contrast        # inspect 64px true pixels on dark background
npm run qa:release      # deliberately fail-closed until true external evidence exists

## Authenticated Penpot capture
Requires an owner-authenticated remote Chromium CDP browser session, via PENPOT_BROWSER_CDP_URL.
node penpot-capture.mjs <real-penpot-file-url> <file-id> exports/penpot-owner-capture.png
Do not use alternate team / login screenshots. Real team must be fa45bb82-5782-8177-8008-cb89bd5343d6.
Direct Penpot RPC for this owner team currently returns 404; the alternate staging team fa45bb82-5782-8177-8008-cb9105f337f9 works but is NOT acceptable for owner access. Recovery belongs to KOMAA-1093.

## Vision provider
Require injected VISION_API_BASE, VISION_API_KEY and VISION_MODEL (OpenAI-compatible multimodal endpoint); never hardcode keys.
node vision-review.mjs exports/penpot-owner-capture.png <40-hex-git-sha> exports/vision-review.json
Model verdict is only visual critique, not first-class CMO or UI QA approval. Resolve all defects and run at least 2 genuine changed-image passes.

## Verified negative baseline 2026-10-21
Actual paired-image and optical-sheet inspection: Iskra has ambiguous undifferentiated torso, no visibly articulated seated legs and oversized hanging scarf; Szlif has an oversized crest, very long tail and thin legs; at 32px facial features and pair readability degrade. Both need actual shape redesign, not SVG validity claims.
Dark 64px Szlif measured 83.84% opaque pixels below 2:1 contrast before optical preview correction; after correction 1.53%. Canonical vector art is unchanged and owner-rejected art remains NOT RELEASEABLE.

## Release integrity
Do not call technical tests E2E art approval. Release requires confirmed real original-owner Penpot file/page/native shapes, actual screenshot+export pixels tied to candidate Git SHA, live Vision report, genuine CMO and UI QA native decisions, and owner's aesthetic decision.
Otherwise return BLOCKED and exact failed codes. Preserve existing DAG KOMAA-1093 + KOMAA-1094 -> KOMAA-1095 -> KOMAA-1100; keep independent KOMAA-1146 renderer dependency.
