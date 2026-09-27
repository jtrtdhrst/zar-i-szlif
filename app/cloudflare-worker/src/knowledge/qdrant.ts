/**
 * KOMAA-309 V2 — minimalny klient Qdrant (REST, czysty fetch — działa
 * w Cloudflare Workers i w Node 22, bez nowych zależności).
 *
 * Deterministyczny upsert po id punktu (V1 §6): ponowny zapis tego samego
 * klucza = no-op nadpisujący ten sam punkt. Dedup po content_hash robi
 * warstwa wywołująca (ten sam hash + ten sam ordinal = ten sam punkt).
 */

import {
  COLLECTION_NAME,
  type AuthContext,
  type ChunkPayload,
  type QdrantFilter,
  buildAuthFilter,
  collectionCreateBody,
  payloadIndexBodies,
  validatePayload,
} from "./schema";

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface QdrantClientOptions {
  baseUrl: string;
  apiKey?: string;
  collection?: string;
  fetchFn?: typeof fetch;
}

export class QdrantClient {
  readonly collection: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: QdrantClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.collection = opts.collection ?? COLLECTION_NAME;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async req(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "api-key": this.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`qdrant ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** Utwórz kolekcję (idempotentnie — 409 = już istnieje) i załóż payload-indexy. */
  async ensureCollection(): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/collections/${this.collection}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "api-key": this.apiKey } : {}),
      },
      body: JSON.stringify(collectionCreateBody()),
    });
    if (res.status !== 200 && res.status !== 409) {
      throw new Error(`qdrant create collection: ${res.status} ${await res.text()}`);
    }
    for (const { field, body } of payloadIndexBodies()) {
      await this.req(`/collections/${this.collection}/index`, "PUT", body).catch((err: Error) => {
        // Index już istnieje → nie jest błędem (idempotentny setup).
        if (!/already exists|Conflict/i.test(err.message)) throw err;
      });
      void field;
    }
  }

  /**
   * Upsert punktów. Fail-closed: punkt z niekompletnym payloadem
   * przerywa całą partię przed jakimkolwiek zapisem.
   */
  async upsertPoints(points: QdrantPoint[]): Promise<void> {
    for (const p of points) {
      const errors = validatePayload(p.payload);
      if (errors.length > 0) throw new Error(`invalid payload for point ${p.id}: ${errors.join("; ")}`);
    }
    await this.req(`/collections/${this.collection}/points`, "PUT", { points });
  }

  /**
   * Usunięcie dokumentu: kasuje punkty (source_id, document_id) w jednym
   * filtrze. Tombstone (`deleted_at`) trzyma warstwa wywołująca — tutaj
   * twardy purge punktów (fizyczny purge ≤24h, V1 §6).
   */
  async deleteDocument(sourceId: string, documentId: string): Promise<void> {
    await this.req(`/collections/${this.collection}/points/delete`, "POST", {
      filter: {
        must: [
          { key: "source_id", match: { value: sourceId } },
          { key: "document_id", match: { value: documentId } },
        ],
      },
    });
  }

  /** Usunięcie całego źródła (V1 §6: delete źródła = purge wszystkich jego punktów). */
  async deleteSource(sourceId: string): Promise<void> {
    await this.req(`/collections/${this.collection}/points/delete`, "POST", {
      filter: {
        must: [{ key: "source_id", match: { value: sourceId } }],
      },
    });
  }

  /** Usunięcie sierocych chunków po ordinalach (shrink dokumentu, V1 §6). */
  async deletePoints(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.req(`/collections/${this.collection}/points/delete`, "POST", { points: ids });
  }

  /**
   * Wyszukiwanie z obowiązkowym prefiltrem autoryzacyjnym (V1 §4).
   * `extraFilter` (np. source_id) jest DOKŁADANY do filtra auth, nigdy go nie zastępuje.
   * `scoreThreshold` (V4) przekazywany jako `score_threshold` Qdrant + egzekwowany
   * post-filtrem w `retrieval.ts` (obrona w głąb).
   */
  async searchScoped(
    vector: number[],
    auth: AuthContext,
    opts?: { limit?: number; extraFilter?: QdrantFilter; withPayload?: boolean; scoreThreshold?: number },
  ): Promise<{ result: { id: string; score: number; payload: ChunkPayload }[] }> {
    const must: unknown[] = [buildAuthFilter(auth)];
    if (opts?.extraFilter) must.push(opts.extraFilter);
    return (await this.req(`/collections/${this.collection}/points/search`, "POST", {
      vector,
      limit: opts?.limit ?? 8,
      filter: { must },
      with_payload: opts?.withPayload ?? true,
      ...(opts?.scoreThreshold !== undefined ? { score_threshold: opts.scoreThreshold } : {}),
    })) as { result: { id: string; score: number; payload: ChunkPayload }[] };
  }
}
