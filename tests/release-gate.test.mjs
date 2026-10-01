import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkProvenance, PRODUCTION_REF } from "../scripts/assert-release-provenance.mjs";
import { classifyTargets } from "../scripts/release-targets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const workerRelease = readFileSync(`${root}/.github/workflows/cloudflare-worker-release.yml`, "utf8");
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");

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
  const dir = mkdtempSync(join(tmpdir(), "kompas-gate-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  const run = (sha, base) => {
    const r = spawnSync(
      process.execPath,
      [`${root}/scripts/release-targets.mjs`, "--plan", `--base=${base}`, sha],
      { cwd: dir, encoding: "utf8" },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  try {
    git("init", "--initial-branch=main");
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
