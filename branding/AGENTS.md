# AGENTS.md — Żar i Szlif / Maskotki E2E

## Mission & completion contract

Deliver a **finished, verified mascot asset**, not a prompt, report, queue ID, or plausible preview. Default deliverables: accepted full-resolution **RGBA PNG**, opaque preview PNG, saved executable ComfyUI workflow (only if new or changed), a compact QA evidence sheet, and `manifest.json`. Respond in Polish to the user; use English in technical logs and the manifest.

**DONE** means: correct species and personality, visual consistency with the authoritative brand references, verified anatomy, complete silhouette, correct transparency, persisted/retrievable files, and an evidence-backed readback. A completed ComfyUI job is **not** an accepted asset. Never claim 10/10 or 100% without proof. If any mandatory check fails, status is `REJECTED` or `BLOCKED`, not `DONE`.

## Reusable agent skills (OpenCode v2)

Keep this `AGENTS.md` as the **short mandatory contract**. Detailed, task-specific procedures live in `.opencode/skills/<skill-id>/SKILL.md` and are loaded **on demand**, not all at once. Official OpenCode v2 supports this project-local directory and its native `skill` loader. When `skill` is unavailable in the active agent runtime, read the matching `SKILL.md` from disk; do not pretend it was loaded. ComfyUI MCP discovery and OpenCode skill loading are **separate capabilities**.

| Stage / trigger | Skill ID | Required action |
| --- | --- | --- |
| New mascot or targeted character refinement | `mascot-reference-director` | Verify source pixels; isolate identity, anatomy and style roles; compose one targeted prompt |
| Every image-generation run, graph validation or queue failure | `comfyui-arkcodex-runner` | Run actual ArkCodex workflow through MCP and fetch exact `prompt_id` output |
| Every new candidate before acceptance | `mascot-anatomy-qa` | Evaluate species, archetype and expression; count required visible digits on macros |
| Only after an ART PASS | `mascot-alpha-export` | Non-destructive alpha extraction, RGBA integrity, persistence and byte readback |
| Any repeated defect, failed execution, failed alpha or missing deliverable | `mascot-e2e-recovery` | Classify root cause, change strategy, enforce completion or an explicit real blocker |

**Execution rule:** select the minimum relevant skill(s) for the current stage; never load all five just to start a run. The rendering skill does not certify ART; art QA does not certify RGBA; alpha export does not repair bad anatomy. The recovery skill is activated only when needed. These skill files do not install models or enable new ComfyUI capabilities.

## Operating environment & tool contract

- Control ComfyUI through its connected MCP tools inside the agent's `execute` path, following the tool-discovery contract for the current runtime (`search({namespace:"comfy"})` where available). Discover actual tool schemas; do not invent actions or parameters.
- Known environment snapshot (2026-10-27): CPU server, no local diffusion weights; only `ArkCodexImageGen` (Codex / Image 2.5) is confirmed functional. Never silently switch models, promise local inpainting/upscaling, install unrequested models, or use local model-training workarounds.
- The node's `background:"transparent"` was observed to produce opaque RGB. Render against a solid black background; make and verify the alpha **after** the artistic candidate is accepted. Recheck if the actual node behavior changes.
- `LoadImage` can read staged inputs, not arbitrary outputs. Stage an output before using it as an image input.
- `get_image`'s `save_dir` points to the MCP host, not necessarily the agent's local filesystem. For local file bytes, use the verified server `/view` endpoint or a documented transfer tool. Do not claim a public download URL without a successful readback.
- Public `/view` base historically used: `https://comfy.kompaszbiorek.pl/view`. Treat access as **unverified per delivery**; test the exact resulting URL. Do not disclose tokens or expose unnecessary private assets.
- Do not rebuild the workflow graph when a known working template can be modified. Avoid creating duplicate asset pipelines.

## Source selection (before the first render)

1. Identify the exact requested character and its brief. Determine if this is a new character or refinement of an approved candidate.
2. Verify every reference **visually and by pixels**, not merely by its filename. Record the authoritative source's dimensions and hash. For an edit, the existing character is **PRIMARY**; style images are **STYLE ONLY**; real-species reference, when needed, is **ANATOMY ONLY**. Explicitly forbid style references from changing identity, pose, props, or frame scale.
3. New character: start from `zar-i-szlif/asset_universal_character_generation_20261027.json` (two brand-style references, `ArkCodexImageGen`, `SaveImage`). Refinement: start from the known five-node three-image variant `zar-i-szlif/asset_wolf_refinement_20261027.json` and change only the necessary inputs/prompt/output prefix.
4. For difficult anatomy with three available inputs, prefer **character source + real-animal anatomy + one authoritative style reference** over two redundant style images. Never assume an image is installed: check the live ComfyUI input inventory.

## Shortest working E2E loop

1. **Preflight only as needed.** Check server health/queue at the start of a batch, after failure, or when runtime changes; read the *named* workflow's `analyze`, then `get` if graph edits are needed. Avoid a full inventory/list on every candidate.
2. **Prepare one prompt.** Prioritize: (A) preserve identity and defining facial expression; (B) fix the specific failed anatomical traits; (C) preserve the flat matte brand style; (D) keep the full silhouette, black background and no unwanted props. Describe positive target anatomy; negative constraints supplement, not replace, it. Avoid excessive numerical micro-instructions that the model cannot reliably enforce.
3. **Build/validate.** Patch only needed image paths, prompt and output prefix. Validate the API graph before enqueue; save a **new** reusable workflow only when it materially differs from existing templates.
4. **Execute.** Enqueue once; retain the returned `prompt_id`. Check `queue.status(prompt_id)` and `get_history.list(prompt_id)`; use exact output names from that history, **never guess `_00002_` or rely on the latest run**. If execution fails, diagnose root cause before retrying; do not send the identical failed graph repeatedly.
5. **Critique BEFORE alpha.** Inspect full image at original scale, a 64×64 readability preview, and only relevant 4–8× nearest-neighbor crops. Record individual pass/fail findings. Reject a new defect even when a target defect was fixed.
6. **Iterate with a change in hypothesis.** For failed art checks, adjust a specific prompt/reference/composition strategy and generate a new candidate from the authoritative source, not from accumulating distorted descendants. Do not merely randomize a seed. After two unsuccessful corrective attempts on the same defect, change the reference strategy or source composition rather than repeating the same tactic. Continue until accepted or a real external blocker is identified; never disguise failure as completion.
7. **Finalize alpha only after visual acceptance.** Extract background using deterministic edge-connected flood fill of the flat background on a mutable image copy; protect internal dark components, check silhouette and anti-aliased fringes, and reject any cut-out that erases anatomy. **No hand-painted repairs.** Persist the RGBA result, retrieve the persisted bytes, and validate them again.
8. **Deliver files and evidence.** Supply exact filenames, subfolders, retrievable links or attached files, and a compact manifest. If the public `/view` URL is inaccessible, use another verified delivery route rather than promising it works.

## Art QA — per-character, not global folklore

- Confirm recognizable **species anatomy**, the personality/archetype, face/pose preserved as specified, coherent limbs, natural tail attachment, complete ears/feet/tail, clean contours and no unwanted props.
- At relevant crops enlarged with **nearest-neighbor 4–8×**, count **visible** fingers/toes separately for each left/right limb. Record exact count or `uncertain` where boundaries cannot be distinguished. Do not infer hidden digits or round counts. Reject when the brief requires a count that is not visible.
- Character-specific requirements apply **only to that character and brief**: e.g., fox may require 5 visible fingers/toes per specified limb; raven may require 3 forward + 1 back/side toes and a beak without holes. Do **not** impose fox/raven toe counts or raven wing-tail rules on a marten.
- Compare measurements against the **authoritative source**, never only against the immediately previous generation. Normalize differences to source body/head/canvas dimensions and define the same region-of-interest for both images. A prompt target (e.g. “ears 25% smaller”) is an intention, not measured proof.
- Use two independent gates: **ART** (anatomy, identity, personality, style and readability) and **TECHNICAL** (file integrity, background, alpha and persistence). Quantitative pixel tests alone never certify artistic quality.
- Only run expensive/macro inspections for relevant uncertain or mandated features; do not produce ceremonial crops of already-correct body parts.

## Alpha & persistence QA

- No manual anatomical pixel retouch, clone stamping, painted toe/ear/tail corrections, AI masked patchwork, or local shape transfers without explicit user permission. Simple deterministic background extraction and isolated speck cleanup are allowed **only if** they do not change the visible character.
- For edge flood-fill, operate on `.copy()`; assert that connected border background pixels became transparent while RGB of surviving subject pixels remains unchanged. Do not restore a lost dark subject component by guesswork; if connectivity makes segmentation ambiguous, reject this extraction strategy and regenerate a more separable source or use another safe deterministic segmentation method.
- Inspect white, charcoal and magenta composites for halos/fringe and accidental cuts. Check PNG mode `RGBA`, corner alpha 0, complete silhouette, nonempty subject, and expected alpha coverage. A `maxdiff=0` comparison is useful for **lossless save/reload of the same final RGBA file**; it is not a validity test between the original opaque image and a composited transparent image.
- When persistence uses `POST /upload/image` and `LoadImage`→`JoinImageWithAlpha`→`SaveImage`, verify node input types and roundtrip alpha, then fetch the **exact** output named by `get_history(prompt_id)`. Test public URL with an actual HTTP readback, not a constructed URL alone.

## Minimal evidence & handoff

The manifest records: `character`, `brief_version`, `source_refs` (filename + SHA256), `workflow`, `prompt_id`, `output_ref`, `art_checks`, `technical_checks`, `accepted`, `remaining_risks`, and the exact file paths. Include one contact sheet with close-ups only where they support a mandated count or a disputed detail. Do not create a multi-page report or additional administrative tasks.

When accepted: deliver the assets and a short factual Polish summary (what changed, what was tested, residual risk). When rejected/blocked: identify the precise failed criterion and the attempted alternative; never output a fake approved file or claim E2E success.
