#!/bin/bash
# Re-apply durable custom_nodes changes (volume-persisted, idempotent).
# Run after any manual volume restore: bash /opt/comfy/patches/apply.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMFY_CTN="${COMFY_CTN:-comfyui}"
run() { sudo -n docker cp "$HERE/$1" "$COMFY_CTN:/tmp/$1"; sudo -n docker exec "$COMFY_CTN" python3 "/tmp/$1" /app/custom_nodes/comfyui-arkennemasis/"$2"; }
putfile() { sudo -n docker exec "$COMFY_CTN" mkdir -p "/app/custom_nodes/comfyui-arkennemasis/$(dirname "$2")" && sudo -n docker cp "$HERE/$1" "$COMFY_CTN:/app/custom_nodes/comfyui-arkennemasis/$2"; }
run qc_reject_patch.py variation/qc.py
run llm_json_tolerant_patch.py codex_provider/llm.py
putfile canvas-bridge/__init__.py mcp_service/__init__.py
putfile canvas-bridge/comfy_bridge.py mcp_service/comfy_bridge.py
echo "custom_nodes changes applied (idempotent, safe to re-run)"
