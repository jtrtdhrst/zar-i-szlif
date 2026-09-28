import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
        "or link this checkout to the existing Vercel project before pushing.",
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

console.log("[vercel-gate] Pulling current Preview project settings...");
runVercel(["pull", "--yes", "--environment=preview"]);

console.log("[vercel-gate] Running Vercel-equivalent local build...");
runVercel(["build"]);

console.log("[vercel-gate] PASS");
