/**
 * KOMAA-309 V2 — minimalne testy: tworzenie kolekcji, upsert, scoped search.
 * Fetch jest mockowany; bez żywego Qdrant.
 */
import { describe, it, expect, vi } from "vitest";
import {
  COLLECTION_NAME,
  REQUIRED_PAYLOAD_INDEXES,
  VECTOR_SIZE,
  buildAuthFilter,
  chunkId,
  collectionCreateBody,
  contentHash,
  payloadIndexBodies,
  pointId,
  validatePayload,
  writeKey,
  type ChunkPayload,
} from "./schema";
import { QdrantClient } from "./qdrant";

const payload: ChunkPayload = {
  source_id: "help-page",
  document_id: "help-page",
  chunk_id: "abc123",
  tenant: "kompas-zbiorek",
  user_id: null,
  workspace_id: null,
  visibility: "global",
  content_type: "help",
  content_hash: "deadbeef",
  source_version: "git:abc",
  updated_at: new Date().toISOString(),
};

function mockFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ status: "ok" }), text: async () => "ok" };
  });
  return { calls, fn: fn as unknown as typeof fetch };
}

describe("collection", () => {
  it("używa kontraktowej nazwy, wymiarów bge-m3 i Cosine", () => {
    expect(COLLECTION_NAME).toBe("kompas-knowledge-v1");
    const body = collectionCreateBody() as { vectors: { size: number; distance: string } };
    expect(body.vectors).toMatchObject({ size: 1024, distance: "Cosine" });
    expect(VECTOR_SIZE).toBe(1024);
  });

  it("zakłada indeksy dla wszystkich pól filtra bezpieczeństwa/scope (V1 §5)", async () => {
    const { calls, fn } = mockFetch();
    await new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn }).ensureCollection();
    expect(calls[0].url).toBe("http://qdrant:6333/collections/kompas-knowledge-v1");
    expect(calls[0].init.method).toBe("PUT");
    const indexed = calls.slice(1).map((c) => (JSON.parse(c.init.body as string) as { field_name: string }).field_name);
    expect(indexed).toEqual([...REQUIRED_PAYLOAD_INDEXES]);
    expect(payloadIndexBodies()).toHaveLength(7);
  });
});

describe("stabilne identyfikatory i idempotencja", () => {
  it("chunk_id jest deterministyczny, a point id poprawnym UUID", async () => {
    expect(await chunkId("doc-1", 0)).toBe(await chunkId("doc-1", 0));
    expect(await chunkId("doc-1", 0)).not.toBe(await chunkId("doc-1", 1));
    const id = await pointId("doc-1", 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("ten sam tekst = ten sam hash (dedup); write key jest stabilny", async () => {
    expect(await contentHash("  Ala   ma kota\n")).toBe(await contentHash("Ala ma kota"));
    expect(writeKey("s", "d", 0, "h")).toBe(writeKey("s", "d", 0, "h"));
    expect(writeKey("s", "d", 0, "h")).not.toBe(writeKey("s", "d", 1, "h"));
  });

  it("upsert tego samego punktu dwa razy trafia w ten sam id (no-op)", async () => {
    const { calls, fn } = mockFetch();
    const client = new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn });
    const id = await pointId("help-page", 0);
    const point = { id, vector: new Array(1024).fill(0), payload };
    await client.upsertPoints([point]);
    await client.upsertPoints([point]);
    const bodies = calls.map((c) => JSON.parse(c.init.body as string) as { points: { id: string }[] });
    expect(bodies[0].points[0].id).toBe(bodies[1].points[0].id);
  });

  it("fail-closed: niekompletny payload przerywa partię przed zapisem", async () => {
    const { calls, fn } = mockFetch();
    const client = new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn });
    await expect(client.upsertPoints([{ id: "x", vector: [], payload: { ...payload, user_id: "u" } }])).rejects.toThrow(
      /visibility=global must not carry/,
    );
    await expect(
      client.upsertPoints([{ id: "x", vector: [], payload: { ...payload, visibility: "user" } }]),
    ).rejects.toThrow(/requires user_id/);
    expect(calls).toHaveLength(0);
    expect(validatePayload({})).not.toHaveLength(0);
  });
});

describe("scoped search (V1 §4)", () => {
  it("filtr zawsze zawiera tenant + regułę global/user/workspace", () => {
    const filter = buildAuthFilter({ userId: "sub-123", workspaceIds: ["team-a"] });
    const raw = JSON.stringify(filter);
    expect(raw).toContain("kompas-zbiorek");
    expect(raw).toContain("sub-123");
    expect(raw).toContain("team-a");
    expect(raw).toContain("global");
  });

  it("fail-closed: brak userId = odrzucenie zapytania", () => {
    expect(() => buildAuthFilter({ userId: "", workspaceIds: [] })).toThrow(/fail-closed/);
  });

  it("extraFilter jest dokładany, nigdy nie zastępuje filtra auth", async () => {
    const { calls, fn } = mockFetch();
    const client = new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn });
    await client.searchScoped(new Array(1024).fill(0), { userId: "sub-123", workspaceIds: [] }, {
      extraFilter: { must: [{ key: "source_id", match: { value: "help-page" } }] },
    });
    const body = JSON.parse(calls[0].init.body as string) as { filter: { must: unknown[] } };
    expect(body.filter.must).toHaveLength(2);
    expect(JSON.stringify(body.filter.must[0])).toContain("kompas-zbiorek");
    expect(JSON.stringify(body.filter.must[1])).toContain("help-page");
  });

  it("deleteDocument kasuje po (source_id, document_id)", async () => {
    const { calls, fn } = mockFetch();
    await new QdrantClient({ baseUrl: "http://qdrant:6333", fetchFn: fn }).deleteDocument("help-page", "help-page");
    const body = JSON.parse(calls[0].init.body as string) as object;
    expect(JSON.stringify(body)).toContain("help-page");
    expect(calls[0].url).toContain("/points/delete");
  });
});
