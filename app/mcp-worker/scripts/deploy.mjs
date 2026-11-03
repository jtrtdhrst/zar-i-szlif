import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const kvId = (process.env.MCP_OAUTH_KV_ID || "").trim();
if (!/^[0-9a-f]{32}$/i.test(kvId)) {
  console.error("DEPLOY BLOCKED: configure MCP_OAUTH_KV_ID with a NEW dedicated Workers KV namespace ID. Do not reuse the legacy Kompas OAUTH_KV.");
  process.exit(2);
}
const file = new URL("../wrangler.jsonc", import.meta.url);
const config = JSON.parse(await readFile(file, "utf8"));
if (config.name !== "zar-i-szlif-mcp" || config.vars.MCP_PUBLIC_ORIGIN !== "https://mcp.zariszlif.pl") {
  console.error("DEPLOY BLOCKED: unexpected target name/origin");
  process.exit(2);
}
config.kv_namespaces = [{ binding: "OAUTH_KV", id: kvId }];
const generated = new URL("../.wrangler.deploy.jsonc", import.meta.url);
await writeFile(generated, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
const r = spawnSync("npx", ["--no-install", "wrangler", "deploy", "--config", ".wrangler.deploy.jsonc"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
