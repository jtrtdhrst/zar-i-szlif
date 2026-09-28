// In-memory emulacja REST Qdrant dla testów/offline (ten sam `fetchFn`
// kontrakt co `QdrantClient` — logika klienta bez zmian). Prod (QDRANT_URL)
// używa prawdziwego Qdrant; ten moduł nigdy nie widzi sekretów.
//
// ponytail: brute-force cosine + filtr w JS; HNSW/indeksy niepotrzebne
// przy rozmiarze korpusu pomocy (setki chunków). Upgrade: prawdziwy Qdrant.

import type { ChunkPayload } from "./schema.js";

type Stored = { vector: number[]; payload: ChunkPayload };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Fail-closed: nieznany kształt warunku = brak dopasowania.
function matches(payload: Record<string, unknown>, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return false;
  const c = cond as Record<string, unknown>;
  if (typeof c.key === "string" && c.match && typeof c.match === "object") {
    return payload[c.key] === (c.match as Record<string, unknown>).value;
  }
  if (Array.isArray(c.must)) return c.must.every((s) => matches(payload, s));
  if (Array.isArray(c.should)) {
    const minRaw = c.min_should as { conditions?: number } | number | undefined;
    const min = typeof minRaw === "number" ? minRaw : (minRaw?.conditions ?? 1);
    return c.should.filter((s) => matches(payload, s)).length >= min;
  }
  return false;
}

function filterPoints(points: Map<string, Stored>, filter: unknown): [string, Stored][] {
  const must = (filter as { must?: unknown[] } | undefined)?.must;
  const conds = Array.isArray(must) ? must : filter === undefined ? [] : null;
  if (conds === null) return [];
  return [...points].filter(([, p]) => conds.every((c) => matches(p.payload as unknown as Record<string, unknown>, c)));
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "ok" };
}

export function createMemoryFetch(): typeof fetch {
  const points = new Map<string, Stored>();
  return (async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (method === "PUT" && /\/collections\/[^/]+$/.test(u)) return ok({ status: "ok" });
    if (method === "PUT" && u.endsWith("/index")) return ok({ status: "ok" });
    if (method === "PUT" && u.endsWith("/points")) {
      for (const p of (body.points as { id: string; vector: number[]; payload: ChunkPayload }[])) {
        points.set(p.id, { vector: p.vector, payload: p.payload });
      }
      return ok({ status: "ok" });
    }
    if (method === "POST" && u.endsWith("/points/delete")) {
      if (Array.isArray(body.points)) {
        for (const id of body.points as string[]) points.delete(id);
      } else {
        for (const [id] of filterPoints(points, body.filter)) points.delete(id);
      }
      return ok({ status: "ok" });
    }
    if (method === "POST" && u.endsWith("/points/search")) {
      const vector = body.vector as number[];
      const threshold = typeof body.score_threshold === "number" ? body.score_threshold : -Infinity;
      const result = filterPoints(points, body.filter)
        .map(([id, p]) => ({ id, score: cosine(vector, p.vector), payload: p.payload }))
        .filter((h) => h.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, (body.limit as number) ?? 8);
      return ok({ result });
    }
    if (method === "POST" && u.endsWith("/points/scroll")) {
      const result = filterPoints(points, body.filter)
        .slice(0, (body.limit as number) ?? 20)
        .map(([id, p]) => ({ id, payload: p.payload }));
      return ok({ result });
    }
    return { ok: false, status: 404, json: async () => ({ error: "unknown" }), text: async () => "unknown" };
  }) as unknown as typeof fetch;
}
