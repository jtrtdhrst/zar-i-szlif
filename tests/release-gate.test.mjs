import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectRouteAccessViolations } from "../scripts/assert-cloudflare-route-access.mjs";
import { checkProvenance, PRODUCTION_REF } from "../scripts/assert-release-provenance.mjs";
import { classifyTargets } from "../scripts/release-targets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const workerRelease = readFileSync(`${root}/.github/workflows/cloudflare-worker-release.yml`, "utf8");
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");

// --- KOMAA-477: fixture isolation guards (fixture-side only) ---------------
const suiteHeadBefore = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout;
const suitePorcelainBefore = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;

const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"]) delete env[key];
  return env;
})();

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

function assertFixtureRepoIsolated(dir) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", env: GIT_ENV });
  assert.equal(r.status, 0, `isolation check failed, git rev-parse --show-toplevel: ${r.stderr}`);
  assert.equal(realpathSync(r.stdout.trim()), realpathSync(dir), `fixture dir is not its own repo: ${dir}`);
  assert.ok(existsSync(join(dir, ".git")), `git init created no repo in ${dir} (inherited GIT_DIR?)`);
}

// Regression fixture: production candidate 8526d68, on which worker validation
// passed. A provider-unrelated gate must not be able to misclassify it.
const CANDIDATE_8526D68 = [
  "app/README.md",
  "app/cloudflare-worker/README.md",
  "app/cloudflare-worker/build-worker.mjs",
  "app/cloudflare-worker/src/dcr.ts",
  "app/cloudflare-worker/src/mcp-identity.test.ts",
  "app/cloudflare-worker/src/mcp.ts",
  "app/cloudflare-worker/src/oauth.ts",
  "app/cloudflare-worker/worker.js",
  "app/cloudflare-worker/wrangler.jsonc",
  "app/cloudflare-worker/wrangler.panel.jsonc",
  "app/plugin/auth.ts",
  "docs/production-release.md",
];

// --- requirement 2/9: target classification -------------------------------

test("Cloudflare-only changes run the Worker gate and never the Vercel gate", () => {
  const plan = classifyTargets(["app/cloudflare-worker/src/mcp.ts"]);

  assert.deepEqual(plan.scripts, ["validate:worker"]);
  assert.equal(plan.unclassified.length, 0);

  // No VERCEL_* requirement on the Cloudflare-only path.
  assert.doesNotMatch(packageJson.scripts["validate:worker"], /vercel/i);
  assert.doesNotMatch(workerRelease, /VERCEL_/);
});

test("Vercel-only changes run the Vercel gate and never the Worker gate", () => {
  const plan = classifyTargets(["app/web/src/styles.css", "vercel.json"]);

  assert.deepEqual(plan.scripts, ["validate:vercel"]);
  assert.equal(plan.unclassified.length, 0);

  // No CLOUDFLARE_* requirement on the Vercel-only path.
  assert.doesNotMatch(packageJson.scripts["validate:vercel"], /cloudflare/i);
  assert.doesNotMatch(ci, /CLOUDFLARE_/);
});

test("mixed changes touching both release targets run both gates", () => {
  const plan = classifyTargets([
    "app/cloudflare-worker/src/oauth.ts",
    "app/web/src/static-app-v2.js",
  ]);

  assert.deepEqual(plan.scripts, ["validate:vercel", "validate:worker"]);
  assert.equal(plan.unclassified.length, 0);
});

test("app/plugin is genuinely shared and runs both gates", () => {
  assert.deepEqual(classifyTargets(["app/plugin/auth.ts"]).scripts, [
    "validate:vercel",
    "validate:worker",
  ]);
});

test("docs-only changes run the minimum canonical gate, never a provider gate", () => {
  const plan = classifyTargets(["docs/production-release.md", "AGENTS.md", "archive/old/thing.txt"]);

  assert.deepEqual(plan.scripts, ["validate:code"]);
  assert.equal(plan.nonReleaseOnly, true);
});

test("ambiguous classification fails closed instead of skipping validation", () => {
  // Behavioural, not a source-string assertion: build a throwaway repo whose
  // only change touches an unclassified path, run the real gate, and require a
  // non-zero exit with no gate executed.
  const dir = mkdtempSync(join(fixtureTmpBase(), "kompas-gate-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r;
  };
  const run = (sha, base) => {
    const r = spawnSync(
      process.execPath,
      [`${root}/scripts/release-targets.mjs`, "--plan", `--base=${base}`, sha],
      { cwd: dir, encoding: "utf8", env: GIT_ENV },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  try {
    assertFixtureDirPathIsolated(dir);
    git("init", "--initial-branch=main");
    assertFixtureRepoIsolated(dir);
    git("config", "user.email", "gate@example.invalid");
    git("config", "user.name", "gate");
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    git("add", "-A");
    git("commit", "-m", "seed");
    const seed = git("rev-parse", "HEAD").stdout.trim();

    mkdirSync(join(dir, "app/not-a-target"), { recursive: true });
    writeFileSync(join(dir, "app/not-a-target/thing.ts"), "export const x = 1;\n");
    git("add", "-A");
    git("commit", "-m", "ambiguous");

    const ambiguous = run(git("rev-parse", "HEAD").stdout.trim(), seed);
    assert.equal(ambiguous.status, 2, "ambiguous target must exit non-zero");
    assert.match(ambiguous.out, /AMBIGUOUS release target/);
    assert.doesNotMatch(ambiguous.out, /PLAN npm run/);

    // Same repo, a classified path: the plan is the Worker gate and nothing else.
    mkdirSync(join(dir, "app/cloudflare-worker"), { recursive: true });
    git("mv", "app/not-a-target/thing.ts", "app/cloudflare-worker/thing.ts");
    git("commit", "-m", "classified");
    const classified = run(git("rev-parse", "HEAD").stdout.trim(), seed);
    assert.equal(classified.status, 0);
    assert.match(classified.out, /targets: cloudflare/);
    assert.match(classified.out, /PLAN npm run validate:worker/);
    assert.doesNotMatch(classified.out, /validate:vercel/);

    // A missing base ref is itself a fail-closed condition, not a silent pass.
    const noBase = run(git("rev-parse", "HEAD").stdout.trim(), "refs/heads/does-not-exist");
    assert.equal(noBase.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fixture isolation guard fires on broken isolation without mutating the enclosing repo", () => {
  const enclosing = mkdtempSync(join(fixtureTmpBase(), "kompas-gate-enclosing-"));
  const egit = (...args) => {
    const r = spawnSync("git", args, { cwd: enclosing, encoding: "utf8", env: GIT_ENV });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r;
  };
  try {
    egit("init", "--initial-branch=main");
    assertFixtureRepoIsolated(enclosing);
    egit("config", "user.email", "gate@example.invalid");
    egit("config", "user.name", "gate");
    writeFileSync(join(enclosing, "f1.txt"), "1\n");
    writeFileSync(join(enclosing, "f2.txt"), "2\n");
    writeFileSync(join(enclosing, "f3.txt"), "3\n");
    egit("add", "-A");
    egit("commit", "-m", "base");
    const headBefore = egit("rev-parse", "HEAD").stdout.trim();
    rmSync(join(enclosing, "f1.txt"));
    rmSync(join(enclosing, "f2.txt"));
    rmSync(join(enclosing, "f3.txt"));
    const broken = join(enclosing, "kompas-gate-broken-xxx");
    mkdirSync(broken);
    // No `git init` here: rev-parse walks up to the enclosing repo, so the
    // fixture's post-init isolation assertion must throw before any commit.
    assert.throws(() => assertFixtureRepoIsolated(broken), /not its own repo/);
    assert.equal(egit("rev-parse", "HEAD").stdout.trim(), headBefore);
  } finally {
    rmSync(enclosing, { recursive: true, force: true });
  }
});

test("an empty diff still runs the minimum canonical gate", () => {
  assert.deepEqual(classifyTargets([]).scripts, ["validate:code"]);
});

test("regression fixture: candidate 8526d68 keeps the Worker gate", () => {
  const plan = classifyTargets(CANDIDATE_8526D68);

  // worker validation passed at this exact SHA, so the Worker gate must be
  // present; app/plugin/auth.ts makes it mixed, not Vercel-only.
  assert.ok(plan.scripts.includes("validate:worker"), "8526d68 must keep the Worker gate");
  assert.deepEqual(plan.unclassified, []);
  assert.deepEqual(classifyTargets(CANDIDATE_8526D68.filter((p) => p.startsWith("app/cloudflare-worker/"))).scripts, [
    "validate:worker",
  ]);
});

// --- requirement 2: the hook dispatches per target ------------------------

test("pre-push classifies release targets instead of aliasing validate:vercel", () => {
  const prePush = readFileSync(`${root}/.githooks/pre-push`, "utf8");

  assert.match(prePush, /refs\/heads\/main/);
  assert.doesNotMatch(prePush, /validate:release\s*$/m);

  // validate:release is now the target-aware dispatcher, not a Vercel alias.
  assert.equal(packageJson.scripts["validate:release"], "node scripts/release-targets.mjs");
  assert.doesNotMatch(packageJson.scripts["validate:release"], /validate:vercel/);
});

// --- KOMAA-499: Vercel candidate validation needs no platform link --------

test("validate:vercel default path needs no Vercel link/API; --platform keeps full validation", () => {
  const gate = readFileSync(`${root}/scripts/validate-vercel.mjs`, "utf8");

  // The --platform variant exists and is discoverable via npm.
  assert.match(gate, /--platform/);
  assert.match(packageJson.scripts["validate:vercel:platform"] ?? "", /--platform/);
  // The default npm path takes no platform flag.
  assert.doesNotMatch(packageJson.scripts["validate:vercel"], /--platform/);

  // Ordering contract: the --platform flag parse is the first platform-only
  // concept in the file, so everything before it is the link-free default
  // path. None of the platform-only strings may appear there.
  const head = gate.slice(0, gate.indexOf("--platform"));
  for (const banned of ["vercel@", "VERCEL_", "vercel pull", "vercel build", ".vercel"]) {
    assert.ok(!head.includes(banned), `default path must not reference ${banned}`);
  }

  // The full platform validation still exists behind --platform.
  assert.match(gate, /VERCEL_ORG_ID/);
  assert.match(gate, /VERCEL_PROJECT_ID/);
  assert.match(gate, /vercel pull/);
  assert.match(gate, /vercel build/);

  // The default path builds the candidate and statically validates the
  // deploy contract instead of calling the Vercel API.
  assert.match(gate, /npm.*run.*build/);
  assert.match(gate, /app\/web\/dist\/index\.html/);
  assert.match(gate, /outputDirectory/);

  // Cloudflare-only changes still never touch the Vercel gate.
  assert.deepEqual(classifyTargets(["app/cloudflare-worker/src/mcp.ts"]).scripts, ["validate:worker"]);
  // Mixed changes still run both gates.
  assert.deepEqual(
    classifyTargets(["app/cloudflare-worker/src/oauth.ts", "app/web/src/static-app-v2.js"]).scripts,
    ["validate:vercel", "validate:worker"],
  );
});

// The decoupling is only real while the platform check still has an explicit
// main/deploy home. If that workflow is dropped, the full Vercel validation
// would exist only as a manual local command and the coupling would return.
test("Vercel platform validation is wired into the main path, not the branch push path", () => {
  const platformWorkflowPath = `${root}/.github/workflows/vercel-frontend-platform.yml`;
  assert.ok(existsSync(platformWorkflowPath), "missing Vercel main-path platform check");

  const platformWorkflow = readFileSync(platformWorkflowPath, "utf8");
  assert.match(platformWorkflow, /branches: \[main\]/);
  assert.match(platformWorkflow, /refs\/heads\/main/);
  assert.match(platformWorkflow, /assert-release-provenance\.mjs/);
  assert.match(platformWorkflow, /validate:vercel:platform/);
  for (const secret of ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_TOKEN"]) {
    assert.match(platformWorkflow, new RegExp(`secrets\\.${secret}`));
  }

  // CI and the pre-push gate stay free of platform auth; only the main-path
  // workflow may carry VERCEL_*.
  assert.doesNotMatch(ci, /VERCEL_/);
  const prePush = readFileSync(`${root}/.githooks/pre-push`, "utf8");
  assert.doesNotMatch(prePush, /VERCEL_|--platform/);
});

// --- requirement 5/6/8: production provenance ------------------------------

test("a non-main ref cannot enter production deploy", () => {
  const violations = checkProvenance({
    ref: "refs/heads/KOMAA-457",
    expectedSha: "a".repeat(40),
    headSha: "a".repeat(40),
    isOnMain: true,
    mainTipSha: "a".repeat(40),
  });

  assert.ok(violations.some((v) => v.includes("non-main")));
});

test("a wrong or mismatched SHA cannot enter production deploy", () => {
  const sha = "b".repeat(40);
  const headMismatch = checkProvenance({
    ref: PRODUCTION_REF,
    expectedSha: sha,
    headSha: "c".repeat(40),
    isOnMain: true,
    mainTipSha: sha,
  });
  assert.ok(headMismatch.some((v) => v.includes("does not match candidate SHA")));

  const offMain = checkProvenance({
    ref: PRODUCTION_REF,
    expectedSha: sha,
    headSha: sha,
    isOnMain: false,
    mainTipSha: sha,
  });
  assert.ok(offMain.some((v) => v.includes("not reachable from origin/main")));

  const stale = checkProvenance({
    ref: PRODUCTION_REF,
    expectedSha: sha,
    headSha: sha,
    isOnMain: true,
    mainTipSha: "d".repeat(40),
    requireMainTip: true,
  });
  assert.ok(stale.some((v) => v.includes("is not the origin/main tip")));

  assert.deepEqual(
    checkProvenance({
      ref: PRODUCTION_REF,
      expectedSha: sha,
      headSha: sha,
      isOnMain: true,
      mainTipSha: sha,
      requireMainTip: true,
    }),
    [],
  );
});

test("production deploy workflow is main-only, serialized and exact-SHA bound", () => {
  // Serialize production mutations per repository; never cancel a mutating run.
  assert.match(workerRelease, /concurrency:/);
  assert.match(workerRelease, /group: cloudflare-worker-production/);
  assert.match(workerRelease, /cancel-in-progress: false/);

  // Exact-SHA invariant before any production mutation.
  assert.match(workerRelease, /assert-release-provenance\.mjs/);
  assert.match(workerRelease, /github\.sha/);

  // Production jobs stay gated on the authoritative main ref.
  assert.match(workerRelease, /github\.ref == 'refs\/heads\/main'/);
});

test("production deploy consumes the artifact built from the verified SHA", () => {
  // Build once in the gate job, deploy that artifact; no second build from a
  // later mutable workspace state.
  assert.match(workerRelease, /name: cloudflare-worker-\$\{\{ github\.sha \}\}/);
  assert.match(workerRelease, /actions\/download-artifact@v4/);
  assert.doesNotMatch(workerRelease, /- run: npm run build\s*\n\s*\n\s*- name: Deploy/);
});

test("downloaded artifact keeps the repo-relative layout the deploy resolves", () => {
  // upload-artifact v4 archiwizuje najblizszy wspolny katalog sciezek
  // (`app/cloudflare-worker/worker.js` + `app/plugin/dist/**` -> `app/` jest
  // pomijane). Rozwiazanie do `path: .` dalo `test -d app/plugin/dist` = false
  // na czystym runnerze i zabilo release (KOMAA-447, run 36944261990).
  const upload = workerRelease.slice(
    workerRelease.indexOf("actions/upload-artifact@v4"),
    workerRelease.indexOf("production-preflight:"),
  );
  assert.match(upload, /app\/plugin\/dist\/\*\*/, "artifact musi zawierac app/plugin/dist");

  const download = workerRelease.slice(
    workerRelease.indexOf("actions/download-artifact@v4"),
    workerRelease.indexOf("- name: Deploy Cloudflare Worker"),
  );
  assert.match(download, /path: app\b/, "download musi odtworzyc prefiks `app/`");
});

// --- KOMAA-466: zone route permission is proven before any mutation ---------

test("production preflight proves zone route access, not just secret presence", async () => {
  // `wrangler whoami` only proves account reachability. Deploy reads
  // /zones/{zone}/workers/routes after uploading the script, so an
  // under-scoped token used to fail mid-deploy with production mutated.
  assert.match(workerRelease, /assert-cloudflare-route-access\.mjs/);
  assert.match(workerRelease, /CLOUDFLARE_ZONE_NAME/);

  // The check must live in preflight, i.e. before deploy-production exists.
  const zoneStep = workerRelease.indexOf("assert-cloudflare-route-access.mjs");
  const deployJob = workerRelease.indexOf("deploy-production:");
  assert.ok(zoneStep > -1 && deployJob > zoneStep, "zone check must precede deploy-production");

  const ok = await collectRouteAccessViolations({
    fetchImpl: async () => ({ json: async () => ({ success: true, result: [{ id: "zone-1" }] }) }),
    accountId: "acct",
    token: "tok",
    zoneName: "kompaszbiorek.pl",
  });
  assert.deepEqual(ok, []);

  // The production failure: token reads no routes for the zone.
  const denied = await collectRouteAccessViolations({
    fetchImpl: async (url) =>
      url.includes("/workers/routes")
        ? { json: async () => ({ success: false, errors: [{ message: "No access to the specified resource." }] }) }
        : { json: async () => ({ success: true, result: [{ id: "zone-1" }] }) },
    accountId: "acct",
    token: "tok",
    zoneName: "kompaszbiorek.pl",
  });
  assert.equal(denied.length, 1);
  assert.match(denied[0], /Workers Routes/);

  // An invisible zone must fail closed rather than silently pass.
  const unknownZone = await collectRouteAccessViolations({
    fetchImpl: async () => ({ json: async () => ({ success: true, result: [] }) }),
    accountId: "acct",
    token: "tok",
    zoneName: "kompaszbiorek.pl",
  });
  assert.equal(unknownZone.length, 1);
  assert.match(unknownZone[0], /not visible/);
});

// --- KOMAA-477: the suite itself must not mutate the repo -------------------

test("release-gate suite leaves repo HEAD and working tree unchanged", () => {
  const headAfter = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout;
  const porcelainAfter = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  assert.equal(headAfter, suiteHeadBefore);
  assert.equal(porcelainAfter, suitePorcelainBefore);
});
