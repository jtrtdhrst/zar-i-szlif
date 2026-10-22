// KOMAA-1084: E2E zapisu przez natywny `plasmic_insert` — prawdziwy transport
// MCP (JSON-RPC po stdio) + prawdziwy klient HTTP, tylko WAB jest lokalny.
//
// Emulator WAB odtwarza zachowanie serwera, które zabijało Designera:
//   - wpis niezgodny z klasą modelu → CAŁY patch odrzucony jednym
//     412 {error:{name:"BundleTypeError"}} (rewizja nietknięta),
//   - poprawny patch → rewizja +1,
//   - niezgodna rewizja → 409.
//
// Sprawdzamy: kontrakt odtwarza kształt WAB, zapis przechodzi, mieszany
// payload (TplTag + Variant + RuleSet + Component) ląduje w JEDNEJ rewizji,
// negatyw zostawia rewizję nietkniętą, a powtórka z tym samym kluczem jest
// replayem (bez drugiego zapisu).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_STACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Json = Record<string, unknown>;

const kindOf = (v: unknown): string =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? "array"
      : typeof v === "object"
        ? "object"
        : typeof v;

/**
 * Model WAB wg realnych bundle'ów (bundle WAB z page-template.json /
 * comp-template.json + zamrożony bundle rev106). Niezależny od kontraktu
 * w services/plasmic-mcp/contract.ts — to niezależny oracle testu.
 */
const WAB_MODEL: Record<string, Record<string, string[]>> = {
  RuleSet: { values: ["object"], mixins: ["array"], animations: ["null", "array"] },
  Variant: {
    uuid: ["string"],
    name: ["string"],
    selectors: ["null", "array"],
    codeComponentName: ["null", "string"],
    codeComponentVariantKeys: ["null", "array"],
    parent: ["null", "object"],
    mediaQuery: ["null", "string"],
    description: ["null", "string"],
    forTpl: ["null", "object"],
  },
  VariantSetting: {
    variants: ["array"],
    args: ["array"],
    attrs: ["object"],
    rs: ["object"],
    dataCond: ["null", "object"],
    dataRep: ["null", "object"],
    text: ["null", "object"],
    columnsConfig: ["null", "object"],
  },
  TplTag: {
    tag: ["string"],
    name: ["null", "string"],
    children: ["array"],
    type: ["string"],
    codeGenType: ["null", "string"],
    columnsSetting: ["null", "object"],
    uuid: ["string"],
    parent: ["null", "object"],
    locked: ["null"],
    vsettings: ["array"],
  },
  TplComponent: {
    component: ["object"],
    name: ["null", "string"],
    uuid: ["string"],
    parent: ["null", "object"],
    locked: ["null"],
    vsettings: ["array"],
  },
  Component: {
    uuid: ["string"],
    name: ["string"],
    params: ["array"],
    states: ["array"],
    tplTree: ["object"],
    editableByContentEditor: ["boolean"],
    hiddenFromContentEditor: ["boolean"],
    variants: ["array"],
    variantGroups: ["array"],
    pageMeta: ["null", "object"],
    codeComponentMeta: ["null", "object"],
    type: ["string"],
    subComps: ["array"],
    superComp: ["null", "object"],
    plumeInfo: ["null", "object"],
    templateInfo: ["null", "object"],
    metadata: ["object"],
    dataQueries: ["array"],
    serverQueries: ["array"],
    figmaMappings: ["array"],
    alwaysAutoName: ["boolean"],
    trapsFocus: ["boolean"],
    updatedAt: ["number"],
  },
};

/** WAB: wpis spoza modelu albo niezgodny z klasą → 412 BundleTypeError. */
function modelProblem(entry: Json): string | null {
  const type = String(entry.__type ?? "");
  const spec = WAB_MODEL[type];
  if (!spec) return `brak klasy modelu dla __type="${type}"`;
  for (const [field, allowed] of Object.entries(spec)) {
    if (!(field in entry)) return `brak pola "${field}" w ${type}`;
    if (!allowed.includes(kindOf(entry[field]))) {
      return `pole "${field}" w ${type} ma typ ${kindOf(entry[field])}, WAB wymaga ${allowed.join("|")}`;
    }
  }
  return null;
}

interface EmulatorState {
  revision: number;
  bundle: { map: Record<string, Json>; version: string; root: string; deps: unknown[] };
  writes: number;
  rejected: number;
}

async function startWab(): Promise<{
  url: string;
  state: EmulatorState;
  close: () => Promise<void>;
}> {
  const state: EmulatorState = {
    revision: 5,
    bundle: {
      map: {
        site1: {
          __type: "Site",
          name: "Site",
          components: [],
          pageArenas: [],
        },
      },
      version: "1.0.0",
      root: "site1",
      deps: [],
    },
    writes: 0,
    rejected: 0,
  };
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (url.pathname === "/api/v1/auth/csrf") {
        res.setHeader("set-cookie", "plasmic_csrf=test; Path=/");
        return json(res, 200, { csrf: "test-csrf" });
      }
      if (url.pathname === "/api/v1/auth/login") {
        res.setHeader("set-cookie", "plasmic_session=test; Path=/");
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/v1/projects") {
        return json(res, 200, { projects: [{ id: "proj1", name: "Fixture" }] });
      }
      const revWrite = /^\/api\/v1\/projects\/([^/]+)\/revisions\/(\d+)$/.exec(url.pathname);
      if (revWrite && req.method === "POST") {
        const target = Number(revWrite[2]);
        const body = JSON.parse(raw || "{}") as { data?: string; toDeleteIids?: string[] };
        const patch = JSON.parse(body.data ?? "{}") as { map?: Record<string, Json> };
        for (const [iid, entry] of Object.entries(patch.map ?? {})) {
          const problem = modelProblem(entry);
          if (problem) {
            state.rejected++;
            // Cały patch odrzucony — rewizja nietknięta.
            return json(res, 412, {
              error: { name: "BundleTypeError", statusCode: 412, message: "" },
            });
          }
          void iid;
        }
        if (target !== state.revision + 1) {
          state.rejected++;
          return json(res, 409, {
            error: { name: "RevisionConflictError", statusCode: 409, message: "stale revision" },
          });
        }
        Object.assign(state.bundle.map, patch.map ?? {});
        for (const iid of body.toDeleteIids ?? []) delete state.bundle.map[iid];
        state.revision = target;
        state.writes++;
        return json(res, 200, { revision: state.revision });
      }
      const revRead = /^\/api\/v1\/projects\/([^/]+)$/.exec(url.pathname);
      if (revRead) {
        return json(res, 200, {
          rev: {
            id: "rev-id",
            revision: state.revision,
            data: JSON.stringify(state.bundle),
          },
          project: { id: "proj1", name: "Fixture" },
          modelVersion: 1,
          hostlessDataVersion: 1,
        });
      }
      return json(res, 404, { error: { name: "NotFoundError", statusCode: 404, message: url.pathname } });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type RpcResponse = {
  id: number;
  result?: {
    tools?: { name: string }[];
    isError?: boolean;
    content?: { text?: string }[];
  };
  error?: { code: number; message: string };
};

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
        /* stdout zawiera też logi */
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
        reject(new Error(`timeout ${method}; stderr: ${stderr.join(" ").slice(0, 400)}`));
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

type ToolResult = { ok: boolean; error?: string; [k: string]: unknown };

async function callTool(
  client: ReturnType<typeof startServer>,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const res = await client.request("tools/call", { name, arguments: args });
  assert.ok(res.result, `tools/call ${name} nie powiodło się: ${JSON.stringify(res.error)}`);
  const text = (res.result.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
  try {
    return JSON.parse(text) as ToolResult;
  } catch {
    throw new Error(`odpowiedź ${name} nie jest JSON: ${text.slice(0, 300)}`);
  }
}

describe("KOMAA-1084: plasmic_insert — zapis, odczyt i rollback przez MCP JSON-RPC", () => {
  let wab: Awaited<ReturnType<typeof startWab>>;
  let stateDir: string;
  let client: ReturnType<typeof startServer>;

  before(async () => {
    wab = await startWab();
    stateDir = await mkdtemp(join(tmpdir(), "komaa-1084-e2e-"));
    client = startServer({
      PLASMIC_BASE_URL: wab.url,
      PLASMIC_STATE_DIR: stateDir,
      PLASMIC_AUDIT_FILE: join(stateDir, "audit.jsonl"),
      MCP_HTTP_PORT: "",
      PLASMIC_EMAIL: "agent@example.com",
      PLASMIC_PASSWORD: "fixture",
      PLASMIC_TEAM_TOKEN: "",
      MCP_AUTH_TOKEN: "",
      MCP_AUTH_TOKENS: "",
    });
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "komaa-1084-e2e", version: "1.0.0" },
    });
    assert.ok(init.result, `initialize nie powiodło się: ${JSON.stringify(init.error)}`);
    client.notify("notifications/initialized");
  });

  after(async () => {
    client?.proc.kill();
    await wab?.close();
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  });

  it("katalog nadal ma 17 narzędzi (bez plasmic_import_html)", async () => {
    const res = await client.request("tools/list", {});
    const tools = (res.result?.tools ?? []).map((t) => t.name);
    assert.equal(tools.length, 17);
    assert.ok(!tools.includes("plasmic_import_html"));
  });

  it("niepoprawny wpis jest odrzucony lokalnie (CONTRACT_INVALID) i nic nie zapisane", async () => {
    const before = { revision: wab.state.revision, writes: wab.state.writes };
    const res = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      elementId: "rs-bad",
      entry: { __type: "RuleSet", values: "color: red", mixins: [] },
    });
    assert.equal(res.ok, false);
    assert.match(String(res.error), /CONTRACT_INVALID/);
    assert.match(String(res.error), /values/);
    assert.equal(wab.state.revision, before.revision, "rewizja nietknięta");
    assert.equal(wab.state.writes, before.writes, "brak zapisu");
    assert.equal(wab.state.bundle.map["rs-bad"], undefined);
  });

  it("nowy RuleSet wchodzi, rewizja +1, wpis czytany z powrotem", async () => {
    const before = wab.state.revision;
    const res = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      elementId: "rs-ok",
      entry: { __type: "RuleSet", values: { display: "flex" } },
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.revision, before + 1);
    assert.equal(wab.state.revision, before + 1);
    const read = await callTool(client, "plasmic_read_component", {
      projectId: "proj1",
      componentId: "rs-ok",
    });
    assert.equal(read.ok, true, JSON.stringify(read));
    const entry = (read.component as { raw: Json }).raw;
    assert.equal(entry.__type, "RuleSet");
    assert.deepEqual(entry.values, { display: "flex" });
    // Wpis dostał komplet pól modelu WAB (values/mixins/animations).
    assert.deepEqual(entry.mixins, []);
    assert.equal(entry.animations, null);
  });

  it("mieszany payload (TplTag + Variant + RuleSet + Component) ląduje w JEDNEJ rewizji", async () => {
    const before = { revision: wab.state.revision, writes: wab.state.writes };
    const res = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      entries: {
        "v-focus": { __type: "Variant", name: "focus-visible" },
        "rs-focus": { __type: "RuleSet", values: { "outline-offset": "2px" } },
        "vs-focus": {
          __type: "VariantSetting",
          variants: [{ __ref: "v-focus" }],
          rs: { __ref: "rs-focus" },
        },
        "tpl-focus": {
          __type: "TplTag",
          tag: "a",
          vsettings: [{ __ref: "vs-focus" }],
        },
        "cmp-focus": {
          __type: "Component",
          name: "Focus Link",
          type: "component",
          tplTree: { __ref: "tpl-focus" },
          variants: [{ __ref: "v-focus" }],
        },
      },
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.revision, before.revision + 1, "cały payload w jednej rewizji");
    assert.equal(wab.state.revision, before.revision + 1);
    assert.equal(wab.state.writes, before.writes + 1, "dokładnie jeden zapis");

    // Graf referencji odczytany z powrotem.
    const read = await callTool(client, "plasmic_read_component", {
      projectId: "proj1",
      componentId: "cmp-focus",
    });
    assert.equal(read.ok, true, JSON.stringify(read));
    const entry = (read.component as { raw: Json }).raw;
    assert.equal(entry.name, "Focus Link");
    assert.equal((entry.tplTree as { __ref: string }).__ref, "tpl-focus");
    const validate = await callTool(client, "plasmic_validate", { projectId: "proj1" });
    assert.equal(validate.ok, true);
    assert.deepEqual(validate.problems, [], JSON.stringify(validate.problems));
  });

  it("negatyw: zły discriminator → 412 BundleTypeError, rewizja nietknięta (brak częściowego zapisu)", async () => {
    const before = { revision: wab.state.revision, writes: wab.state.writes };
    const res = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      entries: {
        "tpl-ok": { __type: "TplTag", tag: "div", vsettings: [] },
        "tpl-bad": { __type: "TplTagg", tag: "div", vsettings: [] },
      },
    });
    assert.equal(res.ok, false);
    assert.match(String(res.error), /412/);
    assert.match(String(res.error), /BundleTypeError/);
    assert.equal(wab.state.revision, before.revision, "rewizja nietknięta");
    assert.equal(wab.state.writes, before.writes, "brak zapisu");
    assert.equal(wab.state.bundle.map["tpl-ok"], undefined, "brak częściowego zapisu");
    assert.equal(wab.state.bundle.map["tpl-bad"], undefined);
  });

  it("plasmic_update nie wprowadza naruszenia kontraktu (RuleSet.values jako string)", async () => {
    const before = { revision: wab.state.revision, writes: wab.state.writes };
    const res = await callTool(client, "plasmic_update", {
      projectId: "proj1",
      elementId: "rs-ok",
      patch: { values: "color: red" },
    });
    assert.equal(res.ok, false);
    assert.match(String(res.error), /CONTRACT_INVALID/);
    assert.equal(wab.state.revision, before.revision, "rewizja nietknięta");
    assert.equal(wab.state.writes, before.writes, "brak zapisu");
  });

  it("powtórka z tym samym idempotencyKey to replay — bez drugiego zapisu", async () => {
    const first = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      elementId: "rs-retry",
      entry: { __type: "RuleSet", values: { color: "blue" } },
      idempotencyKey: "KOMAA-1084-retry",
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const revision = wab.state.revision;
    const writes = wab.state.writes;
    const second = await callTool(client, "plasmic_insert", {
      projectId: "proj1",
      elementId: "rs-retry",
      entry: { __type: "RuleSet", values: { color: "blue" } },
      idempotencyKey: "KOMAA-1084-retry",
    });
    assert.equal(second.ok, true);
    assert.equal(wab.state.revision, revision, "brak drugiej rewizji");
    assert.equal(wab.state.writes, writes, "brak drugiego zapisu");
    assert.equal(second.revision, first.revision);
  });
});
