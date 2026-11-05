"""Prevent accidental bypass of the externally controlled Paperclip release lane.

Product CI validates any PR and main push, but it must never write ci-approved.
The Ubuntu release controller requires real Paperclip native approval before
advancing the ref and uses Coolify HTTP readback for deployed source identity.
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

    def test_product_validation_still_runs_for_pull_request_and_main(self):
        for required in ("  pull_request:", "    branches: [main]",
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
