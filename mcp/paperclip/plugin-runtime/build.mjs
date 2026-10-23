#!/usr/bin/env node
/**
 * Build the bundled Paperclip plugins into a self-contained runtime tree.
 *
 * Why: the upstream Paperclip image ships the plugin SOURCES but not their
 * git-ignored `dist/` output, so on boot every bundled plugin fails activation
 * with "no longer exposes a Paperclip manifest" (and the wiki worker answers
 * 502/WORKER_UNAVAILABLE). Rebuilding inside a running container is an ad-hoc
 * patch that the next recreate erases.
 *
 * This script builds the plugins ONCE at image-build time and emits an
 * immutable tree (MANIFEST.json carries per-file sha256) that the gateway
 * entrypoint stages into the shared /paperclip volume. No Paperclip Core edit.
 *
 * Usage: node build.mjs [repoRoot] [outDir]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.argv[2] || "/app";
const outDir = process.argv[3] || "/opt/paperclip-mcp/plugin-runtime";

const PLUGINS = [
  {
    packageDir: "packages/plugins/plugin-llm-wiki",
    copy: ["package.json", "dist", "agents", "skills", "templates", "migrations"],
  },
  {
    packageDir: "packages/plugins/plugin-workspace-diff",
    copy: ["package.json", "dist"],
  },
  {
    packageDir: "packages/plugins/examples/plugin-file-browser-example",
    copy: ["package.json", "dist"],
  },
];

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function build(packageDir) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, packageDir, "package.json"), "utf8"));
  if (!pkg.name) throw new Error(`missing package name in ${packageDir}`);
  console.log(`[plugin-runtime] building ${pkg.name}`);
  execFileSync("pnpm", ["--filter", pkg.name, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
  return pkg;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const plugin of PLUGINS) {
  const sourceRoot = join(repoRoot, plugin.packageDir);
  if (!existsSync(sourceRoot)) throw new Error(`plugin source missing: ${sourceRoot}`);
  const pkg = build(plugin.packageDir);
  const name = plugin.packageDir.split("/").pop();
  const targetRoot = join(outDir, name);
  mkdirSync(targetRoot, { recursive: true });

  const files = [];
  for (const entry of plugin.copy) {
    const from = join(sourceRoot, entry);
    if (!existsSync(from)) {
      // dist is the only hard requirement; asset dirs are optional per plugin.
      if (entry === "dist") throw new Error(`missing dist after build: ${from}`);
      continue;
    }
    const to = join(targetRoot, entry);
    mkdirSync(join(to, ".."), { recursive: true });
    cpSync(from, to, {
      recursive: true,
      filter: (src) => !src.endsWith(".map"),
    });
    const stat = statSync(to);
    for (const file of stat.isDirectory() ? walk(to) : [to]) {
      files.push({
        path: relative(targetRoot, file).split("\\").join("/"),
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      });
    }
  }

  const manifestPath = join(targetRoot, "dist", "manifest.js");
  if (!existsSync(manifestPath)) throw new Error(`manifest not built: ${manifestPath}`);
  writeFileSync(
    join(targetRoot, "MANIFEST.json"),
    JSON.stringify({ packageName: pkg.name, pluginDir: name, files }, null, 2) + "\n",
  );
  console.log(`[plugin-runtime] staged ${name} (${files.length} files)`);
}

console.log(`[plugin-runtime] done -> ${outDir}`);
