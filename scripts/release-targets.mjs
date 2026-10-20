// Target-aware release gate (KOMAA-457).
//
// Root cause: `validate:release` aliased `validate:vercel`, so a Cloudflare-only
// branch had to pass the Vercel gate or push with --no-verify. This module
// classifies changed paths against the release targets and runs only the
// canonical gate(s) those targets own. Unclassified paths fail closed.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "origin/main";

// Ordered: first match wins. Order encodes specificity (exact files before
// broad prefixes), so a path never lands in the wrong bucket.
const RELEASE_RULES = [
  { re: /^vercel\.json$/, targets: ["vercel"] },
  { re: /^app\/web\//, targets: ["vercel"] },
  { re: /^app\/cloudflare-worker\//, targets: ["cloudflare"] },
  // app/plugin is compiled into the Vercel build (tsc -p plugin/tsconfig.json)
  // and bundled into the Worker (src/mcp.ts -> ../../plugin/server.js), so it
  // is genuinely shared and both gates apply.
  { re: /^app\/plugin\//, targets: ["vercel", "cloudflare"] },
  { re: /^app\/package(-lock)?\.json$/, targets: ["vercel", "cloudflare"] },
  { re: /^package(-lock)?\.json$/, targets: ["vercel", "cloudflare"] },
  // Release infrastructure gates both delivery paths.
  { re: /^\.github\/workflows\//, targets: ["vercel", "cloudflare"] },
  { re: /^\.githooks\//, targets: ["vercel", "cloudflare"] },
  { re: /^(scripts|tests)\//, targets: ["vercel", "cloudflare"] },
];

// Docs/non-release-only: minimum canonical repo validation, never provider auth.
const NON_RELEASE_RULES = [
  // Design-time, not-yet-promoted mascot sources/exports are not imported by the
  // Vercel or Worker bundle. scripts/mascots changes are still release-gated.
  // Promotion into app/web or app/plugin activates the existing release gates.
  /^assets\/mascots\/style-2\//,
  /^docs\//,
  /^archive\//,
  /^content\//,
  /^branding\//,
  /^dev\//,
  /^ops\//,
  /^skills\//,
  /^supabase\//,
  /^registry\//,
  /^\.paperclip-wiki\//,
  /^opencode\.json$/,
  /^\.env\.example$/,
  /^\.git(ignore|modules)$/,
  /\.md$/,
];

export function classifyTargets(paths) {
  const targets = new Set();
  const unclassified = [];
  let sawNonRelease = false;

  for (const path of paths) {
    const release = RELEASE_RULES.find((rule) => rule.re.test(path));
    if (release) {
      for (const target of release.targets) targets.add(target);
      continue;
    }
    if (NON_RELEASE_RULES.some((re) => re.test(path))) {
      sawNonRelease = true;
      continue;
    }
    unclassified.push(path);
  }

  const scripts = [];
  if (targets.has("vercel")) scripts.push("validate:vercel");
  if (targets.has("cloudflare")) scripts.push("validate:worker");
  if (scripts.length === 0) {
    // Either docs-only or an empty diff. Minimum canonical repo validation,
    // never a provider gate: requirement 2 forbids inventing provider auth.
    scripts.push("validate:code");
    return { scripts, targets: [], unclassified, nonReleaseOnly: sawNonRelease };
  }

  return { scripts, targets: [...targets], unclassified, nonReleaseOnly: sawNonRelease };
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function mergeBase(base, ref) {
  const result = git(["merge-base", base, ref]);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function changedPaths(shas, base = DEFAULT_BASE) {
  const paths = new Set();
  for (const sha of shas) {
    const baseCommit = mergeBase(base, sha);
    if (!baseCommit) {
      throw new Error(
        `cannot compute merge-base(${base}, ${sha}) — fetch the base first: git fetch ${base}`,
      );
    }
    const diff = git(["diff", "--name-only", `${baseCommit}..${sha}`]);
    if (diff.status !== 0) {
      throw new Error(`git diff failed for ${baseCommit}..${sha}: ${diff.stderr.trim()}`);
    }
    for (const line of diff.stdout.split("\n")) {
      if (line.trim()) paths.add(line.trim());
    }
  }
  return [...paths].sort();
}

function runGate(script) {
  console.log(`[release-gate] npm run ${script}`);
  const result = spawnSync("npm", ["run", script], { stdio: "inherit" });
  if (result.error) {
    console.error(`[release-gate] failed to launch ${script}: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const args = process.argv.slice(2);
  // --plan prints the resolved plan without executing gates. Used by the
  // non-mutating release smoke to prove which gate a ref would invoke.
  const planOnly = args.includes("--plan");
  const shas = args.filter((arg) => !arg.startsWith("-"));
  const baseArg = args.find((arg) => arg.startsWith("--base="));
  const base = baseArg ? baseArg.slice("--base=".length) : DEFAULT_BASE;

  if (shas.length === 0) {
    const head = git(["rev-parse", "HEAD"]);
    if (head.status !== 0) {
      console.error("[release-gate] not a git repository; cannot classify release targets.");
      process.exit(2);
    }
    shas.push(head.stdout.trim());
  }

  let paths;
  try {
    paths = changedPaths(shas, base);
  } catch (error) {
    console.error(`[release-gate] ${error.message}`);
    process.exit(2);
  }

  const { scripts, targets, unclassified } = classifyTargets(paths);

  console.log(`[release-gate] base=${base} sha=${shas.join(",")}`);
  console.log(`[release-gate] changed paths: ${paths.length}`);
  for (const path of paths) console.log(`[release-gate]   ${path}`);
  console.log(`[release-gate] targets: ${targets.length ? targets.join("+") : "none (non-release only)"}`);

  if (unclassified.length > 0) {
    console.error(
      [
        "[release-gate] AMBIGUOUS release target — failing closed.",
        `Unclassified paths: ${unclassified.join(", ")}`,
        `Classify them in scripts/release-targets.mjs (RELEASE_RULES / NON_RELEASE_RULES).`,
        "Refusing to push code whose release target is unknown.",
      ].join("\n"),
    );
    process.exit(2);
  }

  if (planOnly) {
    for (const script of scripts) console.log(`[release-gate] PLAN npm run ${script}`);
    console.log("[release-gate] PASS (plan only)");
    return;
  }

  for (const script of scripts) runGate(script);
  console.log(`[release-gate] PASS (${scripts.join(" + ")})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
