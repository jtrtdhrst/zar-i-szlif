// PostgREST stub. Records every outbound request so tests can assert the exact
// query the service issues without any live Supabase project.

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface StubReply {
  status?: number;
  body: unknown;
  /** Extra response headers, e.g. `content-range` from a `count=exact` request. */
  headers?: Record<string, string>;
}

export type StubHandler = (url: string, init: RequestInit) => StubReply | Promise<StubReply>;

export interface FetchStub {
  calls: RecordedCall[];
  fetchImpl: typeof fetch;
}

export function createFetchStub(handler: StubHandler): FetchStub {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    const reply = await handler(url, requestInit);
    const status = reply.status ?? 200;
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export function sampleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    poziom: "odkrywcy",
    aspekt: "fizyczny",
    grupa: "ognisko",
    grupa_label: "Ognisko",
    tytul: "Rozpalanie ognia",
    wymagania: ["krzesiwo", "suchy chrust"],
    opis: "Ognisko — Rozpalanie ognia",
    tagi: ["fizyczny", "ognisko"],
    zaktualizowano: "2026-11-12T10:00:00+00:00",
    ...overrides,
  };
}
