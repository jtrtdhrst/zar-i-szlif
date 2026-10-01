import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
    ".github/workflows/ci.yml",
    ".github/workflows/cloudflare-worker-release.yml",
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

// Inwariant architektury (KOMAA-385): produkt gada z Qdrantem bezpośrednio po
// REST, a `mcp-qdrant` zostaje narzędziem agenta/admina/dev. Adres Qdrantu
// przychodzi wyłącznie ze zmiennej środowiskowej (secret flow), nigdy z kodu.
test("product knowledge path is direct-to-Qdrant and env-addressed", () => {
  const sources = readdirSync(`${root}/app/plugin`, { recursive: true })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(`${root}/app/plugin/${f}`, "utf8"))
    .join("\n");

  assert.doesNotMatch(sources, /mcp-qdrant|:8000\/mcp/);
  assert.doesNotMatch(sources, /https?:\/\/[^\s"'`]*qdrant/i);
  assert.match(sources, /process\.env\.QDRANT_URL/);
});

test("frontend and Cloudflare Worker release paths stay separated", () => {
  for (const script of [
    "validate:code",
    "validate:vercel",
    "validate:cloudflare",
    "validate:worker",
    "validate:release",
  ]) {
    assert.equal(typeof packageJson.scripts[script], "string", `missing npm script: ${script}`);
  }

  // validate:release is the target-aware dispatcher (KOMAA-457); it must not
  // collapse to a single provider's gate.
  assert.match(packageJson.scripts["validate:release"], /release-targets\.mjs/);
  assert.doesNotMatch(packageJson.scripts["validate:release"], /validate:vercel/);
  assert.match(packageJson.scripts["validate:worker"], /validate:cloudflare/);

  const prePush = readFileSync(`${root}/.githooks/pre-push`, "utf8");
  assert.match(prePush, /refs\/heads\/main/);
  assert.match(prePush, /release-targets\.mjs/);

  const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");
  assert.match(ci, /verify-and-package:/);
  assert.doesNotMatch(ci, /CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(ci, /deploy-production:/);
  assert.doesNotMatch(ci, /production-preflight:/);

  const workerRelease = readFileSync(
    `${root}/.github/workflows/cloudflare-worker-release.yml`,
    "utf8",
  );
  assert.match(workerRelease, /Cloudflare Worker Release/);
  assert.match(workerRelease, /app\/cloudflare-worker\/\*\*/);
  assert.match(workerRelease, /CLOUDFLARE_API_TOKEN/);
  assert.match(workerRelease, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workerRelease, /wrangler@4\.123\.0 whoami/);
  assert.match(workerRelease, /deploy-production:/);

  assert.equal(
    existsSync(`${root}/.github/workflows/release-readiness.yml`),
    false,
    "global Cloudflare readiness must not gate Vercel/frontend PRs",
  );
});
