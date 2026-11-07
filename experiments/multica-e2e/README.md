# Multica workflow PoC (isolated)

This Python feature and tests were generated in a local OpenCode CLI run (DeepSeek V4.1 Flash), then independently reviewed by another OpenCode CLI run (Qwen 3.8 Flash). **These coding runs were not orchestrated by Multica.**

Purpose: verify a GitHub branch -> PR -> CI -> merge -> readback path independently of the production release branch, and compare with Multica's separate native DAG integration tests.

Run: `python3 -m unittest discover -s experiments/multica-e2e -p 'test_*.py' -v`

No production application code is changed and no production deployment should occur from this experiment.
