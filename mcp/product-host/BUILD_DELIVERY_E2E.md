# Native source-root delivery smoke

Component: **Product MCP Host**

This file is intentionally located inside the service-owned build root. A change to this file is a safe, non-runtime Git input for testing path-scoped CI selection. It must not change application behavior, container credentials or deployment authorization.

Acceptance conditions:

1. A feature branch in `jtrtdhrst/zar-i-szlif` opens a PR to `main`; required `PR baseline` and `Verify GitHub PR and main checkout` checks succeed.
2. The PR is squash-merged to `main`; record the resulting 40-character commit SHA and verify the post-merge smoke check.
3. The source-root change must trigger `.github/workflows/product-ci.yml` as applicable. Check actual jobs (not just workflow definitions) and record their conclusions and artifact digests if published.
4. Confirm any candidate deployed via Coolify is tied to that SHA with a healthy runtime and a rollback path. **Do not** report production completion solely because GitHub CI succeeded.
5. A separate real Multica/Hermes agent run must independently demonstrate GitHub write access; commits made through an operator connector do not establish agent authorization.

This is a source-root trigger fixture, not a new deployment controller or a change to upstream Multica.

## Live native Coolify source webhook regression (2026-11-28)

This source-root documentation change accompanies Product Web's public delivery marker in the same reviewed PR. It triggers the Product MCP Host build/deploy selector without changing the MCP HTTP protocol, auth logic, or Supabase environment. After merge, verify the protected main SHA, OCI digest, Coolify deployment and health separately.
