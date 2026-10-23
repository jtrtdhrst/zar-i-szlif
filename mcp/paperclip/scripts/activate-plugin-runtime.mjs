#!/usr/bin/env node
/**
 * Activate the staged plugin runtime through the SUPPORTED install route.
 *
 * The plugins are installed from /paperclip/plugin-runtime/<name> (persistent
 * volume, staged by the gateway image entrypoint) instead of the image's
 * ephemeral /app source tree, so a cold recreate can no longer erase dist.
 * POST /plugins/install with a local path updates the SAME plugin record
 * (registry keyed by manifest id) and reloads the lifecycle.
 *
 * Board-only: the route asserts instance admin. The credential is read from a
 * file path by default (never argv, never logged, never exported to agents).
 *
 * Usage:
 *   node activate-plugin-runtime.mjs \
 *     --api-url https://paperclip.kompaszbiorek.pl \
 *     --board-key-file /paperclip/instances/default/secrets/remote-mcp-board-key \
 *     [--runtime-root /paperclip/plugin-runtime] [--dry-run]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const apiUrl = String(arg("api-url", process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100")).replace(/\/+$/, "");
const boardKeyFile = arg("board-key-file", process.env.PAPERCLIP_BOARD_KEY_FILE);
const runtimeRoot = String(arg("runtime-root", "/paperclip/plugin-runtime"));
const dryRun = Boolean(arg("dry-run", false));

if (!boardKeyFile || typeof boardKeyFile !== "string") {
  console.error("Missing --board-key-file (Board credential required; never pass it on argv).");
  process.exit(2);
}
const boardKey = readFileSync(boardKeyFile, "utf8").trim();
if (!boardKey) {
  console.error("Board credential file is empty.");
  process.exit(2);
}
if (!existsSync(runtimeRoot)) {
  console.error(`Runtime root not staged: ${runtimeRoot}`);
  process.exit(2);
}

const base = apiUrl.endsWith("/api") ? apiUrl : `${apiUrl}/api`;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${boardKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${String(text).slice(0, 300)}`);
  return parsed;
}

const staged = readdirSync(runtimeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(runtimeRoot, entry.name, "dist", "manifest.js")))
  .map((entry) => join(runtimeRoot, entry.name));

if (staged.length === 0) {
  console.error(`No staged plugin packages under ${runtimeRoot}`);
  process.exit(2);
}

for (const localPath of staged) {
  if (dryRun) {
    console.log(`[dry-run] POST /plugins/install localPath=${localPath}`);
    continue;
  }
  const installed = await call("POST", "/plugins/install", { packageName: localPath, isLocalPath: true });
  console.log(`installed ${localPath} -> status=${installed?.status ?? "?"} key=${installed?.pluginKey ?? "?"}`);
}

const plugins = await call("GET", "/plugins");
const rows = (Array.isArray(plugins) ? plugins : plugins?.plugins ?? []).map((plugin) => ({
  key: plugin.pluginKey,
  status: plugin.status,
  path: plugin.packagePath,
}));
console.log(JSON.stringify(rows.filter((row) => String(row.path || "").startsWith(runtimeRoot)), null, 2));
if (rows.some((row) => String(row.path || "").startsWith(runtimeRoot) && row.status !== "ready")) {
  console.error("At least one staged plugin is not ready.");
  process.exit(1);
}
