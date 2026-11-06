// All-path CI coverage contract (KOMAA-1616).
//
// Every tracked path in this repository must resolve to a named CI lane or be
// explicitly classified as non-release. An unclassified path fails closed, so a
// new product/Web/Worker/MCP root can never ride on unrelated green CI.
//
// Lanes are npm scripts. `.github/workflows/product-ci.yml` runs `validate:code`
// and the composed `validate:paths`; tests/ci-path-coverage.test.mjs proves the
// composition and the workflow wiring stay in sync.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const LANES = {
  code: "validate:code",
  frontend: "validate:frontend",
  cloudflare: "validate:cloudflare-build",
  mcp: "validate:mcp",
  www: "validate:www",
  website: "validate:website",
};

// Ordered: first match wins. Keep exact files before broad prefixes.
export const COVERAGE_RULES = [
  { re: /^app\/README\.md$/, lane: "non-release" },
  { re: /^app\/documentation\.md$/, lane: "non-release" },
  { re: /^app\/package(-lock)?\.json$/, lane: "frontend" },
  { re: /^app\/web\//, lane: "frontend" },
  { re: /^app\/plugin\//, lane: "frontend" },
  { re: /^app\/cloudflare-worker\//, lane: "cloudflare" },
  { re: /^app\/mcp-worker\//, lane: "mcp" },
  // Scaffold only. The dedicated lane fails closed once real source appears,
  // so a website build cannot be silently uncovered.
  { re: /^app\/website\//, lane: "website" },
  { re: /^registry\/kompas\/(ui|components|blocks|shells|pages)\//, lane: "frontend" },
  { re: /^registry\//, lane: "non-release" },
  { re: /^ops\/coolify\//, lane: "frontend" },
  { re: /^ops\//, lane: "non-release" },
  { re: /^scripts\//, lane: "code" },
  { re: /^tests\//, lane: "code" },
  { re: /^\.github\/workflows\//, lane: "code" },
  { re: /^\.github\//, lane: "non-release" },
  { re: /^content\//, lane: "non-release" },
  { re: /^mcp\//, lane: "www" },
  { re: /^product\//, lane: "www" },
  { re: /^www\//, lane: "www" },
  { re: /^(package\.json|package-lock\.json)$/, lane: "code" },
  { re: /^(README\.md|POSTHOG\.md|\.env\.posthog\.example|\.gitignore)$/, lane: "non-release" },
];

const WALK_SKIP = new Set(["node_modules", ".git", "dist", "registry-dist", ".next", "coverage"]);

export function classifyPath(path) {
  const rule = COVERAGE_RULES.find((candidate) => candidate.re.test(path));
  return rule ? rule.lane : null;
}

export function coverage(paths) {
  const byLane = {};
  const unclassified = [];
  for (const path of paths) {
    const lane = classifyPath(path);
    if (lane === null) {
      unclassified.push(path);
      continue;
    }
    (byLane[lane] ||= []).push(path);
  }
  return { byLane, unclassified };
}

function walkFiles(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, root, out);
    else if (entry.isFile()) out.push(relative(root, full).split("\\").join("/"));
  }
}

export function trackedPaths({ cwd = process.cwd() } = {}) {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  } catch {
    const out = [];
    walkFiles(cwd, cwd, out);
    return out;
  }
}

function main() {
  const paths = trackedPaths();
  const { byLane, unclassified } = coverage(paths);

  for (const [lane, files] of Object.entries(byLane).sort()) {
    console.log(`[ci-coverage] ${lane.padEnd(12)} ${String(files.length).padStart(4)} paths`);
  }

  if (unclassified.length > 0) {
    console.error(
      [
        "[ci-coverage] UNCOVERED paths — failing closed.",
        ...unclassified.map((path) => `  - ${path}`),
        "Add a CI lane for the path in scripts/ci-path-coverage.mjs (COVERAGE_RULES)",
        "and wire that lane into validate:paths / product-ci.yml.",
      ].join("\n"),
    );
    process.exit(2);
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const missing = Object.entries(LANES)
    .filter(([, script]) => !packageJson.scripts?.[script])
    .map(([lane, script]) => `${lane} (${script})`);
  if (missing.length > 0) {
    console.error(`[ci-coverage] MISSING lane scripts: ${missing.join(", ")}`);
    process.exit(2);
  }

  console.log(`[ci-coverage] PASS (${paths.length} tracked paths, ${Object.keys(byLane).length} lanes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
