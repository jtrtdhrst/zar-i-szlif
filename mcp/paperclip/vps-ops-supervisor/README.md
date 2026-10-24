# VPS operations supervisor overlay

This build overlays a narrow, issue-bound heartbeat-run authorization lane onto the verified local supervisor base `local/vps-ops-supervisor:1.0.19` (image ID `sha256:e0f68bed2b5ac12e48fb0be58ea303b7c0c2f57311fca96bdaa35dfa03509ae6`). `apply-auth-compat.py` fails closed unless the base watcher and policy SHA-256 match the live v3.10 files observed on 2026-10-24.

Only `host.file.patch` may use `runId`, and only for an existing canary path accepted by the baked `FILE_PATCH_PREFIXES` guard. The supervisor resolves the issue UUID, verifies the issue is nonterminal and assigned to the calling agent in the configured company, then verifies the heartbeat row is `running`, belongs to the same agent/company, and its context snapshot binds to that exact issue. Existing audited, unexpired `operatorRunId` authorization remains valid for all existing mutations; a supplied operator ID is never silently replaced by `runId`.

Build and test on the VPS rootless Docker engine after the source is present in the checked-out `KOMAA-1458` worktree:

```sh
docker -H unix:///run/user/1001/docker.sock build \
  -t local/vps-ops-supervisor:1.0.20-komaa1458 \
  -f mcp/paperclip/vps-ops-supervisor/Dockerfile \
  mcp/paperclip/vps-ops-supervisor
```

The Docker build applies the patch atomically, verifies the known base hashes, runs `bash -n`, then executes the positive/negative authorization matrix against the resulting watcher before producing the image. Building a candidate does not install or start it. Preserve the current v1.0.19 container and `vps-ops-state` volume for rollback; replace the supervisor only through the bounded rollout procedure recorded in the issue after the exact candidate has passed CI and independent CTO review.
