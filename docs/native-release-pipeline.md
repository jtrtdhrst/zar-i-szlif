# Native Product release pipeline — migration record

Status: PROPOSED / NOT DEPLOYED. Canonical Multica issue: ZARI-269 (ZARI-276 was closed as a duplicate). Existing Product PR: #190. Audit date: 2026-11-27.

## Target ownership

- Multica: issue coordination, independent review handoffs, and Production QA evidence. A Multica comment is not a formal GitHub review.
- GitHub: protected main, independent formal review, required substantive CI, exact merged SHA, immutable image publication, and native production authorization. No self-approval or bypass.
- Coolify: authorized deployment of the verified immutable image; retain persistent data and previous approved digest for rollback. A push webhook alone is insufficient.
- Production QA: positive and negative service checks, exact live source SHA and digest, rollback verification, then Done.

## Migration sequence

1. Reuse PR #190. Re-read the current HEAD, reconcile PR #188 without duplicating implementation, and independently review the final exact SHA. Keep existing release protections in place.
2. Verify actual ruleset requirements and full CI, not only baseline and hosted fixtures. Keep untrusted PR code isolated from persistent runners and production credentials.
3. Build the three source-owned images from app/web (with explicit registry and config named contexts), mcp/product-host, and ops/mascot-worker. Publish exact SHA and registry digest from trusted main.
4. Verify supported GitHub production environment authorization and Coolify digest deployment on a canary before switching production. Scope deployment authorization to each resource; never promote an unvalidated push.
5. Enforce a single release writer at cutover. Retire the custom promotion controller and timer only when the equivalent native gates are verified.
6. Verify live health, release SHA/digest, positive and negative MCP auth/transport checks, mascot readiness without paid rendering, and rollback. Preserve all data. Record evidence in ZARI-269.
7. Merge and refresh the RepoWise index; verify retrieval against the merged commit.

## Audit evidence before this documentation change

- Product main: c2490d7a32eedf5ccdae6f2fbd94eaa3ccf3ccd9. Active main-protection ruleset.
- PR #190 head: 74c3af66c85e1f78f06815f383f8ffa8b770917b. Hosted fixture and baseline checks passed. No formal GitHub review; merge blocked.
- Product CI on main still uses the previous repository owner. PR #190 corrects it but has not been merged.
- Legacy product-native-promotion service failed. No native replacement or production release has been demonstrated.
- Daemon is intentionally stopped pending native runtime reconnection. Do not dispatch agents against unavailable runtime.
- RepoWise index was at the main SHA above; writing this file to a feature branch does not update the main index.

## Acceptance

PASS only after independent approved merge, successful exact-SHA CI, immutable image publication, authorized deployment, positive and negative production checks and tested rollback. Missing evidence is NOT RUN. Do not count a documentation commit, local test or PR as production release.
