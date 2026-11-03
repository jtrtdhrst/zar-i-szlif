import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
test("recovered product web app is buildable from this repo", () => {
  for (const file of ["app/package.json", "app/web/scripts/build-static.mjs", "ops/coolify/Dockerfile", "ops/coolify/nginx.conf", "registry/kompas/ui/kompas-button.js"]) assert.ok(existsSync(file), "missing product build input: " + file);
});
test("product and infrastructure repositories stay separate", () => {
  for (const infra of ["mcp-bridges", "paperclip-mcp", "ubuntu-mcp", "comfyui-mcp", "plasmic-mcp", "coolify-mcp"]) assert.equal(existsSync(infra), false, "infra must live in harness: " + infra);
  assert.ok(existsSync("mcp/README.md"));
});
test("recovering product runtime must not reactivate Cloudflare Worker publishing", () => {
  assert.equal(existsSync(".github/workflows/cloudflare-worker-release.yml"), false);
  const dockerfile = readFileSync("ops/coolify/Dockerfile", "utf8");
  assert.match(dockerfile, /COPY --from=build \/app\/app\/web\/dist/);
  assert.match(dockerfile, /nginx:alpine/);
});
