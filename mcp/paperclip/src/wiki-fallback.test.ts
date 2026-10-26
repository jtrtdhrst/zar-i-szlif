// 1012 compat regression: file fallback requires upstream Board authorization
// and must never turn missing credentials into filesystem read/write access.
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";

const WORKER_DOWN = "POST /plugins/paperclipai.plugin-llm-wiki/data/pages failed with 502: worker not ready";

const root = mkdtempSync(join(tmpdir(), "wiki-fallback-"));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function client(): PaperclipApiClient {
  return new PaperclipApiClient({
    apiUrl: "http://127.0.0.1:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: null,
    runId: null,
    agentApiKey: null,
    boardApiKey: "token-board",
    principalKind: "board",
  });
}

function tool(name: string, api: PaperclipApiClient) {
  const found = createToolDefinitions(api).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

function stubWorkerDown(api: PaperclipApiClient) {
  return vi.spyOn(api, "requestJson").mockImplementation(async (method) => {
    if (method === "GET") return [] as any; // Board /plugins proof
    throw new Error(WORKER_DOWN);
  });
}

// MCP tool results are envelopes: parse the JSON text payload (the tools do
// not throw towards the transport; failures come back as isError + taxonomy).
async function run(name: string, api: PaperclipApiClient, args: Record<string, unknown>) {
  const result = await tool(name, api).execute(args) as any;
  const text = result?.content?.find((entry: any) => entry.type === "text")?.text ?? "null";
  const parsed = JSON.parse(text);
  if (result?.isError) throw new Error(parsed.error ?? parsed.message ?? text);
  return parsed;
}

beforeAll(() => {
  vi.stubEnv("PAPERCLIP_MCP_ENABLE_ALL", "1");
  vi.stubEnv("PAPERCLIP_WIKI_ROOT", root);
  mkdirSync(join(root, "wiki", "concepts"), { recursive: true });
  writeFileSync(join(root, "wiki", "concepts", "routing.md"), "# Routing\n\nBody\n", "utf8");
  writeFileSync(join(root, "wiki", "index.md"), "no heading here\n", "utf8");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("wiki tools fall back to the managed file store", () => {
  it("lists pages with titles when the authorized plugin worker is down", async () => {
    const api = client();
    stubWorkerDown(api);
    const result = await run("paperclipWikiList", api, { limit: 50 });
    const paths = result.data.pages.map((page: any) => page.path);
    expect(paths).toEqual(["wiki/concepts/routing.md", "wiki/index.md"]);
    expect(result.data.pages[0].title).toBe("Routing");
  });

  it("searches paths/titles offline", async () => {
    const api = client();
    stubWorkerDown(api);
    const result = await run("paperclipWikiSearch", api, { query: "routing" });
    expect(result.matchCount).toBe(1);
    expect(result.matches[0].path).toBe("wiki/concepts/routing.md");
  });

  it("reads a page with its hash", async () => {
    const api = client();
    stubWorkerDown(api);
    const result = await run("paperclipWikiGetPage", api, { path: "wiki/concepts/routing.md" });
    expect(result.data.contents).toContain("# Routing");
    expect(result.data.hash).toBe(sha("# Routing\n\nBody\n"));
  });

  it("computes a dry-run diff against the file copy", async () => {
    const api = client();
    stubWorkerDown(api);
    const result = await run("paperclipWikiProposeChange", api, {
      path: "wiki/concepts/routing.md",
      contents: "# Routing\n\nNew body\n",
    });
    expect(result.currentHash).toBe(sha("# Routing\n\nBody\n"));
    expect(result.addedLines).toBe(1);
    expect(result.removedLines).toBe(1);
  });

  it("refuses a stale expectedHash and writes on a matching hash", async () => {
    const api = client();
    stubWorkerDown(api);
    await expect(run("paperclipWikiApplyChange", api, {
      path: "wiki/concepts/routing.md",
      contents: "changed\n",
      expectedHash: "deadbeefdeadbeef",
    })).rejects.toThrow(/VERSION_CONFLICT/);

    const next = "# Routing\n\nNew body\n";
    const wrote = await run("paperclipWikiApplyChange", api, {
      path: "wiki/concepts/routing.md",
      contents: next,
      expectedHash: sha("# Routing\n\nBody\n"),
    });
    expect(wrote.fallback).toBe("file");
    expect(readFileSync(join(root, "wiki", "concepts", "routing.md"), "utf8")).toBe(next);
  });

  it("does not bypass absent Board authority for reads or writes", async () => {
    const api = new PaperclipApiClient({
      apiUrl: "http://127.0.0.1:3100/api", apiKey: "agent",
      companyId: "11111111-1111-1111-1111-111111111111",
      agentId: "22222222-2222-2222-2222-222222222222",
      runId: null, agentApiKey: "agent", boardApiKey: null,
      principalKind: "agent",
    });
    const missing = "POST /plugins/paperclipai.plugin-llm-wiki/data/pages requires an explicitly configured Board credential [errorCode=CONFIGURATION_MISSING]";
    vi.spyOn(api, "requestJson").mockRejectedValue(new Error(missing));
    await expect(run("paperclipWikiList", api, {})).rejects.toThrow(/CONFIGURATION_MISSING/);
    await expect(run("paperclipWikiApplyChange", api, {
      path: "wiki/index.md", contents: "unauthorized write", expectedHash: sha("no heading here\n"),
    })).rejects.toThrow(/CONFIGURATION_MISSING/);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toBe("no heading here\n");
  });

  it("does not use filesystem fallback when Board proof returns 403", async () => {
    const api = client();
    vi.spyOn(api, "requestJson").mockImplementation(async (method) => {
      if (method === "GET") throw new Error("GET /plugins failed with 403: Board access required");
      throw new Error(WORKER_DOWN);
    });
    await expect(run("paperclipWikiApplyChange", api, {
      path: "wiki/index.md", contents: "unauthorized write", expectedHash: sha("no heading here\n"),
    })).rejects.toThrow(/403/);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toBe("no heading here\n");
  });

  it("reports NOT_FOUND for a missing page", async () => {
    const api = client();
    stubWorkerDown(api);
    await expect(run("paperclipWikiGetPage", api, { path: "wiki/nope.md" }))
      .rejects.toThrow(/NOT_FOUND/);
  });
});
