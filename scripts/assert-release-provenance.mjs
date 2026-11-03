// Production provenance guard (KOMAA-457).
//
// Production delivery must consume one exact verified GitHub
// SHA on origin/main. This module is the single fail-closed assertion used by
// the local release gate (scripts/release-targets.mjs) and by the production
// deploy jobs, so both paths cannot drift apart.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PRODUCTION_REF = "refs/heads/main";
const PRODUCTION_BRANCH = "main";

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

/**
 * Pure check. Returns a list of violations; empty means provenance is valid.
 * `requireMainTip` is true for a push to main, where the event SHA is by
 * definition the tip. Manual dispatch is allowed to be an ancestor.
 */
export function checkProvenance({
  ref,
  expectedSha,
  headSha,
  isOnMain,
  mainTipSha = null,
  requireMainTip = false,
}) {
  const violations = [];

  if (ref !== PRODUCTION_REF) {
    violations.push(`ref ${ref} is not ${PRODUCTION_REF}; non-main refs can never mutate production`);
  }
  if (!expectedSha) {
    violations.push("no candidate SHA supplied; production delivery requires an exact SHA");
  }
  if (headSha !== expectedSha) {
    violations.push(`checked out HEAD ${headSha} does not match candidate SHA ${expectedSha}`);
  }
  if (!isOnMain) {
    violations.push(`SHA ${expectedSha} is not reachable from origin/${PRODUCTION_BRANCH}`);
  }
  if (requireMainTip && mainTipSha && expectedSha !== mainTipSha) {
    violations.push(`candidate SHA ${expectedSha} is not the origin/main tip ${mainTipSha}`);
  }

  return violations;
}

function readProvenanceFacts() {
  const ref = process.env.GITHUB_REF;
  const expectedSha = process.env.GITHUB_SHA || process.env.RELEASE_CANDIDATE_SHA;
  const head = git(["rev-parse", "HEAD"]);
  const headSha = head.status === 0 ? head.stdout.trim() : null;

  const fetched = git(["fetch", "--no-tags", "origin", PRODUCTION_REF]);
  const tip = git(["rev-parse", "FETCH_HEAD"]);
  const mainTipSha = fetched.status === 0 && tip.status === 0 ? tip.stdout.trim() : null;

  const isOnMain =
    Boolean(mainTipSha) && spawnSync("git", ["merge-base", "--is-ancestor", expectedSha ?? "", "FETCH_HEAD"]).status === 0;

  return { ref, expectedSha, headSha, isOnMain, mainTipSha };
}

function main() {
  const facts = readProvenanceFacts();
  const requireMainTip = process.env.GITHUB_EVENT_NAME === "push";
  const violations = checkProvenance({ ...facts, requireMainTip });

  if (violations.length > 0) {
    console.error("[release-provenance] FAIL — refusing to mutate production:");
    for (const violation of violations) console.error(`[release-provenance] - ${violation}`);
    process.exit(1);
  }

  console.log(
    `[release-provenance] PASS ref=${facts.ref} sha=${facts.expectedSha} main-tip=${facts.mainTipSha}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
