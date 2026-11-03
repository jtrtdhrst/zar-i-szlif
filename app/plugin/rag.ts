// Punkty adapterowe RAG. Celowo brak finalnej semantyki retrieval —
// ten moduł definiuje wyłącznie kształt, przez który przyszłe node'y
// podepną prawdziwy silnik (np. Qdrant z app/cloudflare-worker).

export type RagChunk = {
  text: string;
  score: number;
  source: string;
};

export type RagQuery = {
  query: string;
  limit?: number;
};

export type RagAdapter = {
  search: (query: RagQuery) => Promise<RagChunk[]>;
};

// Stub: zawsze pusto, żeby żaden caller nie uzależnił się od wyników.
export function createStubRagAdapter(): RagAdapter {
  return { search: async () => [] };
}
