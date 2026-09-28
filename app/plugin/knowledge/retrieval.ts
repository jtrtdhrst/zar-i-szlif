/**
 * KOMAA-311 V4 — bezpieczny retrieval nad Qdrantem (kontrakt V1 KOMAA-308 §4–§5).
 *
 * - Prefilter autoryzacyjny w silniku (`searchScoped` → `buildAuthFilter`): tenant + global/własny user/własny workspace.
 * - `sourceIds` zawsze przecinane z allowlistą V1 (`ALLOWED_SOURCES`, kod nie flaga); nieznane źródło = błąd fail-closed.
 * - `minScore` egzekwowany w Qdrant (`score_threshold`) i post-filtrem (obrona w głąb).
 * - Post-filtr obronny: tenant, allowlista źródeł (denylista operacyjna nigdy nie wraca),
 *   reguły visibility ↔ auth — nawet gdyby silnik zwrócił nadmiarowy hit.
 * - Zwraca kontekst z metadata/source attribution dla MCP.
 */

import { TENANT, type AuthContext, type ChunkPayload } from "./schema.js";
import { ALLOWED_SOURCES } from "./pipeline.js";
import type { QdrantClient } from "./qdrant.js";
import type { EmbedFn } from "./embeddings.js";

export const RETRIEVAL_DEFAULT_TOP_K = 8;
export const RETRIEVAL_MAX_TOP_K = 20;
/** Sensowny próg Cosine similarity dla bge-m3 / treści PL (nadpisywalny per wywołanie). */
export const RETRIEVAL_DEFAULT_MIN_SCORE = 0.35;

export interface RetrievalHit {
  score: number;
  /** Treść chunka (puste dla punktów V2/V3 bez `payload.text`). */
  text: string;
  source_id: string;
  document_id: string;
  chunk_id: string;
  content_type: ChunkPayload["content_type"];
  source_version: string;
  updated_at: string;
  visibility: ChunkPayload["visibility"];
}

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  /** Zawężenie do podzbioru allowlisty; domyślnie wszystkie dozwolone źródła. */
  sourceIds?: string[];
}

function assertScope(auth: AuthContext): void {
  if (!auth?.userId) throw new Error("auth required: userId missing (fail-closed)");
}

function resolveSources(sourceIds?: string[]): string[] {
  const ids = sourceIds ?? Object.keys(ALLOWED_SOURCES);
  if (ids.length === 0) throw new Error("source filter must not be empty (fail-closed)");
  for (const id of ids) {
    if (!ALLOWED_SOURCES[id]) throw new Error(`source not allowed (V1 allowlist): ${id}`);
  }
  return ids;
}

function visibleTo(payload: ChunkPayload, auth: AuthContext): boolean {
  if (payload.tenant !== TENANT) return false;
  if (!ALLOWED_SOURCES[payload.source_id]) return false; // denylistowane/operacyjne nigdy nie wracają
  if (payload.visibility === "global") return true;
  if (payload.visibility === "user") return payload.user_id === auth.userId;
  if (payload.visibility === "workspace") {
    return !!payload.workspace_id && auth.workspaceIds.includes(payload.workspace_id);
  }
  return false;
}

/**
 * Semantic search z obowiązkowym scope użytkownika.
 * Zapytanie bez `userId` = odrzucane (fail-closed, V1 §4).
 */
export async function retrieve(
  client: QdrantClient,
  embed: EmbedFn,
  query: string,
  auth: AuthContext,
  opts?: RetrieveOptions,
): Promise<RetrievalHit[]> {
  assertScope(auth);
  const topK = opts?.topK ?? RETRIEVAL_DEFAULT_TOP_K;
  if (!Number.isInteger(topK) || topK < 1 || topK > RETRIEVAL_MAX_TOP_K) {
    throw new Error(`topK must be an integer 1..${RETRIEVAL_MAX_TOP_K}`);
  }
  const minScore = opts?.minScore ?? RETRIEVAL_DEFAULT_MIN_SCORE;
  if (typeof minScore !== "number" || !(minScore >= 0 && minScore <= 1)) {
    throw new Error("minScore must be a number 0..1");
  }
  const sources = resolveSources(opts?.sourceIds);
  const queryText = query.trim();
  if (!queryText) return [];

  const [vector] = await embed([queryText]);
  const res = await client.searchScoped(vector, auth, {
    limit: topK,
    scoreThreshold: minScore,
    extraFilter: { should: sources.map((s) => ({ key: "source_id", match: { value: s } })) },
  });

  return (res.result ?? [])
    .filter((hit) => typeof hit.score === "number" && hit.score >= minScore)
    .filter((hit) => hit.payload && visibleTo(hit.payload, auth))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((hit) => ({
      score: hit.score,
      text: hit.payload.text ?? "",
      source_id: hit.payload.source_id,
      document_id: hit.payload.document_id,
      chunk_id: hit.payload.chunk_id,
      content_type: hit.payload.content_type,
      source_version: hit.payload.source_version,
      updated_at: hit.payload.updated_at,
      visibility: hit.payload.visibility,
    }));
}
