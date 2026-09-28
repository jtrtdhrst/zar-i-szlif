/**
 * KOMAA-310 V3 — deterministyczny pipeline source → normalize → chunk → embed → upsert.
 *
 * Kontrakt V1 (KOMAA-308 §2–§6): allowlista źródeł jako kod, stabilne
 * chunk_id/point id/content_hash z `schema.ts`, upsert po id punktu
 * (powtórka = no-op), re-chunk + purge sierot przy zmianie dokumentu,
 * delete dokumentu/źródła. Bez nowych zależności.
 */

import {
  TENANT,
  chunkId,
  contentHash,
  normalizeText,
  pointId,
  type ChunkPayload,
  type ContentType,
  type Visibility,
} from "./schema.js";
import type { QdrantClient } from "./qdrant.js";
import type { EmbedFn } from "./embeddings.js";

/** V1 §2: indeksowalne źródła (kod, nie flaga). S2 i S7 wyłączone do decyzji V2. */
export const ALLOWED_SOURCES: Record<string, { contentType: ContentType; visibility: Visibility }> = {
  "skills-catalog": { contentType: "rr-requirement", visibility: "global" },
  marketing: { contentType: "marketing", visibility: "global" },
  "onboarding-emails": { contentType: "onboarding-email", visibility: "global" },
  "help-page": { contentType: "help", visibility: "global" },
  legal: { contentType: "legal", visibility: "global" },
  "runtime-doc": { contentType: "runtime-doc", visibility: "global" },
};

export function assertAllowedSource(sourceId: string): void {
  if (!ALLOWED_SOURCES[sourceId]) throw new Error(`source not allowed (V1 allowlist): ${sourceId}`);
}

export interface SourceDocument {
  sourceId: string;
  documentId: string;
  rawText: string;
  /** V1 §5: S1 = timestamp snapshotu, S3–S6 = git SHA + ścieżka, S6 = deploy-id. */
  sourceVersion: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export const CHUNK_MAX_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;

/**
 * Stabilny chunking: deterministyczny podział znormalizowanego tekstu na
 * okna `maxChars` z zachodzeniem `overlap`, cięte na granicy spacji.
 * Ten sam tekst = te same granice = te same ordinale.
 */
export function chunkText(text: string, maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  if (norm.length <= maxChars) return [norm];
  const chunks: string[] = [];
  let start = 0;
  while (start < norm.length) {
    let end = Math.min(start + maxChars, norm.length);
    if (end < norm.length) {
      const cut = norm.lastIndexOf(" ", end);
      if (cut > start) end = cut;
    }
    chunks.push(norm.slice(start, end).trim());
    if (end >= norm.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

export interface SyncResult {
  documentId: string;
  chunks: number;
  upserted: number;
  skipped: number;
  deleted: number;
}

/**
 * Synchronizacja jednego dokumentu: normalize → chunk → hash → embed
 * (tylko zmienione vs `knownHashes[ordinal]`) → upsert → purge sierot.
 * `knownHashes` + `prevCount` pochodzą z poprzedniego syncu (snapshot
 * content_hash per ordinal); brak = pełny zapis.
 */
export async function syncDocument(
  client: QdrantClient,
  embed: EmbedFn,
  doc: SourceDocument,
  opts?: { knownHashes?: Record<number, string>; prevCount?: number; now?: string },
): Promise<SyncResult> {
  assertAllowedSource(doc.sourceId);
  const meta = ALLOWED_SOURCES[doc.sourceId];
  const chunks = chunkText(doc.rawText);
  const now = opts?.now ?? new Date().toISOString();
  const known = opts?.knownHashes ?? {};

  const pending: { ordinal: number; text: string; hash: string }[] = [];
  let skipped = 0;
  for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
    const hash = await contentHash(chunks[ordinal]);
    if (known[ordinal] === hash) skipped++;
    else pending.push({ ordinal, text: chunks[ordinal], hash });
  }

  if (pending.length > 0) {
    const vectors = await embed(pending.map((p) => p.text));
    const points = await Promise.all(
      pending.map(async (p, i) => ({
        id: await pointId(doc.documentId, p.ordinal),
        vector: vectors[i],
        payload: {
          source_id: doc.sourceId,
          document_id: doc.documentId,
          chunk_id: await chunkId(doc.documentId, p.ordinal),
          tenant: TENANT,
          user_id: meta.visibility === "global" ? null : (doc.userId ?? null),
          workspace_id: meta.visibility === "global" ? null : (doc.workspaceId ?? null),
          visibility: meta.visibility,
          content_type: meta.contentType,
          content_hash: p.hash,
          source_version: doc.sourceVersion,
          updated_at: now,
          text: p.text,
        } satisfies ChunkPayload,
      })),
    );
    await client.upsertPoints(points);
  }

  // Purge sierot: ordinale zniknięte w nowej wersji (shrink), w tej samej synchronizacji.
  const prevCount = opts?.prevCount ?? chunks.length;
  let deleted = 0;
  if (prevCount > chunks.length) {
    const stale: string[] = [];
    for (let ordinal = chunks.length; ordinal < prevCount; ordinal++) stale.push(await pointId(doc.documentId, ordinal));
    await client.deletePoints(stale);
    deleted = stale.length;
  }

  return { documentId: doc.documentId, chunks: chunks.length, upserted: pending.length, skipped, deleted };
}

/** Sync korpusu: zwraca sumaryczne liczniki; pusty tekst = delete dokumentu. */
export async function syncCorpus(
  client: QdrantClient,
  embed: EmbedFn,
  docs: SourceDocument[],
  state?: Map<string, { hashes: Record<number, string>; count: number }>,
  now?: string,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const doc of docs) {
    if (!normalizeText(doc.rawText)) {
      await client.deleteDocument(doc.sourceId, doc.documentId);
      state?.delete(`${doc.sourceId}\n${doc.documentId}`);
      results.push({ documentId: doc.documentId, chunks: 0, upserted: 0, skipped: 0, deleted: 0 });
      continue;
    }
    const key = `${doc.sourceId}\n${doc.documentId}`;
    const prev = state?.get(key);
    const r = await syncDocument(client, embed, doc, { knownHashes: prev?.hashes, prevCount: prev?.count, now });
    if (state) {
      const hashes: Record<number, string> = {};
      const chunks = chunkText(doc.rawText);
      for (let i = 0; i < chunks.length; i++) hashes[i] = await contentHash(chunks[i]);
      state.set(key, { hashes, count: chunks.length });
    }
    results.push(r);
  }
  return results;
}

/** Delete całego źródła (odwołanie zgody / wycofanie źródła, V1 §6). */
export async function deleteSource(client: QdrantClient, sourceId: string): Promise<void> {
  assertAllowedSource(sourceId);
  await client.deleteSource(sourceId);
}
