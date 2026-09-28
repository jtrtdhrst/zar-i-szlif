// Live smoke: ingest -> Qdrant -> scoped retrieval (wymaga sekretów).
// Uruchamia posiadacz sekretu: QDRANT_URL (+QDRANT_API_KEY) node scripts/rag-live-smoke.mjs
// Bez QDRANT_URL gate kończy się kodem 2 z czytelną instrukcją (nie udaje live).
import { QdrantClient } from "../app/plugin/dist/knowledge/qdrant.js";
import { deterministicEmbed } from "../app/plugin/dist/knowledge/embeddings.js";
import { syncCorpus } from "../app/plugin/dist/knowledge/pipeline.js";
import { retrieve } from "../app/plugin/dist/knowledge/retrieval.js";
import { bearerSubject } from "../app/plugin/dist/auth.js";

const url = (process.env.QDRANT_URL ?? "").trim().replace(/\/+$/, "");
if (!url) {
  console.error("[rag-live-smoke] QDRANT_URL missing — live Qdrant smoke requires the secret holder to run with QDRANT_URL (+QDRANT_API_KEY).");
  process.exit(2);
}
if (process.env.EMBEDDING_ALLOW_LEXICAL !== "1") {
  console.error("[rag-live-smoke] Refusing: set EMBEDDING_ALLOW_LEXICAL=1 to smoke with lexical vectors, or wire Workers AI bge-m3 (alias-swap collection).");
  process.exit(2);
}
const client = new QdrantClient({ baseUrl: url, apiKey: process.env.QDRANT_API_KEY || undefined });
await client.ensureCollection();
const docs = [{ sourceId: "help-page", documentId: "live-smoke", rawText: "Pomoc: logowanie przez Google. Smoke Qdrant live.", sourceVersion: "smoke" }];
const res = await syncCorpus(client, deterministicEmbed(), docs, new Map());
const sub = bearerSubject("Bearer live-smoke-token");
const hits = await retrieve(client, deterministicEmbed(), "logowanie Google", { userId: sub, workspaceIds: [] }, { minScore: 0 });
console.log(JSON.stringify({ upserted: res[0], hits: hits.slice(0, 2) }, null, 2));
if (hits.length === 0) { console.error("[rag-live-smoke] FAIL: no hits"); process.exit(1); }
await client.deleteDocument("help-page", "live-smoke");
console.log("[rag-live-smoke] PASS (smoke doc cleaned up)");
