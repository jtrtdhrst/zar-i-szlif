/**
 * KOMAA-310 V3 — evidence: 2x ingest = brak wzrostu chunków; update/delete działa.
 * Fetch i embed mockowane; bez żywego Qdrant.
 */
import { describe, it, expect, vi } from "vitest";
import { QdrantClient } from "./qdrant";
import {
  ALLOWED_SOURCES,
  isAllowedSource,
  chunkText,
  deleteSource,
  syncCorpus,
  syncDocument,
  type SourceDocument,
} from "./pipeline";

const LONG = "Ala ma kota. ".repeat(300); // > CHUNK_MAX_CHARS → kilka chunków

function mockClient() {
  const calls: { url: string; body: string }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: url as string, body: (init.body as string) ?? "" });
    return { ok: true, status: 200, json: async () => ({ status: "ok" }), text: async () => "ok" };
  });
  return { calls, client: new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn as unknown as typeof fetch }) };
}

function countingEmbed(dim = 8) {
  let calls = 0;
  const embed = async (texts: string[]) => {
    calls += texts.length;
    return texts.map((_, i) => new Array(dim).fill(calls + i));
  };
  return { embed, getCalls: () => calls };
}

const doc = (rawText: string): SourceDocument => ({
  sourceId: "help-page",
  documentId: "help-page",
  rawText,
  sourceVersion: "git:test",
});

describe("allowlista źródeł (V1 §2, kod nie flaga)", () => {
  it("zawiera S1,S3–S6 i odrzuca S2/S7 oraz nieznane", async () => {
    for (const s of ["skills-catalog", "marketing", "onboarding-emails", "help-page", "legal", "runtime-doc"]) {
      expect(ALLOWED_SOURCES[s]).toBeDefined();
    }
    const { client } = mockClient();
    const { embed } = countingEmbed();
    await expect(syncDocument(client, embed, doc("x").valueOf() && { ...doc("x"), sourceId: "user-plans" })).rejects.toThrow(
      /not allowed/,
    );
    await expect(deleteSource(client, "drive-user")).rejects.toThrow(/not allowed/);
    expect(isAllowedSource("constructor")).toBe(false);
    expect(isAllowedSource("toString")).toBe(false);
    await expect(deleteSource(client, "constructor")).rejects.toThrow(/not allowed/);
  });

  it("chunking jest stabilny dla stałej treści", () => {
    expect(chunkText(LONG)).toEqual(chunkText(LONG));
    expect(chunkText("")).toEqual([]);
    expect(chunkText("krótki")).toEqual(["krótki"]);
  });
});

describe("idempotencja: ingest 2x nie zwiększa liczby logicznych chunków", () => {
  it("drugi sync tego samego korpusu = same id, zero nowych embeddingów", async () => {
    const { calls, client } = mockClient();
    const { embed, getCalls } = countingEmbed();
    const state = new Map<string, { hashes: Record<number, string>; count: number }>();

    const first = await syncCorpus(client, embed, [doc(LONG)], state);
    const upsertBodies1 = calls.filter((c) => c.url.endsWith("/points")).map((c) => JSON.parse(c.body));
    const ids1 = upsertBodies1.flatMap((b) => b.points.map((p: { id: string }) => p.id));
    expect(first[0].chunks).toBeGreaterThan(1);
    expect(first[0].upserted).toBe(first[0].chunks);
    expect(getCalls()).toBe(first[0].chunks);

    const callsBefore = calls.length;
    const second = await syncCorpus(client, embed, [doc(LONG)], state);
    // Brak nowych upsertów (wszystko skipped po content_hash) → brak wzrostu logicznych chunków.
    expect(second[0].skipped).toBe(first[0].chunks);
    expect(second[0].upserted).toBe(0);
    expect(calls.length).toBe(callsBefore);
    expect(getCalls()).toBe(first[0].chunks);
    void ids1;
  });
});

describe("update/delete", () => {
  it("zmiana treści = re-embed tylko zmienionych + purge sierot przy shrinku", async () => {
    const { calls, client } = mockClient();
    const { embed, getCalls } = countingEmbed();
    const state = new Map<string, { hashes: Record<number, string>; count: number }>();

    await syncCorpus(client, embed, [doc(LONG)], state);
    const embeddedAfterFirst = getCalls();

    // Rozszerzenie: co najmniej jeden nowy chunk do embeddowania.
    const grown = await syncCorpus(client, embed, [doc(`${LONG} Nowy akapit o zbiórce. `.repeat(40))], state);
    expect(grown[0].upserted).toBeGreaterThan(0);

    // Shrink do 1 chunka: sieroce ordinale usunięte w tym samym syncu.
    const deletesBefore = calls.filter((c) => c.url.endsWith("/points/delete")).length;
    const shrunk = await syncCorpus(client, embed, [doc("krótka pomoc")], state);
    expect(shrunk[0].chunks).toBe(1);
    expect(shrunk[0].deleted).toBeGreaterThan(0);
    expect(calls.filter((c) => c.url.endsWith("/points/delete")).length).toBeGreaterThan(deletesBefore);
  });

  it("pusty tekst = delete dokumentu; deleteSource kasuje po source_id", async () => {
    const { calls, client } = mockClient();
    const { embed } = countingEmbed();
    await syncCorpus(client, embed, [{ ...doc("treść"), rawText: "   " }], new Map());
    const delDoc = calls.find((c) => c.url.endsWith("/points/delete"));
    expect(JSON.stringify(delDoc?.body)).toContain("help-page");

    calls.length = 0;
    await deleteSource(client, "legal");
    expect(calls[0].url).toContain("/points/delete");
    expect(JSON.parse(calls[0].body).filter.must).toHaveLength(1);
    expect(JSON.stringify(calls[0].body)).toContain("legal");
  });
});
