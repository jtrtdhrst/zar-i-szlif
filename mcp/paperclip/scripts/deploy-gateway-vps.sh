#!/usr/bin/env bash
# VPS-only: merged source SHA -> immutable image -> clone live gateway -> health/readback.
# No host Docker socket is ever handed to an agent. Previous container is rollback.
set -euo pipefail
# Two-phase release: PREPARE builds an image without stopping a service; APPLY
# only starts the exact, independently approved Docker image ID prepared earlier.
# "approved digest" is Docker's config image ID (.Id), NOT a registry manifest digest.
MODE=apply
if [[ ${1:-} == prepare && $# -eq 2 ]]; then
  MODE=prepare; SHA="$2"; APPROVED_IMAGE_ID=""
elif [[ $# -eq 2 ]]; then
  SHA="$1"; APPROVED_IMAGE_ID="$2"
else
  echo "REFUSED: usage: $0 prepare <merged-source-sha> | <merged-source-sha> <approved-docker-image-id>" >&2; exit 2
fi
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "REFUSED: full merged source SHA required" >&2; exit 2; }
if [[ "$MODE" == apply && ! "$APPROVED_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "REFUSED: approved Docker image ID (sha256:64hex) required" >&2; exit 2
fi
SHORT="${SHA:0:12}"
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
# PREPARE can build an unmerged PR SHA for independent image-ID review.
# APPLY is the only mutating step and strictly requires merged main.
if [[ "$MODE" == apply ]]; then
  sourcegit show-ref --verify --quiet refs/remotes/origin/main || refuse "origin/main unavailable"
  sourcegit merge-base --is-ancestor "$SHA" refs/remotes/origin/main ||
    refuse "source is NOT merged into origin/main"
fi
[[ -z "$(sourcegit status --porcelain -- mcp/paperclip)" ]] || refuse "dirty MCP source"
dkr container inspect "$NAME" > "$TMP/old.json" || refuse "running gateway absent"
! dkr container inspect "$BACKUP" >/dev/null 2>&1 || refuse "existing rollback requires disposition first"
BASE="$(dkr inspect "$NAME" --format '{{.Config.Image}}')"
PREIMAGE="$(dkr inspect "$NAME" --format '{{.Image}}')"
[[ -n "$BASE" && -n "$PREIMAGE" ]] || refuse "current image unverifiable"
# A cached-base gateway overlay does not require a full 20GiB free.
# Keep a 12GiB / 6% pre-build floor and re-check >=10GiB / 5% BEFORE
# stopping the live service. A large unexpected build is refused before stop.
disk_free_kb() {
  local line available used
  line="$(dkr exec paperclip df -Pk /paperclip | tail -n 1)"
  available="$(printf '%s\n' "$line" | awk '{print $4}')"
  used="$(printf '%s\n' "$line" | awk '{gsub(/%/,"",$5);print $5}')"
  [[ "$available" =~ ^[0-9]+$ && "$used" =~ ^[0-9]+$ ]] || refuse "disk preflight unreadable"
  printf '%s %s\n' "$available" "$used"
}
read -r AVAIL_K USED_PCT < <(disk_free_kb)
(( AVAIL_K >= 12*1024*1024 && USED_PCT <= 94 )) || refuse "disk preflight blocked: below 12GiB free or over 94% used"
python3 "$SCRIPT/recreate-gateway-argv.py" prepare "$TMP/old.json" "$NAME" "$BACKUP" "$TMP/args" "$TMP/env"
mapfile -d '' -t ARGS < "$TMP/args"
if [[ "$MODE" == prepare ]]; then
  sourcegit archive "$SHA" mcp/paperclip | tar -x -C "$TMP"
  dkr build --pull=false --build-arg "PAPERCLIP_BASE=$BASE" \
    --label "org.opencontainers.image.revision=$SHA" \
    -t "$IMAGE" -f "$TMP/mcp/paperclip/Dockerfile" "$TMP/mcp/paperclip"
fi
# Never rebuild during APPLY: a rebuilt Docker image may have a DIFFERENT ID
# despite identical source. Fail before touching the running gateway.
CANDIDATE="$(dkr image inspect "$IMAGE" --format '{{.Id}}')" || refuse "prepared image missing"
[[ "$CANDIDATE" =~ ^sha256:[a-f0-9]{64}$ ]] || refuse "invalid Docker image ID"
CANDIDATE_SHA="$(dkr image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$CANDIDATE_SHA" == "$SHA" ]] || refuse "prepared image source revision mismatch"
if [[ "$MODE" == prepare ]]; then
  echo "CANDIDATE_PREPARED source_sha=$SHA docker_image_id=$CANDIDATE (approve this exact ID before apply)"
  PHASE=verified
  exit 0
fi
[[ "$CANDIDATE" == "$APPROVED_IMAGE_ID" ]] || refuse "prepared Docker image ID differs from approved ID (before stop)"
[[ "$CANDIDATE" != "$PREIMAGE" ]] || refuse "candidate is already live"
# Apply never stops the old container when the post-build reserve is exhausted.
read -r POST_AVAIL_K POST_USED_PCT < <(disk_free_kb)
(( POST_AVAIL_K >= 10*1024*1024 && POST_USED_PCT <= 95 )) || refuse "pre-switch disk check blocked: below 10GiB free or over 95% used"
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
