---
name: mascot-anatomy-qa
description: Critique full-size mascot renders for recognizable species, personality, silhouette, brand consistency, measurable geometry, and individually counted visible fingers or toes on nearest-neighbor crops. Use after every candidate render and before alpha export.
compatibility: opencode
metadata:
  workflow: mascot-generation
  stage: art-qa
---

# Mascot Art & Anatomy QA

## Evaluate independently from the prompt
Look at the **actual fetched pixels**, not the prompt or output filename. Judge:
1. **Species** — recognizable features, not generic cute rodent/canine when a marten is requested.
2. **Archetype & expression** — can a viewer infer the intended personality? Protect defining micro-expression and pose.
3. **Family style** — matte flat shapes, outline simplicity, coherent proportions, no gradient/fuzz/accidental clothes or props.
4. **Whole silhouette** — head, ears, hands, feet and tail inside canvas; natural attachments, no merged appendages or broken limb geometry.
5. **Readability** — inspect downscaled 64×64 rendition; silhouette and expression should still communicate.

## Count visible digits rigorously
- For **every limb requiring an explicit digit count**, create an individual left/right hand/foot crop and enlarge using nearest-neighbor 4–8×. Label anatomical sides unambiguously (character-left vs viewer-left).
- Count only actually visible, separable tips/lobes with readable gaps. Do not infer covered digits, invent counts or claim a pass from a low-resolution preview. When count is obscured, write `uncertain`, mark the mandatory condition not verified, and do not accept.
- Only apply the **current brief's** counts. Examples: fox may explicitly require 5 fingers and 5 toes per specified limb; raven may explicitly require 3 forward + 1 backward/side toe. Those counts do **not** become defaults for marten, wolf or other animals.
- If the character has no exact digit requirement, assess coherence and legibility instead of forcing an arbitrary count. Report observed counts if you can distinguish them, without turning them into unsupported acceptance targets.

## Compare geometry correctly
- Use authoritative **source** image, not a failed derivative. Normalize changes by source head/body dimensions and canvas scale. Use the *same semantic ROI* for both source and candidate.
- For example, requested ear shrinkage should compare ear height relative to head height, not raw pixels on mismatched images. Report measured ratios, method and uncertainty where a numeric target matters.
- Numeric targets in prompts are **not measured evidence**; measurements do not prove artistic quality or semantic identity.

## Output
Produce compact machine-readable findings: `art: PASS|FAIL|UNCERTAIN`, then a short list of failed criteria and evidence crop filenames **only when needed**. A failed existing trait is a regression even when another trait improved. If ART fails, return to `mascot-reference-director` or `mascot-e2e-recovery`; do not send a failed candidate to alpha export. Avoid unsubstantiated 10/10 ratings.
