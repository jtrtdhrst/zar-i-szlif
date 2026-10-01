// Identity guard regression coverage (KOMAA-492).
//
// Fixture fake identities stay confined to isolated temp repos with
// fixture-local git config only: env strips inherited GIT_* pointers, dirs are
// asserted outside the real repo, and nothing touches global/workspace config.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkIdentity, cleanGitEnv } from "../scripts/assert-git-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const guardScript = `${root}/scripts/assert-git-identity.mjs`;
const prePush = readFileSync(`${root}/.githooks/pre-push`, "utf8");
const preCommit = readFileSync(`${root}/.githooks/pre-commit`, "utf8");
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");

const suiteHeadBefore = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout;
const suitePorcelainBefore = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;

const GIT_ENV = cleanGitEnv();

const GATE = { name: "gate", email: "gate@example.invalid" };
const ROLE = { name: "Engineer", email: "engineer@paperclip.local" };
const CANONICAL = { name: "miloszspyrka-code", email: "milosz.spyrka@gmail.com" };

function fixtureTmpBase() {
  const base = tmpdir();
  return base && isAbsolute(base) ? base : "/tmp";
}

function assertFixtureDirPathIsolated(dir) {
  assert.ok(isAbsolute(dir), `fixture dir must be absolute (TMPDIR leak?): ${dir}`);
  const realDir = realpathSync(dir);
  const realRoot = realpathSync(root);
  assert.ok(
    realDir !== realRoot && !realDir.startsWith(`${realRoot}/`),
    `fixture dir resolves inside the repo: ${realDir}`,
  );
}

function initFixture(identity) {
  const dir = mkdtempSync(join(fixtureTmpBase(), "kompas-identity-"));
  assertFixtureDirPathIsolated(dir);
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r;
  };
  git("init", "--initial-branch=main");
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", env: GIT_ENV });
  assert.equal(realpathSync(top.stdout.trim()), realpathSync(dir), "fixture dir is not its own repo");
  // Fixture-local config only — never global/workspace.
  git("config", "user.name", identity.name);
  git("config", "user.email", identity.email);
  return { dir, git };
}

function commitFile({ dir, git }, file, message) {
  writeFileSync(join(dir, file), `${file}: ${message}\n`);
  git("add", "-A");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD").stdout.trim();
}

function runGuard({ dir, args, extraEnv = {} }) {
  const r = spawnSync(process.execPath, [guardScript, ...args], {
    cwd: dir,
    encoding: "utf8",
    // HOME points at the fixture so no ambient global gitconfig can leak in.
    env: { ...GIT_ENV, HOME: dir, ...extraEnv },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// --- pure identity classification -------------------------------------------

test("gate@example.invalid is rejected as synthetic", () => {
  const violations = checkIdentity(GATE);
  assert.ok(violations.length > 0, "gate identity must be rejected");
  assert.match(violations.join("\n"), /synthetic|reserved/);
});

test("role-only identities are rejected, including role local-parts on real domains", () => {
  for (const identity of [
    ROLE,
    { name: "CTO (Paperclip)", email: "cto@paperclip.local" },
    { name: "Paperclip CTO", email: "cto@kompaszbiorek.pl" },
    { name: "Harness Agent", email: "harness@paperclip.local" },
    { name: "MCP Engineer", email: "mcp-engineer@kompaszbiorek.pl" },
  ]) {
    assert.ok(checkIdentity(identity).length > 0, `${identity.name} <${identity.email}> must be rejected`);
  }
});

test("canonical human identity and GitHub merge commits pass", () => {
  assert.deepEqual(checkIdentity(CANONICAL), []);
  assert.deepEqual(
    checkIdentity({ name: "GitHub", email: "noreply@github.com" }),
    [],
    "GitHub merge committer must stay allowed",
  );
  // A human hiding behind the merge-bot address is still synthetic.
  assert.ok(checkIdentity({ name: "gate", email: "noreply@github.com" }).length > 0);
});

// --- poisoned local identity (commit path) -----------------------------------

test("poisoned fixture-local identity fails --check-config without touching real config", () => {
  const bad = initFixture(GATE);
  try {
    commitFile(bad, "seed.txt", "seed");
    const r = runGuard({ dir: bad.dir, args: ["--check-config"] });
    assert.notEqual(r.status, 0, "poisoned local identity must fail");
    assert.match(r.out, /example\.invalid/);
  } finally {
    rmSync(bad.dir, { recursive: true, force: true });
  }
});

test("canonical fixture-local identity passes --check-config", () => {
  const good = initFixture(CANONICAL);
  try {
    commitFile(good, "seed.txt", "seed");
    const r = runGuard({ dir: good.dir, args: ["--check-config"] });
    assert.equal(r.status, 0, `canonical identity must pass: ${r.out}`);
  } finally {
    rmSync(good.dir, { recursive: true, force: true });
  }
});

// --- pushed range inspection (push path) --------------------------------------

test("synthetic commits in the pushed range are rejected; canonical pass", () => {
  const gateRepo = initFixture(GATE);
  const roleRepo = initFixture(ROLE);
  const goodRepo = initFixture(CANONICAL);
  try {
    commitFile(gateRepo, "f.txt", "seed");
    const gateSha = commitFile(gateRepo, "g.txt", "synthetic change");
    const gateRun = runGuard({ dir: gateRepo.dir, args: [gateSha] });
    assert.notEqual(gateRun.status, 0, "gate commit must be rejected");
      assert.match(gateRun.out, /example\.invalid/);

    commitFile(roleRepo, "f.txt", "seed");
    const roleSha = commitFile(roleRepo, "g.txt", "role change");
    const roleRun = runGuard({ dir: roleRepo.dir, args: [roleSha] });
    assert.notEqual(roleRun.status, 0, "role-only commit must be rejected");
    assert.match(roleRun.out, /role-only/);

    commitFile(goodRepo, "f.txt", "seed");
    const goodSha = commitFile(goodRepo, "g.txt", "real change");
    const goodRun = runGuard({ dir: goodRepo.dir, args: [goodSha] });
    assert.equal(goodRun.status, 0, `canonical commit must pass: ${goodRun.out}`);

    // CI mode: --base/--head over the fixture range.
    const gateBase = gateRepo.git("rev-list", "--max-parents=0", "HEAD").stdout.trim();
    const gateRange = runGuard({ dir: gateRepo.dir, args: [`--base=${gateBase}`, "--head=HEAD"] });
    assert.notEqual(gateRange.status, 0, "CI range with gate commit must fail");
    const goodBase = goodRepo.git("rev-list", "--max-parents=0", "HEAD").stdout.trim();
    const goodRange = runGuard({ dir: goodRepo.dir, args: [`--base=${goodBase}`, "--head=HEAD"] });
    assert.equal(goodRange.status, 0, `CI range of canonical commits must pass: ${goodRange.out}`);
  } finally {
    rmSync(gateRepo.dir, { recursive: true, force: true });
    rmSync(roleRepo.dir, { recursive: true, force: true });
    rmSync(goodRepo.dir, { recursive: true, force: true });
  }
});

// --- GIT_DIR inheritance ------------------------------------------------------

test("inherited GIT_DIR cannot redirect inspection to another repo", () => {
  const outer = initFixture(CANONICAL);
  const inner = initFixture(GATE);
  try {
    commitFile(outer, "ok.txt", "canonical outer commit");
    commitFile(inner, "f.txt", "seed");
    const badSha = commitFile(inner, "g.txt", "synthetic change");

    // Poisoned env: GIT_DIR points at the clean outer repo. The guard strips
    // inherited repo pointers and follows cwd, so it must still flag the
    // fixture's synthetic commit — honouring GIT_DIR would inspect the wrong
    // repo and wrongly pass.
    const r = runGuard({
      dir: inner.dir,
      args: [badSha],
      extraEnv: { GIT_DIR: join(outer.dir, ".git") },
    });
    assert.notEqual(r.status, 0, "guard must flag the fixture commit despite inherited GIT_DIR");
    assert.match(r.out, /example\.invalid/);
  } finally {
    rmSync(outer.dir, { recursive: true, force: true });
    rmSync(inner.dir, { recursive: true, force: true });
  }
});

// --- wiring: guard executes on the normal commit/push path ---------------------

test("pre-push runs the identity gate before the release gate", () => {
  const identityPos = prePush.indexOf("assert-git-identity.mjs");
  const releasePos = prePush.indexOf("release-targets.mjs");
  assert.ok(identityPos > -1, "pre-push must invoke the identity gate");
  assert.ok(releasePos > identityPos, "identity gate must run before the release gate");
});

test("pre-commit checks the configured identity and CI re-checks the range", () => {
  assert.match(preCommit, /assert-git-identity\.mjs --check-config/);
  assert.match(ci, /assert-git-identity\.mjs/);
  assert.match(ci, /fetch-depth: 0/);
});

// --- the suite itself must not mutate the repo ----------------------------------

test("identity-guard suite leaves repo HEAD and working tree unchanged", () => {
  const headAfter = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout;
  const porcelainAfter = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  assert.equal(headAfter, suiteHeadBefore);
  assert.equal(porcelainAfter, suitePorcelainBefore);
});
