# Native GitHub delivery verification

Repository: `jtrtdhrst/zar-i-szlif`.

This is the lightweight native GitHub delivery contract. It does not replace Multica, add an agent permission broker, or implement a deployment controller.

1. An assigned Multica agent checks out this repository through the native Multica workspace/worktree mechanism.
2. The actual Hermes task process uses standard `git` and GitHub CLI. `gh auth status` **must succeed in that process** before claiming agent write access. Successful GitHub operations by a separate operator do not establish agent permission.
3. Commit to an unprotected feature branch and push with an authenticated GitHub identity; open a pull request targeting `main`.
4. The active GitHub `main-protection` ruleset requires both `PR baseline` and `Verify GitHub PR and main checkout`, plus a squash merge via pull request. An independent approving review is not required by the current ruleset.
5. After merge, read the exact `main` SHA and verify the native GitHub delivery smoke workflow passed at **that SHA**.
6. Image publishing, Coolify source selection, production health and release SHA readback are **separate** deployment checks. Do not claim a full production release based on GitHub CI alone.

For a non-mutating agent authentication probe use `GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:refs/heads/<isolated-test-name>`; this is not proof of a real push and must be reported as such.

The native GitHub test workflow is `.github/workflows/native-git-delivery-e2e.yml`. This document is intentionally limited to repository delivery behavior, not an application feature or automatic deployment approval.
