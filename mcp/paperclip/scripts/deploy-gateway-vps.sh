#!/usr/bin/env bash
# VPS-only: merged source SHA -> immutable image -> clone live gateway -> health/readback.
# No host Docker socket is ever handed to an agent. Previous container is rollback.
set -euo pipefail
[[ $# -eq 2 && "$1" =~ ^[a-f0-9]{40}$ && "$2" == "sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104" ]] || { echo "REFUSED: source SHA and approved immutable artifact digest are required" >&2; exit 2; }
SHA="$1"; SHORT="$(printf '%s' "$SHA" | cut -c1-12)"
NAME="paperclip-mcp-gateway"
SOCKET="$(printenv PAPERCLIP_DOCKER_SOCKET || printf '/run/user/1001/docker.sock')"
REPO="$(printenv PAPERCLIP_RELEASE_REPO || true)"
[[ -S "$SOCKET" ]] || { echo 'REFUSED: rootless Docker socket unavailable' >&2; exit 2; }
dkr() { docker -H "unix://$SOCKET" "$@"; }
refuse() { echo "REFUSED: $*" >&2; exit 1; }
CONTAINER_REPO="/paperclip/repos/kompas-zbiorek"
if [[ -d "$REPO/.git" ]]; then
  GIT_MODE=host
elif dkr exec paperclip git -C "$CONTAINER_REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_MODE=paperclip
else
  refuse "trusted repository unavailable on VPS and in paperclip container"
fi
sourcegit() {
  if [[ "$GIT_MODE" == host ]]; then git -C "$REPO" "$@"
  else dkr exec paperclip git -C "$CONTAINER_REPO" "$@"; fi
}
SCRIPT="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d /dev/shm/paperclip-mcp-release.XXXXXXXX)"; chmod 700 "$TMP"
BACKUP="$NAME-rollback-$SHORT"; IMAGE="local/paperclip-mcp-gateway:sha-$SHORT"
PHASE=preflight; PREIMAGE=""
rollback() {
  case "$PHASE" in
    stopped) dkr start "$NAME" >/dev/null || echo "ROLLBACK_FAILED: could not start previous gateway" >&2 ;;
    renamed|new_started)
      dkr rm -f "$NAME" >/dev/null 2>&1 || true
      if dkr container inspect "$BACKUP" >/dev/null 2>&1; then
        dkr rename "$BACKUP" "$NAME"; dkr start "$NAME" >/dev/null
        [[ "$(dkr inspect "$NAME" --format '{{.Image}}')" == "$PREIMAGE" ]] ||
          echo "ROLLBACK_FAILED: restored image differs" >&2
      else echo "ROLLBACK_FAILED: backup container missing" >&2; fi ;;
  esac
}
finish() {
  local code=$?
  if (( code != 0 )); then rollback; fi
  rm -rf "$TMP"; exit "$code"
}
trap finish EXIT
sourcegit cat-file -e "$SHA^{commit}" || refuse "source commit missing"
sourcegit show-ref --verify --quiet refs/remotes/origin/main || refuse "origin/main unavailable"
sourcegit merge-base --is-ancestor "$SHA" refs/remotes/origin/main ||
  refuse "source is NOT merged into origin/main"
[[ -z "$(sourcegit status --porcelain -- mcp/paperclip)" ]] || refuse "dirty MCP source"
dkr container inspect "$NAME" > "$TMP/old.json" || refuse "running gateway absent"
! dkr container inspect "$BACKUP" >/dev/null 2>&1 || refuse "existing rollback requires disposition first"
BASE="$(dkr inspect "$NAME" --format '{{.Config.Image}}')"
PREIMAGE="$(dkr inspect "$NAME" --format '{{.Image}}')"
[[ -n "$BASE" && -n "$PREIMAGE" ]] || refuse "current image unverifiable"
# Keep the same deployment disk gate as the existing supervisor.
DFLINE="$(dkr exec paperclip df -Pk /paperclip | tail -n 1)"
AVAIL_K="$(printf '%s\n' "$DFLINE" | awk '{print $4}')"
USED_PCT="$(printf '%s\n' "$DFLINE" | awk '{gsub(/%/,"",$5);print $5}')"
[[ "$AVAIL_K" =~ ^[0-9]+$ && "$USED_PCT" =~ ^[0-9]+$ ]] || refuse "disk preflight unreadable"
(( AVAIL_K >= 20*1024*1024 && USED_PCT <= 90 )) || refuse "disk preflight blocked: less than 20GiB or 10% free"
python3 "$SCRIPT/recreate-gateway-argv.py" prepare "$TMP/old.json" "$NAME" "$BACKUP" "$TMP/args" "$TMP/env"
mapfile -d '' -t ARGS < "$TMP/args"
sourcegit archive "$SHA" mcp/paperclip | tar -x -C "$TMP"
dkr build --pull=false --build-arg "PAPERCLIP_BASE=$BASE" \
  --label "org.opencontainers.image.revision=$SHA" \
  -t "$IMAGE" -f "$TMP/mcp/paperclip/Dockerfile" "$TMP/mcp/paperclip"
CANDIDATE="$(dkr image inspect "$IMAGE" --format '{{.Id}}')"
[[ "$CANDIDATE" == "$2" ]] || refuse "built image digest differs from approved artifact"
[[ "$CANDIDATE" != "$PREIMAGE" ]] || refuse "candidate is already live"
dkr stop --time 25 "$NAME" >/dev/null; PHASE=stopped
dkr rename "$NAME" "$BACKUP"; PHASE=renamed
dkr run -d "${ARGS[@]}" "$IMAGE" >/dev/null; PHASE=new_started
GOOD=false
for _ in $(seq 1 45); do
  STATE="$(dkr inspect "$NAME" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' 2>/dev/null || true)"
  if [[ "$STATE" == "running|healthy" ]]; then GOOD=true; break; fi
  if [[ "$STATE" == exited* || "$STATE" == dead* || "$STATE" == *'|unhealthy' ]]; then break; fi
  sleep 2
done
[[ "$GOOD" == true ]] || refuse "Docker gateway health failed"
dkr container inspect "$NAME" > "$TMP/new.json"
python3 "$SCRIPT/recreate-gateway-argv.py" verify "$TMP/old.json" "$TMP/new.json" _ _ _ ||
  refuse "post-deploy configuration drift"
LIVEIMAGE="$(dkr inspect "$NAME" --format '{{.Image}}')"
LIVESHA="$(dkr inspect "$NAME" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$LIVEIMAGE" == "$CANDIDATE" && "$LIVESHA" == "$SHA" ]] || refuse "image ID or SHA mismatch"
dkr exec paperclip node -e "fetch('http://$NAME:3101/health',{signal:AbortSignal.timeout(10000)}).then(async r=>{let j=await r.json();process.exit(r.ok&&j.service==='paperclip-mcp'?0:1)}).catch(()=>process.exit(1))" ||
  refuse "internal gateway health failed"
PHASE=verified
echo "DEPLOY_VERIFIED source_sha=$SHA image_id=$LIVEIMAGE rollback_container=$BACKUP"
