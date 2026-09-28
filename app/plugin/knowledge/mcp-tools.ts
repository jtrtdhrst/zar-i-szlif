/**
 * KOMAA-312 V5 — bezpieczny interfejs MCP do bazy wiedzy (kontrakt V1 KOMAA-308 §4–§5).
 *
 * - `search_knowledge`: semantic search; `get_knowledge_source`: chunki dokumentu.
 * - Auth/context (googleSub z tokenu MCP → AuthContext) rozstrzygany PRZED
 *   query do Qdrant; brak userId = odrzucenie (fail-closed).
 * - Klient NIE może przekazać tenant/workspace/user filter — takie klucze
 *   w argumentach = błąd (uniemożliwia obejście izolacji scope).
 * - Wynik: treść + score + źródło/metadata w minimalnym zakresie.
 * - `knowledge_status` pominięte: status kolekcji to operacyjny odczyt
 *   infrastruktury, nie wiedza użytkownika; nie jest potrzebne do DONE.
 */

import { TENANT, type AuthContext, type ChunkPayload } from "./schema.js";
import { ALLOWED_SOURCES } from "./pipeline.js";
import { RETRIEVAL_DEFAULT_MIN_SCORE, RETRIEVAL_DEFAULT_TOP_K, RETRIEVAL_MAX_TOP_K, retrieve } from "./retrieval.js";
import type { QdrantClient } from "./qdrant.js";
import type { EmbedFn } from "./embeddings.js";

/** Minimalny kształt props tokenu MCP (ctx.props z OAuth Workera). */
export interface TokenProps {
  googleSub?: unknown;
  workspaceIds?: unknown;
}

/** Auth wywiedziona WYŁĄCZNIE z tokenu — nigdy z argumentów klienta. */
export function resolveAuth(props: TokenProps | null | undefined): AuthContext {
  const userId = typeof props?.googleSub === "string" ? props.googleSub : "";
  if (!userId) throw new Error("Brak autoryzacji: token MCP bez tożsamości użytkownika (fail-closed).");
  const raw = Array.isArray(props?.workspaceIds) ? (props.workspaceIds as unknown[]) : [];
  return { userId, workspaceIds: raw.filter((w): w is string => typeof w === "string" && w.length > 0) };
}

/** Klucze scope, których klient nie może narzucać (izolacja scope z tokenu). */
const FORBIDDEN_CLIENT_KEYS = ["tenant", "userId", "user_id", "workspaceIds", "workspace_id", "workspaces"];

function assertNoClientScope(args: Record<string, unknown>): void {
  for (const key of FORBIDDEN_CLIENT_KEYS) {
    if (args[key] !== undefined) {
      throw new Error(`Parametr "${key}" jest niedozwolony: zakres wynika z tokenu użytkownika.`);
    }
  }
}

export const SEARCH_QUERY_MAX_CHARS = 500;
export const SOURCE_MAX_LIMIT = 50;

export interface SearchArgs {
  query: string;
  topK: number;
  minScore: number;
  sourceIds?: string[];
}

export function validateSearchArgs(raw: unknown): SearchArgs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Argumenty muszą być obiektem.");
  const args = raw as Record<string, unknown>;
  assertNoClientScope(args);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error(`Parametr "query" jest wymagany (niepusty tekst).`);
  if (query.length > SEARCH_QUERY_MAX_CHARS) {
    throw new Error(`Parametr "query" jest za długi (max ${SEARCH_QUERY_MAX_CHARS} znaków).`);
  }
  const topK = args.topK ?? RETRIEVAL_DEFAULT_TOP_K;
  if (!Number.isInteger(topK) || (topK as number) < 1 || (topK as number) > RETRIEVAL_MAX_TOP_K) {
    throw new Error(`Parametr "topK" musi być liczbą całkowitą 1..${RETRIEVAL_MAX_TOP_K}.`);
  }
  const minScore = args.minScore ?? RETRIEVAL_DEFAULT_MIN_SCORE;
  if (typeof minScore !== "number" || !(minScore >= 0 && minScore <= 1)) {
    throw new Error(`Parametr "minScore" musi być liczbą 0..1.`);
  }
  let sourceIds: string[] | undefined;
  if (args.sourceIds !== undefined) {
    if (!Array.isArray(args.sourceIds) || args.sourceIds.length === 0) {
      throw new Error(`Parametr "sourceIds" musi być niepustą listą identyfikatorów źródeł.`);
    }
    for (const id of args.sourceIds) {
      if (typeof id !== "string" || !ALLOWED_SOURCES[id]) {
        throw new Error(`Źródło niedozwolone (allowlista V1): ${String(id)}.`);
      }
    }
    sourceIds = args.sourceIds as string[];
  }
  return { query, topK: topK as number, minScore, sourceIds };
}

export interface KnowledgeResult {
  text: string;
  score: number;
  source_id: string;
  document_id: string;
  chunk_id: string;
  content_type: ChunkPayload["content_type"];
  source_version: string;
  updated_at: string;
  visibility: ChunkPayload["visibility"];
}

/** MCP `search_knowledge`: auth z tokenu → walidacja → retrieve() ze scope. */
export async function searchKnowledge(
  client: QdrantClient,
  embed: EmbedFn,
  props: TokenProps | null | undefined,
  rawArgs: unknown,
): Promise<KnowledgeResult[]> {
  const auth = resolveAuth(props);
  const { query, topK, minScore, sourceIds } = validateSearchArgs(rawArgs);
  const hits = await retrieve(client, embed, query, auth, { topK, minScore, sourceIds });
  return hits.map((h) => ({
    text: h.text,
    score: h.score,
    source_id: h.source_id,
    document_id: h.document_id,
    chunk_id: h.chunk_id,
    content_type: h.content_type,
    source_version: h.source_version,
    updated_at: h.updated_at,
    visibility: h.visibility,
  }));
}

export interface SourceArgs {
  source_id: string;
  document_id: string;
  limit: number;
}

export function validateSourceArgs(raw: unknown): SourceArgs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Argumenty muszą być obiektem.");
  const args = raw as Record<string, unknown>;
  assertNoClientScope(args);
  const source_id = typeof args.source_id === "string" ? args.source_id : "";
  if (!source_id) throw new Error(`Parametr "source_id" jest wymagany.`);
  if (!ALLOWED_SOURCES[source_id]) throw new Error(`Źródło niedozwolone (allowlista V1): ${source_id}.`);
  const document_id = typeof args.document_id === "string" ? args.document_id.trim() : "";
  if (!document_id) throw new Error(`Parametr "document_id" jest wymagany (niepusty tekst).`);
  if (document_id.length > 256) throw new Error(`Parametr "document_id" jest za długi (max 256 znaków).`);
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > SOURCE_MAX_LIMIT) {
    throw new Error(`Parametr "limit" musi być liczbą całkowitą 1..${SOURCE_MAX_LIMIT}.`);
  }
  return { source_id, document_id, limit: limit as number };
}

export interface SourceChunk {
  chunk_id: string;
  text: string;
  content_type: ChunkPayload["content_type"];
  source_version: string;
  updated_at: string;
  visibility: ChunkPayload["visibility"];
}

function chunkVisible(payload: ChunkPayload, auth: AuthContext): boolean {
  if (payload.tenant !== TENANT) return false;
  if (!ALLOWED_SOURCES[payload.source_id]) return false;
  if (payload.visibility === "global") return true;
  if (payload.visibility === "user") return payload.user_id === auth.userId;
  if (payload.visibility === "workspace") {
    return !!payload.workspace_id && auth.workspaceIds.includes(payload.workspace_id);
  }
  return false;
}

/** MCP `get_knowledge_source`: chunki dokumentu widoczne dla użytkownika z tokenu. */
export async function getKnowledgeSource(
  client: QdrantClient,
  props: TokenProps | null | undefined,
  rawArgs: unknown,
): Promise<{ source_id: string; document_id: string; chunks: SourceChunk[] }> {
  const auth = resolveAuth(props);
  const { source_id, document_id, limit } = validateSourceArgs(rawArgs);
  const res = await client.scrollScoped(auth, {
    limit,
    extraFilter: {
      must: [
        { key: "source_id", match: { value: source_id } },
        { key: "document_id", match: { value: document_id } },
      ],
    },
  });
  const chunks = (res.result ?? [])
    .filter((hit) => hit.payload && chunkVisible(hit.payload, auth))
    .slice(0, limit)
    .map((hit) => ({
      chunk_id: hit.payload.chunk_id,
      text: hit.payload.text ?? "",
      content_type: hit.payload.content_type,
      source_version: hit.payload.source_version,
      updated_at: hit.payload.updated_at,
      visibility: hit.payload.visibility,
    }));
  return { source_id, document_id, chunks };
}

export const SEARCH_KNOWLEDGE_TOOL = {
  name: "search_knowledge",
  title: "Przeszukaj bazę wiedzy",
  description:
    "Przeszukuje bazę wiedzy (pomoc, maile onboardingowe, wymagania sprawności, treści marketingowe, dokumenty prawne). Zakres wynika z zalogowanego użytkownika.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Pytanie w języku naturalnym (max 500 znaków).", maxLength: 500 },
      topK: { type: "integer", description: "Liczba wyników (1–20, domyślnie 8).", minimum: 1, maximum: 20 },
      minScore: { type: "number", description: "Minimalne podobieństwo 0–1 (domyślnie 0.35).", minimum: 0, maximum: 1 },
      sourceIds: {
        type: "array",
        items: { type: "string" },
        description: "Opcjonalne zawężenie do źródeł (podzbiór allowlisty).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
};

export const GET_KNOWLEDGE_SOURCE_TOOL = {
  name: "get_knowledge_source",
  title: "Pobierz źródło wiedzy",
  description: "Zwraca chunki dokumentu ze źródła wiedzy widoczne dla zalogowanego użytkownika.",
  inputSchema: {
    type: "object",
    properties: {
      source_id: { type: "string", description: "Identyfikator źródła (np. help-page, legal)." },
      document_id: { type: "string", description: "Identyfikator dokumentu w źródle.", maxLength: 256 },
      limit: { type: "integer", description: "Liczba chunków (1–50, domyślnie 20).", minimum: 1, maximum: 50 },
    },
    required: ["source_id", "document_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
};

export const KNOWLEDGE_TOOLS = [SEARCH_KNOWLEDGE_TOOL, GET_KNOWLEDGE_SOURCE_TOOL];
