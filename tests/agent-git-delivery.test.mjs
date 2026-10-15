import test from "node:test";
import assert from "node:assert/strict";
import { ADOPTION, issueFromBranch, issueFromAnyBranch, conflictingBranches, candidateRef, evaluateBranch } from "../scripts/assert-branch-policy.mjs";

const valid = (branch, mode = "new", extra = {}) => evaluateBranch({
  branch, mode, remoteBranches: [branch], subjects: ["fix(" + issueFromBranch(branch) + "): repair an actual defect"], ...extra,
});
test("one new canonical issue branch is allowed", () => {
  assert.equal(issueFromBranch("KOMAA-879"), "KOMAA-879");
  assert.equal(issueFromBranch("hotfix/KOMAA-879"), "KOMAA-879");
  assert.deepEqual(valid("KOMAA-879"), []);
});
test("branches from retries, agents and review are never independently created", () => {
  for (const name of ["KOMAA-879-retry", "fix/KOMAA-879", "review/KOMAA-879", "KOMAA-879-deploy"]) {
    assert.equal(issueFromBranch(name), null);
    assert.ok(evaluateBranch({ branch: name, mode: "new" }).length);
  }
});
test("one root issue cannot own two remote branches", () => {
  assert.equal(issueFromAnyBranch("fix/KOMAA-879-review"), "KOMAA-879");
  assert.deepEqual(conflictingBranches("KOMAA-879", ["KOMAA-879", "hotfix/KOMAA-879"]), ["hotfix/KOMAA-879"]);
  assert.match(evaluateBranch({ branch:"KOMAA-879", mode:"new",
    remoteBranches:["KOMAA-879", "fix/KOMAA-879-review"] })[0], /another branch already owns/);
});
test("one branch can receive meaningful new commits without branching", () => {
  assert.deepEqual(valid("KOMAA-879", "existing", { subjects: [] }), []);
  assert.deepEqual(valid("KOMAA-879", "existing"), []);
});
test("existing canonical branches reject all newly pushed wrongly owned commits", () => {
  assert.match(evaluateBranch({ branch:"KOMAA-879", mode:"existing",
    subjects:["fix(KOMAA-777): wrong issue identity"] })[0], /commit subject/);
  assert.match(evaluateBranch({ branch:"KOMAA-879", mode:"existing",
    subjects:["generic invalid commit"] })[0], /commit subject/);
  assert.deepEqual(evaluateBranch({ branch:"KOMAA-879", mode:"existing",
    subjects:["fix(KOMAA-879): correct issue ownership"] }), []);
});
test("historical noncanonical existing branches remain available", () => {
  assert.deepEqual(evaluateBranch({ branch:"brand/zar-i-szlif-direct-20261013", mode:"existing",
    subjects:["old historical commit"] }), []);
});
test("new PRs enforce canonical identity and commit subject", () => {
  const createdAt = "2026-10-16T01:00:00Z";
  assert.deepEqual(valid("KOMAA-879", "pr", { createdAt }), []);
  assert.match(evaluateBranch({ branch:"KOMAA-879", mode:"pr", createdAt,
    subjects:["feat(KOMAA-777): wrong task identifier"] })[0], /commit subject/);
  assert.ok(evaluateBranch({ branch:"fix/KOMAA-879", mode:"pr", createdAt }).length);
});
test("already-open PRs before adoption do not get retroactively blocked", () => {
  const before = new Date(Date.parse(ADOPTION) - 1000).toISOString();
  assert.deepEqual(evaluateBranch({ branch:"brand/zar-i-szlif-direct-20261013",
    mode:"pr", createdAt:before, subjects:["old historical commit"] }), []);
});
test("missing PR timestamp and protected branch fail closed", () => {
  assert.ok(evaluateBranch({ branch:"KOMAA-879", mode:"pr" }).length);
  assert.ok(evaluateBranch({ branch:"main", mode:"existing" }).length);
  assert.ok(evaluateBranch({ branch:"master", mode:"new" }).length);
});

test("PR candidate is exact event head, not GitHub synthetic test-merge HEAD", () => {
  const sha = "f".repeat(40);
  assert.equal(candidateRef("pr", sha), sha);
  assert.equal(candidateRef("new"), "HEAD");
  assert.throws(() => candidateRef("pr", null), /PR head SHA/);
});
