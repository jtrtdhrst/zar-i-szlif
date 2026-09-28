// Live smoke: ingest -> Qdrant -> scoped retrieval -> odpowiedź MCP (wymaga sekretów).
// Uruchamia posiadacz sekretu: QDRANT_URL (+QDRANT_API_KEY) node scripts/rag-live-smoke.mjs
// Bez QDRANT_URL gate kończy się kodem 2 z czytelną instrukcją (nie udaje live).
// Sama ścieżka żyje w knowledge/smoke.ts — pokryta testem na emulacji REST.
import { QdrantClient } from "../app/plugin/dist/knowledge/qdrant.js";
import { deterministicEmbed } from "../app/plugin/dist/knowledge/embeddings.js";
import { runKnowledgeSmoke } from "../app/plugin/dist/knowledge/smoke.js";
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
const report = await runKnowledgeSmoke(client, deterministicEmbed(), bearerSubject("Bearer live-smoke-token"));
console.log(JSON.stringify(report, null, 2));
console.log("[rag-live-smoke] PASS (dokumenty smoke usunięte)");
