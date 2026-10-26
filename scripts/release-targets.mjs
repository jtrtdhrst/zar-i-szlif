// Target-aware release gate (KOMAA-457).
//
// Root cause: `validate:release` aliased one provider gate, so a Cloudflare-only
// branch had to pass the frontend gate or push with --no-verify. This module
// classifies changed paths against the release targets and runs only the
// canonical gate(s) those targets own. Unclassified paths fail closed.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "origin/main";

// Ordered: first match wins. Order encodes specificity (exact files before
// broad prefixes), so a path never lands in the wrong bucket.
const RELEASE_RULES = [
  // The Vercel config is gone, but the path stays classified: a deletion (or a
  // future re-addition) of it must never land unclassified — the gate fails
  // closed, and an unclassified path would block the push.
  { re: /^vercel\.json$/, targets: ["frontend"] },
  { re: /^app\/web\//, targets: ["frontend"] },
  { re: /^app\/cloudflare-worker\//, targets: ["cloudflare"] },
  // app/plugin is compiled into the frontend build (tsc -p plugin/tsconfig.json)
  // and bundled into the Worker (src/mcp.ts -> ../../plugin/server.js), so it
  // is genuinely shared and both gates apply.
  { re: /^app\/plugin\//, targets: ["frontend", "cloudflare"] },
  { re: /^app\/package(-lock)?\.json$/, targets: ["frontend", "cloudflare"] },
  { re: /^package(-lock)?\.json$/, targets: ["frontend", "cloudflare"] },
  // Release infrastructure gates both delivery paths.
  { re: /^\.github\/workflows\//, targets: ["frontend", "cloudflare"] },
  { re: /^\.githooks\//, targets: ["frontend", "cloudflare"] },
  { re: /^(scripts|tests)\//, targets: ["frontend", "cloudflare"] },
  // Self-hosted deployment of the same static frontend artifact. `ops/` is
  // otherwise non-release, but these files are release infrastructure: the
  // frontend gate owns them, they must not be silently skipped.
  { re: /^ops\/coolify\//, targets: ["frontend"] },
];

// Docs/non-release-only: minimum canonical repo validation, never provider auth.
const NON_RELEASE_RULES = [
  /^docs\//,
  /^archive\//,
  /^content\//,
  /^branding\//,
  /^dev\//,
  /^ops\//,
  // Standalone MCP services (own Dockerfiles, deployed by Coolify/Cloudflare, not
  // by the frontend/worker pipelines). They own no provider gate here; their
  // correctness is proven by their own image build + MCP handshake.
  /^mcp\//,
  // Vendored upstream Plasmic source for the self-hosted deployment. It is
  // built only by its own Dockerfiles (Coolify) and owns no provider gate here.
  /^plasmic\//,
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
  if (targets.has("frontend")) scripts.push("validate:frontend");
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
