/**
 * KOMAA-385 — live smoke E2E bazy wiedzy: ingest -> Qdrant -> scoped retrieval
 * -> odpowiedź MCP z atrybucją źródła (+ negatyw wycieku między userami).
 *
 * Logika jest tu, a nie w skrypcie, bo uruchomienie przeciw prawdziwemu
 * Qdrantowi kosztuje jednorazową akcję boardową (sekret). Skrypt ma więc być
 * zweryfikowany ZANIM ktokolwiek zwiąże sekret: `runKnowledgeSmoke` działa
 * na tym samym `QdrantClient`, a test kontraktowy podpina istniejącą
 * emulację REST (`createMemoryFetch`). Każde założenie smoke to `throw`,
 * a nie log — zielony wydruk bez pokrycia hipotezy jest gorszy od wyjątku.
 *
 * Zero sekretów w module: adres i klucz dokłada wywołujący (`scripts/rag-live-smoke.mjs`).
 */

import { TENANT, contentHash, type ChunkPayload } from "./schema.js";
import { syncCorpus, type SourceDocument } from "./pipeline.js";
import { getKnowledgeSource, searchKnowledge, type KnowledgeResult } from "./mcp-tools.js";
import type { QdrantClient } from "./qdrant.js";
import type { EmbedFn } from "./embeddings.js";

const SOURCE_ID = "help-page";
const DOC_ID = "live-smoke";
/** Prywatny chunk cudzego użytkownika — wstawiany wprost, bo V1 allowlista ma tylko źródła globalne. */
const PRIVATE_DOC_ID = "live-smoke-private";
const PRIVATE_POINT_ID = "0badf00d-0000-4000-8000-0000000c0de";
const PRIVATE_TEXT = "notatka prywatna: haslo odzyskania konta dla jednego uzytkownika";
/** Inny podmiot niż właściciel — token drugiego użytkownika, nie klient. */
const ALIEN_SUB = "bearer:live-smoke-alien";

const PUBLIC_TEXT = "Pomoc: logowanie przez Google. Smoke Qdrant live: synchronizacja wiedzy.";
const PUBLIC_QUERY = "logowanie Google pomoc";

function assertLive(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`[rag-live-smoke] FAIL: ${what}`);
}

export interface SmokeReport {
  collection: string;
  upserted: number;
  chunks: number;
  /** Odpowiedź MCP (`search_knowledge`) — dowód atrybucji źródła. */
  topHit: KnowledgeResult | null;
  /** `get_knowledge_source` — chunki dokumentu widoczne dla właściciela. */
  sourceChunks: number;
  privateVisibleToOwner: number;
  /** Musi być 0: prywatny cudzego chunk nie wraca w odpowiedzi MCP. */
  privateVisibleToAlien: number;
  cleanedUp: boolean;
}

/**
 * Pełna ścieżka DoD wobec dowolnego Qdranta (prawdziwy lub emulowany).
 * Zawsze sprząta po sobie: smoke nie zostawia danych w kolekcji.
 */
export async function runKnowledgeSmoke(
  client: QdrantClient,
  embed: EmbedFn,
  ownerSub: string,
): Promise<SmokeReport> {
  assertLive(ownerSub, "brak tożsamości właściciela (ownerSub) — token nie został rozpoznany");
  await client.ensureCollection();

  const owner = { googleSub: ownerSub, workspaceIds: [] };
  const alien = { googleSub: ALIEN_SUB, workspaceIds: [] };

  // 1. Ingest przez produkcyjny pipeline (allowlista + denylist + chunk + embed + upsert).
  const docs: SourceDocument[] = [{ sourceId: SOURCE_ID, documentId: DOC_ID, rawText: PUBLIC_TEXT, sourceVersion: "smoke" }];
  const sync = (await syncCorpus(client, embed, docs, new Map()))[0];
  assertLive(sync && sync.upserted > 0, `ingest nie zapisał chunków (${JSON.stringify(sync)})`);

  // 2. Odpowiedź MCP z atrybucją źródła (nie wewnętrzne retrieve()).
  const hits = await searchKnowledge(client, embed, owner, { query: PUBLIC_QUERY, minScore: 0 });
  const topHit = hits.find((h) => h.document_id === DOC_ID) ?? null;
  assertLive(topHit, `search_knowledge nie zwrócił smoke dokumentu (${JSON.stringify(hits)})`);
  assertLive(
    Boolean(topHit.source_id && topHit.chunk_id && topHit.text.length > 0),
    `odpowiedź MCP bez atrybucji: ${JSON.stringify(topHit)}`,
  );

  const source = await getKnowledgeSource(client, owner, { source_id: SOURCE_ID, document_id: DOC_ID });
  assertLive(source.chunks.length > 0, "get_knowledge_source nie zwrócił chunków");

  // 3. Negatyw wycieku na prawdziwym silniku: filtr scope w Qdrant, nie tylko post-filtr w JS.
  //    Punkt `user`-scoped nie przechodzi allowlistą V1 (wszystkie źródła są globalne),
  //    więc wstawiamy go wprost — to test filtra, nie testu pipeline'u.
  const [vector] = await embed([PRIVATE_TEXT]);
  const privatePoint = {
    id: PRIVATE_POINT_ID,
    vector,
    payload: {
      source_id: SOURCE_ID,
      document_id: PRIVATE_DOC_ID,
      chunk_id: `${PRIVATE_DOC_ID}#0`,
      tenant: TENANT,
      user_id: ownerSub,
      workspace_id: null,
      visibility: "user",
      content_type: "help",
      content_hash: await contentHash(PRIVATE_TEXT),
      source_version: "smoke",
      updated_at: new Date().toISOString(),
      text: PRIVATE_TEXT,
    } satisfies ChunkPayload,
  };
  await client.upsertPoints([privatePoint]);

  const ownerSees = await searchKnowledge(client, embed, owner, { query: PRIVATE_TEXT, minScore: 0 });
  const ownedByOwner = ownerSees.filter((h) => h.text.includes(PRIVATE_TEXT));
  assertLive(ownedByOwner.length > 0, "wlasciciel nie widzi wlasnego chunka — filtr scope popsujony");
  // Liczymy trafienie w TĘ treść, nie długość listy: przy progu 0 obcy token i tak
  // dostaje globalny dokument o score 0, co nie jest wyciekiem.
  const alienSees = await searchKnowledge(client, embed, alien, { query: PRIVATE_TEXT, minScore: 0 });
  const leaked = alienSees.filter((h) => h.text.includes(PRIVATE_TEXT));
  assertLive(leaked.length === 0, `wyciek: obcy uzytkownik widzi prywatny chunk (${JSON.stringify(leaked)})`);

  // 4. Sprzątanie — smoke nie zostawia śmieci w kolekcji produkcyjnej.
  await client.deleteDocument(SOURCE_ID, DOC_ID);
  await client.deletePoints([PRIVATE_POINT_ID]);
  const afterDelete = await searchKnowledge(client, embed, owner, { query: PUBLIC_QUERY, minScore: 0 });
  const gonePrivate = await searchKnowledge(client, embed, owner, { query: PRIVATE_TEXT, minScore: 0 });
  assertLive(!afterDelete.some((h) => h.document_id === DOC_ID), "po delete dokument nadal wraca");
  assertLive(!gonePrivate.some((h) => h.text.includes(PRIVATE_TEXT)), "po delete prywatny chunk nadal wraca");

  return {
    collection: client.collection,
    upserted: sync.upserted,
    chunks: sync.chunks,
    topHit,
    sourceChunks: source.chunks.length,
    privateVisibleToOwner: ownedByOwner.length,
    privateVisibleToAlien: leaked.length,
    cleanedUp: true,
  };
}
