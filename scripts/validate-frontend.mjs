// Frontend gate (KOMAA-457).
//
// Validates the static frontend artifact that the deployment target ships:
// `app/web/dist` (index.html + logo), built exactly like the self-hosted
// Coolify target builds it (Node 24, `npm --prefix app run build`).
//
// The gate is candidate validation: no platform link, no provider API, no
// credentials. It must pass on any branch, because the branch push path runs
// it through `npm run validate:release`.

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Publish directory of the frontend target. Must stay in sync with
// `ops/coolify/Dockerfile` (the container copies this directory verbatim).
const INDEX_FILE = "app/web/dist/index.html";
const LOGO_FILE = "app/web/dist/kompas-logo.png";
const PUBLISH_DIR_IN_IMAGE = "/app/app/web/dist";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });

  if (result.error) {
    console.error(`[frontend-gate] Failed to launch ${cmd}: ${result.error.message}`);
    process.exit(2);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[frontend-gate] Building the static frontend...");
run("npm", ["--prefix", "app", "run", "build"]);

const violations = [];

const indexFile = INDEX_FILE;
if (!existsSync(indexFile) || statSync(indexFile).size === 0) {
  violations.push(`missing or empty ${indexFile} after build`);
}

const logoFile = LOGO_FILE;
if (!existsSync(logoFile)) {
  violations.push(`missing ${logoFile} after build`);
}

// The container copies one fixed path; publish-dir drift would ship an empty
// site without any failing build.
const dockerfile = "ops/coolify/Dockerfile";
if (!existsSync(dockerfile)) {
  violations.push(`missing ${dockerfile}`);
} else if (!readFileSync(dockerfile, "utf8").includes(PUBLISH_DIR_IN_IMAGE)) {
  violations.push(`${dockerfile} does not copy ${PUBLISH_DIR_IN_IMAGE} (publish dir drift)`);
}

if (violations.length > 0) {
  console.error(["[frontend-gate] frontend validation failed:", ...violations.map((v) => `  - ${v}`)].join("\n"));
  process.exit(2);
}

console.log("[frontend-gate] PASS (build + dist artifacts)");
