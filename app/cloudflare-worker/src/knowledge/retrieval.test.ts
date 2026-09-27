/**
 * KOMAA-311 V4 — testy retrieval: pozytywne, negatywne, cross-workspace leakage.
 * Fetch i embed mockowane; bez żywego Qdrant.
 */
import { describe, it, expect, vi } from "vitest";
import { QdrantClient } from "./qdrant";
import { retrieve } from "./retrieval";
import type { ChunkPayload } from "./schema";

const base: ChunkPayload = {
  source_id: "help-page",
  document_id: "help-page",
  chunk_id: "c0",
  tenant: "kompas-zbiorek",
  user_id: null,
  workspace_id: null,
  visibility: "global",
  content_type: "help",
  content_hash: "h",
  source_version: "git:test",
  updated_at: new Date().toISOString(),
  text: "Pomoc: logowanie przez Google.",
};

function mockSearch(hits: { score: number; payload: ChunkPayload }[]) {
  const calls: { url: string; body: string }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const body = (init.body as string) ?? "";
    calls.push({ url: url as string, body });
    return { ok: true, status: 200, json: async () => ({ result: hits }), text: async () => "ok" };
  });
  const client = new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn as unknown as typeof fetch });
  const embed = async (texts: string[]) => texts.map(() => new Array(1024).fill(0.1));
  return { calls, client, embed };
}

const authU = { userId: "sub-u1", workspaceIds: ["team-a"] };

describe("pozytywne: trafny kontekst z dozwolonego scope", () => {
  it("zwraca hity globalne z attribution dla MCP, posortowane malejąco, w limicie topK", async () => {
    const { calls, client, embed } = mockSearch([
      { score: 0.9, payload: { ...base, chunk_id: "c1", text: "Pierwszy" } },
      { score: 0.5, payload: { ...base, chunk_id: "c2", text: "Drugi" } },
      { score: 0.8, payload: { ...base, chunk_id: "c3", text: "Trzeci" } },
    ]);
    const hits = await retrieve(client, embed, "jak się zalogować?", authU, { topK: 2, minScore: 0 });
    expect(hits.map((h) => h.chunk_id)).toEqual(["c1", "c3"]); // sort + topK
    expect(hits[0]).toMatchObject({ source_id: "help-page", document_id: "help-page", content_type: "help" });
    expect(hits[0].text).toBe("Pierwszy");
    const body = JSON.parse(calls[0].body);
    expect(body.limit).toBe(2);
    expect(JSON.stringify(body.filter)).toContain("kompas-zbiorek"); // tenant prefilter
    expect(JSON.stringify(body.filter)).toContain("sub-u1"); // user scope w silniku
  });
});

describe("negatywne: threshold, scope, denylista", () => {
  it("odcina wyniki poniżej minScore (sensowny threshold)", async () => {
    const { client, embed } = mockSearch([{ score: 0.2, payload: base }]);
    expect(await retrieve(client, embed, "pytanie", authU, { minScore: 0.35 })).toEqual([]);
  });

  it("próba cross-workspace leakage: cudzy workspace niewidzialny, własny widoczny", async () => {
    const { client, embed } = mockSearch([
      { score: 0.95, payload: { ...base, visibility: "workspace", workspace_id: "team-B", user_id: null } },
      { score: 0.9, payload: { ...base, visibility: "workspace", workspace_id: "team-a", user_id: null } },
    ]);
    const hits = await retrieve(client, embed, "plan drużyny", authU, { minScore: 0 });
    expect(hits).toHaveLength(1);
    expect(hits[0].visibility).toBe("workspace");
  });

  it("cudzy user-chunk niewidzialny; własny widoczny", async () => {
    const { client, embed } = mockSearch([
      { score: 0.9, payload: { ...base, visibility: "user", user_id: "sub-obcy" } },
      { score: 0.8, payload: { ...base, visibility: "user", user_id: "sub-u1" } },
    ]);
    const hits = await retrieve(client, embed, "mój plan", authU, { minScore: 0 });
    expect(hits.map((h) => h.chunk_id)).toEqual(["c0"]);
  });

  it("fail-closed: brak userId = odrzucenie zapytania", async () => {
    const { client, embed } = mockSearch([{ score: 0.9, payload: base }]);
    await expect(retrieve(client, embed, "x", { userId: "", workspaceIds: [] })).rejects.toThrow(/fail-closed/);
  });

  it("nie zwraca treści denylistowanych/operacyjnych ani obcego tenanta", async () => {
    const { client, embed } = mockSearch([
      { score: 0.99, payload: { ...base, source_id: "paperclip-issues" } },
      { score: 0.98, payload: { ...base, source_id: "AGENTS.md" } },
      { score: 0.97, payload: { ...base, tenant: "inny-produkt" } },
      { score: 0.9, payload: base },
    ]);
    const hits = await retrieve(client, embed, "x", authU, { minScore: 0 });
    expect(hits).toHaveLength(1);
    expect(hits[0].source_id).toBe("help-page");
  });

  it("filtr source spoza allowlisty i klucze Object.prototype = błąd; podzbiór allowlisty trafia do silnika", async () => {
    const { calls, client, embed } = mockSearch([{ score: 0.9, payload: base }]);
    await expect(retrieve(client, embed, "x", authU, { sourceIds: ["drive-user"] })).rejects.toThrow(/not allowed/);
    await expect(retrieve(client, embed, "x", authU, { sourceIds: ["constructor"] })).rejects.toThrow(/not allowed/);
    await expect(retrieve(client, embed, "x", authU, { sourceIds: ["toString"] })).rejects.toThrow(/not allowed/);
    await retrieve(client, embed, "x", authU, { sourceIds: ["help-page", "legal"], minScore: 0 });
    const body = JSON.parse(calls[0].body);
    expect(JSON.stringify(body)).toContain("help-page");
    expect(JSON.stringify(body)).toContain("legal");
    expect(body.score_threshold).toBe(0);
  });

  it("post-filtr odrzuca prototype-key source oraz payload łamiący invariant visibility", async () => {
    const { client, embed } = mockSearch([
      { score: 0.99, payload: { ...base, source_id: "constructor" } },
      { score: 0.98, payload: { ...base, user_id: "sub-obcy", visibility: "global" } },
      { score: 0.9, payload: { ...base, chunk_id: "safe" } },
    ]);
    const hits = await retrieve(client, embed, "x", authU, { minScore: 0 });
    expect(hits.map((h) => h.chunk_id)).toEqual(["safe"]);
  });
});
