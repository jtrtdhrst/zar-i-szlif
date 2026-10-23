#!/usr/bin/env node
/**
 * Plasmic MCP production release admission.
 *
 * Run from the checked-out repository before publishing or deploying a
 * production image. Fails closed if the production workflow builds a
 * different source tree than the reviewed canonical MCP code.
 *
 * --source-only validates the canonical Docker build safety without checking
 * GitHub Actions integration (useful for development/PR unit tests).
 *
 * No credentials, network calls, writes or Docker daemon access.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const read = (p) => readFile(resolve(repo, p), "utf8");
const problems = [];

const dockerfile = await read("mcp/plasmic/Dockerfile");
if (!dockerfile.includes("RUN npm ci --omit=dev --ignore-scripts")) {
  problems.push("Dockerfile must use lockfile-only npm ci --omit=dev --ignore-scripts");
}
if (/\|\|\s*npm\s+install|npm\s+install\s+--omit=dev/.test(dockerfile)) {
  problems.push("Dockerfile must not silently fall back to npm install");
}
if (!/^USER mcp\s*$/m.test(dockerfile)) {
  problems.push("Docker image must run as unprivileged mcp user");
}

if (!process.argv.includes("--source-only")) {
  const workflow = await read(".github/workflows/opendesign-brand-mcp.yml");
  // Both the build context and dispatch paths must name the same canonical tree.
  if (!/^\s*context:\s*mcp\/plasmic\s*$/m.test(workflow)) {
    problems.push("GHCR image workflow builds a noncanonical context; expected context: mcp/plasmic");
  }
  if (!/^\s*file:\s*mcp\/plasmic\/Dockerfile\s*$/m.test(workflow)) {
    problems.push("GHCR image workflow does not use mcp/plasmic/Dockerfile");
  }
  if (!/^\s*-\s*["']?mcp\/plasmic\/\*\*/m.test(workflow)) {
    problems.push("GHCR image workflow does not watch mcp/plasmic/** changes");
  }
  if (!/github\.ref\s*==\s*'refs\/heads\/main'/.test(workflow)) {
    problems.push("GHCR image workflow must gate image push on refs/heads/main");
  }
  const compose = await read("ops/design-stack/docker-compose.mcp.yml");
  if (!compose.includes("IMAGE_TAG:?IMAGE_TAG required")) {
    problems.push("Compose must refuse a missing immutable IMAGE_TAG");
  }
}
if (problems.length) {
  for (const problem of problems) console.error(`RELEASE_BLOCKED: ${problem}`);
  process.exitCode = 1;
} else {
  console.log(process.argv.includes("--source-only")
    ? "SOURCE_PREFLIGHT_OK: deterministic non-root Dockerfile"
    : "RELEASE_PREFLIGHT_OK: reviewed canonical MCP source matches the GHCR build pipeline");
}
