/**
 * KOMAA-309 V2 — obsługa modelu embedding.
 *
 * Domyślnie Workers AI (`@cf/baai/bge-m3`, 1024 dims — zgodny z VECTOR_SIZE
 * w schema.ts). Moduł nie trzyma sekretów; wołany z env Workera albo
 * z procesu Node (endpoint OpenAI-kompatybilny jako fallback).
 */

import { EMBEDDING_MODEL, VECTOR_SIZE } from "./schema";

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
