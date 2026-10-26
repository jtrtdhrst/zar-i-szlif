// KOMAA-1415: Paperclip 2026.1012.0 removed POST /companies/:id/operator-runs.
// paperclipStartOperatorRun must never advertise/mint a dead capability; it
// resolves the caller's SANCTIONED context (own live run or Board lane) and
// fails closed otherwise.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const RUN = "33333333-3333-3333-3333-333333333333";

function client(options: { runId?: string | null; boardApiKey?: string | null } = {}) {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: AGENT,
    runId: options.runId === undefined ? RUN : options.runId,
    agentApiKey: "token-agent",
    boardApiKey: options.boardApiKey ?? null,
  });
}

function payload(result: any): any {
  const text = result?.content?.find((entry: any) => entry.type === "text")?.text ?? "null";
  return JSON.parse(text);
}

function tool(api: PaperclipApiClient) {
  const found = createControlPlaneTools(api).find((entry) => entry.name === "paperclipStartOperatorRun");
  if (!found) throw new Error("missing paperclipStartOperatorRun");
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paperclipStartOperatorRun on 2026.1012.0", () => {
  it("resolves the session's own live run and never calls the removed route", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ id: RUN, status: "running", agentId: AGENT }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const out = payload(await tool(client()).execute({ reason: "inspect control plane" }));

    expect(out.authority).toBe("agent-run");
    expect(out.runId).toBe(RUN);
    expect(out.operatorRunId).toBeNull();
    expect(out.run).toMatchObject({ id: RUN, status: "running" });
    expect(urls.some((url) => url.includes("/operator-runs"))).toBe(false);
  });

  it("reports the Board lane without minting an operator session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const out = payload(await tool(client({ runId: null, boardApiKey: "token-board" })).execute({ reason: "board work" }));
    expect(out.authority).toBe("board");
    expect(out.runId).toBeNull();
    expect(out.operatorRunId).toBeNull();
  });

  it("fails closed with NO_RUN_CONTEXT instead of fabricating a run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const out = payload(await tool(client({ runId: null, boardApiKey: null })).execute({ reason: "no context" }));
    expect(JSON.stringify(out)).toMatch(/NO_RUN_CONTEXT/);
    expect(JSON.stringify(out)).not.toMatch(/"runId":"/);
  });
});
