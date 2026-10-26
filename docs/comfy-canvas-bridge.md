# Canvas bridge: MCP reads the open tab (`/arkennemasis/mcp/*`)

Status: deployed and E2E-verified 2026-10-26. No new MCP tools were added.

## Problem

The MCP could download any image by filename (`get_image`), but had no way to
know *which* image is on the current canvas (node 1). ComfyUI keeps the open
graph only in the browser tab — the server never sees it. The pack already
shipped the browser half (`web/mcp/bridge.js`: Share-canvas toggle, canvas
snapshot incl. per-node widget values, heartbeat command queue, ack channel),
but the server half did not exist: every POST to `/arkennemasis/mcp/browser/*`
was a 404, so the badge stayed `not shared` and `Connection: unavailable`.

## Fix

`mcp/comfyui/canvas-bridge/comfy_bridge.py` implements exactly the protocol the
shipped JS speaks (verified against `web/mcp/bridge.js` line by line), loaded
through the hook the pack already tries at startup
(`from .mcp_service.comfy_bridge import register_routes`):

- `POST .../browser/register` → `{session_id, session_secret}`
- `POST .../browser/heartbeat` → `{commands: [...]}` (queued reads; unknown
  session → `unknown_session`, which is what makes the tab reconnect)
- `POST .../browser/ack` → stores the snapshot result under `request_id`
- `POST .../browser/disconnect` → drops the session (idempotent)
- `POST .../browser/connection-status` → `online` (≥1 live tab) or `waiting`
- Agent side: `POST .../agent/read` (defaults to most-recently-seen tab) and
  `GET .../agent/result?request_id=`, `GET .../agent/sessions`

Read loop: agent enqueues `read` → next tab heartbeat (≤15 s) executes the
in-browser snapshot → ack carries the full graph incl. node widget values →
agent extracts node 1's image filename → existing MCP `get_image` downloads
byte-identical pixels (`scripts/check-canvas-bridge.py`, 13/13 PASS live).

## Deliberately NOT built

- No verdict/text plumbing beyond canvas snapshots (Snapshots already carry
  what the loop needs; strings stay out of scope).
- No `setup`/`oauth` server routes (different flows, not needed here).
- No auth tokens on the new endpoints — same posture as the open ComfyUI UI
  and the open MCP itself. `shortcut: add a shared token on the agent
  endpoints when MCP gets tokens.`
- No fork of the pack, no ComfyUI core changes, no Manager install required.
  Single `docker restart comfyui` loads it (custom_nodes import at startup).

## Operate

- Share: open the ComfyUI tab, click **Share canvas** (badge → `canvas shared`,
  `Connection: online`). Stop sharing / close tab disconnects (TTL 60 s reaps).
- Restore after volume loss: files live in the persistent `comfy-custom`
  volume; re-copy from this folder and restart ComfyUI (see
  `/opt/comfy/patches/apply.sh`).
- Regression: `python3 scripts/check-canvas-bridge.py [COMFY_BASE=... MCP_BASE=...]`.
