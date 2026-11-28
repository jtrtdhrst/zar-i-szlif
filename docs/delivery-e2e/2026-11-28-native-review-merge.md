# Native protected-branch review and merge validation — Product

This documentation-only change validates the 2026-11-28 GitHub PR review and protected-branch merge process. It is not an application release.

## Required GitHub-native evidence

1. Create a task-scoped feature branch from the exact `main` SHA, with no direct push to protected `main`.
2. Open a non-draft PR with immutable head SHA, reviewer evidence, and a review ID. A `COMMENT` review does not count as an independent approval.
3. Require the exact-head `PR baseline`, `Verify GitHub PR and main checkout`, and any other required checks to pass before merge. Unresolved review threads block merge.
4. Perform only a native, allowed squash merge. Independently read back the PR's merged state and the final `main` commit; inspect the post-merge checks.
5. As this PR changes documentation only, it should not trigger Product Web or MCP Host production deployments. Real Product source delivery must independently prove Git SHA → immutable artifact → running Coolify revision → public functional E2E and rollback readiness.

## Agent authorization

GitHub OAuth for an operator does not establish permission for the Multica Engineer agent. Verify GitHub Ops MCP write identity and repository scope from the actual agent before claiming autonomous delivery. Keep release and security HOLDs unchanged.
