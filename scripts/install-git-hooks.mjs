import { chmodSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const hookPaths = [".githooks/pre-push", ".githooks/pre-commit"].filter((p) => existsSync(p));
if (hookPaths.length === 0) process.exit(0);

const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  stdio: "ignore",
});
if (inside.status !== 0) process.exit(0);

for (const hookPath of hookPaths) {
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Best-effort on filesystems that do not expose POSIX mode bits.
  }
}

const configured = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

if (configured.status !== 0) {
  console.warn("[hooks] Could not configure core.hooksPath; local git validation will not be automatic.");
  process.exit(0);
}

console.log("[hooks] Git commit/push validation enabled.");
