import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaperclipApiClient, PaperclipApiError } from "./client.js";

// KOMAA-797 regression: a mutation that fails ambiguously (HTTP 500/502/503/
// 504/429 after commit, or transport loss) must NEVER read as a definitive
// failure. It surfaces commitState=UNKNOWN_COMMIT_STATE so callers
// reconcile/read-back by natural key instead of blind-retrying (→ duplicates).
// Definitive refusals (403 scope, 409 Wiki CAS) keep their meaning.

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "55555555-5555-4555-8555-555555555555",
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("KOMAA-797 unknown commit state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("marks HTTP 500 after a write as UNKNOWN_COMMIT_STATE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)));
    const err = await makeClient().requestJson("POST", "/issues/x/comments", { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PaperclipApiError);
    expect((err as PaperclipApiError).status).toBe(500);
    expect((err as Error).message).toContain("UNKNOWN_COMMIT_STATE");
    expect((err as Error).message).toContain("read-back");
  });

  it("does NOT mark HTTP 500 after a read as commit-ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500)));
    const err = await makeClient().requestJson("GET", "/issues/x").catch((e) => e);
    expect(err).toBeInstanceOf(PaperclipApiError);
    expect((err as Error).message).not.toContain("UNKNOWN_COMMIT_STATE");
  });

  it("marks transport loss after a write as UNKNOWN_COMMIT_STATE (status 0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await makeClient().requestJson("POST", "/issues/x/comments", { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PaperclipApiError);
    expect((err as PaperclipApiError).status).toBe(0);
    expect((err as Error).message).toContain("UNKNOWN_COMMIT_STATE");
  });

  it("rethrows transport loss after a read without commit ambiguity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await makeClient().requestJson("GET", "/issues/x").catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
  });

  it("keeps 403 scope refusal and 409 Wiki CAS definitive (NOT_COMMITTED)", async () => {
    for (const status of [403, 409]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "refused" }, status)));
      const err = await makeClient().requestJson("POST", "/issues/x/comments", { body: {} }).catch((e) => e);
      expect(err).toBeInstanceOf(PaperclipApiError);
      expect((err as PaperclipApiError).status).toBe(status);
      expect((err as Error).message).not.toContain("UNKNOWN_COMMIT_STATE");
    }
  });

  it("returns the body on success (COMMITTED)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "c1" }, 201)));
    const out = await makeClient().requestJson("POST", "/issues/x/comments", { body: {} });
    expect(out).toEqual({ id: "c1" });
  });
});
