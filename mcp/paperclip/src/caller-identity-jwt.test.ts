// P0 2026-10-20 (KOMAA-1005) regression: agent sessions are issued a JWT
// (PAPERCLIP_API_KEY), NOT a pcp_agent_* key. resolveCallerIdentity() gated its
// GET /agents/me probe behind key.startsWith("pcp_agent_"), so the probe was
// skipped, the board-only /companies fallback failed, the caller identity stayed
// "unknown" and EVERY workspace-mutation route (patch / diff / batch / exec /
// commit) failed closed with auth_failed before the write-scope guard could
// answer DENIED or ADMITTED.
//
// These tests pin the fixed behaviour:
//   - a JWT-shaped caller key resolves as an agent via GET /agents/me;
//   - an explicit pcp_board_ key stays board authority and is never probed as
//     an agent (no denial noise in the log);
//   - an unresolvable credential still fails closed as "unknown".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { resolveCallerIdentity } from "./workspace-native.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZ2VudCJ9.signature";

function makeClient(apiKey: string) {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey,
    companyId: COMPANY,
    agentId: AGENT,
    runId: null,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function routeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      for (const [part, body] of Object.entries(routes)) {
        if (url.includes(part)) return jsonResponse(body, body === null ? 404 : 200);
      }
      return jsonResponse({ error: "not mocked" }, 404);
    }),
  );
  return calls;
}

describe("resolveCallerIdentity — JWT-issued agent credentials", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves a JWT caller key as an agent via GET /agents/me", async () => {
    const calls = routeFetch({ "/agents/me": { id: AGENT } });
    const id = await resolveCallerIdentity(makeClient(JWT));
    expect(id).toEqual({ type: "agent", agentId: AGENT });
    expect(calls.some((u) => u.includes("/agents/me"))).toBe(true);
  });

  it("probes /agents/me with the CALLER key, not a board key", async () => {
    const auth: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        auth.push((init?.headers as Record<string, string> | undefined)?.Authorization);
        return jsonResponse({ id: AGENT });
      }),
    );
    await resolveCallerIdentity(makeClient(JWT));
    expect(auth[0]).toBe(`Bearer ${JWT}`);
  });

  it("keeps an explicit pcp_board_ key as board authority without probing as agent", async () => {
    const calls = routeFetch({});
    const id = await resolveCallerIdentity(makeClient("pcp_board_abc"));
    expect(id).toEqual({ type: "board" });
    expect(calls).toHaveLength(0);
  });

  it("still resolves a non-prefixed board credential through the /companies probe", async () => {
    routeFetch({ "/companies": { id: COMPANY } });
    const id = await resolveCallerIdentity(makeClient("jwt-shaped-board-key"));
    expect(id).toEqual({ type: "board" });
  });

  it("fails closed as unknown when neither probe resolves", async () => {
    routeFetch({ "/agents/me": null, "/companies": null });
    const id = await resolveCallerIdentity(makeClient(JWT));
    expect(id).toEqual({ type: "unknown" });
  });
});
