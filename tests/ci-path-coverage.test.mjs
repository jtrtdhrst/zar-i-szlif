import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LANES,
  PROJECT_MAP,
  classifyPath,
  coverage,
  projectCoverage,
  readProjectEnumeration,
  trackedPaths,
} from "../scripts/ci-path-coverage.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/product-ci.yml", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("every tracked path has an explicit CI lane (no silent gap)", () => {
  const { unclassified } = coverage(trackedPaths());
  assert.deepEqual(unclassified, [], "uncovered tracked paths");
});

test("each deployable product root resolves to its own lane", () => {
  const expected = {
    "app/web/src/static-app-v2.js": "frontend",
    "app/plugin/server.ts": "frontend",
    "app/cloudflare-worker/src/mcp.ts": "cloudflare",
    "app/mcp-worker/src/index.ts": "mcp",
    "www/landing/posthog.client.mjs": "www",
    "www/mcp/posthog.client.mjs": "www",
    "product/posthog.client.mjs": "www",
    "mcp/posthog.server.mjs": "www",
    "app/website/next.config.js": "website",
  };
  for (const [path, lane] of Object.entries(expected)) {
    assert.equal(classifyPath(path), lane, path);
  }
});

test("an unknown new root fails closed instead of inheriting green CI", () => {
  for (const path of [
    "brand-new-service/src/index.ts",
    "supabase/migrations/001_init.sql",
    "app/new-surface/index.ts",
  ]) {
    assert.equal(classifyPath(path), null, path);
  }
});

test("Product CI runs validate:code, which composes every path lane", () => {
  assert.match(workflow, /npm run validate:code/);
  const code = packageJson.scripts["validate:code"];
  for (const [lane, script] of Object.entries(LANES)) {
    if (lane === "code" || lane === "frontend") continue;
    assert.match(code, new RegExp(`npm run ${script}`), `missing ${lane} lane`);
  }
});

test("validate:paths adds the frontend build on top of every lane", () => {
  assert.match(packageJson.scripts["validate:paths"], /npm run validate:frontend/);
  assert.match(packageJson.scripts["validate:frontend"], /node scripts\/validate-frontend\.mjs/);
});

test("product CI validates every pull request regardless of path", () => {
  // PRs are the merge path; a bare pull_request trigger validates www/,
  // product/, mcp/ and website changes even without a main-push path entry.
  assert.match(workflow, /on:\n  pull_request:/);
  assert.match(workflow, /npm run validate:code/);
});

test("the checked-in enumeration contains all 15 Paperclip projects", () => {
  const enumeration = readProjectEnumeration();
  assert.equal(enumeration.projectCount, 15);
  assert.equal(enumeration.projects.length, 15);
  assert.equal(new Set(enumeration.projects.map((project) => project.id)).size, 15);
  assert.equal(PROJECT_MAP.length, 15);
});

test("every Paperclip project is mapped to real roots and lanes (no uncovered project)", () => {
  const enumeration = readProjectEnumeration();
  const { issues } = projectCoverage(enumeration.projects, trackedPaths());
  assert.deepEqual(issues, []);
});

test("project mapping fails closed on drift (negative fixtures)", () => {
  const enumeration = readProjectEnumeration();
  const paths = trackedPaths();

  const unmapped = [
    ...enumeration.projects,
    { id: "00000000-0000-0000-0000-000000000000", name: "99 · New Project", repoUrl: null },
  ];
  assert.ok(
    projectCoverage(unmapped, paths).issues.some((issue) => /unmapped Paperclip project/.test(issue)),
  );

  const canonicalMarkedExternal = PROJECT_MAP.map((entry) =>
    entry.id === "291fecff-2f36-44bc-ba39-cae853f6e90c"
      ? { ...entry, external: true, roots: [], lanes: [] }
      : entry,
  );
  assert.ok(
    projectCoverage(enumeration.projects, paths, canonicalMarkedExternal).issues.some((issue) =>
      /cannot be marked external/.test(issue),
    ),
  );

  const laneDrift = PROJECT_MAP.map((entry) =>
    entry.id === "586450b2-f8b2-4dbf-bf49-6d6f7ef4d00c"
      ? { ...entry, lanes: ["frontend"] }
      : entry,
  );
  assert.ok(
    projectCoverage(enumeration.projects, paths, laneDrift).issues.some((issue) =>
      /lane mismatch/.test(issue),
    ),
  );

  const externalClaimsRoots = PROJECT_MAP.map((entry) =>
    entry.id === "74623e58-4aea-4f5e-9608-201fafb7ab02"
      ? { ...entry, roots: ["app/web"], lanes: ["frontend"] }
      : entry,
  );
  assert.ok(
    projectCoverage(enumeration.projects, paths, externalClaimsRoots).issues.some((issue) =>
      /external project must not claim local roots/.test(issue),
    ),
  );
});

test("root .dockerignore excludes only the Coolify-injected non-source file", () => {
  const dockerignore = readFileSync(
    new URL("../.dockerignore", import.meta.url),
    "utf8",
  );
  const entries = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(entries, ["docker-compose.yaml"]);
  assert.equal(classifyPath(".dockerignore"), "non-release");
});

test("Docker context without .git ignores the injected compose file but still fails closed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-coverage-"));
  try {
    writeFileSync(join(cwd, ".dockerignore"), "docker-compose.yaml\n");
    writeFileSync(join(cwd, "docker-compose.yaml"), "services: {}\n");
    writeFileSync(join(cwd, "README.md"), "# fixture\n");
    mkdirSync(join(cwd, "brand-new-service", "src"), { recursive: true });
    writeFileSync(join(cwd, "brand-new-service", "src", "index.ts"), "export {};\n");

    const paths = trackedPaths({ cwd });
    assert.ok(
      !paths.includes("docker-compose.yaml"),
      "provider-injected compose file leaked into tracked coverage",
    );
    const { unclassified } = coverage(paths);
    assert.deepEqual(unclassified, ["brand-new-service/src/index.ts"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Docker context with re-including negation stays fail-closed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-coverage-"));
  try {
    writeFileSync(join(cwd, ".dockerignore"), "vendor\n!vendor/keep.js\n");
    mkdirSync(join(cwd, "vendor"), { recursive: true });
    writeFileSync(join(cwd, "vendor", "keep.js"), "export {};\n");
    writeFileSync(join(cwd, "README.md"), "# fixture\n");

    // Docker re-includes vendor/keep.js after excluding vendor/, so the
    // fallback must not apply the overridden literal exclusion.
    const paths = trackedPaths({ cwd });
    assert.ok(
      paths.includes("vendor/keep.js"),
      "negation-reincluded source was hidden from coverage",
    );
    assert.deepEqual(coverage(paths).unclassified, ["vendor/keep.js"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Docker context with an unsupported glob applies no exclusions", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-coverage-"));
  try {
    writeFileSync(join(cwd, ".dockerignore"), "docker-compose.yaml\n*.log\n");
    writeFileSync(join(cwd, "docker-compose.yaml"), "services: {}\n");
    writeFileSync(join(cwd, "debug.log"), "noise\n");
    writeFileSync(join(cwd, "README.md"), "# fixture\n");

    const paths = trackedPaths({ cwd });
    assert.ok(
      paths.includes("docker-compose.yaml"),
      "unsupported manifest must not apply any exclusion",
    );
    assert.deepEqual(coverage(paths).unclassified.sort(), ["debug.log", "docker-compose.yaml"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the website lane fails closed on real source (fixture)", () => {
  const script = readFileSync(
    new URL("../scripts/validate-website.mjs", import.meta.url),
    "utf8",
  );
  assert.match(script, /ALLOWED = new Set\(\["app\/website\/\.gitkeep"\]\)/);
  assert.match(script, /process\.exit\(2\)/);
});
