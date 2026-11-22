#!/usr/bin/env bash
# Root-controlled, fail-closed GitHub Actions admission. Never run PR head code.
set -Eeuo pipefail
fail() { printf '%s\n' "::error::ZIS Product runner admission DENIED: $1" >&2; exit 86; }
[[ "$(id -un)" == 'actions-zis-product' ]] || fail 'unexpected runner user'
[[ "${GITHUB_REPOSITORY:-}" == 'jtrtdhrst/zar-i-szlif' ]] || fail 'unexpected repository'
[[ "${GITHUB_EVENT_NAME:-}" == 'push' || "${GITHUB_EVENT_NAME:-}" == 'workflow_dispatch' ]] || fail 'untrusted event'
[[ "${GITHUB_REF:-}" == 'refs/heads/main' ]] || fail 'unapproved branch/ref'
[[ "${GITHUB_WORKFLOW_REF:-}" == 'jtrtdhrst/zar-i-szlif/.github/workflows/product-ci.yml@refs/heads/main' ]] || fail 'unexpected workflow source'
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || fail 'missing immutable commit sha'
[[ -S /run/zis-rootless-docker/docker.sock ]] || fail 'dedicated rootless Docker socket missing'
[[ ! -w /run/docker.sock ]] || fail 'root-owned Docker socket unexpectedly writable'
[[ ! -r /opt/zis-actions-runner-harness/.credentials ]] || fail 'other runner credentials readable'
printf '%s\n' 'ZIS PRODUCT ADMISSION PASS: trusted main event, immutable SHA, isolated runner identity and rootless engine'
