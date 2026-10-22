// Protect the product repository from accidental host-MCP deployments.
// This gate is intentionally additive: deleting legacy host-only files is allowed.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const HOST_ONLY_PATHS = [
  /^mcp\//,
  /^(?:mantic-mcp-http|mcp-qdrant|plasmic-mcp|supabase-mcp|ubuntu-mcp)\//,
  /^penpot\/mcp\//,
  /^ops\/design-stack\//,
  /^ops\/mcp\//,
  /^dev\/integrations\/(?:opencode-mcp|paperclip-mcp)\//,
  /^\.github\/workflows\/opendesign-brand-mcp\.yml$/,
];

export function isHostOnlyPath(path) {
  return HOST_ONLY_PATHS.some((rule) => rule.test(path));
}

export function findHostMcpViolations(entries) {
  return entries.filter(({ status, path, previousPath }) => {
    if (status === "D") return false; // permit safe cleanup in the product repository
    return isHostOnlyPath(path) || (previousPath ? isHostOnlyPath(previousPath) : false);
  });
}

function git(...argv) {
  return execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function parseNameStatus(raw) {
  return raw.split("\n").filter(Boolean).map((line) => {
    const [statusCode, firstPath, secondPath] = line.split("\t");
    const status = statusCode[0];
    if (!status || !firstPath || (["R", "C"].includes(status) && !secondPath)) {
      throw new Error("Invalid git --name-status record: " + line);
    }
    return ["R", "C"].includes(status)
      ? { status, path: secondPath, previousPath: firstPath }
      : { status, path: firstPath };
  });
}

function main() {
  const baseArg = process.argv.find((arg) => arg.startsWith("--base="));
  const base = baseArg?.slice("--base=".length) || process.env.GITHUB_BASE_SHA;
  if (!base) throw new Error("Missing --base or GITHUB_BASE_SHA (fail closed)");
  const mergeBase = git("merge-base", base, "HEAD");
  const changed = parseNameStatus(git("diff", "--name-status", "--find-renames", mergeBase, "HEAD"));
  const violations = findHostMcpViolations(changed);
  if (violations.length) {
    console.error("WRONG_REPOSITORY: host MCP changes cannot be committed to the PRODUCT repository.");
    for (const entry of violations) {
      console.error("  " + entry.status + " " + (entry.previousPath ? entry.previousPath + " -> " : "") + entry.path);
    }
    console.error("Host MCP source belongs to a SEPARATE private owner Harness repository under mcp/<service>/.");
    console.error("Product MCP stays under app/mcp-worker/**. Legacy host-only deletions are allowed for migration.");
    process.exitCode = 1;
  } else {
    console.log("PASS product/host MCP repository boundary (" + changed.length + " changed paths)");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error("MCP repository fence error:", error.message); process.exitCode = 2; }
}
