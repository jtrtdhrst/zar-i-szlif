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
  { re: /^docs\//, lane: "non-release" },
  { re: /^\.repowise\/decisions\.yaml$/, lane: "non-release" },
  { re: /^mcp\//, lane: "www" },
  { re: /^product\//, lane: "www" },
  { re: /^www\//, lane: "www" },
  { re: /^(package\.json|package-lock\.json)$/, lane: "code" },
  { re: /^(README\.md|POSTHOG\.md|\.env\.posthog\.example|\.gitignore|\.dockerignore)$/, lane: "non-release" },
];

// Paperclip project -> repository path/lane mapping (KOMAA-1616).
//
// Every one of the company's Paperclip projects is enumerated so a project that
// owns a deployable root cannot be silently uncovered. Projects whose source is
// not in this repository are explicit `external: true` with no local roots.
// tests/fixtures/paperclip-projects.json is the checked-in enumeration evidence;
// tests/project-coverage.test.mjs fails if the two drift.
export const CANONICAL_REPO = /^https:\/\/github\.com\/miloszspyrka-code\/zar-i-szlif(\.git)?$/;

export const PROJECT_MAP = [
  {
    id: "e848c88a-8cf9-4564-9b8c-ec0e7f235423",
    name: "99 · Archive / Hermes MuseSpark Validation",
    external: true,
    roots: [],
    lanes: [],
  },
  {
    id: "b78c0f66-8b70-4eda-bead-950df106d49e",
    name: "04 · Operations / Release & Reliability",
    roots: ["ops/coolify", ".github", "scripts"],
    lanes: ["frontend", "code"],
  },
  {
    id: "3d251932-c5e1-4ebe-bb4a-3d46628a1951",
    name: "04 · Operations / Paperclip Ops",
    external: true,
    roots: [],
    lanes: [],
  },
  {
    id: "291fecff-2f36-44bc-ba39-cae853f6e90c",
    name: "01 · Produkt / Panel aplikacji",
    roots: ["app/web", "app/plugin", "app/cloudflare-worker", "registry"],
    lanes: ["frontend", "cloudflare", "non-release"],
  },
  {
    id: "911366a1-6347-4245-96ab-e7d0c6b64089",
    name: "02 · MCP / Integracje i dane",
    roots: ["app/mcp-worker", "mcp", "product"],
    lanes: ["mcp", "www"],
  },
  {
    id: "d8759fc7-850b-4500-8b07-076d46c5d4d7",
    name: "02 · MCP / Product MCP",
    roots: ["app/mcp-worker"],
    lanes: ["mcp"],
  },
  {
    id: "ca5ae4f0-04c8-4f7d-a034-4efce4fbd72c",
    name: "02 · MCP / Qdrant Hybrid",
    external: true,
    roots: [],
    lanes: [],
  },
  {
    id: "ac9cf5b0-0b02-49f1-892d-942a3e0caade",
    name: "03 · Growth / Marketing & Acquisition",
    roots: ["content"],
    lanes: ["non-release"],
  },
  {
    id: "5c72d685-382a-4837-9440-67419f3ca78e",
    name: "04 · Operations / Paperclip Source Fix (Legacy P0)",
    external: true,
    roots: [],
    lanes: [],
  },
  {
    id: "9a5927dc-8387-4b8c-bf91-4bae23a8b6c4",
    name: "99 · Archive / Hermes Validation",
    external: true,
    roots: [],
    lanes: [],
  },
  {
    id: "89c48231-e50c-424a-9e1e-ab50c04e924e",
    name: "02 · MCP / Strona podłączenia MCP",
    roots: ["www", "product"],
    lanes: ["www"],
  },
  {
    id: "84320acf-66de-4808-a82e-e112bd90af79",
    name: "03 · Growth / Lifecycle & Email",
    roots: ["app/cloudflare-worker", "content"],
    lanes: ["cloudflare", "non-release"],
  },
  {
    id: "586450b2-f8b2-4dbf-bf49-6d6f7ef4d00c",
    name: "01 · Produkt / Strona główna",
    roots: ["app/website"],
    lanes: ["website"],
  },
  {
    id: "104544b6-cab1-43f1-8098-a61a4fa5e6f7",
    name: "01 · Produkt / Design System & Maskotki",
    roots: ["registry"],
    lanes: ["frontend", "non-release"],
  },
  {
    id: "74623e58-4aea-4f5e-9608-201fafb7ab02",
    name: "04 · Operations / Hermes-Paperclip E2E",
    external: true,
    roots: [],
    lanes: [],
  },
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

// Verify every enumerated Paperclip project is accounted for and that every
// project owning a path in this repository is covered by the lanes its paths
// actually classify to. Returns problems instead of throwing so tests can
// assert on negative fixtures.
export function projectCoverage(projects, paths, projectMap = PROJECT_MAP) {
  const issues = [];
  if (projectMap.length !== 15) {
    issues.push(`expected 15 project mappings, found ${projectMap.length}`);
  }

  const mappedIds = new Set(projectMap.map((entry) => entry.id));
  const projectIds = new Set(projects.map((project) => project.id));
  for (const project of projects) {
    if (!mappedIds.has(project.id)) {
      issues.push(`unmapped Paperclip project: ${project.name} (${project.id})`);
    }
  }
  for (const entry of projectMap) {
    if (!projectIds.has(entry.id)) {
      issues.push(`mapping references unknown Paperclip project: ${entry.name} (${entry.id})`);
    }
  }

  for (const entry of projectMap) {
    const project = projects.find((candidate) => candidate.id === entry.id);
    if (!project) continue;

    const canonical = CANONICAL_REPO.test(project.repoUrl || "");
    if (!canonical) {
      if (!entry.external) {
        issues.push(`${entry.name}: non-canonical repo must be marked external`);
      }
      if (entry.roots.length > 0) {
        issues.push(`${entry.name}: external project must not claim local roots`);
      }
      continue;
    }

    if (entry.external) {
      issues.push(`${entry.name}: canonical repo project cannot be marked external`);
    }
    if (entry.roots.length === 0) {
      issues.push(`${entry.name}: canonical repo project has no mapped roots`);
      continue;
    }

    const actualLanes = new Set();
    for (const root of entry.roots) {
      const under = paths.filter((path) => path === root || path.startsWith(`${root}/`));
      if (under.length === 0) {
        issues.push(`${entry.name}: root "${root}" covers no tracked paths`);
      }
      for (const path of under) actualLanes.add(classifyPath(path));
    }
    const declared = [...entry.lanes].sort().join(",");
    const actual = [...actualLanes].sort().join(",");
    if (declared !== actual) {
      issues.push(`${entry.name}: lane mismatch declared [${declared}] actual [${actual}]`);
    }
  }

  return { issues, projects: projects.length, mapped: projectMap.length };
}

function walkFiles(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, root, out);
    else if (entry.isFile()) out.push(relative(root, full).split("\\").join("/"));
  }
}

// Docker copies the context with the root .dockerignore applied. When `.git`
// is absent (Coolify build context) `git ls-files` fails, so the filesystem
// walk must apply the same ignore manifest instead of treating every file
// present at runtime — e.g. a provider-injected docker-compose.yaml — as
// tracked source. Only literal paths/prefixes are modeled; Docker applies
// entries in order with globs and `!` negation, so a manifest containing any
// such entry is honored as no exclusions at all. Fail closed: an ignore we
// cannot model must never hide source that Docker re-includes.
function dockerignoreExcludes(cwd) {
  let contents;
  try {
    contents = readFileSync(join(cwd, ".dockerignore"), "utf8");
  } catch {
    return () => false;
  }
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const unsupported = lines.some((line) =>
    ["*", "?", "[", "]", "{", "}", "!"].some((token) => line.includes(token)),
  );
  if (unsupported) return () => false;
  const entries = lines.map((line) => line.replace(/^\.?\//, "").replace(/\/+$/, ""));
  return (path) =>
    entries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

export function trackedPaths({ cwd = process.cwd() } = {}) {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  } catch {
    const out = [];
    walkFiles(cwd, cwd, out);
    const excluded = dockerignoreExcludes(cwd);
    return out.filter((path) => !excluded(path));
  }
}

export function readProjectEnumeration() {
  return JSON.parse(
    readFileSync(new URL("../tests/fixtures/paperclip-projects.json", import.meta.url), "utf8"),
  );
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

  const enumeration = readProjectEnumeration();
  const projectResult = projectCoverage(enumeration.projects, paths);
  if (projectResult.issues.length > 0) {
    console.error(
      [
        "[ci-coverage] PAPERCLIP PROJECT COVERAGE FAILED — failing closed.",
        ...projectResult.issues.map((issue) => `  - ${issue}`),
        "Map every project in scripts/ci-path-coverage.mjs (PROJECT_MAP) to real roots/lanes.",
      ].join("\n"),
    );
    process.exit(2);
  }
  console.log(
    `[ci-coverage] projects ${projectResult.mapped}/${enumeration.projectCount} mapped ` +
      `(${projectResult.projects} enumerated in fixture)`,
  );

  console.log(`[ci-coverage] PASS (${paths.length} tracked paths, ${Object.keys(byLane).length} lanes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
