import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

// KOMAA-499: candidate validation vs platform deploy validation.
//
// Default path (no --platform) is candidate validation: it proves the exact
// pushed content builds into a deployable frontend without any Vercel
// project link, Vercel API, VERCEL_* env or .vercel/project.json. Production
// frontend deploys from main via the Vercel <-> GitHub integration, so a
// branch push/PR must never require local Vercel state.
//
// --platform keeps the full Vercel validation (vercel pull + vercel build)
// for explicit platform checks; it may use existing Paperclip secret
// bindings (VERCEL_ORG_ID / VERCEL_PROJECT_ID / VERCEL_TOKEN).
//
// Ordering contract (enforced by tests/release-gate.test.mjs): the
// `--platform` flag parse below is the first occurrence of platform-only
// concepts in this file. Everything before it must stay free of
// vercel@/VERCEL_/vercel pull/vercel build/.vercel references.

const platform = process.argv.includes("--platform");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
    ...opts,
  });

  if (result.error) {
    console.error(`[vercel-gate] Failed to launch ${cmd}: ${result.error.message}`);
    process.exit(2);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!platform) {
  console.log("[vercel-gate] Candidate validation (no Vercel link/API required)...");
  run("npm", ["run", "build"]);

  const indexFile = "app/web/dist/index.html";
  if (!existsSync(indexFile) || statSync(indexFile).size === 0) {
    console.error(
      `[vercel-gate] Missing or empty ${indexFile} after build; refusing candidate.`,
    );
    process.exit(2);
  }

  let vercelJson;
  try {
    vercelJson = JSON.parse(readFileSync("vercel.json", "utf8"));
  } catch (error) {
    console.error(`[vercel-gate] Cannot read vercel.json: ${error.message}`);
    process.exit(2);
  }

  const violations = [];
  if (vercelJson.buildCommand !== "npm run build") {
    violations.push(`buildCommand must be "npm run build" (got ${JSON.stringify(vercelJson.buildCommand)})`);
  }
  if (vercelJson.installCommand !== "npm ci") {
    violations.push(`installCommand must be "npm ci" (got ${JSON.stringify(vercelJson.installCommand)})`);
  }
  if (vercelJson.outputDirectory !== "app/web/dist") {
    violations.push(
      `outputDirectory must be "app/web/dist" (got ${JSON.stringify(vercelJson.outputDirectory)})`,
    );
  }
  if (!existsSync(vercelJson.outputDirectory)) {
    violations.push(`outputDirectory ${JSON.stringify(vercelJson.outputDirectory)} does not exist after build`);
  }

  if (violations.length > 0) {
    console.error(["[vercel-gate] vercel.json validation failed:", ...violations.map((v) => `  - ${v}`)].join("\n"));
    process.exit(2);
  }

  console.log("[vercel-gate] PASS (candidate: build + dist + vercel.json)");
  process.exit(0);
}

const VERCEL_CLI_VERSION = "59.19.1";
const projectFile = ".vercel/project.json";

if (!existsSync(projectFile)) {
  const missing = ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID"].filter(
    (name) => !process.env[name],
  );

  if (missing.length > 0) {
    console.error(
      [
        "[vercel-gate] Vercel project is not linked.",
        `Missing: ${missing.join(", ")}.`,
        "Set VERCEL_ORG_ID and VERCEL_PROJECT_ID in the workspace environment",
        "or link this checkout to the existing Vercel project before running --platform.",
        "The gate refuses to auto-create/link an unknown Vercel project.",
      ].join("\n"),
    );
    process.exit(2);
  }
}

function runVercel(args) {
  const tokenArgs = process.env.VERCEL_TOKEN
    ? ["--token", process.env.VERCEL_TOKEN]
    : [];

  const result = spawnSync(
    "npx",
    ["--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args, ...tokenArgs],
    {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    },
  );

  if (result.error) {
    console.error(`[vercel-gate] Failed to launch Vercel CLI: ${result.error.message}`);
    process.exit(2);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[vercel-gate] Running vercel pull (Preview project settings)...");
runVercel(["pull", "--yes", "--environment=preview"]);

console.log("[vercel-gate] Running vercel build (Vercel-equivalent local build)...");
runVercel(["build"]);

console.log("[vercel-gate] PASS (platform)");
