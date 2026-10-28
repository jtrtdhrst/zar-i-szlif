---
name: comfyui-arkcodex-runner
description: Execute and retrieve verified ArkCodexImageGen ComfyUI image jobs through MCP, using existing workflows, validation, queue status, exact prompt IDs, and readback. Use on every mascot render and on technical job failures.
compatibility: opencode
metadata:
  workflow: mascot-generation
  stage: render
---

# ComfyUI / ArkCodex Runner

## Non-negotiable runtime contract
- All ComfyUI operations go through the connected **ComfyUI MCP** inside the agent's `execute` environment, after the runtime's `search({namespace:"comfy"})` discovery where supported. Inspect the tool's live schema; do not guess request shapes or pretend a CLI/shell command acts on the same machine.
- Verified baseline (2026-10-27): **CPU, no local diffusion weights; only `ArkCodexImageGen` functional**. No silent fallback to FLUX, SDXL, local inpaint, upscaling, LoRA or downloads.
- `background:"transparent"` previously returned opaque pixels; render opaque pure black and handle alpha after art acceptance. Validate again only if the node's behavior has verifiably changed.
- Use saved workflows: new character → `zar-i-szlif/asset_universal_character_generation_20261027.json` (4 nodes); refinement → `zar-i-szlif/asset_wolf_refinement_20261027.json` (5 nodes, three image inputs). Change input paths, prompt, prefix, not the graph architecture without reason.

## Render transaction
1. If this is the first job in a batch or the server failed, `get_system_stats(action:health)` and inspect the queue. Otherwise skip redundant full health scans.
2. `get_workflow(action:analyze, filename:...)`; `get` when editing a graph. Confirm installed input images visually and by availability; **LoadImage reads input**, so stage existing outputs first.
3. Patch the graph: source input(s), prompt, output prefix. Keep 1:1, high quality and opaque background when supported by the live `ArkCodexImageGen` schema.
4. `create_workflow(action:validate, ...)` before enqueue; save (`save_workflow` `action:"save"`) only a materially reusable new/refined graph. Validate the **actual** graph you will submit, not a sibling template.
5. `enqueue_workflow` once and retain the returned `prompt_id`. Poll `queue(action:status, prompt_id:...)`; do not assume queued == executed or success == accepted.
6. `get_history(action:list, prompt_id:...)`. Extract output `filename`, `subfolder`, `type` from this exact history, then `get_image(action:get, filename:...)` to inspect. **Never infer the `_0000N_` counter or fetch 'latest'**.
7. When byte-level work is required, get it from a verified transfer route or exact `/view` URL; `get_image(save_dir)` writes on the MCP host, not necessarily the agent's local filesystem. The public endpoint is a historical possibility, not a guaranteed download URL.

## Failure handling
- If enqueue rejects graph, inspect actual validation messages and current node inputs. If a job runs but fails, use exact-job history/diagnostics and repair the identified cause, not identical retries.
- Do not cancel or clear other people's queued runs just to make this one faster.
- Return to calling agent: `prompt_id`, exact output ref or diagnosis, graph name, and whether a visually inspectable image was retrieved. Do **not** mark asset accepted.
