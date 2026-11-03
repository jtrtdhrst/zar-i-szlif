/**
 * KOMAA-309 V2 — obsługa modelu embedding.
 *
 * Domyślnie Workers AI (`@cf/baai/bge-m3`, 1024 dims — zgodny z VECTOR_SIZE
 * w schema.ts). Moduł nie trzyma sekretów; wołany z env Workera albo
 * z procesu Node (endpoint OpenAI-kompatybilny jako fallback).
 */

import { EMBEDDING_MODEL, VECTOR_SIZE, normalizeText } from "./schema.js";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** Minimalny kształt bindowania Workers AI potrzebny do embeddingów. */
interface WorkersAiBinding {
  run(model: string, input: { text: string[] }): Promise<{ data: number[][] } | { shape: number[]; data: number[][] }>;
}

/**
 * Embedding przez Workers AI (`env.AI`). Rzuca czytelny błąd, gdy wymiary
 * nie zgadzają się z kolekcją — rozjazd model↔kolekcja wymaga alias-swap
 * na nową kolekcję (V1 §6), nie cichej kontynuacji.
 */
export function workersAiEmbed(ai: WorkersAiBinding, model = EMBEDDING_MODEL): EmbedFn {
  return async (texts: string[]) => {
    const out = await ai.run(model, { text: texts });
    const vectors = "data" in out ? out.data : [];
    for (const v of vectors) {
      if (v.length !== VECTOR_SIZE) {
        throw new Error(`embedding dim mismatch: got ${v.length}, collection expects ${VECTOR_SIZE} (${model})`);
      }
    }
    return vectors;
  };
}

/** FNV-1a 32-bit (deterministyczny, bez zależności). */
function fnv1a(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Deterministyczny fallback dla Node/offline (testy, dev bez bindingu AI).
 * Wektor workowy: słowa → kubek `fnv1a % VECTOR_SIZE`, normalizacja L2 —
 * cosine mierzy współdzielone słownictwo (wystarcza dla korpusu pomocy PL).
 * Prod: Workers AI (bge-m3) przez `workersAiEmbed`.
 *
 * ponytail: heurystyka leksykalna, nie semantyka; upgrade = prawdziwy
 * model gdy Qdrant dostanie wektory bge-m3 (osobna kolekcja, alias-swap).
 */
export function deterministicEmbed(): EmbedFn {
  return async (texts: string[]) =>
    texts.map((t) => {
      const vec = new Array(VECTOR_SIZE).fill(0);
      for (const w of normalizeText(t).toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/u).filter(Boolean)) {
        vec[fnv1a(w) % VECTOR_SIZE] += 1;
      }
      const norm = Math.sqrt(vec.reduce((s: number, x: number) => s + x * x, 0));
      return norm === 0 ? vec : vec.map((x: number) => x / norm);
    });
}
