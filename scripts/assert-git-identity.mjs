// Identity guard (KOMAA-492) — fail-closed.
//
// REAL commits in this repo must carry a canonical human identity. Synthetic
// identities — fixture `gate@example.invalid`, other `example.*` / `.invalid` /
// `.local` domains, and role-only accounts like
// `Engineer <engineer@paperclip.local>` — are confined to isolated throwaway
// repos in tests and must never author repo history (a `gate` commit already
// leaked onto main once).
//
// This guard only REJECTS. It never assigns or repairs identity; runtime
// identity projection is owned by the Harness branch.
//
// Enforcement points (all call this module, so they cannot drift apart):
// - `.githooks/pre-commit` — `--check-config` (effective user.name/user.email)
// - `.githooks/pre-push`   — commit objects in the pushed range, before the
//   release gate (runs before push/production)
// - `.github/workflows/ci.yml` — `--base/--head` on the pushed/PR range, so
//   `--no-verify` is never the normal path, only a CI-caught bypass

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GIT_ENV_KEYS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"];

/** Env with inherited repo pointers stripped, so inspection always follows cwd. */
export function cleanGitEnv(env = process.env) {
  const out = { ...env };
  for (const key of GIT_ENV_KEYS) delete out[key];
  return out;
}

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Role-only display names seen in leaked history: gate, Engineer,
// CTO (Paperclip), Paperclip CTO, MCP Engineer, Harness Agent, ...
const ROLE_NAMES = new Set([
  "gate",
  "engineer",
  "cto",
  "designer",
  "qa",
  "reviewer",
  "harness",
  "harnessagent",
  "mcpengineer",
  "paperclipcto",
  "ctopaperclip",
  "bot",
  "claude",
  "codex",
  "opencode",
]);

// Role-only email local-parts (exact match after stripping separators/tags).
const ROLE_LOCAL_PARTS = new Set([
  "gate",
  "engineer",
  "cto",
  "designer",
  "qa",
  "reviewer",
  "harness",
  "harnessagent",
  "mcpengineer",
  "admin",
  "bot",
]);

const RESERVED_BASE_DOMAINS = ["example.com", "example.org", "example.net"];

function domainViolation(domain) {
  const d = domain.toLowerCase();
  if (
    d === "localhost" || d.endsWith(".localhost") ||
    d.endsWith(".invalid") ||
    d.endsWith(".local") ||
    d.endsWith(".test") ||
    d.endsWith(".example") ||
    RESERVED_BASE_DOMAINS.some((base) => d === base || d.endsWith(`.${base}`))
  ) {
    return `email domain ${JSON.stringify(domain)} is synthetic/reserved`;
  }
  return null;
}

/**
 * Pure check. Returns violations; empty means the identity is acceptable.
 * `role` is only a label for messages ("author"/"committer"/"config author").
 */
export function checkIdentity({ name, email }) {
  const violations = [];
  const cleanName = String(name ?? "").trim();
  const cleanEmail = String(email ?? "").trim();

  if (!cleanName) violations.push("name is empty — configure a canonical human user.name");
  if (!cleanEmail) violations.push("email is empty — configure a canonical human user.email");
  if (violations.length > 0) return violations;

  // Exact allowlist: GitHub merge commits (committer of PR merges).
  if (cleanName === "GitHub" && cleanEmail.toLowerCase() === "noreply@github.com") return [];

  const at = cleanEmail.lastIndexOf("@");
  if (at < 1 || at === cleanEmail.length - 1 || cleanEmail.includes(" ")) {
    return [`email ${JSON.stringify(cleanEmail)} is not a usable address`];
  }
  const local = cleanEmail.slice(0, at).toLowerCase().split("+")[0];
  const domain = cleanEmail.slice(at + 1);

  const domainProblem = domainViolation(domain);
  if (domainProblem) {
    violations.push(domainProblem);
  } else if (domain.toLowerCase() !== "users.noreply.github.com") {
    if (ROLE_LOCAL_PARTS.has(local.replace(/[^a-z0-9]/g, ""))) {
      violations.push(`email local-part ${JSON.stringify(local)} is role-only, not a human identity`);
    }
  }
  if (ROLE_NAMES.has(normalize(cleanName))) {
    violations.push(`name ${JSON.stringify(cleanName)} is role-only, not a human identity`);
  }
  return violations;
}

function git(cwd, env, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: cleanGitEnv(env) });
}

function readConfig(cwd, env, key) {
  const r = git(cwd, env, ["config", "--get", key]);
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

/** Effective commit-time identity: env overrides win, then repo config. */
export function checkConfiguredIdentity({ cwd = process.cwd(), env = process.env } = {}) {
  const configuredName = readConfig(cwd, env, "user.name");
  const configuredEmail = readConfig(cwd, env, "user.email");
  const pairs = [
    ["author", env.GIT_AUTHOR_NAME ?? configuredName, env.GIT_AUTHOR_EMAIL ?? configuredEmail],
    ["committer", env.GIT_COMMITTER_NAME ?? configuredName, env.GIT_COMMITTER_EMAIL ?? configuredEmail],
  ];
  const violations = [];
  for (const [role, name, email] of pairs) {
    for (const v of checkIdentity({ name, email })) violations.push(`${role}: ${v}`);
  }
  return violations;
}

export function readCommitIdentities({ cwd = process.cwd(), env = process.env, sha }) {
  const r = git(cwd, env, ["log", "-1", "--format=%an%x00%ae%x00%cn%x00%ce%x00%s", sha]);
  if (r.status !== 0) throw new Error(`cannot inspect commit ${sha}: ${(r.stderr || "").trim()}`);
  const [authorName, authorEmail, committerName, committerEmail, subject] = r.stdout.replace(/\n$/, "").split("\0");
  return { sha, authorName, authorEmail, committerName, committerEmail, subject };
}

export function checkCommits({ cwd = process.cwd(), env = process.env, shas = [] } = {}) {
  const violations = [];
  for (const sha of shas) {
    let id;
    try {
      id = readCommitIdentities({ cwd, env, sha });
    } catch (error) {
      violations.push(`${String(sha).slice(0, 12)}: ${error.message}`);
      continue;
    }
    const short = String(sha).slice(0, 12);
    for (const v of checkIdentity({ name: id.authorName, email: id.authorEmail })) {
      violations.push(`${short} author (${id.subject}): ${v}`);
    }
    for (const v of checkIdentity({ name: id.committerName, email: id.committerEmail })) {
      violations.push(`${short} committer (${id.subject}): ${v}`);
    }
  }
  return violations;
}

/** New commits in merge-base(base, head)..head. Throws fail-closed. */
export function listRangeCommits({ cwd = process.cwd(), env = process.env, base = "origin/main", head = "HEAD" } = {}) {
  const mb = git(cwd, env, ["merge-base", base, head]);
  if (mb.status !== 0) {
    throw new Error(`cannot resolve merge-base(${base}, ${head}) — run: git fetch origin main`);
  }
  const from = mb.stdout.trim();
  const rl = git(cwd, env, ["rev-list", `${from}..${head}`]);
  if (rl.status !== 0) throw new Error(`cannot list commits ${from}..${head}: ${(rl.stderr || "").trim()}`);
  return rl.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function report(violations, emptyNote) {
  if (violations.length > 0) {
    console.error("[identity-gate] FAIL — refusing synthetic Git identity:");
    for (const v of violations) console.error(`[identity-gate] - ${v}`);
    process.exit(1);
  }
  console.log(`[identity-gate] PASS ${emptyNote ?? "canonical author/committer identity"}`);
}

function main() {
  const args = process.argv.slice(2);
  const baseArg = args.find((a) => a.startsWith("--base="));
  const headArg = args.find((a) => a.startsWith("--head="));
  const checkConfig = args.includes("--check-config");
  const shas = args.filter((a) => !a.startsWith("-"));

  try {
    if (checkConfig && shas.length === 0 && !baseArg && !headArg) {
      report(checkConfiguredIdentity({}));
      return;
    }
    if (baseArg || headArg) {
      const range = listRangeCommits({
        base: baseArg ? baseArg.slice("--base=".length) : "origin/main",
        head: headArg ? headArg.slice("--head=".length) : "HEAD",
      });
      if (range.length === 0) {
        report([], "no new commits in range");
        return;
      }
      report(checkCommits({ shas: range }));
      return;
    }
    if (shas.length === 0) {
      // No args: full local gate — configured identity plus new commits vs origin/main.
      const violations = checkConfiguredIdentity({}).map((v) => `config ${v}`);
      report([...violations, ...checkCommits({ shas: listRangeCommits({}) })]);
      return;
    }
    report(checkCommits({ shas }));
  } catch (error) {
    console.error(`[identity-gate] FAIL — ${error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
