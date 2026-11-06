// Public-site and analytics module gate (KOMAA-1616).
//
// `www/`, `product/` and `mcp/` ship ready-to-wire client/server adapters that
// no bundler currently compiles in CI. This lane proves they parse and that
// every PostHog adapter keeps consent OFF by default and never autocaptures.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOTS = ["www/", "product/", "mcp/"];

let files;
try {
  files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path && ROOTS.some((root) => path.startsWith(root)))
    .filter((path) => /\.(mjs|cjs|js)$/.test(path));
} catch {
  console.error("[client-modules] cannot enumerate tracked files (git ls-files failed)");
  process.exit(2);
}

const failures = [];

for (const file of files) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (check.status !== 0) {
    failures.push(`${file}: syntax error\n${check.stderr.trim()}`);
    continue;
  }

  const source = readFileSync(file, "utf8");
  if (file.endsWith("posthog.client.mjs")) {
    if (!/opt_out_capturing_by_default:\s*true/.test(source)) {
      failures.push(`${file}: PostHog must default to opt_out_capturing_by_default: true`);
    }
    if (!/autocapture:\s*false/.test(source)) {
      failures.push(`${file}: PostHog must disable autocapture`);
    }
    if (!/disable_session_recording:\s*true/.test(source)) {
      failures.push(`${file}: PostHog must disable session recording`);
    }
    if (!/has_opted_in_capturing\(\)/.test(source)) {
      failures.push(`${file}: capture helpers must guard on has_opted_in_capturing()`);
    }
  }
  if (file.endsWith("posthog.server.mjs") && !/enabled\s*=\s*false/.test(source)) {
    failures.push(`${file}: server analytics must stay disabled by default`);
  }
  if (/\bsk-[A-Za-z0-9]{16,}\b|phc_[A-Za-z0-9]{20,}/.test(source)) {
    failures.push(`${file}: looks like a committed secret/token`);
  }
}

if (failures.length > 0) {
  console.error(["[client-modules] FAIL", ...failures.map((failure) => `  - ${failure}`)].join("\n"));
  process.exit(2);
}

console.log(`[client-modules] PASS (${files.length} modules parsed, consent defaults verified)`);
