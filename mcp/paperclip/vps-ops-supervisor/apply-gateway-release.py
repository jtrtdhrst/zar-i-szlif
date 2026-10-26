#!/usr/bin/env python3
"""Hash-pinned v1.0.20 -> v1.0.21 overlay: only the Paperclip MCP gateway release."""
from hashlib import sha256
from pathlib import Path
import os

ROOT = Path(os.environ.get("SUP_PATCH_ROOT", "/opt/sup"))
WATCHER_SHA = "de14f44c66a76a7b5f245922a47ad75ac12f5637bf476ae6a4388a00c48b8173"
POLICY_SHA = "c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99"
watcher, policy = ROOT / "watcher.sh", ROOT / "POLICY.md"

def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, got {count}")
    return source.replace(old, new, 1)

if sha256(watcher.read_bytes()).hexdigest() != WATCHER_SHA:
    raise SystemExit("REFUSED: watcher not the verified v1.0.20 baseline")
if sha256(policy.read_bytes()).hexdigest() != POLICY_SHA:
    raise SystemExit("REFUSED: policy not the verified v3.11 baseline")

s = watcher.read_text()
s = replace_once(s,
    'host.backup.restore_to_staging host.migration.apply"\nLIVE_RUN_MUT_OPS="host.file.patch"',
    'host.backup.restore_to_staging host.migration.apply mcp.gateway.prepare mcp.gateway.release"\nLIVE_RUN_MUT_OPS="host.file.patch mcp.gateway.prepare mcp.gateway.release"',
    "allowlist and issue-bound live-run auth")
s = replace_once(s,
    '    host.container.recreate)\n      vtgt="$(jget target "$req")";',
    '''    mcp.gateway.prepare|mcp.gateway.release)
      vtgt="$(jget target "$req")"
      vsha="$(jget sourceSha "$req")"
      vdig="$(jget artifactDigest "$req")"
      [ "$vtgt" = "paperclip-mcp-gateway" ] || { echo "gateway release target not allowlisted"; return; }
      [[ "$vsha" =~ ^[0-9a-f]{40}$ ]] || { echo "gateway release requires full sourceSha"; return; }
      if [ "$op" = "mcp.gateway.release" ]; then
        [[ "$vdig" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "gateway release requires full Docker image ID"; return; }
      fi ;;
    host.container.recreate)
      vtgt="$(jget target "$req")";''',
    "exact gateway target guard")
s = replace_once(s, '    mcp.build_candidate)\n      # §2.1:',
    '''    mcp.gateway.prepare)
      local prepare_sha
      prepare_sha="$(jget sourceSha "$req")"
      if [ "$dry" = "True" ]; then
        echo "dryRun: would prepare gateway sourceSha=$prepare_sha (no Docker mutation)"
        return 0
      fi
      PAPERCLIP_DOCKER_SOCKET=/var/run/docker.sock timeout --signal=TERM --kill-after=12s 780 \
        bash /opt/sup/release/deploy-gateway-vps.sh prepare "$prepare_sha" ;;
    mcp.gateway.release)
      # Only this op can rebuild/recreate the exact gateway; generic recreate
      # remains unavailable. Release uses main SHA and rollback on any mismatch.
      local release_sha release_digest
      release_sha="$(jget sourceSha "$req")"
      release_digest="$(jget artifactDigest "$req")"
      if [ "$dry" = "True" ]; then
        echo "dryRun: would deploy merged gateway sourceSha=$release_sha digest=$release_digest (no mutations)"
        return 0
      fi
      PAPERCLIP_DOCKER_SOCKET=/var/run/docker.sock timeout --signal=TERM --kill-after=12s 780 \
        bash /opt/sup/release/deploy-gateway-vps.sh "$release_sha" "$release_digest" ;;
    mcp.build_candidate)
      # §2.1:''',
    "real gateway executor")
s = replace_once(s, '      host.file.patch) target="filepatch" ;;',
    '''      mcp.gateway.prepare|mcp.gateway.release) target="recreate-paperclip-mcp-gateway" ;;
      host.file.patch) target="filepatch" ;;''',
    "single-flight target")
s = replace_once(s,
    '''        ( sleep 90; kill -9 "$pid" 2>/dev/null ) &''',
    '''        # The gateway release image build has its own 780-second timeout.
        local max_seconds op_name
        max_seconds=90
        op_name="$(jget operation "$(read_request "${f%.json}")")"
        [[ "$op_name" = "mcp.gateway.release" || "$op_name" = "mcp.gateway.prepare" ]] && max_seconds=830
        ( sleep "$max_seconds"; kill -9 "$pid" 2>/dev/null ) &''',
    "bounded watchdog for release")
s = replace_once(s,
    "ks=['operation','target','path','content','contentSha','expectedSha','image','backupName','migrationId','sourceRef','digest','dryRun','tail']",
    "ks=['operation','target','path','content','contentSha','expectedSha','image','backupName','migrationId','sourceRef','digest','dryRun','tail','sourceSha','artifactDigest']",
    "include immutable artifact and source SHA in replay digest")
watcher.write_text(s)
p = policy.read_text()
p = replace_once(p,
    "# VPS-OPS operational policy v3.11 (KOMAA-1458, live with supervisor 1.0.20):",
    """# VPS-OPS operational policy v3.12 (candidate supervisor 1.0.21):
# The only new live-run mutations are mcp.gateway.prepare (build-only) and
# mcp.gateway.release (exact previously prepared image). Host verifies
# issue ownership, agent/company, run liveness, exact gateway target and SHA.
# The supplied Docker image ID must match the already-prepared image; a literal
# hardcoded fake digest would prevent all real releases. Source MUST be merged
# into origin/main and keep its exact revision label.
# The release script also verifies the SHA is on origin/main, preserves env,
# mounts, network and entrypoint, checks health and retains rollback.
# Generic host.container.recreate remains unprovisioned and unsafe to use.
# This candidate is NOT effective until its own production image is deployed.
#
# VPS-OPS operational policy v3.11 (KOMAA-1458, live with supervisor 1.0.20):""",
    "policy header")
policy.write_text(p)
print("GATEWAY_RELEASE_PATCH_OK",sha256(watcher.read_bytes()).hexdigest(),
      sha256(policy.read_bytes()).hexdigest())
