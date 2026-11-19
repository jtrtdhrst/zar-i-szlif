// Read-only Supabase PostgREST access for the `sprawnosci` catalog.
//
// Two deliberate constraints:
//   1. every request carries the *caller's* Supabase Auth access token, so row
//      level security applies exactly as it does for the application;
//   2. the projection is a fixed column list and the only exposed table is
//      `public.sprawnosci` — there is no generic table selector, no raw SQL and
//      no service-role key anywhere in this service.

export const SELECT_COLUMNS = [
  "id",
  "poziom",
  "aspekt",
  "grupa",
  "grupa_label",
  "tytul",
  "wymagania",
  "opis",
  "tagi",
  "zaktualizowano",
].join(",");

export const POZIOMY = ["odkrywcy", "zwiadowcy", "wedrownicy"] as const;
export const ASPEKTY = ["fizyczny", "intelektualny", "duchowy", "spoleczny"] as const;

export type Poziom = (typeof POZIOMY)[number];
export type Aspekt = (typeof ASPEKTY)[number];

export interface SprawnoscItem {
  id: string;
  poziom: string;
  aspekt: string;
  grupa: string;
  grupa_label: string;
  tytul: string;
  wymagania: unknown;
  opis: string | null;
  tagi: string[];
  zaktualizowano: string;
}

export interface ListSprawnosciParams {
  query?: string | undefined;
  poziom?: string | undefined;
  aspekt?: string | undefined;
  grupa?: string | undefined;
  limit: number;
  offset: number;
}

export interface ListSprawnosciResult {
  items: SprawnoscItem[];
  /**
   * Total number of rows matching the filters, parsed from the PostgREST
   * `Content-Range` header (`start-end/total`, or `*` for the range when the
   * page is empty) — never the page length. A missing or unparseable total is
   * an error, not a silent page count.
   */
  count: number;
  limit: number;
  offset: number;
}

export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

export class PostgrestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PostgrestError";
    this.status = status;
  }
}

export class SprawnoscNotFoundError extends Error {
  constructor(message = "sprawnosc not found") {
    super(message);
    this.name = "SprawnoscNotFoundError";
  }
}

/**
 * The list response carried no usable total row count. Callers must see this as
 * a tool error: reporting the page length as `count` would silently break any
 * client that pages through the catalog.
 */
export class CountUnavailableError extends Error {
  constructor(message = "sprawnosci response did not include an exact total row count") {
    super(message);
    this.name = "CountUnavailableError";
  }
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface RepositoryDeps {
  config: SupabaseConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  /** Sent as the PostgREST `Prefer` header, e.g. `count=exact`. */
  prefer?: string;
  /**
   * PostgREST answers an offset past the last row with HTTP 416. With this
   * enabled, a 416 that carries an exact total in `Content-Range` is returned as
   * an empty page; a 416 without a usable total still fails.
   */
  emptyPageOnUnsatisfiableRange?: boolean;
}

export interface SprawnoscRepository {
  list(accessToken: string, params: ListSprawnosciParams): Promise<ListSprawnosciResult>;
  get(accessToken: string, id: string): Promise<SprawnoscItem>;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
// Characters that terminate a PostgREST filter/boolean expression. They are
// removed from free-text search terms because the term is interpolated into an
// `or=(...)` expression.
const EXPRESSION_BREAKERS = /[",()*%\\]/g;
// For equality values the same characters are a hard error instead: silently
// dropping them could widen a filter to a different row set.
const FILTER_BREAKERS = /[",()]/;

/**
 * Normalize a free-text search term before it is interpolated into an
 * `or=(tytul.ilike.*term*,opis.ilike.*term*)` expression.
 */
export function normalizeSearchTerm(raw: string): string {
  const normalized = raw
    .normalize("NFC")
    .replace(CONTROL_CHARS, " ")
    .replace(EXPRESSION_BREAKERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "") {
    throw new InvalidArgumentError("query must contain at least one searchable character");
  }
  return normalized;
}

/**
 * Normalize an equality filter value.
 *
 * PostgREST does **not** strip double quotes from `eq."value"` for a text
 * column — it compares the literal quoted string, so a quoted filter silently
 * matches nothing on a live database. Values are therefore emitted unquoted and
 * URL-encoded by `encodeParams`, and any character that would terminate the
 * filter expression or change its logic fails closed instead of producing a
 * different row set.
 */
export function equalityValue(raw: string, field: string): string {
  const cleaned = raw.normalize("NFC").replace(CONTROL_CHARS, "").trim();
  if (cleaned === "") throw new InvalidArgumentError(`${field} must not be empty`);
  if (FILTER_BREAKERS.test(cleaned)) {
    throw new InvalidArgumentError(`${field} must not contain , ( ) or "`);
  }
  return cleaned;
}

function encodeParams(params: Array<[string, string]>): string {
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

export function listUrl(config: SupabaseConfig, params: ListSprawnosciParams): string {
  const query: Array<[string, string]> = [["select", SELECT_COLUMNS]];

  if (params.query !== undefined && params.query.trim() !== "") {
    const term = normalizeSearchTerm(params.query);
    query.push(["or", `(tytul.ilike.*${term}*,opis.ilike.*${term}*` + ")"]);
  }
  if (params.poziom !== undefined) {
    query.push(["poziom", `eq.${equalityValue(params.poziom, "poziom")}`]);
  }
  if (params.aspekt !== undefined) {
    query.push(["aspekt", `eq.${equalityValue(params.aspekt, "aspekt")}`]);
  }
  if (params.grupa !== undefined) {
    query.push(["grupa", `eq.${equalityValue(params.grupa, "grupa")}`]);
  }

  query.push(["limit", String(params.limit)]);
  query.push(["offset", String(params.offset)]);

  return `${config.url}/rest/v1/sprawnosci?${encodeParams(query)}`;
}

export function getUrl(config: SupabaseConfig, id: string): string {
  const query: Array<[string, string]> = [
    ["select", SELECT_COLUMNS],
    ["id", `eq.${equalityValue(id, "id")}`],
    ["limit", "1"],
  ];
  return `${config.url}/rest/v1/sprawnosci?${encodeParams(query)}`;
}

// PostgREST answers a `Prefer: count=exact` request with the total matching row
// count in `Content-Range`: `0-24/300` for a page, or `*/300` when the range is
// empty (an offset past the end). Only the value after the slash may be handed
// to a client as `count`; `*` there means "unknown" and fails closed below.
const CONTENT_RANGE_TOTAL = /^(?:\d+-\d+|\*)\/(\d+|\*)$/;
// An offset past the last row is answered with HTTP 416 and `Content-Range:
// */<total>`. That is a valid empty page, not a failure — but only when the
// total is really present; anything else on a 416 still fails.
const UNSATISFIABLE_RANGE_TOTAL = /^\*\/(\d+)$/;
export const RANGE_NOT_SATISFIABLE = 416;

function toCount(raw: string | undefined): number | null {
  if (raw === undefined || raw === "*") return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function tryParseTotalCount(contentRange: string | null): number | null {
  const match = contentRange === null ? null : CONTENT_RANGE_TOTAL.exec(contentRange.trim());
  return toCount(match?.[1]);
}

export function parseTotalCount(contentRange: string | null): number {
  const total = tryParseTotalCount(contentRange);
  if (total !== null) return total;
  throw new CountUnavailableError(
    contentRange === null
      ? "sprawnosci response has no Content-Range header, so the total row count is unknown"
      : "sprawnosci response has an unparseable Content-Range total",
  );
}

/**
 * Total carried by a 416 "requested range not satisfiable" response, which
 * PostgREST returns when `offset` is past the last row. Only the `*` start form
 * is accepted here: a 416 without a real total stays an error.
 */
export function parseUnsatisfiableRangeTotal(contentRange: string | null): number | null {
  const match = contentRange === null ? null : UNSATISFIABLE_RANGE_TOTAL.exec(contentRange.trim());
  return toCount(match?.[1]);
}

function asString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new PostgrestError(0, `unexpected ${field} value in sprawnosci response`);
}

export function mapRow(row: unknown): SprawnoscItem {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new PostgrestError(0, "unexpected row shape in sprawnosci response");
  }
  const record = row as Record<string, unknown>;
  const opis = record.opis;
  const tagi = record.tagi;

  return {
    id: asString(record.id, "id"),
    poziom: asString(record.poziom, "poziom"),
    aspekt: asString(record.aspekt, "aspekt"),
    grupa: asString(record.grupa, "grupa"),
    grupa_label: asString(record.grupa_label, "grupa_label"),
    tytul: asString(record.tytul, "tytul"),
    wymagania: record.wymagania ?? null,
    opis: typeof opis === "string" ? opis : null,
    tagi: Array.isArray(tagi) ? tagi.filter((tag): tag is string => typeof tag === "string") : [],
    zaktualizowano: asString(record.zaktualizowano, "zaktualizowano"),
  };
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      const message = (parsed as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim() !== "") {
        return `sprawnosci query failed (${status}): ${message}`;
      }
    }
  } catch {
    // Non-JSON error body (proxy HTML, empty body) — keep a generic message.
  }
  return `sprawnosci query failed (${status})`;
}

export function createSprawnoscRepository(deps: RepositoryDeps): SprawnoscRepository {
  const { config } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  async function request(
    url: string,
    accessToken: string,
    options: RequestOptions = {},
  ): Promise<{ payload: unknown; contentRange: string | null }> {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const contentRange = response.headers.get("content-range");
    const body = await response.text();
    if (!response.ok) {
      // An offset past the last row is not a failure: PostgREST answers 416 and
      // still names the exact total, so it maps to an empty page. The same 416
      // without a usable total keeps its error.
      if (
        options.emptyPageOnUnsatisfiableRange === true &&
        response.status === RANGE_NOT_SATISFIABLE &&
        parseUnsatisfiableRangeTotal(contentRange) !== null
      ) {
        return { payload: [], contentRange };
      }
      throw new PostgrestError(response.status, errorMessage(response.status, body));
    }
    try {
      return { payload: JSON.parse(body), contentRange };
    } catch {
      throw new PostgrestError(response.status, "sprawnosci query returned a non-JSON body");
    }
  }

  return {
    async list(accessToken, params) {
      // `Prefer: count=exact` asks PostgREST for the total matching row count in
      // `Content-Range`; the body still carries only this page.
      const { payload, contentRange } = await request(listUrl(config, params), accessToken, {
        prefer: "count=exact",
        // An offset past the last row is a 416 carrying the total; that is an
        // empty page, not a failed request.
        emptyPageOnUnsatisfiableRange: true,
      });
      if (!Array.isArray(payload)) {
        throw new PostgrestError(0, "sprawnosci query did not return an array");
      }
      const items = payload.map(mapRow);
      return {
        items,
        count: parseTotalCount(contentRange),
        limit: params.limit,
        offset: params.offset,
      };
    },

    async get(accessToken, id) {
      if (typeof id !== "string" || id.trim() === "") {
        throw new InvalidArgumentError("id must be a non-empty string");
      }
      const { payload } = await request(getUrl(config, id), accessToken);
      if (!Array.isArray(payload)) {
        throw new PostgrestError(0, "sprawnosci query did not return an array");
      }
      const row = payload[0];
      if (row === undefined) throw new SprawnoscNotFoundError(`sprawnosc not found: ${id}`);
      return mapRow(row);
    },
  };
}
