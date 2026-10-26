#!/usr/bin/env bash
set -euo pipefail

DOCKER=(sudo -n docker -H unix:///run/user/1001/docker.sock)
NAME=vps-ops-supervisor
BACKUP=vps-ops-supervisor-rollback-v1.0.20
BASE_TAG=local/vps-ops-supervisor:1.0.20-komaa1458-candidate
BASE_ID=""
CANDIDATE=local/vps-ops-supervisor:1.0.21-komaa1463-gateway-candidate
STATE_VOLUME=vps-ops-state
DOCKER_SOCKET=/run/user/1001/docker.sock
MIRROR=/home/opencode/.local/share/docker/volumes/paperclip-home/_data/vps-ops/policy
EXPECTED_WATCHER=3ea5ac52bd9df3a6ac00c8ee404aed39e69dcf12b87eeed546ed14ac6258a523
EXPECTED_BASE_WATCHER=de14f44c66a76a7b5f245922a47ad75ac12f5637bf476ae6a4388a00c48b8173
EXPECTED_POLICY=cafa417b12f6c8db296128572eb18fc74748bc62a63c3940d4f0f8619c5667b8
EXPECTED_BASE_POLICY=c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99

dkr() { "${DOCKER[@]}" "$@"; }
BASE_ID="$(dkr image inspect "$BASE_TAG" --format '{{.Id}}')"
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
  [ "$restored" = "$BASE_ID" ] || fail "rollback image does not match the pinned v1.0.20 base"
  printf 'ROLLBACK_OK image=%s state_volume=%s\n' "$restored" "$STATE_VOLUME"
}

apply() {
  exists "$NAME" || fail "active supervisor container is missing"
  exists "$BACKUP" && fail "rollback container already exists; inspect it before proceeding"
  local active candidate running mounts network envs locks hashes
  active="$(dkr inspect --format '{{.Image}}' "$NAME")"
  [ "$active" = "$BASE_ID" ] || fail "active supervisor is not the pinned v1.0.20 base image"
  local base_hashes
  base_hashes="$(dkr exec "$NAME" sha256sum /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  [[ "$base_hashes" == *"$EXPECTED_BASE_WATCHER  /opt/sup/watcher.sh"* ]] || fail "running base watcher is not verified 1.0.20"
  [[ "$base_hashes" == *"$EXPECTED_BASE_POLICY  /opt/sup/POLICY.md"* ]] || fail "running base policy is not verified v3.11"
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
  dkr run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=8m --entrypoint bash "$CANDIDATE" /opt/sup/candidate-test/auth-matrix.test.sh /opt/sup/watcher.sh
  dkr run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=8m --entrypoint bash "$CANDIDATE" /opt/sup/candidate-test/gateway-release-matrix.test.sh /opt/sup/watcher.sh /opt/sup/candidate-test/auth-matrix.test.sh

  dkr stop --time 15 "$NAME" >/dev/null
  dkr rename "$NAME" "$BACKUP"
  if ! dkr run -d --name "$NAME" --network bridge --restart unless-stopped \
    --mount "type=volume,source=$STATE_VOLUME,target=/state" \
    --mount "type=bind,source=$DOCKER_SOCKET,target=/var/run/docker.sock,readonly" \
    --env STATE_DIR=/state "$CANDIDATE" >/dev/null; then
    rollback
    fail "candidate supervisor failed to start; restored v1.0.20"
  fi
  for _ in $(seq 1 15); do
    running="$(dkr inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null || true)"
    [ "$running" = true ] && break
    sleep 1
  done
  if [ "$running" != true ]; then
    rollback
    fail "candidate supervisor did not stay running; restored v1.0.20"
  fi
  if ! dkr exec "$NAME" bash -n /opt/sup/watcher.sh; then
    rollback
    fail "deployed watcher syntax check failed; restored v1.0.20"
  fi
  local live_image live_hashes mirror_hashes
  live_image="$(dkr inspect --format '{{.Image}}' "$NAME")"
  [ "$live_image" = "$candidate" ] || { rollback; fail "running image ID differs from candidate; restored v1.0.20"; }
  live_hashes="$(dkr exec "$NAME" sha256sum /opt/sup/watcher.sh /opt/sup/POLICY.md)"
  [[ "$live_hashes" == *"$EXPECTED_WATCHER  /opt/sup/watcher.sh"* ]] || { rollback; fail "running watcher digest mismatch; restored v1.0.20"; }
  [[ "$live_hashes" == *"$EXPECTED_POLICY  /opt/sup/POLICY.md"* ]] || { rollback; fail "running policy digest mismatch; restored v1.0.20"; }
  for _ in $(seq 1 15); do
    mirror_hashes="$(sudo -n sha256sum "$MIRROR/watcher.sh" "$MIRROR/POLICY.md" 2>/dev/null || true)"
    [[ "$mirror_hashes" == *"$EXPECTED_WATCHER  $MIRROR/watcher.sh"* && "$mirror_hashes" == *"$EXPECTED_POLICY  $MIRROR/POLICY.md"* ]] && break
    sleep 1
  done
  [[ "$mirror_hashes" == *"$EXPECTED_WATCHER  $MIRROR/watcher.sh"* && "$mirror_hashes" == *"$EXPECTED_POLICY  $MIRROR/POLICY.md"* ]] || { rollback; fail "policy mirror did not converge; restored v1.0.20"; }
  printf 'CANARY_DEPLOYED image=%s watcher=%s policy=%s rollback=%s\n' "$live_image" "$EXPECTED_WATCHER" "$EXPECTED_POLICY" "$BACKUP"
}

build() {
  [ $# -eq 1 ] || fail "usage: $0 build <approved-main-SHA>"
  local sha="$1" temp
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA must be full-length"
  local repo=/paperclip/repos/kompas-zbiorek
  dkr exec paperclip git -C "$repo" cat-file -e "$sha^{commit}" || fail "commit unavailable"
  dkr exec paperclip git -C "$repo" merge-base --is-ancestor "$sha" refs/remotes/origin/main ||
    fail "source SHA has not been merged to main"
  temp="$(mktemp -d /dev/shm/gateway-sup-build.XXXXXXXX)"
  trap 'rm -rf "$temp"' EXIT
  dkr exec paperclip git -C "$repo" archive "$sha" mcp/paperclip | tar -x -C "$temp"
  dkr build --pull=false -t "$CANDIDATE" \
    -f "$temp/mcp/paperclip/vps-ops-supervisor/Dockerfile.gateway-release" \
    "$temp/mcp/paperclip"
  echo "GATEWAY_SUPERVISOR_CANDIDATE_BUILT sha=$sha image=$(dkr image inspect "$CANDIDATE" --format '{{.Id}}')"
}

case "${1:-status}" in
  status) status ;;
  build) shift; build "$@" ;;
  apply) apply ;;
  rollback) rollback ;;
  *) fail "usage: $0 {status|build <main-SHA>|apply|rollback}" ;;
esac
