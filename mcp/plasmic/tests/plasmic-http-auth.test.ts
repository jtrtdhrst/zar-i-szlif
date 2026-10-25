import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_TEST_PORT");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
  return address.port;
}

test("Plasmic MCP rejects an invalid Bearer token with HTTP 401 without echoing it", async () => {
  const port = await availablePort();
  const stateDir = await mkdtemp(join(tmpdir(), "plasmic-http-auth-"));
  const proc = spawn(process.execPath, ["services/plasmic-mcp/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PLASMIC_BASE_URL: "http://127.0.0.1:9",
      PLASMIC_STATE_DIR: stateDir,
      PLASMIC_AUDIT_FILE: join(stateDir, "audit.jsonl"),
      PLASMIC_EMAIL: "",
      PLASMIC_PASSWORD: "",
      PLASMIC_TEAM_TOKEN: "",
      MCP_HTTP_PORT: String(port),
      MCP_AUTH_TOKEN: "configured-test-canary",
      MCP_AUTH_TOKENS: "",
    },
    stdio: "ignore",
  });
  const invalidToken = "invalid-test-canary";
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(ready, true, "HTTP MCP server did not start");
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${invalidToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.text()).includes(invalidToken), false);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
      proc.kill();
      await exited;
    }
  }
});
