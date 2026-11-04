# CI-gated production release: Żar i Szlif panel

## Live deployment contract (verified 2026-11-04)

- **Source of truth:** `miloszspyrka-code/zar-i-szlif`, `main`.
- **Validation:** `.github/workflows/product-ci.yml` job `validate-product` runs lint, typecheck, tests and the exact production Dockerfile build. The container startup must fail without a 40-hex `SOURCE_COMMIT`.
- **Promote:** on a successful `main` push validation, job `promote-release` fast-forwards `ci-approved` to the exact validated main SHA. It verifies the remote main tip and refuses force pushes/non-descendant updates.
- **Delivery:** existing Coolify GitHub App application `zar-i-szlif-web` (`k0vwdsjazxguvgmh4qixjgxn`) watches `ci-approved`, not the unvalidated `main` push. Source repository stays `zar-i-szlif`, Dockerfile stays `ops/coolify/Dockerfile`. No extra Cloudflare Workers.
- **Readback:** `verify-production` waits for `https://panel.zariszlif.pl/__release.json` to match the exact `main` SHA. Nginx writes that JSON via `ops/coolify/40-release-provenance.sh` using Coolify's runtime `SOURCE_COMMIT`. `/healthz` must return HTTP 200 `ok`.
- **Retention:** the previous working container must remain the rollback baseline until the newly built image passes health and exact-SHA readback.

## Operational checks

1. GitHub Actions: all three jobs `validate-product`, `promote-release`, and `verify-production` must be successful for a releasable `main` commit.
2. GitHub refs: `main` and `ci-approved` must have the same exact SHA for a release. The source branch may lag while CI is running or failed; this is intentional.
3. Coolify deployments: latest successful deployment must have `is_webhook=true`, exact SHA from `ci-approved`, and status `finished`.
4. Docker: running container must be healthy and carry an immutable image ID. Public `__release.json` SHA must equal the expected GitHub commit.
5. Negative gate: if `validate-product` is red, `promote-release` cannot run and production must remain on the last approved SHA. If promotion cannot fast-forward, no forced update is allowed.
6. Outage: if a deploy fails, keep/restore the last verified container image. Do not mark the release done until the public SHA and health agree.

## Limitations and branch controls

The `ci-approved` branch is a machine-managed deployment ref, not a second development branch. Humans and agents should develop through PRs into `main` and never push `ci-approved` directly. GitHub native branch protection/rulesets should prevent direct pushes; at verification, private-repository ruleset endpoints were unavailable on the current access/plan. Until enforceable branch protection exists, a privileged direct push to `ci-approved` remains an administrative bypass risk.

This contract applies to the static `zar-i-szlif-web` application only. Paperclip MCP has its own reviewed source-scoped host GitOps controller. Hermes Gateway remains a separately gated deployment and agent-migration workstream; a healthy Hermes canary alone does not authorize migration of 14 agents.
