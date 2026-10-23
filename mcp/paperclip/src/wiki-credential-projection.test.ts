// KOMAA-1415: the agent principal has no Board key, so every wiki call used to
// fail locally with CONFIGURATION_MISSING. The trusted gateway may project its
// enrolled Board credential for the llm-wiki plugin data/actions routes only.
// This regression pins the route boundary and the fail-closed default.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import type { PaperclipMcpConfig } from "./config.js";

function config(overrides: Partial<PaperclipMcpConfig> = {}): PaperclipMcpConfig {
  return {
    apiUrl: "http://127.0.0.1:3100/api",
    apiKey: "caller-agent-token",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: null,
    agentApiKey: "caller-agent-token",
    boardApiKey: null,
    principalKind: "agent",
    ...overrides,
  };
}

function mockFetch() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: URL, init: RequestInit) => {
    calls.push(String((init.headers as Record<string, string>).Authorization));
    return new Response(JSON.stringify({ data: { pages: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KOMAA-1415 scoped wiki Board projection", () => {
  it("uses the gateway Board credential for the wiki data route", async () => {
    const calls = mockFetch();
    const client = new PaperclipApiClient(config({ wikiBoardApiKey: "board-scoped" }));
    await client.requestJson("POST", "/plugins/paperclipai.plugin-llm-wiki/data/pages", {
      body: { companyId: "11111111-1111-1111-1111-111111111111", params: {} },
    });
    expect(calls).toEqual(["Bearer board-scoped"]);
    // The principal itself is still an agent: capability reporting must not
    // claim Board authority just because the gateway holds the key.
    expect(client.hasBoardCredential).toBe(false);
  });

  it("uses the same scoped key for the safe write action", async () => {
    const calls = mockFetch();
    const client = new PaperclipApiClient(config({ wikiBoardApiKey: "board-scoped" }));
    await client.requestJson("POST", "/plugins/paperclipai.plugin-llm-wiki/actions/write-page", {
      body: { companyId: "11111111-1111-1111-1111-111111111111", params: { path: "wiki/x.md", contents: "x" } },
    });
    expect(calls).toEqual(["Bearer board-scoped"]);
  });

  it("fails closed when the gateway did not project a key", async () => {
    mockFetch();
    const client = new PaperclipApiClient(config());
    await expect(client.requestJson("POST", "/plugins/paperclipai.plugin-llm-wiki/data/pages", {
      body: { companyId: "11111111-1111-1111-1111-111111111111", params: {} },
    })).rejects.toThrow(/CONFIGURATION_MISSING/);
  });

  it("never projects the key to another plugin route", async () => {
    mockFetch();
    const client = new PaperclipApiClient(config({ wikiBoardApiKey: "board-scoped" }));
    await expect(client.requestJson("POST", "/plugins/paperclip.workspace-diff/data/changes", {
      body: { companyId: "11111111-1111-1111-1111-111111111111" },
    })).rejects.toThrow(/CONFIGURATION_MISSING/);
  });

  it("keeps a caller-presented Board credential authoritative", async () => {
    const calls = mockFetch();
    const client = new PaperclipApiClient(config({
      boardApiKey: "board-from-caller",
      wikiBoardApiKey: "board-scoped",
      principalKind: "board",
    }));
    await client.requestJson("POST", "/plugins/paperclipai.plugin-llm-wiki/data/pages", {
      body: { companyId: "11111111-1111-1111-1111-111111111111", params: {} },
    });
    expect(calls).toEqual(["Bearer board-from-caller"]);
  });
});
