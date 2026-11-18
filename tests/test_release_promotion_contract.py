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

    def test_global_token_is_read_only(self):
        self.assertIn("permissions:\n  contents: read\n", self.source)


if __name__ == "__main__":
    unittest.main()
