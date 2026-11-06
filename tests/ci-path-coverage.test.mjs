import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LANES,
  classifyPath,
  coverage,
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

test("the website lane fails closed on real source (fixture)", () => {
  const script = readFileSync(
    new URL("../scripts/validate-website.mjs", import.meta.url),
    "utf8",
  );
  assert.match(script, /ALLOWED = new Set\(\["app\/website\/\.gitkeep"\]\)/);
  assert.match(script, /process\.exit\(2\)/);
});
