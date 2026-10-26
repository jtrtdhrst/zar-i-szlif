#!/bin/bash
# Re-apply durable custom_nodes patches (volume-persisted, idempotent).
# Run after any manual volume restore: bash /opt/comfy/patches/apply.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMFY_CTN="${COMFY_CTN:-comfyui}"
run() { sudo -n docker cp "$HERE/$1" "$COMFY_CTN:/tmp/$1"; sudo -n docker exec "$COMFY_CTN" python3 "/tmp/$1" /app/custom_nodes/comfyui-arkennemasis/"$2"; }
run qc_reject_patch.py variation/qc.py
run llm_json_tolerant_patch.py codex_provider/llm.py
echo "custom_nodes patches applied (idempotent, safe to re-run)"
