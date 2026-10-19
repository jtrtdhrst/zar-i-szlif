/**
 * Contract of the EXISTING Cloudflare Worker ChatGPT MCP -> product Qdrant.
 * Uses in-memory Qdrant REST emulation; NOT proof of deployed credentials.
 * OAuthProvider validates the token before calling this handler; tests supply
 * verified ctx.props to exercise the complete MCP tool path after that gate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKompasMcpHandler, knowledgeBackend } from "./mcp";
import { QdrantClient } from "../../plugin/knowledge/qdrant.js";
import { createMemoryFetch } from "../../plugin/knowledge/memory.js";
import { COLLECTION_NAME, TENANT, VECTOR_SIZE } from "../../plugin/knowledge/schema.js";

const endpoint = "https://mcp-kompas.kompaszbiorek.pl/mcp";
const modelVector = Array(VECTOR_SIZE).fill(0.01);
const ai = { run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map(() => modelVector) }) };
const env = {
  MCP_PUBLIC_ORIGIN: "https://mcp-kompas.kompaszbiorek.pl",
  QDRANT_URL: "https://unit-test-qdrant.example",
  QDRANT_API_KEY: "test-only-secret",
  AI: ai,
};
afterEach(() => vi.unstubAllGlobals());

function decoded(raw: string, mime: string): any {
  if (mime.includes("text/event-stream")) {
    const line = raw.split("\n").find(line => line.startsWith("data: "));
    if (!line) throw new Error("Missing JSONRPC SSE data frame: " + raw.slice(0, 200));
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(raw);
}
let sequence = 0;
async function callMcp(method: string, params: unknown, subject: string | null, runtimeEnv = env) {
  const handler = createKompasMcpHandler({ widgetHtml: "<!doctype html><html><body>Żar i Szlif</body></html>" });
  const request = new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
  });
  const props = subject === null ? null : { googleSub: subject, workspaceIds: [] };
  const response = await handler.fetch(request, runtimeEnv, { props } as unknown as ExecutionContext);
  const body = decoded(await response.text(), response.headers.get("content-type") ?? "");
  return { status: response.status, body };
}

describe("ChatGPT MCP product knowledge on the canonical Worker transport", () => {
  it("rejects invalid Qdrant config and never selects lexical production vectors", () => {
    expect(knowledgeBackend({ MCP_PUBLIC_ORIGIN: env.MCP_PUBLIC_ORIGIN })).toBeNull();
    expect(() => knowledgeBackend({ ...env, QDRANT_API_KEY: "" })).toThrow(/QDRANT_API_KEY/);
    expect(() => knowledgeBackend({ ...env, QDRANT_URL: "http://unit-test-qdrant.example" })).toThrow(/HTTPS/);
    expect(() => knowledgeBackend({ ...env, QDRANT_URL: "https://alice:password@qdrant.example" })).toThrow(/QDRANT_URL/);
    expect(() => knowledgeBackend({ ...env, AI: undefined, EMBEDDING_ALLOW_LEXICAL: "1" })).toThrow(/Workers AI/);
    expect(knowledgeBackend(env)?.client.collection).toBe(COLLECTION_NAME);
  });

  it("initializes the SAME user MCP server and advertises knowledge tools", async () => {
    const init = await callMcp("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "chatgpt-integration-contract", version: "1.0.0" },
    }, "verified-google-sub-a");
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("Kompas Zbiórek");

    const list = await callMcp("tools/list", {}, "verified-google-sub-a");
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("pokaz_kompas_zbiorek");
    for (const name of ["search_knowledge", "get_knowledge_source", "search", "fetch"]) {
      expect(names).toContain(name);
    }
    expect(names).toContain("filtruj_aktywnosci");
  });

  it("retrieves source-attributed chunks through tools/call without cross-user leak", async () => {
    const backendFetch = createMemoryFetch();
    vi.stubGlobal("fetch", backendFetch);
    const seed = new QdrantClient({
      baseUrl: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY,
      collection: COLLECTION_NAME, fetchFn: backendFetch,
    });
    await seed.ensureCollection();
    const shared = {
      tenant: TENANT, source_id: "help-page", content_type: "help" as const,
      workspace_id: null, content_hash: "sha-test", source_version: "fixture",
      updated_at: "2026-10-19T00:00:00.000Z",
    };
    await seed.upsertPoints([
      { id: "00000000-0000-4000-8000-000000000001", vector: modelVector, payload: {
        ...shared, document_id: "public", chunk_id: "public#0",
        user_id: null, visibility: "global" as const, text: "Poradnik planowania pierwszej zbiórki.",
      }},
      { id: "00000000-0000-4000-8000-000000000002", vector: modelVector, payload: {
        ...shared, document_id: "alice", chunk_id: "alice#0",
        user_id: "verified-google-sub-a", visibility: "user" as const, text: "Osobista notatka Alicji.",
      }},
      { id: "00000000-0000-4000-8000-000000000003", vector: modelVector, payload: {
        ...shared, document_id: "bob", chunk_id: "bob#0",
        user_id: "verified-google-sub-b", visibility: "user" as const, text: "Osobista notatka Boba.",
      }},
    ]);
    const a = await callMcp("tools/call", {
      name: "search_knowledge", arguments: { query: "zbiórka", minScore: 0 },
    }, "verified-google-sub-a");
    expect(a.status).toBe(200);
    expect(a.body.result.isError).not.toBe(true);
    const ah = a.body.result.structuredContent.results;
    expect(ah.some((h: any) => h.document_id === "public")).toBe(true);
    expect(ah.some((h: any) => h.document_id === "alice")).toBe(true);
    expect(ah.some((h: any) => h.document_id === "bob")).toBe(false);
    expect(ah.every((h: any) => h.source_id && h.chunk_id && h.text)).toBe(true);

    const b = await callMcp("tools/call", {
      name: "search_knowledge", arguments: { query: "zbiórka", minScore: 0 },
    }, "verified-google-sub-b");
    expect(b.body.result.structuredContent.results.some((h: any) => h.document_id === "alice")).toBe(false);

    const source = await callMcp("tools/call", {
      name: "get_knowledge_source", arguments: { source_id: "help-page", document_id: "alice" },
    }, "verified-google-sub-a");
    expect(source.body.result.structuredContent.chunks).toHaveLength(1);
    const forbidden = await callMcp("tools/call", {
      name: "get_knowledge_source", arguments: { source_id: "help-page", document_id: "alice" },
    }, "verified-google-sub-b");
    expect(forbidden.body.result.structuredContent.chunks).toHaveLength(0);

    const fakeScope = await callMcp("tools/call", {
      name: "search_knowledge", arguments: { query: "zbiórka", userId: "verified-google-sub-b" },
    }, "verified-google-sub-a");
    expect(fakeScope.body.result.isError ?? !!fakeScope.body.error).toBeTruthy();
  });

  it("rejects missing verified OAuth grant before reaching Qdrant", async () => {
    await expect(callMcp("tools/call", {
      name: "search_knowledge", arguments: { query: "przygotowanie zbiórki" },
    }, null)).rejects.toThrow(/autoryzacji|subjectu/i);
  });
});
