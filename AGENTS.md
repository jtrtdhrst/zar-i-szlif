# Agent and contributor guidance — Żar i Szlif product

This repository owns **the application, product pages and product-specific MCP only**. Infrastructure services, general-purpose MCPs, Paperclip, Hermes Gateway and Opik integration sources belong to `miloszspyrka-code/harness-zar-i-szlif`. Follow the repository ownership map in [README.md](README.md); never duplicate infrastructure code here.

## Mandatory repository and issue preflight

1. Before any write, read the current `README.md` and this file, then only the relevant product architecture and release docs. For any panel production/release change, read [ops/coolify/CI_GATED_RELEASE.md](ops/coolify/CI_GATED_RELEASE.md) and the actual `.github/workflows/product-ci.yml`.
2. Use the current managed Paperclip `agent-git-delivery` skill and its canonical Wiki contract `wiki/concepts/agent-git-delivery-policy.md`. This local file adds **repository-specific** boundaries; it does not replace Wiki or claim that a policy is API-enforced.
3. Resolve the actual Paperclip issue, assigned agent, live issue-run authorization, workspace, base SHA, writable remote, target paths and correct service owner. Preserve existing worktrees, PRs and unrelated uncommitted work. Never develop directly on `main` or on the deployment ref.
4. Before first issue/run write, record a bounded `DOC_PREFLIGHT` checkpoint in that existing delivery record: issue/run/agent, repository, base SHA, actually read documentation with blob hashes, paths, ownership, release lane, relevant current runtime/source state, conflicts and PASS or STOP. Do not invent a read, SHA, review, runtime check or grant. A missing or stale source-of-truth requires reconciliation, not speculation.
5. If the targeted file belongs in Harness or a service-specific repository, STOP and use its existing canonical issue/PR instead. Do not create duplicate tickets or integrations merely to work around missing access.

## Product build, review and release boundaries

- The product `main` PR requires exact-head `validate-product` CI (lint/typecheck/tests, container build and source-SHA negative checks), independent Paperclip native review where required, and a reviewed merge.
- **GitHub Actions only validates.** Merged Product PR #156 removed `promote-release` and `verify-production` from `.github/workflows/product-ci.yml`. Never restore an automatic `main → ci-approved` writer.
- The native reviewed promotion controller lives in Harness and runs on the Ubuntu host. Only that authorized writer can advance `ci-approved` after matching issue-run, independent review, merged SHA, CI and release policy. Neither a successful CI run nor a source merge is sufficient production proof.
- Coolify `zar-i-szlif-web` watches the `ci-approved` ref and builds `ops/coolify/Dockerfile`. Production acceptance requires the exact approved SHA in `/__release.json`, `/healthz` HTTP 200, immutable running image digest, actual Coolify deployment record and retained/tested rollback. Keep the last known healthy image if a gate fails.
- Do not manually force-push `ci-approved`, rewrite history, change the watched branch, deploy on unreviewed code, invent a webhook receipt or bypass GitHub/Paperclip/Cloudflare permissions.
- Keep the three existing production Cloudflare Workers outside routine repo cleanup; do not add an unnecessary Worker, PAT, GitHub App, service or parallel MCP.
- If GitHub branch protection is not enforced, report the risk plainly. Do not represent prompts, CI or reviewer comments as server-side protection.

For the current status, consult the live systems. Dated README/runbook checkpoints are historical evidence, not a guarantee that the next promotion or Hermes integration succeeded.
