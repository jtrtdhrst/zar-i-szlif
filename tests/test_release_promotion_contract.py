"""Prevent accidental bypass of the externally controlled Paperclip release lane.

Product CI executes on trusted main push or main dispatch only, never on
unreviewed PR-head workflows. Pre-merge exact-SHA local CI requires independent
native review. The Ubuntu release controller alone verifies admission and
Coolify HTTP readback; this workflow never writes ci-approved.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "product-ci.yml"


class ReleaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding="utf-8")

    def test_source_identifies_external_gated_owner(self):
        self.assertIn("RELEASE_OWNER: native-paperclip-product-promotion-v1", self.source)
        self.assertIn("Enforce external reviewed-promotion contract", self.source)

    def test_ci_repository_owner_matches_current_canonical_source(self):
        self.assertIn("GITHUB_REPOSITORY", self.source)
        self.assertIn("'jtrtdhrst/zar-i-szlif'", self.source)
        self.assertNotIn("miloszspyrka-code/zar-i-szlif", self.source)

    def test_main_checkout_must_match_workflow_sha_before_source_execution(self):
        self.assertIn("Verify checked-out main SHA before executing repository code", self.source)
        self.assertIn('test "$(git rev-parse --verify HEAD)" = "$GITHUB_SHA"', self.source)
        self.assertIn(
            'test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify refs/remotes/origin/main)"',
            self.source,
        )
        verification = self.source.index("Verify checked-out main SHA before executing repository code")
        validation = self.source.index("Enforce external reviewed-promotion contract")
        self.assertLess(verification, validation)

    def test_rootless_runner_admission_hook_is_source_controlled_and_fail_closed(self):
        hook = (ROOT / "ops" / "ci" / "zis-product-runner-admission.sh").read_text(encoding="utf-8")
        self.assertTrue(hook.startswith("#!/usr/bin/env bash"))
        self.assertIn("set -Eeuo pipefail", hook)
        self.assertNotIn("miloszspyrka-code/zar-i-szlif", hook)
        self.assertIn("GITHUB_REPOSITORY:-", hook)
        self.assertIn("'jtrtdhrst/zar-i-szlif'", hook)
        self.assertIn("jtrtdhrst/zar-i-szlif/.github/workflows/product-ci.yml@refs/heads/main", hook)
        self.assertIn("actions-zis-product", hook)
        self.assertIn("GITHUB_EVENT_NAME:-", hook)
        self.assertIn("workflow_dispatch", hook)
        self.assertIn("'refs/heads/main'", hook)
        self.assertIn("GITHUB_SHA:-", hook)
        self.assertIn("zis-rootless-docker/docker.sock", hook)
        self.assertIn("! -w /run/docker.sock", hook)
        self.assertIn("! -r /opt/zis-actions-runner-harness/.credentials", hook)
        self.assertIn("exit 86", hook)

    def test_no_automatic_ref_write_or_direct_deployment(self):
        for forbidden in ("  promote-release:", "  verify-production:",
                          "contents: write", "git push origin",
                          "gh api repos/", "git update-ref"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.source)

    def test_product_validation_requires_trusted_main_and_never_runs_pr_head(self):
        # The workflow file on a PR can itself be malicious: no PR-originated
        # workflow may schedule this persistent, production-adjacent runner.
        for forbidden in ("  pull_request:\n", "  pull_request_target:\n"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.source)
        for required in ("  push:\n", "    branches: [main]", "  workflow_dispatch:\n",
                         "if: github.ref == 'refs/heads/main'",
                         "runs-on: [self-hosted, Linux, X64, zis-local-build]",
                         "Defense in depth - root-owned main-only admission",
                         "  validate-product:", "npm run validate:code",
                         "docker build --file ops/coolify/Dockerfile",
                         "Verify source SHA is emitted by the real nginx entrypoint",
                         "Reject versionless container starts"):
            with self.subTest(required=required):
                self.assertIn(required, self.source)

    def test_runner_never_executes_dependency_install_on_host(self):
        # A lockfile may contain lifecycle hooks. Run them only in the
        # unprivileged rootless build, not under the persistent runner UID.
        self.assertNotIn("actions/setup-node@", self.source)
        self.assertNotIn("      - name: Install locked dependencies", self.source)
        self.assertNotIn("run: npm ci", self.source)
        self.assertIn("docker build --file ops/coolify/Dockerfile --target build", self.source)
        self.assertIn("docker run --rm --network none", self.source)

    def test_product_ci_tags_are_unique_per_run_attempt(self):
        for tag in ("CI_BUILD_TAG", "CI_VALIDATION_TAG", "CI_VERIFIED_TAG"):
            self.assertIn(tag + ": product-ci:", self.source)
        self.assertIn("${{ github.run_id }}", self.source)
        self.assertIn("${{ github.run_attempt }}", self.source)
        self.assertIn("--build-arg \"SOURCE_BUILD_IMAGE=$CI_BUILD_TAG\"", self.source)
        self.assertIn('name="$CI_CANARY_NAME"', self.source)
        self.assertNotIn("--tag product-ci:build", self.source)
        self.assertNotIn("--tag product-ci:validation", self.source)
        self.assertNotIn("--tag product-ci:verified", self.source)

    def test_global_token_is_read_only(self):
        self.assertIn("permissions:\n  contents: read\n", self.source)


if __name__ == "__main__":
    unittest.main()
