import test from "node:test";
import assert from "node:assert/strict";
import { createUserMcpRuntime, UserMcpUnauthorized } from "../dist/user-mcp/runtime.js";
import { createMemoryFetch } from "../dist/knowledge/memory.js";
import { QdrantClient } from "../dist/knowledge/qdrant.js";
import { COLLECTION_NAME, TENANT, VECTOR_SIZE } from "../dist/knowledge/schema.js";

const fakeQdrant = createMemoryFetch();
const vector = Array(VECTOR_SIZE).fill(0.1);
const ai = { async run(_model, { text }) { return { data: text.map(() => vector) }; } };
const config = {
  qdrantUrl: "https://product-qdrant.example",
  qdrantApiKey: "fake-unit-test-key",
  fetchFn: fakeQdrant,
  ai,
  readBundle: async () => "<html><body>demo</body></html>",
  verifyAccessToken: async (token) =>
    token === "A" ? { userId: "sub-a", workspaceIds: ["team-a"] }
    : token === "B" ? { userId: "sub-b", workspaceIds: ["team-b"] }
    : null,
};

test("configuration fails closed (TLS, credentials, verifier and embeddings)", () => {
  for (const qdrantUrl of ["http://evil.example", "https://x.example/some-path", "https://user:password@x.example", "memory://foo"]) {
    assert.throws(() => createUserMcpRuntime({ ...config, qdrantUrl }), /QDRANT_URL/);
  }
  assert.throws(() => createUserMcpRuntime({ ...config, qdrantApiKey: "" }), /QDRANT_API_KEY/);
  assert.throws(() => createUserMcpRuntime({ ...config, verifyAccessToken: null }), /OAuth verifier/);
  assert.throws(() => createUserMcpRuntime({ ...config, ai: null }), /Workers AI/);
});

test("request identity must be verified; forged scope cannot be passed", async () => {
  const runtime = createUserMcpRuntime(config);
  for (const auth of [undefined, "Bearer", "Bearer invalid", "Basic A"]) {
    await assert.rejects(runtime.search(auth, { query: "zbiórka" }), UserMcpUnauthorized);
  }
  await assert.rejects(
    runtime.search("Bearer A", { query: "zbiórka", workspaceIds: ["team-b"] }),
    /niedozwolony/,
  );
  const mcp = await runtime.createServer("Bearer A");
  assert.ok(mcp, "MCP registry constructed for verified subject");
  assert.equal(runtime.collection, "kompas-knowledge-v1");
});

test("real Qdrant REST adapter: user isolation + global docs + source read", async () => {
  const runtime = createUserMcpRuntime(config);
  const seed = new QdrantClient({ baseUrl: config.qdrantUrl, apiKey: config.qdrantApiKey, collection: COLLECTION_NAME, fetchFn: fakeQdrant });
  await seed.ensureCollection();
  const common = {
    tenant: TENANT, workspace_id: null, content_type: "help",
    source_id: "help-page", source_version: "test", updated_at: "2026-10-19T00:00:00Z", content_hash: "hash",
  };
  await seed.upsertPoints([
    { id: "10000000-0000-4000-8000-000000000001", vector, payload: { ...common, user_id: null, visibility: "global", document_id: "public", chunk_id: "public-1", text: "instrukcja zbiórka globalna" } },
    { id: "10000000-0000-4000-8000-000000000002", vector, payload: { ...common, user_id: "sub-a", visibility: "user", document_id: "private", chunk_id: "private-1", text: "notatki zbiórka prywatne" } },
    { id: "10000000-0000-4000-8000-000000000003", vector, payload: { ...common, user_id: "sub-b", visibility: "user", document_id: "secret-b", chunk_id: "secret-b-1", text: "sekret zbiórka B" } },
  ]);
  const a = await runtime.search("Bearer A", { query: "zbiórka", minScore: 0 });
  const b = await runtime.search("Bearer B", { query: "zbiórka", minScore: 0 });
  assert.ok(a.some(hit => hit.document_id === "public"));
  assert.ok(a.some(hit => hit.document_id === "private"));
  assert.ok(!a.some(hit => hit.document_id === "secret-b"));
  assert.ok(b.some(hit => hit.document_id === "secret-b"));
  assert.ok(!b.some(hit => hit.document_id === "private"));
  const source = await runtime.getSource("Bearer A", { source_id: "help-page", document_id: "private" });
  assert.equal(source.chunks.length, 1);
  const alien = await runtime.getSource("Bearer B", { source_id: "help-page", document_id: "private" });
  assert.equal(alien.chunks.length, 0);
});
