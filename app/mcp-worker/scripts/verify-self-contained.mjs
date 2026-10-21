/** Fail closed when Worker service source reaches outside app/mcp-worker.
 * Kept dependency-free so Cloudflare and GitHub CI can run this from Root directory.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcesRoot = resolve(workerRoot, "src");
let scanned = 0;
const failures = [];
function walk(folder) {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const file = resolve(folder, item.name);
    if (item.isDirectory()) { walk(file); continue; }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(item.name)) continue;
    scanned++;
    const code = readFileSync(file, "utf8");
    const imports = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g;
    for (const match of code.matchAll(imports)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      const scope = relative(workerRoot, target);
      if (scope === ".." || scope.startsWith("../") || /^(?:\/|\\)/.test(scope)) {
        failures.push(`${relative(workerRoot,file)} imports outside Root directory: ${spec}`);
        continue;
      }
      const resolved = target.replace(/\.js$/, ".ts");
      if (!existsSync(target) && !existsSync(resolved)) {
        failures.push(`${relative(workerRoot,file)} imports missing local module: ${spec}`);
      }
    }
  }
}
walk(sourcesRoot);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`PASS: ${scanned} local MCP source modules; no escaped imports`);
