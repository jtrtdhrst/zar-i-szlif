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
- Verify: `get_system_stats(action:health)`, model-free `LoadImage→ImageScale→SaveImage`
  enqueue→history→`get_image(action:get)` SHA-256 match → `stage` → second pass;
  `upload_image data_base64` round-trip; `train_doctor` shows `ready_for_training:false`.
