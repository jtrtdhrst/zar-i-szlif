#!/usr/bin/env node
/**
 * Fail-closed boundary for the PRODUCT repository.
 * Harness/host-MCP code belongs in the owner's separate private Harness repo.
 * Deleting or moving legacy files OUT is allowed; adding/modifying them here is not.
 * This does not gate user-facing PRODUCT MCP under app/mcp-worker/.
 */
import { spawnSync } from "node:child_process";

const expectedRepository = "miloszspyrka-code/zar-i-szlif";
const actualRepository = process.env.GITHUB_REPOSITORY;
if (actualRepository && actualRepository !== expectedRepository) {
  console.error(`PRODUCT_REPOSITORY_MISMATCH: expected ${expectedRepository}, got ${actualRepository}`);
  process.exit(2);
}
const base = process.argv[2] ?? "origin/main";
const head = process.argv[3] ?? "HEAD";
const diff = spawnSync("git", ["diff", "--name-status", "--find-renames", `${base}...${head}`], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
if (diff.status !== 0 || diff.error) {
  console.error("REPOSITORY_BOUNDARY_DIFF_FAILED:", diff.stderr || diff.error?.message);
  process.exit(2);
}
const reserved = [
  /^dev\/integrations\//,
  /^ops\/design-stack\//,
  /^harness\//,
  /^ops\/(?:paperclip-mcp|mcp-gateway|supervisor|opencode)\//,
];
const forbidden = [];
for (const line of diff.stdout.split("\n")) {
  if (!line.trim()) continue;
  const parts = line.split("\t");
  const status = parts[0] ?? "";
  const path = /^[RC]/.test(status) ? parts[2] : parts[1];
  if (!path) {
    console.error("REPOSITORY_BOUNDARY_INVALID_DIFF_LINE:", line);
    process.exit(2);
  }
  // Allow deleting legacy infrastructure files as part of a safe migration.
  if (status === "D") continue;
  if (reserved.some((pattern) => pattern.test(path))) {
    forbidden.push(`${status}\t${path}`);
  }
}
if (forbidden.length) {
  console.error("HOST_HARNESS_CODE_IN_PRODUCT_REPOSITORY:");
  for (const f of forbidden) console.error("  " + f);
  console.error("Move internal host MCP/Harness changes to the separate owner's Harness repo; do not publish to the product repo.");
  process.exit(1);
}
console.log("PRODUCT_REPOSITORY_BOUNDARY_OK");
