// Plasmic MCP: kontrakt katalogu MCP == tools/list serwera, sprawdzony na ŻYWYM
// serwerze plasmic-mcp (stdio, JSON-RPC), a nie na lokalnej tablicy nazw.
//
// Serwer startuje bez poświadczeń Plasmic i bez sieci (PLASMIC_BASE_URL ->
// nieosiągalny port), a stan/audit idzie do katalogu tymczasowego, więc test
// nie mutuje produkcyjnego projektu Plasmic. tools/list oraz wywołanie
// nieistniejącego narzędzia są operacjami read-only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_STACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Manifest agent-visible plasmic-mcp (kontrakt publiczny). */
const EXPECTED_TOOLS = [
  "plasmic_list_projects",
  "plasmic_list_comments",
  "plasmic_get_element_comments",
  "plasmic_list_branches",
  "plasmic_create_branch",
  "plasmic_preview_merge",
  "plasmic_get_project",
  "plasmic_list_pages",
  "plasmic_list_components",
  "plasmic_list_tokens",
  "plasmic_read_page",
  "plasmic_read_component",
  "plasmic_read_component_tree",
  "plasmic_create_page",
  "plasmic_create_component",
  "plasmic_insert",
  "plasmic_update",
  "plasmic_delete",
  "plasmic_set_props",
  "plasmic_set_styles",
  "plasmic_use_component",
  "plasmic_validate",
  "plasmic_get_changes",
];

/** Narzędzia tylko do odczytu — nie zmieniają projektu Plasmic. */
const READ_ONLY_TOOLS = [
  "plasmic_list_projects",
  "plasmic_list_comments",
  "plasmic_get_element_comments",
  "plasmic_list_branches",
  "plasmic_preview_merge",
  "plasmic_get_project",
  "plasmic_list_pages",
  "plasmic_list_components",
  "plasmic_list_tokens",
  "plasmic_read_page",
  "plasmic_read_component",
  "plasmic_read_component_tree",
  "plasmic_validate",
  "plasmic_get_changes",
];

/** Narzędzia zapisujące — platforma musi je widzieć jako zmiany. */
const WRITE_TOOLS = [
  "plasmic_create_branch",
  "plasmic_create_page",
  "plasmic_create_component",
  "plasmic_insert",
  "plasmic_update",
  "plasmic_delete",
  "plasmic_set_props",
  "plasmic_set_styles",
  "plasmic_use_component",
];

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

type RpcResponse = {
  id: number;
  result?: {
    tools?: { name: string; annotations?: ToolAnnotations }[];
    isError?: boolean;
    content?: { text?: string }[];
  };
  error?: { code: number; message: string };
};

/** Minimalny klient MCP stdio (newline-delimited JSON-RPC), bez sleepów. */
function startServer(env: Record<string, string>) {
  const proc = spawn(process.execPath, ["services/plasmic-mcp/server.ts"], {
    cwd: DESIGN_STACK_ROOT,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const pending = new Map<number, (res: RpcResponse) => void>();
  const stderr: string[] = [];
  let buffer = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcResponse;
        const resolver = pending.get(msg.id);
        if (resolver) {
          pending.delete(msg.id);
          resolver(msg);
        }
      } catch {
        /* stdout serwera zawiera też logi, nie tylko JSON-RPC */
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => stderr.push(chunk));

  let nextId = 1;
  const request = (method: string, params: unknown = {}) =>
    new Promise<RpcResponse>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}; stderr: ${stderr.join(" ").slice(0, 500)}`));
      }, 15_000);
      pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method: string, params: unknown = {}) =>
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

  return { proc, request, notify, stderr };
}

async function withServer<T>(
  fn: (client: ReturnType<typeof startServer>) => Promise<T>,
): Promise<T> {
  const stateDir = await mkdtemp(join(tmpdir(), "komaa-1001-catalog-"));
  const client = startServer({
    PLASMIC_BASE_URL: "http://127.0.0.1:9", // nigdy nieosiągalny: bez sieci
    PLASMIC_STATE_DIR: stateDir,
    PLASMIC_AUDIT_FILE: join(stateDir, "audit.jsonl"),
    MCP_HTTP_PORT: "", // pusty -> transport stdio
    PLASMIC_EMAIL: "",
    PLASMIC_PASSWORD: "",
    PLASMIC_TEAM_TOKEN: "",
    MCP_AUTH_TOKEN: "",
    MCP_AUTH_TOKENS: "",
  });
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "komaa-1001-catalog-check", version: "1.0.0" },
    });
    assert.ok(init.result, `initialize nie powiodło się: ${JSON.stringify(init.error)}`);
    client.notify("notifications/initialized");
    return await fn(client);
  } finally {
    client.proc.kill();
  }
}

describe("Plasmic MCP: katalog MCP == tools/list żywego serwera", () => {
  it("tools/list zwraca dokładnie 23 narzędzia zgodnych z kontraktem", async () => {
    const tools = await withServer(async (client) => {
      const res = await client.request("tools/list", {});
      assert.ok(res.result, `tools/list nie powiodło się: ${JSON.stringify(res.error)}`);
      return (res.result.tools ?? []).map((t) => t.name);
    });
    assert.deepEqual(tools.sort(), [...EXPECTED_TOOLS].sort());
    assert.equal(tools.length, EXPECTED_TOOLS.length);
  });

  it("negatyw na poziomie protokołu: serwer odrzuca plasmic_import_html", async () => {
    const res = await withServer(async (client) =>
      client.request("tools/call", { name: "plasmic_import_html", arguments: {} }),
    );
    assert.ok(res.result, `serwer zwrócił błąd zamiast odpowiedzi: ${JSON.stringify(res.error)}`);
    assert.equal(res.result.isError, true);
    const text = (res.result.content ?? [])
      .map((c: { text?: string }) => c.text ?? "")
      .join(" ");
    assert.match(text, /Tool plasmic_import_html not found/);
  });

  it("każde narzędzie deklaruje adnotacje, a zapisujące nie są read-only", async () => {
    // Klasyfikacja platformy (readOnlyHint/destructiveHint) bierze się
    // wprost z manifestu serwera — bez adnotacji insert/use_component/update
    // wyglądały jak read-only i omijały politykę zatwierdzania zmian.
    assert.deepEqual(
      [...READ_ONLY_TOOLS, ...WRITE_TOOLS].sort(),
      [...EXPECTED_TOOLS].sort(),
      "każde narzędzie z kontraktu musi być sklasyfikowane",
    );
    const tools = await withServer(async (client) => {
      const res = await client.request("tools/list", {});
      assert.ok(res.result, `tools/list nie powiodło się: ${JSON.stringify(res.error)}`);
      return res.result.tools ?? [];
    });
    assert.equal(tools.length, EXPECTED_TOOLS.length);
    for (const t of tools) {
      assert.ok(t.annotations, `${t.name}: brak adnotacji MCP — platforma nie sklasyfikuje narzędzia`);
    }
    const byName = new Map(tools.map((t) => [t.name, t.annotations!]));
    for (const name of READ_ONLY_TOOLS) {
      assert.equal(byName.get(name)?.readOnlyHint, true, `${name} powinno być read-only`);
    }
    for (const name of WRITE_TOOLS) {
      const a = byName.get(name);
      assert.ok(a, `${name}: brak adnotacji`);
      assert.equal(a.readOnlyHint, false, `${name} zapisuje — nie może być read-only`);
      assert.equal(typeof a.destructiveHint, "boolean", `${name}: brak destructiveHint`);
    }
    // Usunięcie i nadpisanie istniejącego wpisu są destrukcyjne.
    assert.equal(byName.get("plasmic_delete")?.destructiveHint, true);
    assert.equal(byName.get("plasmic_insert")?.destructiveHint, true);
    assert.equal(byName.get("plasmic_update")?.destructiveHint, true);
    // set_props tworzy nowe wpisy Expr przy każdym wywołaniu — nie jest idempotentne.
    assert.equal(byName.get("plasmic_set_props")?.idempotentHint, false);
    // Klucz idempotencji w create_page/create_component/insert/use_component.
    assert.equal(byName.get("plasmic_create_branch")?.idempotentHint, true,
      "plasmic_create_branch must advertise its locked retry/dedup contract");
    assert.equal(byName.get("plasmic_create_page")?.idempotentHint, true);
    assert.equal(byName.get("plasmic_insert")?.idempotentHint, true);
  });
});
