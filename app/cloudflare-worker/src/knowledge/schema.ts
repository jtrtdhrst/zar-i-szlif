/**
 * KOMAA-309 V2 — schema kolekcji wiedzy użytkowej (kontrakt V1 KOMAA-308 §5–§6).
 *
 * Jedna kolekcja `kompas-knowledge-v1`. Zmiana schema lub modelu embedding
 * = nowa kolekcja + alias-swap, nigdy mutacja w miejscu.
 *
 * Model embedding: `@cf/baai/bge-m3` (1024 dims, Cosine) — wielojęzyczny
 * (treści PL), natywny dla Workers AI, czyli istniejącego runtime
 * (`kompas-ui-plugin/cloudflare-worker`). Bez nowych zależności:
 * klient Qdrant to czysty `fetch` (REST), hash to `crypto.subtle`.
 *
 * Env:
 * - QDRANT_URL — bazowy URL Qdrant (bez końcowego `/`)
 * - QDRANT_API_KEY — klucz API (opcjonalny lokalnie)
 * - EMBEDDING_MODEL — nadpisanie modelu (domyślnie EMBEDDING_MODEL poniżej)
 */

export const COLLECTION_NAME = "kompas-knowledge-v1";
export const TENANT = "kompas-zbiorek";

/** Workers AI model id; wymiary muszą zgadzać się z `vectors.size` kolekcji. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const VECTOR_SIZE = 1024;
export const VECTOR_DISTANCE = "Cosine" as const;

export type Visibility = "global" | "workspace" | "user";

export type ContentType =
  | "rr-requirement"
  | "user-plan"
  | "user-reflection"
  | "marketing"
  | "onboarding-email"
  | "help"
  | "legal"
  | "runtime-doc";

/** Obowiązkowy payload każdego punktu (V1 §5). */
export interface ChunkPayload {
  source_id: string;
  document_id: string;
  chunk_id: string;
  tenant: string;
  user_id: string | null;
  workspace_id: string | null;
  visibility: Visibility;
  content_type: ContentType;
  content_hash: string;
  source_version: string;
  updated_at: string;
  /** Znormalizowany tekst chunka (V4: retrieval zwraca trafny kontekst; opcjonalne dla punktów V2/V3). */
  text?: string;
}

/** Pola z obowiązkowym payload-indexem (V1 §5). */
export const REQUIRED_PAYLOAD_INDEXES = [
  "tenant",
  "visibility",
  "user_id",
  "workspace_id",
  "source_id",
  "document_id",
  "content_hash",
] as const;

/** Tożsamość wywołującego wywiedziona ze zweryfikowanego tokenu (V1 §4). */
export interface AuthContext {
  /** googleSub z tokenu; brak = zapytanie odrzucane (fail-closed). */
  userId: string;
  /** team_id z sesji/payloadu tokenu. */
  workspaceIds: string[];
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 znormalizowanego tekstu chunka (dedup + wykrywanie zmian, V1 §6). */
export function contentHash(text: string): Promise<string> {
  return sha256Hex(normalizeText(text));
}

/**
 * Determinystyczny id chunka: sha256(document_id + "#" + ordinal)[:32] (V1 §5).
 * Ordinal = stabilna pozycja chunka w dokumencie.
 */
export async function chunkId(documentId: string, ordinal: number): Promise<string> {
  return (await sha256Hex(`${documentId}#${ordinal}`)).slice(0, 32);
}

/**
 * Id punktu Qdrant jako UUID wywiedzione z chunk_id (Qdrant akceptuje
 * uint/UUID — 32 znaki hex bez myślników nie są poprawnym UUID).
 */
export async function pointId(documentId: string, ordinal: number): Promise<string> {
  const hex = await chunkId(documentId, ordinal);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Klucz idempotencji zapisu (V1 §6). */
export function writeKey(sourceId: string, documentId: string, ordinal: number, hash: string): string {
  return `${sourceId}\n${documentId}\n${ordinal}\n${hash}`;
}

/**
 * Walidacja fail-closed: chunk bez kompletnego payloadu nie trafia do kolekcji.
 * Zwraca listę błędów (pusta = payload poprawny). Sprawdza też spójność
 * visibility ↔ user_id/workspace_id wg reguł V1 §4.
 */
export function validatePayload(p: Partial<ChunkPayload>): string[] {
  const errors: string[] = [];
  const required: (keyof ChunkPayload)[] = [
    "source_id",
    "document_id",
    "chunk_id",
    "tenant",
    "visibility",
    "content_type",
    "content_hash",
    "source_version",
    "updated_at",
  ];
  for (const key of required) {
    if (p[key] === undefined || p[key] === null || p[key] === "") errors.push(`missing ${key}`);
  }
  if (p.tenant !== undefined && p.tenant !== TENANT) errors.push(`tenant must be ${JSON.stringify(TENANT)}`);
  if (p.visibility === "user" && !p.user_id) errors.push("visibility=user requires user_id");
  if (p.visibility === "workspace" && !p.workspace_id) errors.push("visibility=workspace requires workspace_id");
  if (p.visibility === "global" && (p.user_id ?? p.workspace_id)) {
    errors.push("visibility=global must not carry user_id/workspace_id");
  }
  if (p.updated_at && Number.isNaN(Date.parse(p.updated_at))) errors.push("updated_at must be RFC3339");
  return errors;
}

/** Minimalny filtr Qdrant (format REST API). */
export type QdrantFilter = Record<string, unknown>;

/**
 * Prefilter autoryzacyjny liczony W silniku wektorowym, przed retrieval
 * (V1 §4 — nigdy samo post-filtrowanie). Zawsze zawiera `tenant` oraz
 * regułę widoczności: global ∨ własny user ∨ własny workspace.
 * Brak dopasowania = chunk niewidzialny (też dla agregacji).
 */
export function buildAuthFilter(auth: AuthContext): QdrantFilter {
  if (!auth.userId) throw new Error("auth required: userId missing (fail-closed)");
  const should: QdrantFilter[] = [
    { key: "visibility", match: { value: "global" } },
    { key: "user_id", match: { value: auth.userId } },
  ];
  for (const workspaceId of auth.workspaceIds) {
    should.push({
      must: [{ key: "visibility", match: { value: "workspace" } }, { key: "workspace_id", match: { value: workspaceId } }],
    });
  }
  return {
    must: [{ key: "tenant", match: { value: TENANT } }, { should, min_should: { conditions: 1 } }],
  };
}

/** Body tworzenia kolekcji (PUT /collections/{name}) — deterministyczne, testowane. */
export function collectionCreateBody(): Record<string, unknown> {
  return {
    vectors: { size: VECTOR_SIZE, distance: VECTOR_DISTANCE, on_disk: true },
    hnsw_config: { m: 16, ef_construct: 100 },
    optimizers_config: { default_segment_number: 2 },
  };
}

/** Definicje payload-indexów do założenia po utworzeniu kolekcji. */
export function payloadIndexBodies(): { field: string; body: Record<string, unknown> }[] {
  return REQUIRED_PAYLOAD_INDEXES.map((field) => ({
    field,
    body: { field_name: field, field_schema: "keyword" },
  }));
}
