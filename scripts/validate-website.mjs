// Website scaffold gate (KOMAA-1616).
//
// `app/website/` is an empty scaffold. There is no build/test/release lane for
// real Next.js website source yet, so any file other than `.gitkeep` must fail
// closed instead of shipping through the frontend lane unnoticed.

import { execFileSync } from "node:child_process";

const ALLOWED = new Set(["app/website/.gitkeep"]);

let files;
try {
  files = execFileSync("git", ["ls-files", "app/website"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.error("[website-gate] cannot enumerate app/website (git ls-files failed)");
  process.exit(2);
}

const uncovered = files.filter((file) => !ALLOWED.has(file));
if (uncovered.length > 0) {
  console.error(
    [
      "[website-gate] UNCOVERED website source — failing closed.",
      ...uncovered.map((file) => `  - ${file}`),
      "Add a real website build/test lane before committing app/website source.",
    ].join("\n"),
  );
  process.exit(2);
}

console.log("[website-gate] PASS (scaffold only, no uncovered website source)");
