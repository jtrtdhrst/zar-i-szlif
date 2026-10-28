---
name: mascot-reference-director
description: Select and verify visual references, assign identity/style/anatomy roles, and prepare targeted Image 2.5 edit prompts for new or refined Żar i Szlif mascots. Use before generating or when a character drifts in species, expression, proportions, or style.
compatibility: opencode
metadata:
  workflow: mascot-generation
  stage: prepare
---

# Mascot Reference Director

## Outcome
A verified source set and **one targeted prompt** with explicitly assigned image roles. This skill does not generate images or certify the finished output.

## Route the task
1. Extract species, archetype, exact defining expression, allowed pose changes, visual style and explicit anatomical counts from the user's latest brief. Do not transfer requirements from unrelated characters.
2. Choose **NEW** when there is no approved candidate: use the existing 4-node universal workflow with Żar/Iskra and Szlif as style-only inputs.
3. Choose **REFINE** when preserving an existing character: use the verified 5-node, three-input edit workflow. Preferred input roles: `image_1 = existing character (PRIMARY identity, expression, pose)`, `image_2 = actual-species photo or anatomy reference (ANATOMY ONLY)`, `image_3 = one authoritative mascot (STYLE ONLY)`.
4. If no real-anatomy image is available, do not invent one or call a file authoritative by its name. Use available verified references, state the missing evidence, and make the best supported anatomy description.
5. Verify reference **pixels/visual contents**, image dimensions and actual ComfyUI input availability. Names such as `final` do not prove that an image is correct. Record hashes where available. For output-to-input reuse, stage first.

## Prompt composition (single edit, not a long shopping list)
- **Identity lock**: retain the defining facial expression, palette, identity and chosen gesture from `image_1`.
- **Targeted repair**: specify the 2–4 most important visual changes as positive outcomes (e.g. compact rounded marten ears, elongated mustelid muzzle, lower naturally tapered tail).
- **Reference isolation**: state explicitly that the real-animal photo transfers only anatomy; the style mascot transfers only flat matte geometry, not its species, wardrobe, gestures, frame or accessories.
- **Style & framing**: flat matte vector-like color blocks; full-body single subject, 1:1 canvas, opaque pure-black background, no text or props unless the brief requires them.
- **Guardrails**: no squirrel tail, no species confusion, no unrequested accessories, no new smiling face replacing a signature half-smile. Use negatives sparingly after positive descriptions.
- **Numeric change**: target only, not proof. Do not expect prompt percentages to be exactly obeyed.

## For ENTP marten / kuna refinement
Keep the sly closed-mouth asymmetrical half-smile, one raised brow and paw-at-chin *if present in the selected base*. Seek European pine marten morphology: small rounded-triangular ears, longer muzzle/torso, short sturdy legs, proportionate low tapered tail. Preserve playful intelligence, not generic happiness or villainy.

## Exit condition
The primary source is actually visible; all source files are available or consciously omitted; image roles are unambiguous; the prompt attacks a specific failure. Pass the resolved sources and prompt to `comfyui-arkcodex-runner`.
