#!/usr/bin/env bash
set -euo pipefail

DOCKER=(sudo -n docker -H unix:///run/user/1001/docker.sock)
NAME=vps-ops-supervisor
BACKUP=vps-ops-supervisor-rollback-komaa1458
BASE_ID=sha256:e0f68bed2b5ac12e48fb0be58ea303b7c0c2f57311fca96bdaa35dfa03509ae6
CANDIDATE=local/vps-ops-supervisor:1.0.20-komaa1458-candidate
STATE_VOLUME=vps-ops-state
DOCKER_SOCKET=/run/user/1001/docker.sock
MIRROR=/home/opencode/.local/share/docker/volumes/paperclip-home/_data/vps-ops/policy
EXPECTED_WATCHER=de14f44c66a76a7b5f245922a47ad75ac12f5637bf476ae6a4388a00c48b8173
EXPECTED_POLICY=c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99

dkr() { "${DOCKER[@]}" "$@"; }
exists() { dkr container inspect "$1" >/dev/null 2>&1; }
fail() { printf 'REFUSED: %s\n' "$1" >&2; exit 1; }

status() {
  if exists "$NAME"; then
    dkr inspect --format 'active={{.Name}} image={{.Image}} running={{.State.Running}}' "$NAME"
  else
    printf 'active container missing\n'
  fi
  if exists "$BACKUP"; then
    dkr inspect --format 'rollback={{.Name}} image={{.Image}} running={{.State.Running}}' "$BACKUP"
  else
    printf 'rollback container absent\n'
  fi
}

rollback() {
  if exists "$NAME"; then
    dkr rm -f "$NAME" >/dev/null
  fi
  exists "$BACKUP" || fail "rollback container is missing"
  dkr rename "$BACKUP" "$NAME"
  dkr start "$NAME" >/dev/null
  local restored
  restored="$(dkr inspect --format '{{.Image}}' "$NAME")"
  [ "$restored" = "$BASE_ID" ] || fail "rollback image does not match the pinned v1.0.19 base"
  printf 'ROLLBACK_OK image=%s state_volume=%s\n' "$restored" "$STATE_VOLUME"
}

apply() {
  exists "$NAME" || fail "active supervisor container is missing"
  exists "$BACKUP" && fail "rollback container already exists; inspect it before proceeding"
  local active candidate running mounts network envs locks hashes
  active="$(dkr inspect --format '{{.Image}}' "$NAME")"
  [ "$active" = "$BASE_ID" ] || fail "active supervisor is not the pinned v1.0.19 base image"
  running="$(dkr inspect --format '{{.State.Running}}' "$NAME")"
  [ "$running" = true ] || fail "active supervisor is not running"
  candidate="$(dkr image inspect --format '{{.Id}}' "$CANDIDATE")"
  [ -n "$candidate" ] || fail "candidate image is not available"
  mounts="$(dkr inspect --format '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$NAME")"
  [[ "$mounts" == *"volume|$STATE_VOLUME|/state|true"* ]] || fail "persistent supervisor state mount differs from expected"
  [[ "$mounts" == *"bind||/var/run/docker.sock|false"* ]] || fail "read-only Docker socket mount differs from expected"
  network="$(dkr inspect --format '{{.HostConfig.NetworkMode}}' "$NAME")"
  [ "$network" = bridge ] || fail "supervisor network differs from expected"
  envs="$(dkr inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME")"
  printf '%s\n' "$envs" | python3 -c 'import sys; xs=[x.rstrip() for x in sys.stdin if x.strip()]; ks={x.split("=",1)[0] for x in xs}; assert ks=={"PATH","STATE_DIR"} and "STATE_DIR=/state" in xs' || fail "supervisor environment differs from the reviewed config"
  locks="$(dkr exec "$NAME" sh -lc 'ls -A /state/locks 2>/dev/null')"
  [ -z "$locks" ] || fail "supervisor has in-flight operation locks"
  hashes="$(dkr run --rm --network none --read-only --entrypoint sha256sum "$CANDIDATE" /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  [[ "$hashes" == *"$EXPECTED_WATCHER  /opt/sup/watcher.sh"* ]] || fail "candidate watcher digest mismatch"
  [[ "$hashes" == *"$EXPECTED_POLICY  /opt/sup/POLICY.md"* ]] || fail "candidate policy digest mismatch"
  dkr run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=1m --entrypoint bash "$CANDIDATE" /opt/sup/candidate-test/auth-matrix.test.sh /opt/sup/watcher.sh

  dkr stop --time 15 "$NAME" >/dev/null
  dkr rename "$NAME" "$BACKUP"
  GW_SWAP_PENDING=1
  trap 'if [ "${GW_SWAP_PENDING:-0}" = 1 ]; then gateway_rollback || printf "GATEWAY_LANE_RECOVERY_FAILED\\n" >&2; fi' EXIT
  if ! dkr run -d --name "$NAME" --network bridge --restart unless-stopped \
    --mount "type=volume,source=$STATE_VOLUME,target=/state" \
    --mount "type=bind,source=$DOCKER_SOCKET,target=/var/run/docker.sock,readonly" \
    --env STATE_DIR=/state "$CANDIDATE" >/dev/null; then
    rollback
    fail "candidate supervisor failed to start; restored v1.0.19"
  fi
  for _ in $(seq 1 15); do
    running="$(dkr inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null || true)"
    [ "$running" = true ] && break
    sleep 1
  done
  if [ "$running" != true ]; then
    rollback
    fail "candidate supervisor did not stay running; restored v1.0.19"
  fi
  if ! dkr exec "$NAME" bash -n /opt/sup/watcher.sh; then
    rollback
    fail "deployed watcher syntax check failed; restored v1.0.19"
  fi
  local live_image live_hashes mirror_hashes
  live_image="$(dkr inspect --format '{{.Image}}' "$NAME")"
  [ "$live_image" = "$candidate" ] || { rollback; fail "running image ID differs from candidate; restored v1.0.19"; }
  live_hashes="$(dkr exec "$NAME" sha256sum /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  [[ "$live_hashes" == *"$EXPECTED_WATCHER  /opt/sup/watcher.sh"* ]] || { rollback; fail "running watcher digest mismatch; restored v1.0.19"; }
  [[ "$live_hashes" == *"$EXPECTED_POLICY  /opt/sup/POLICY.md"* ]] || { rollback; fail "running policy digest mismatch; restored v1.0.19"; }
  for _ in $(seq 1 15); do
    mirror_hashes="$(sudo -n sha256sum "$MIRROR/watcher.sh" "$MIRROR/POLICY.md" 2>/dev/null || true)"
    [[ "$mirror_hashes" == *"$EXPECTED_WATCHER  $MIRROR/watcher.sh"* && "$mirror_hashes" == *"$EXPECTED_POLICY  $MIRROR/POLICY.md"* ]] && break
    sleep 1
  done
  [[ "$mirror_hashes" == *"$EXPECTED_WATCHER  $MIRROR/watcher.sh"* && "$mirror_hashes" == *"$EXPECTED_POLICY  $MIRROR/POLICY.md"* ]] || { rollback; fail "policy mirror did not converge; restored v1.0.19"; }
  printf 'CANARY_DEPLOYED image=%s watcher=%s policy=%s rollback=%s\n' "$live_image" "$EXPECTED_WATCHER" "$EXPECTED_POLICY" "$BACKUP"
}


# Exact-image second-stage provision; preserve the original 1.0.19 rollback.
# Neither this operation nor its success implies a gateway deployment.
GATEWAY=paperclip-mcp-gateway
GATEWAY_IMAGE=sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104
GATEWAY_TAG=local/paperclip-mcp-gateway:komaa1458-c519
GATEWAY_PREVIOUS=sha256:531fa0b9d361104c9ca271bb4c9e88136bed5146e01aff0705af3c422fbf5eb0
SUP_IMAGE=sha256:395595bb698a39832579ad4d15fbfc6ec07e9a2e763cb276a153b56cb93e8d69
GATEWAY_BACKUP=vps-ops-supervisor-pre-gateway-komaa1458
TARGET_ENV="RECREATE_TARGETS=$GATEWAY"
IMAGE_ENV="RECREATE_IMAGES=$GATEWAY=$GATEWAY_IMAGE"

gateway_preflight() {
  exists "$NAME" || fail "active supervisor absent"
  exists "$GATEWAY" || fail "exact gateway container absent"
  ! exists "$GATEWAY_BACKUP" || fail "pre-gateway rollback already exists; refuse overwrite"
  [ "$(dkr inspect --format '{{.Image}}' "$NAME")" = "$SUP_IMAGE" ] || fail "not the verified supervisor v1.0.20 image"
  [ "$(dkr inspect --format '{{.State.Running}}' "$NAME")" = true ] || fail "supervisor not running"
  [ "$(dkr inspect --format '{{.Image}}' "$GATEWAY")" = "$GATEWAY_PREVIOUS" ] || fail "gateway image differs from pinned pre-release image"
  [ "$(dkr image inspect --format '{{.Id}}' "$GATEWAY_TAG")" = "$GATEWAY_IMAGE" ] || fail "gateway candidate tag not the reviewed image"
  [ "$(dkr image inspect --format '{{.Id}}' "$GATEWAY_IMAGE")" = "$GATEWAY_IMAGE" ] || fail "immutable gateway candidate is unavailable"
  [ "$(dkr image inspect --format '{{.Id}}' "$CANDIDATE")" = "$SUP_IMAGE" ] || fail "candidate supervisor tag differs from pinned image"
  [ "$(dkr inspect --format '{{.HostConfig.NetworkMode}}' "$NAME")" = bridge ] || fail "supervisor network mismatch"
  local mounts envs locks hashes
  mounts="$(dkr inspect --format '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$NAME")"
  [[ "$mounts" == *"volume|$STATE_VOLUME|/state|true"* && "$mounts" == *"bind||/var/run/docker.sock|false"* ]] || fail "supervisor mounts mismatch"
  envs="$(dkr inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME")"
  printf '%s\n' "$envs" | python3 -c 'import sys; x=[s.strip() for s in sys.stdin if s.strip()]; assert {s.split("=",1)[0] for s in x}=={"PATH","STATE_DIR"} and "STATE_DIR=/state" in x' || fail "unexpected supervisor environment"
  locks="$(dkr exec "$NAME" sh -lc 'ls -A /state/locks 2>/dev/null')"
  [ -z "$locks" ] || fail "host operations in flight"
  hashes="$(dkr exec "$NAME" sha256sum /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  [[ "$hashes" == *"$EXPECTED_WATCHER  /opt/sup/watcher.sh"* && "$hashes" == *"$EXPECTED_POLICY  /opt/sup/POLICY.md"* ]] || fail "supervisor source/policy hashes mismatch"
  printf 'GATEWAY_LANE_PREFLIGHT_OK target=%s image=%s\n' "$GATEWAY" "$GATEWAY_IMAGE"
}

gateway_rollback() {
  exists "$GATEWAY_BACKUP" || fail "pre-gateway rollback absent"
  [ "$(dkr inspect --format '{{.Image}}' "$GATEWAY_BACKUP")" = "$SUP_IMAGE" ] || fail "rollback supervisor image mismatch"
  if exists "$NAME"; then
    [ "$(dkr inspect --format '{{.Image}}' "$NAME")" = "$SUP_IMAGE" ] || fail "unexpected supervisor image; refusing removal"
    dkr rm -f "$NAME" >/dev/null
  fi
  dkr rename "$GATEWAY_BACKUP" "$NAME"
  dkr start "$NAME" >/dev/null
  [ "$(dkr inspect --format '{{.State.Running}}' "$NAME")" = true ] || fail "restored supervisor not running"
  printf 'GATEWAY_LANE_ROLLBACK_OK image=%s\n' "$SUP_IMAGE"
}

gateway_apply() {
  gateway_preflight
  dkr stop --time 15 "$NAME" >/dev/null
  if ! dkr rename "$NAME" "$GATEWAY_BACKUP"; then
    dkr start "$NAME" >/dev/null || true
    fail "failed to retain old supervisor"
  fi
  if ! dkr run -d --name "$NAME" --network bridge --restart unless-stopped \
      --mount "type=volume,source=$STATE_VOLUME,target=/state" \
      --mount "type=bind,source=$DOCKER_SOCKET,target=/var/run/docker.sock,readonly" \
      --env STATE_DIR=/state --env "$TARGET_ENV" --env "$IMAGE_ENV" "$CANDIDATE" >/dev/null; then
    fail "candidate supervisor recreate failed"
  fi
  local envs hashes live
  for _ in $(seq 1 15); do
    live="$(dkr inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null || true)"
    [ "$live" = true ] && break
    sleep 1
  done
  if [ "$live" != true ]; then fail "candidate supervisor not running"; fi
  envs="$(dkr inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME")"
  if ! printf '%s\n' "$envs" | grep -Fxq "$TARGET_ENV" ||
     ! printf '%s\n' "$envs" | grep -Fxq "$IMAGE_ENV"; then
    fail "pinned target/image config was not persisted"
  fi
  hashes="$(dkr exec "$NAME" sha256sum /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  if [[ "$hashes" != *"$EXPECTED_WATCHER  /opt/sup/watcher.sh"* ||
        "$hashes" != *"$EXPECTED_POLICY  /opt/sup/POLICY.md"* ]]; then
    fail "supervisor policy source differs from reviewed canary"
  fi
  if ! dkr exec "$NAME" bash -n /opt/sup/watcher.sh; then
    fail "supervisor watcher syntax test failed"
  fi
  GW_SWAP_PENDING=0
  trap - EXIT
  printf 'GATEWAY_LANE_PROVISIONED target=%s image=%s rollback=%s\n' "$GATEWAY" "$GATEWAY_IMAGE" "$GATEWAY_BACKUP"
  printf '%s\n' 'NOT DEPLOYED: validate native planner and release the matching gateway image separately.'
}

case "${1:-status}" in
  gateway-preflight) gateway_preflight ;;
  gateway-apply) gateway_apply ;;
  gateway-rollback) gateway_rollback ;;
  status) status ;;
  apply) apply ;;
  rollback) rollback ;;
  *) fail "usage: $0 {status|apply|rollback|gateway-preflight|gateway-apply|gateway-rollback}" ;;
esac
