import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const files = [
  "app/web/scripts/build-static.mjs",
  "app/web/scripts/skill-completion-task-test.mjs",
  "app/plugin/index.ts",
  "app/cloudflare-worker/build-worker.mjs",
  "app/cloudflare-worker/worker.js",
  "tests/repo-structure.test.mjs",
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(file)], { stdio: "inherit" });
}
