// Deterministic Git branch/commit admission for NEW agent delivery lanes.
// Historical PRs created before adoption remain reviewable, never silently deleted.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ADOPTION = "2026-10-15T00:00:00Z";
const CANONICAL = /^(?:hotfix\/)?KOMAA-([1-9]\d*)$/;
const SUBJECT = /^(feat|fix|docs|test|chore|refactor|perf|build|ci)\(KOMAA-([1-9]\d*)\): \S.{6,}$/;

export function issueFromBranch(branch) {
  const m = String(branch ?? "").match(CANONICAL);
  return m ? "KOMAA-" + m[1] : null;
}

export function candidateRef(mode, headSha) {
  if (mode !== "pr") return "HEAD";
  if (!/^[0-9a-f]{40}$/.test(String(headSha ?? ""))) throw new Error("PR head SHA missing or invalid");
  return headSha;
}

export function issueFromAnyBranch(branch) {
  const m = String(branch ?? "").match(/(?:^|\/)KOMAA-([1-9]\d*)(?:$|[-/])/i);
  return m ? "KOMAA-" + m[1] : null;
}

export function conflictingBranches(branch, remoteBranches) {
  const issue = issueFromBranch(branch);
  if (!issue) return [];
  return remoteBranches.filter((other) => other !== branch && issueFromAnyBranch(other) === issue).sort();
}

// Pure predicate; caller obtains branches and subjects with git, not LLM judgment.
export function evaluateBranch({ branch, mode, createdAt, remoteBranches = [], subjects = [] }) {
  const errors = [];
  const name = String(branch ?? "");
  if (!["new", "existing", "pr"].includes(mode)) return ["unknown admission mode"];
  if (!name || name === "main" || name === "master" || name.startsWith("refs/")) {
    return ["protected, missing, or invalid branch name"];
  }
  // Historical branches remain valid, but a canonical existing issue branch
  // must validate the issue ownership of every newly pushed commit.
  if (mode === "existing" && !issueFromBranch(name)) return errors;
  if (mode === "pr" && (!createdAt || !Number.isFinite(Date.parse(createdAt)))) {
    return ["PR created_at evidence missing or invalid"];
  }
  if (mode === "pr" && Date.parse(createdAt) < Date.parse(ADOPTION)) return errors;

  const issue = issueFromBranch(name);
  if (!issue) return ["new branch must be exactly KOMAA-N or hotfix/KOMAA-N"];
  const duplicates = mode === "existing" ? [] : conflictingBranches(name, remoteBranches);
  if (duplicates.length) errors.push("another branch already owns " + issue + ": " + duplicates.join(", "));
  for (const subject of subjects) {
    const m = String(subject).match(SUBJECT);
    if (!m || "KOMAA-" + m[2] !== issue) {
      errors.push("commit subject does not match " + issue + ": " + JSON.stringify(subject));
    }
  }
  return errors;
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr || "").trim());
  return r.stdout.trim();
}

function main() {
  const args = process.argv.slice(2);
  const get = (prefix) => args.find((s) => s.startsWith(prefix))?.slice(prefix.length);
  const mode = get("--mode=");
  const branch = get("--branch=");
  const createdAt = get("--created-at=");
  const headSha = get("--head-sha=");
  const oldSha = get("--old-sha=");
  try {
    const oldPR = mode === "pr" && createdAt && Number.isFinite(Date.parse(createdAt)) &&
      Date.parse(createdAt) < Date.parse(ADOPTION);
    const mustCheck = mode === "new" || (mode === "pr" && !oldPR);
    let remoteBranches = [];
    let subjects = [];
    if (mode === "existing" && issueFromBranch(branch)) {
      if (![oldSha, headSha].every((sha) => /^[0-9a-f]{40}$/.test(String(sha ?? "")))) {
        throw new Error("existing branch requires old and new 40-character commit SHAs");
      }
      git(["cat-file", "-e", oldSha + "^{commit}"]);
      git(["cat-file", "-e", headSha + "^{commit}"]);
      const ff = spawnSync("git", ["merge-base", "--is-ancestor", oldSha, headSha]);
      if (ff.status !== 0) throw new Error("non-fast-forward update of canonical issue branch is forbidden");
      subjects = git(["log", "--format=%s", oldSha + ".." + headSha]).split("\n").filter(Boolean);
    } else if (mustCheck && issueFromBranch(branch)) {
      // Remote read is authoritative for other branch names owning the same issue.
      remoteBranches = git(["ls-remote", "--heads", "origin"]).split("\n")
        .filter(Boolean).map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, "")).filter(Boolean);
      const mainRef = git(["rev-parse", "--verify", "origin/main"]);
      // Pull request checkout points at a SYNTHETIC GitHub merge commit.
      // Check only real PR head commits for conventional issue ownership.
      const realCandidate = candidateRef(mode, headSha);
      git(["cat-file", "-e", realCandidate + "^{commit}"]);
      const mergeBase = git(["merge-base", mainRef, realCandidate]);
      subjects = git(["log", "--format=%s", mergeBase + ".." + realCandidate]).split("\n").filter(Boolean);
    }
    const violations = evaluateBranch({ branch, mode, createdAt, remoteBranches, subjects });
    if (violations.length) {
      console.error("[branch-policy] FAIL");
      for (const violation of violations) console.error("[branch-policy] - " + violation);
      process.exit(2);
    }
    console.log("[branch-policy] PASS " + (oldPR ? "legacy existing PR (no destructive migration)" :
      mode === "existing" ? "existing remote branch" : "canonical issue branch") + " " + branch);
  } catch (error) {
    console.error("[branch-policy] FAIL " + error.message);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
