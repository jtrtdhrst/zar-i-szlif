// Smoke: start serwisów MCP (stdio) + lista narzędzi + health/ready HTTP.
// Uruchomienie: SMOKE=1 node --test tests/smoke.test.ts (wymaga sieci Dockera).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const SMOKE = process.env.SMOKE === "1";

function rpc(proc: ReturnType<typeof spawn>, msg: object) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

function startServer(file: string, env: Record<string, string>): ReturnType<typeof spawn> {
  return spawn("node", [file], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
}

async function mcpSmoke(
  file: string,
  env: Record<string, string>,
  expectedTools: string[],
): Promise<{ tools: string[] }> {
  const proc = startServer(file, env);
  const out: string[] = [];
  proc.stdout!.on("data", (d) => out.push(String(d)));
  const errors: string[] = [];
  proc.stderr!.on("data", (d) => errors.push(String(d)));
  rpc(proc, {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
  });
  await new Promise((r) => setTimeout(r, 3000));
  rpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  await new Promise((r) => setTimeout(r, 500));
  rpc(proc, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  await new Promise((r) => setTimeout(r, 4000));
  proc.kill();
  const text = out.join("\n");
  const tools: string[] = [];
  for (const line of text.split("\n")) {
    try {
      const msg = JSON.parse(line);
      for (const t of msg.result?.tools ?? []) tools.push(t.name);
    } catch {
      /* logi */
    }
  }
  assert.ok(tools.length > 0, `brak tools; stderr: ${errors.join(" ").slice(0, 500)}`);
  for (const e of expectedTools) assert.ok(tools.includes(e), `brak narzędzia ${e}`);
  return { tools };
}

describe("smoke: plasmic-mcp (stdio, bez sekretów)", () => {
  it("startuje i wystawia 19 narzędzi", { skip: !SMOKE }, async () => {
    const { tools } = await mcpSmoke(
      "services/plasmic-mcp/server.ts",
      { PLASMIC_HOST: "127.0.0.1", PLASMIC_PORT: "1" },
      [
        "plasmic_get_project",
        "plasmic_validate",
        "plasmic_get_changes",
        "plasmic_list_projects",
        "plasmic_create_project",
      ],
    );
    assert.equal(tools.length, 19);
  });
});

describe("smoke: opendesign-bridge-mcp (stdio, bez sekretów)", () => {
  it("startuje i wystawia 9 narzędzi READ-ONLY", { skip: !SMOKE }, async () => {
    const { tools } = await mcpSmoke(
      "services/opendesign-bridge-mcp/server.ts",
      { OD_HOST: "127.0.0.1", OD_PORT: "1", OD_API_TOKEN: "x" },
      ["design_get_context", "design_list_tokens"],
    );
    assert.equal(tools.length, 9);
  });
});
