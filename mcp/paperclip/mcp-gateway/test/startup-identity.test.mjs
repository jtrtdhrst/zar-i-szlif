import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const gateway = readFileSync(fileURLToPath(new URL("../gateway.mjs", import.meta.url)), "utf8");

test("permanent gateway requires company and service-agent identity, not run/project context", () => {
  assert.match(gateway, /requireEnvUuid\("PAPERCLIP_COMPANY_ID"\)/);
  assert.match(gateway, /agentId: requireEnvUuid\("PAPERCLIP_MCP_AGENT_ID"\)/);
  assert.doesNotMatch(gateway, /PAPERCLIP_MCP_(?:RUN_ID|PROJECT_ID)/);
});

test("gateway imports the crypto hash used by OAuth and caller rate limiting", () => {
  assert.match(gateway, /import \{[^}]*\bcreateHash\b[^}]*\} from "node:crypto"/);
});
