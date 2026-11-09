---
title: Żar i Szlif — shared visual source of truth
type: concept
updated: 2026-10-29
owner: CPO
---

# Shared visual source (single reference for CPO + Mascot Designer)

This document is the ONE source of shared visual style and asset-manifest requirements. Each agent keeps only a short role-specific instruction, not duplicated mascot/world pipelines.

## Current brand
- Brand: **Żar i Szlif** (never old Iskra/Kompas name in new content).
- Flat, simple 2D Finch-like friendly geometry, 12–40 clear shapes per character, no gradients, outlines, furry/anime/Disney-style rendering, unnecessary gloss or textures.
- Each scene and asset uses a small harmonious flat-color palette, cream background where needed; provide *truly transparent* export for standalone artifacts and inspect alpha channel, rather than claiming a solid RGB background is transparent.
- Keep stable approved color palette, exact reference files and versions. If a legacy document says fox Iskra has turquoise scarf, that is OUTDATED.
- Every generation starts from the latest approved reference/asset version; do not silently redesign accepted characters or change other agent's specialist directives.
- Common result contract: real saved file (not text-only prompt), preview, path/asset id, resolution, format/alpha verified, content SHA-256 or equivalent provenance, reference/style version, visual acceptance status. Do not publish directly into Plasmic without separate approved UI design/implementation.

## Role split — non-overlapping
**CPO:** creates all NON-CHARACTER world assets personally via existing ComfyUI ArkCodex/Image workflow. Tents, campfire, locations, furniture, signs, activity boards, tools, props, decorative interface illustrations, scenery, backgrounds, blank-state scenes. Does NOT create animal mascots or edit interactive Plasmic components.

**Mascot Designer:** creates characters only: fox Żar, raven Szlif, approved animal avatar cast, poses and facial expressions. Mascot-specific style/anatomy/QA/alpha pipeline skills belong only to Mascot Designer.

**Shared tools:** the generic ComfyUI runner may be used by both agents. No copy-paste of specialist role instructions or duplicated specialist skills.

**Designer under CTO:** implements native editable Plasmic components, state and responsive layout using approved assets. **Mascot native review owner:** CPO independently reviews the exact character image and issues APPROVE or CHANGES_REQUESTED. **CMO:** supports brand review only if explicitly requested; does not replace CPO's owned native stage. No separate Release Manager agent. Product publication/integration is executed by the appropriate implementer after acceptance.

## Character-only reference for Mascot Designer (NOT instructions for CPO to render characters)
- Żar: fox; red scarf `#D62839`, closely spaced **two white stripes on both sides**, overlapping tips, small copper ring, symmetric round belly, 5 fingers; no blush/no clothing.
- Szlif: raven; black legs and symmetric four-toe feet, front-facing, symmetric wings, brown-underneath flat scout cap, clean nose/forehead, no extra dots.
- Both: matching relative height, 2 flat shadow tones max, small dot eyes with white highlights, no outlines or gradients.
- Never regenerate a mascot from world-asset instruction. The character specialist owns all mascot QA.

## Delivery
Per owner stand-down (2026-10-29 and reaffirmed 2026-11-02), all timed heartbeat routines, monitors and task watchdogs stay DISABLED unless explicitly re-enabled. Native issue assignment, review and dependency wakes are allowed for the particular authorized work; do not create new routine/watchdog. Visual review is not a substitute for real saved and inspectable artifacts. Preserve user-approved style. This wiki is canonical until superseded by a newer owner-approved revision; legacy `mcp/comfyui/brand/STYLE.v1.md` conflicts on name/scarf and must not override these current constraints.


## Canonical mascot appearance skill and tested pipeline (2026-11-02)

- The specialized, AI-facing source for character appearance is Paperclip skill `zar-i-szlif-mascot-appearance`, loaded on demand by **Mascot Designer** BEFORE reference direction, generation and QA. No other agent needs this role-specific skill. Keep the shared art guidelines in this Wiki and the detailed character-only constraints in the skill; avoid duplicating their entire contents in system prompts.
- Validated real route: CPO authored `KOMAA-1527` → delegated native prerequisite `KOMAA-1528` to Mascot Designer → Paperclip OpenCode runtime with `comfyui` MCP → verified four reference files → graph edges `LoadImage.image -> ArkCodexImageGen.image_1..image_4` → prompt_id → output with exact view_url/SHA256 → internal image QA → typed CPO review → `changes_requested` and same-task revision when rejected → formal approval → durable publication and external SHA/next-workflow reuse test → close parent.
- Never confuse `GetAgentSkillSet installed` with **skill actually loaded in the running agent**. The agent's own transcript must show a skill read, then a Character Appearance Brief that the generator uses. The original 2026-11-02 v1/v3 render happened before the appearance skill existed; it is NOT evidence that skill improved image quality.
- 2026-11-02 CPO independently **REJECTED** Kuna v3, opaque SHA `36abacae70f40f2d36453b8e911417fbfa386840954a89ed832749bb7ea5872d`, for *visible soft gradients and volumetric shading despite "flat" prompt* plus an overly humanoid upright body. v3 is a **negative regression example**, never an approved master, even though its 1254×1254 RGBA, sha and public HTTP readback passed.
- ART gate before final alpha: compare real cropped pixels to owner-provided Żar/Szlif reference images. Separate explicit PASS for uniform hard-edged color regions/no gradient, marten/correct species morphology, convincing non-humanoid four-limbed construction, personality/face, unwanted prop/garment absence, and 64px readability. FAIL/UNCERTAIN blocks candidate from native review; an agent's self-rated ART PASS is internal only.
- Review and publication are distinct. After CPO formal approval of the exact candidate digest, dependent native Paperclip issue **KOMAA-1531**, assigned to the same Mascot Designer and blocked on **KOMAA-1528**, publishes *those exact accepted bytes*, confirms external HTTP/content-type/size/SHA, and uses `stage_output_image_reference` (or documented equivalent) plus LoadImage smoke test to prove exact reuse. Only then parent Done.
- Shared skills-home caveat: OpenCode agents currently use `/paperclip/.claude/skills` shared directory. Per-agent skill sync was observed pruning another agent's links. Do not use per-agent sync as a routine action; validate the desired union across all 14 agents after skill operations and repair safely when needed. This is a known mitigation, not a permanent Paperclip Core fix.


## Production family package reconciliation (2026-11-02)

- Imported and inspected user-owned Library package `mascot-family-skill.zip` (SHA256 `505a48e9353d337513f508e8e56d161eae152639ff35d97ab064637a7019fa7b`, 10 files). **No second canonical style skill** was created: production appearance contract merged into `zar-i-szlif-mascot-appearance` r6 with adjacent `characters.yaml` v2, `DOD_PL.md`, `SOURCE_IMPORT.md`. Static tooling placed solely in `mascot-anatomy-qa` r4 as `qa/check_image.py` and `qa/make_lineup.py`. Detailed specs live in those versioned skill files; Wiki holds precedence and routing, not a duplicate 33KB style prompt.
- **Precedence:** locked CPO/user-approved identity and correctives → family contract and species geometry → real Żar/Szlif approved style pixels → species anatomy reference (never fur texture) → optional pose → generator taste. Source ZIP default "all upright bipeds" contradicts newer native CPO changes_requested for Kuna; latest CPO four-limbed mustelid correction takes precedence.
- Package images: Żar SHA `0ef5e535…d059c` and Szlif SHA `53e511a2…95094` match existing ComfyUI masters byte-for-byte. ZIP's Kuna image SHA `c7e1fdde…d6549b37` differs from already staged owner draft. It was preserved in Library `/mascot-family-skill/references/` but precise remote ComfyUI Input staging is not yet verified due `upload_chatgpt_image` parameter/schema mismatch. Never claim this distinct input loaded.
- **Fresh activation evidence:** native Paperclip skill test `KOMAA-1532`, run `30281220-f989-4d28-a721-0a8a97487b3b`, PASS with actual skill tool call, reads of characters.yaml + DOD_PL.md, ComfyUI read-only health/list-tools. OpenCode 1.19.3. Installed alone is not proof; this transcript is.
- **Actual v6 deterministic QA:** ran deployed `qa/check_image.py` in real ComfyUI container on SHA `be531ea917235150db418b02e43dd9ccbfc9965f1fc56c04e1e708457b12b7c6`. 1254² decoded RGBA corners alpha0, bbox [63,254,1230,979], margins L63/R23/T254/B274; **P0-05 FAIL** (R must ≥45), bottom-alpha baseline proxy y979 vs required planted-foot y1135..1185. CPO independently inspected pixels and rejected **P0-05 and P0-09** because soft gradients remain; native changes_requested, same KOMAA-1528 continues. No fake 92/90/90 score, no publication.
- Existing release graph: `KOMAA-1528` artist/refinement+native CPO review → blocked `KOMAA-1531` exact approved PNG publish/HTTP SHA/LoadImage reuse+native CPO review → parent `KOMAA-1527` done only after both. Separate family rollout `KOMAA-1538` assigned to CHO and blocked on `KOMAA-1527`, keeping Żar and Szlif approved masters protected. Neither task enables timed watchers or routines.
- Known remaining engineering risk: shared `/paperclip/.claude/skills` prune-to-exact behavior across agents after per-agent sync; last full union audit remains 120/120 installed (14 agents), but repeating destructive synchronization is NOT a safe passing resilience test. Permanent skill isolation/union-safe native fix is still pending. Runbooks may repair absent symlinks but never call that a Core fix.
