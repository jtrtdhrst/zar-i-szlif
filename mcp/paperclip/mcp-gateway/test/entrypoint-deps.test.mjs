// Every relative gateway import must be staged into the writable /paperclip
// volume by the production entrypoint; otherwise the Docker image builds but
// the production gateway fails at runtime with ERR_MODULE_NOT_FOUND.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const gateway = readFileSync(resolve(dir, "../gateway.mjs"), "utf8");
const entrypoint = readFileSync(resolve(dir, "../../entrypoint.sh"), "utf8");

test("production entrypoint copies every relative gateway import", () => {
  const imports = gateway.split("\n").map((line) => {
    const segment = line.includes('from "./') ? line.split('from "./')[1]
      : line.includes("from './") ? line.split("from './")[1] : null;
    return segment ? segment.split(/['"]/)[0] : null;
  }).filter((value) => value?.endsWith(".mjs"));
  assert.ok(imports.includes("identity-retry.mjs"), "retry helper must be imported by gateway");
  assert.ok(imports.includes("skills.mjs"), "skill loader must be imported by gateway");
  for (const file of imports) {
    assert.ok(entrypoint.includes(`/opt/paperclip-mcp/mcp-gateway/${file}`), `missing staged gateway dependency: ${file}`);
  }
});
