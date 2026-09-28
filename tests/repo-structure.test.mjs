import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const vercelJson = JSON.parse(readFileSync(`${root}/vercel.json`, "utf8"));

test("repo exposes the V0 application contract", () => {
  for (const path of [
    "package.json",
    "vercel.json",
    "app",
    "app/plugin",
    "branding",
    "supabase",
    "tests",
    ".github",
    ".github/workflows/release-readiness.yml",
    "README.md",
    "AGENTS.md",
    ".env.example",
  ]) {
    assert.ok(existsSync(`${root}/${path}`), `missing ${path}`);
  }

  for (const script of ["dev", "build", "lint", "typecheck", "test"]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script: ${script}`);
  }

  assert.equal(existsSync(`${root}/app/server`), false, "legacy app/server must stay removed; use app/plugin");

  assert.deepEqual(packageJson.workspaces, ["app"]);
  assert.equal(vercelJson.buildCommand, "npm run build");
  assert.equal(vercelJson.installCommand, "npm ci");
  assert.equal(vercelJson.outputDirectory, "app/web/dist");
  assert.equal(vercelJson.framework, null);
});

test("release guardrails cover build targets, pre-merge readiness and production auth", () => {
  for (const script of ["validate:code", "validate:vercel", "validate:cloudflare", "validate:release"]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script: ${script}`);
  }

  assert.match(packageJson.scripts["validate:release"], /validate:vercel/);
  assert.match(packageJson.scripts["validate:release"], /validate:cloudflare/);

  const prePush = readFileSync(`${root}/.githooks/pre-push`, "utf8");
  assert.match(prePush, /refs\/heads\/main/);
  assert.match(prePush, /validate:release/);

  const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");
  assert.match(ci, /production-preflight:/);
  assert.match(ci, /CLOUDFLARE_API_TOKEN/);
  assert.match(ci, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(ci, /wrangler whoami/);
  assert.match(ci, /needs: production-preflight/);

  const readiness = readFileSync(`${root}/.github/workflows/release-readiness.yml`, "utf8");
  assert.match(readiness, /pull_request_target:/);
  assert.match(readiness, /production-config-preflight:/);
  assert.match(readiness, /environment: production/);
  assert.match(readiness, /CLOUDFLARE_API_TOKEN/);
  assert.match(readiness, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readiness, /wrangler@4\.123\.0 whoami/);
  assert.doesNotMatch(readiness, /actions\/checkout/);
});
