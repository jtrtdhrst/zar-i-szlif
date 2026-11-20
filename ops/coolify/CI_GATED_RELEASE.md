# Reviewed production release: Żar i Szlif panel

## GitHub source contract — reviewed on 2026-11-05

- **Product source:** `miloszspyrka-code/zar-i-szlif:main`.
- **CI:** `.github/workflows/product-ci.yml` runs `validate-product`, including code verification, production Docker build and release-SHA/negative startup checks. **There is no `promote-release` or `verify-production` job in this workflow after merged Product PR #156.** Green CI alone must not advance production.
- **Promotion authority:** the separately versioned and reviewed native controller in `miloszspyrka-code/harness-zar-i-szlif` (`scripts/paperclip_native_release_gate.py`, `scripts/product_native_promotion.py`; Harness PRs #59 and #60) must validate the real native Paperclip issue decision, independent reviewer, accepted source SHA, merged GitHub PR SHA and successful `validate-product` before an authorized forward-only promotion. It must refuse unapproved commits, stale candidates and competing release writers.
- **Deployment reference:** existing Coolify application `zar-i-szlif-web` (`k0vwdsjazxguvgmh4qixjgxn`) watches `ci-approved`. This is a deployment reference, **not** a development branch and not automatically advanced by the Product GitHub Actions workflow.
- **Docker source:** `ops/coolify/Dockerfile` in this repository. The running image must embed the actual deployed 40-hex source commit via `SOURCE_COMMIT`.
- **Live release evidence:** exact approved SHA in GitHub `ci-approved`, matching deployment record and production `https://panel.zariszlif.pl/__release.json`, plus `/healthz` HTTP 200 and retained rollback target. A matching GitHub ref is not, by itself, proof of deployment.
- **Controller activation is a separate operational claim.** Source merged into `harness:main` does **not** prove that the controller service/timer is installed, enabled or that it successfully promoted an actual change. Read runtime state before marking release ready.

## GitHub snapshot versus production proof

As of the GitHub read on 2026-11-05, `main` and `ci-approved` both pointed to `b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14`. This is repository-state evidence only: it is **not** the public release SHA or a new successful deployment assertion. A prior checkpoint on 2026-11-04 confirmed the then-live `7322f946a5a395db29fa95d14da1ea9037e30d7c` build; do not silently reuse that dated checkpoint for later commits.

## Mandatory operator checks

1. Validate that the candidate is an accepted Paperclip issue-run artifact, with independently persisted review decision on the current immutable SHA and no outstanding changes requested.
2. Verify the GitHub merge result, target ancestry and the exact successful `validate-product` checks for that source SHA; do not infer approval from a green workflow.
3. Verify the reviewed controller deployed on the Ubuntu host is the intended source and is the **only** writer of `ci-approved`. Confirm its actual enabled/running state and controller logs; do not enable a second promoter.
4. Promote only the accepted target SHA with compare-and-swap/non-force ref semantics. A missing native decision, mismatched check, wrong source branch or changed head must fail closed.
5. Confirm Coolify deployment for the `ci-approved` source SHA and read back the container image/digest and `/__release.json`; `/healthz` must be healthy. Preserve the prior digest for tested rollback.
6. If the controller, CI, review or readback is missing or inconsistent, keep the last verified deployment and mark release `UNVERIFIED`; do not advance `ci-approved` or claim DONE.

## Live controller and panel readback — 2026-11-05

Read directly from the Ubuntu host's real systemd service and the public production endpoints:

- `product-native-promotion.timer` is **enabled and active**; the one-shot `product-native-promotion.service` completed with exit status `0/SUCCESS` and did not leave a persistent process.
- The actual execution at 22:18:38 UTC returned `{"result":"already_released","sha":"b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14","live":"b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14"}`. This is evidence that the source-controlled controller ran its no-op/reconciled path, **not** an independent proof that a new unreviewed PR could be blocked in all failure modes.
- Live `https://panel.zariszlif.pl/__release.json` returned HTTP 200 and `commit=b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14` (`source=zar-i-szlif/main`).
- Live `https://panel.zariszlif.pl/healthz` returned HTTP 200 with body `ok`.
- Coolify application `k0vwdsjazxguvgmh4qixjgxn` is `running:healthy`, linked to GitHub App source `miloszspyrka-code/zar-i-szlif:ci-approved`, Dockerfile `/ops/coolify/Dockerfile`. Latest finished deployment: `job4atvrc3wy7symxqao74os`, source commit `b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14`, manual (`is_webhook=false`); a separate finished webhook deployment `6a8futuhzhxdlsfwqy7xbr9s` contains the same SHA.
- The actually running healthy Docker container `k0vwdsjazxguvgmh4qixjgxn-20261105T205555` uses image ID `sha256:787e1e24ae66fce960e9ce57528f4342c26a6145a102f509f317f98966a10d2b`. This is the immutable local-image readback, not proof of a fresh controller-initiated promotion or a tested rollback.
- `paperclip-mcp-auto-release.timer` remains disabled. Its release domain is separate and must not be activated as a second product promoter.
- The same SHA was present on GitHub refs `main` and `ci-approved` at the read time.

**Remaining proof gate:** the next authorized, independently approved PR must demonstrate source SHA → native decision → exact CI → only-writer promotion → actual Coolify deployment → immutable image digest → production readback → tested rollback. Existing no-op checks alone do not prove that future release cycle.

## Known limitations

GitHub native branch protection/rulesets were not enforceable on the previously checked private-repository access/plan. Git hooks, reviewer prompts and CI are not a replacement for server-side protection. This must remain an explicit risk until actual ruleset/protection readback confirms enforcement.

The obsolete 2026-11-04 contract (`main` → CI `promote-release` → `ci-approved`) was invalidated by Product PR #156 and must not be used. Never restore that automatic write job alongside the native controller.

This release contract covers only the `zar-i-szlif-web` panel. Paperclip MCP, Hermes Gateway and other integrations have their own independent source SHA, approval, deployment, authentication and rollback gates. Three existing Cloudflare Workers remain outside this repository-cleanup scope.
