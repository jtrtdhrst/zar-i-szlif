#!/bin/sh
# Create the Emailens bridge on the paperclip network without disconnecting a
# running instance; stop it explicitly before replacing a changed configuration.
# Persistent container (restart unless-stopped); the heavy MCP backend inside
# is killed after IDLE_SECONDS without traffic and respawned on demand.
# Internal only: no published ports.
# Usage: ensure-bridge.sh [idle_seconds]  (default 600)
set -eu
IDLE="${1:-600}"
IMAGE="local/emailens-mcp-bridge:0.10.0"
NAME="emailens-mcp-bridge-v2"
TOKEN_FILE="/root/.config/opencode/.emailens-bridge-token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi
docker build -f /home/opencode/projects/emailens-mcp/Dockerfile.bridge -t "$IMAGE" /home/opencode/projects/emailens-mcp
if docker inspect "$NAME" >/dev/null 2>&1; then
  RUNNING="$(docker inspect "$NAME" --format '{{.State.Running}}')"
  CURRENT_IMAGE="$(docker inspect "$NAME" --format '{{.Image}}')"
  BUILT_IMAGE="$(docker image inspect "$IMAGE" --format '{{.Id}}')"
  CURRENT_IDLE="$(docker inspect "$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -x "IDLE_SECONDS=$IDLE" || true)"
  if [ "$RUNNING" = true ]; then
    if [ "$CURRENT_IMAGE" = "$BUILT_IMAGE" ] && [ "$CURRENT_IDLE" = "IDLE_SECONDS=$IDLE" ]; then
      echo "$NAME already matches the requested image and idle timeout"
      exit 0
    fi
    echo "$NAME is running with a different configuration; stop it explicitly before replacement" >&2
    exit 1
  fi
  docker rm "$NAME" >/dev/null
fi
docker run -d --name "$NAME" \
  --network paperclip-net \
  --restart unless-stopped \
  --memory=512m --memory-swap=512m --cpus=1.0 --pids-limit=128 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  --read-only --tmpfs /tmp --tmpfs /run \
  -e "EMAILENS_BRIDGE_TOKEN=$(cat "$TOKEN_FILE")" \
  -e "IDLE_SECONDS=$IDLE" \
  "$IMAGE"
echo "bridge started idle=${IDLE}s id=$(docker inspect "$NAME" --format '{{.Id}}' | cut -c1-12)"
