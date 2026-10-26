# `mcp/comfyui/` — ComfyUI + comfyui-mcp deployment (CPU)

Production: ComfyUI 0.42.1 (CPU-only) + `comfyui-mcp` 0.52.206, plain Docker on host
(`coolify` network), Caddy reverse-proxy, Cloudflare Worker edge. This folder is
the durable deployable unit (mirrors `/opt/comfy` on the host).

- `Dockerfile.comfyui` — python:3.12-slim, torch CPU, ComfyUI v0.42.1, `--cpu`.
- `Dockerfile.mcp` — node:22, `comfyui-mcp@0.52.206`, applies `patch-v1.mjs` at build.
- `compose.yml` — `comfyui` + `comfy-mcp` on external `coolify` network; sets
  `COMFYUI_URL=http://comfyui:8188` (fixes Prompt Director 127.0.0.1 bug).
- `patch-v1.mjs` — durable production patches (idempotent, applied at build + live):
  `upload_image data_base64` (remote clients, SHA-256, magic-byte check, 30MB cap),
  `train_doctor ready_for_training/diagnostic_completed` (no false success).
- `patch-color.mjs` — `color-analysis`: uniform fills report `FLAT, not washed out`
  (`washedOut:false`, measurements preserved).
- Public: UI `https://comfy.kompaszbiorek.pl/` (Caddy → `comfyui:8188`),
  MCP `https://mcp-comfy.kompaszbiorek.pl/mcp` (Worker `comfyui-mcp` → origin
  `https://comfy-engine.zariszlif.pl/mcp` → Caddy → `comfy-mcp:9100`).
  UI address unchanged; MCP URL unchanged (Worker takes over the same hostname).
- Volumes (persist across restart/recreate): `comfy-models`, `comfy-input`,
  `comfy-output`, `comfy-user`, `comfy-custom`. No models installed (CPU-only;
  local diffusion generation NOT_CONFIGURED; hosted ArkFal nodes via contract only).
- Manager/panel NOT installed (intentional): MCP already returns honest
  `FEATURE_UNAVAILABLE` for Manager snapshots and Apps (404 panel predates Apps);
  installing heavy deps on 93% disk risks production. Classified as justified
  unsupported (PA-24/26/27), not a defect blocking the primary workflow.
- Auth: origin currently OPEN (`--allow-unauthenticated-non-loopback`, owner decision
  2026-10-26). Worker supports `MCP_AUTH_TOKEN` (client→Worker) + `UPSTREAM_TOKEN`
  (Worker→origin); to lock down: set `COMFYUI_MCP_HTTP_TOKEN` on `comfy-mcp`
  (compose env) + same value as Worker `UPSTREAM_TOKEN` + client `MCP_AUTH_TOKEN`,
  then redeploy both. Secrets never enter the repo (Cloudflare secrets + host env).
- Rollback: host backups `/opt/comfy/compose.yml.bak-*`, `/data/caddy/Caddyfile.bak-*`,
  images `local/comfyui-cpu:0.42.1`, `local/comfyui-mcp:0.52.206`; restore compose/Caddy
  + `docker compose up -d` + DNS revert (Worker custom domain → DNS-only A).
- Codex-only (owner decision 2026-10-26): pipelines use ONLY Codex custom nodes
  (`ArkCodexLLM` model `gpt-6-luna` -> `ArkCodexImageGen` -> `SaveImage`).
  No ComfyUI.org / fal nodes. Auth resolves `CODEX_HOME` -> `~/.codex`;
  compose pins `CODEX_HOME=/app/user/.codex` (persistent volume; the
  container-layer `/root/.codex` copy is identical, SHA-verified, but lost on
  rebuild). Verified live: login ok, plan plus, token fresh (236h left),
  end-to-end run 47.30s -> 1254x1254 PNG via the same MCP URL.
- Verify: `get_system_stats(action:health)`, model-free `LoadImage→ImageScale→SaveImage`
  enqueue→history→`get_image(action:get)` SHA-256 match → `stage` → second pass;
  `upload_image data_base64` round-trip; `train_doctor` shows `ready_for_training:false`.
- GPT Image 2.5 (Luna 6 pipeline, 2026-10-26): nodes `ArkCodexLLM` (model
  `gpt-6-luna`) → `OpenAIGPTImageNodeV2` (model `gpt-image-2.5-flare`) → `SaveImage`
  already installed — NO new MCP tools needed (`create_workflow` validate,
  `enqueue_workflow`, `list_api_nodes schema`, `get_history`, `get_image` cover it).
  Reference FLAT-format workflow: `workflows/zar_szlif_luna6_gptimage25_api_20261026.json`
  (`"model": "<key>"` + `"model.<sub>"` flat keys; nested `model` dicts validate but cannot execute; Web-UI `widgets_values` alone fail validation too; the validator now mirrors the server 1:1). `create_workflow validate` = PASS.
  Blocker is ONLY auth: Codex login works (`/app/user/.codex/auth.json`,
  fallback `zar_szlif_luna6_codex_image_fallback_00001_.png` 1254×1254 rendered in
  47.36s); `OpenAIGPTImageNodeV2` is a ComfyUI partner node requiring ComfyUI.org
  login (`auth_token_comfy_org`/`api_key_comfy_org`, 401 otherwise) — owner logs the
  server into comfy.org, then re-run validate + enqueue. No paid run without approval.

- Image loop: mandatory 8-step Codex-only pipeline, parity rules, acceptance evidence: docs/comfy-image-loop.md. Brand contract: mcp/comfyui/brand/ (PNG refs live in input/brand/ on the volume).
- Canvas bridge (`mcp/comfyui/canvas-bridge/`): the MCP can read the OPEN tab — node 1 filename + pixels — via the pack's shipped browser bridge, whose server half was missing (every POST 404'd). `comfy_bridge.py` implements exactly the JS protocol behind `from .mcp_service.comfy_bridge import register_routes` (register/heartbeat+queued read/ack/disconnect/connection-status + agent read/result/sessions). No new MCP tools, no Manager, no panel install: agent enqueues `read`, next tab heartbeat returns the snapshot, node 1 filename → existing `get_image` downloads byte-identical pixels (E2E 13/13 live, `scripts/check-canvas-bridge.py`). Restore: re-copy the two files + `docker restart comfyui` (see `patches/apply.sh`).
