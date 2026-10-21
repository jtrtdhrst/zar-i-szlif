/**
 * Calendar D (KOMAA-1278) — bezpieczny kontrakt aktywności dla produktowego MCP.
 *
 * Zakres: wycinek TARGET-owego kontraktu (`wiki/concepts/product-mcp-tool-catalog-proposal.md`,
 * pozycje 8–10: `list_activities`, `get_activity`, `manage_activity`) ograniczony do
 * nagłówka aktywności (tytuł, data, czas) oraz statusu synchronizacji kalendarza.
 * Pełna karta (zadania, materiały, raporty, sprawności RR) pozostaje TARGET-em
 * P0/P4 i NIE jest tutaj udawana.
 *
 * Zasady nieodnegocjowalne:
 * - Jedno źródło prawdy: aktywność żyje w Supabase/Postgres (SSOT aplikacji).
 *   MCP nie tworzy własnych rekordów wydarzeń i nie dotyka Google Calendar API —
 *   propagację do połączonego kalendarza robi backend (outbox).
 * - Kanoniczny `activity_id` to id aplikacji; MCP je echa, nigdy nie mintuje.
 * - Google OAuth, access/refresh token, identyfikator zdarzenia Google i dane
 *   prywatne kalendarza nie wchodzą ani do wejścia, ani do wyjścia narzędzi.
 * - Pola PII (dzieci, uczestnicy, notatki, raporty) są w DTO pomijane.
 */

/** Klucze, których klient nie może narzucać: zakres wynika z tokenu, nie z argumentów. */
const FORBIDDEN_CLIENT_KEYS = [
  "tenant",
  "userId",
  "user_id",
  "team_id",
  "teamId",
  "workspace",
  "workspace_id",
  "workspaceIds",
  "email",
  "google_sub",
  "googleSub",
];

/** Dozwolone pola nagłówkowe do mutacji przez MCP (wycinek calendar-D). */
export const MANAGE_ACTIVITY_FIELDS = ["title", "date", "start_at", "end_at", "timezone"] as const;
export type ManageActivityField = (typeof MANAGE_ACTIVITY_FIELDS)[number];

/** Jedyna dozwolona akcja w wycinku calendar-D: aktualizacja nagłówka aktywności. */
export const MANAGE_ACTIVITY_ACTIONS = ["update"] as const;

/** Dozwolone wartości statusu synchronizacji kalendarza (bez komunikatów backendu). */
const CALENDAR_SYNC_STATUSES = ["not_connected", "pending", "synced", "error", "disabled"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE_RE = /^[A-Za-z0-9_+-]{1,64}$/;

export interface ActivityDto {
  activity_id: string;
  team_id: string | null;
  title: string;
  type: string | null;
  status: string | null;
  date: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  location: string | null;
  calendar_sync_status: string | null;
  updated_at: string | null;
  version: number | null;
}

export interface ListActivitiesArgs {
  date_from?: string;
  date_to?: string;
  status?: string;
  type?: string;
  limit?: number;
  cursor?: string;
}

export interface GetActivityArgs {
  activity_id: string;
}

export interface ManageActivityArgs {
  action: (typeof MANAGE_ACTIVITY_ACTIONS)[number];
  activity_id: string;
  fields: Partial<Record<ManageActivityField, string>>;
  expected_version?: number;
  idempotency_key?: string;
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Argumenty muszą być obiektem.");
  }
  return raw as Record<string, unknown>;
}

function asText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function asInstant(raw: unknown): string | null {
  const text = asText(raw, 40);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function asDate(raw: unknown): string | null {
  const text = asText(raw, 10);
  if (!text || !DATE_RE.test(text)) return null;
  return text;
}

function asVersion(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function assertNoClientScope(args: Record<string, unknown>): void {
  for (const key of FORBIDDEN_CLIENT_KEYS) {
    if (args[key] !== undefined) {
      throw new Error(`Parametr "${key}" jest niedozwolony: zakres wynika z tokenu użytkownika.`);
    }
  }
}

/**
 * Bezpieczna projekcja rekordu aktywności z backendu na DTO MCP.
 * Nieznane pola (PII, dane Google, notatki) są pomijane — DTO budujemy jawnie,
 * nigdy przez rozpakowywanie obiektu wejściowego.
 */
export function toActivityDto(row: unknown): ActivityDto {
  const raw = asRecord(row);
  const id = asText(raw.activity_id ?? raw.id, 128);
  if (!id) throw new Error("Rekord aktywności bez kanonicznego activity_id.");
  const syncStatus = asText(raw.calendar_sync_status, 32);
  return {
    activity_id: id,
    team_id: asText(raw.team_id, 128),
    title: asText(raw.title, 200) ?? "",
    type: asText(raw.type, 64),
    status: asText(raw.status, 64),
    date: asDate(raw.date),
    start_at: asInstant(raw.start_at),
    end_at: asInstant(raw.end_at),
    timezone: asText(raw.timezone, 64),
    location: asText(raw.location, 200),
    calendar_sync_status: syncStatus && CALENDAR_SYNC_STATUSES.includes(syncStatus) ? syncStatus : null,
    updated_at: asInstant(raw.updated_at),
    version: asVersion(raw.version),
  };
}

export function parseListActivitiesArgs(raw: unknown): ListActivitiesArgs {
  const args = asRecord(raw);
  assertNoClientScope(args);
  const limit = args.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
    throw new Error("Parametr \"limit\" musi być liczbą całkowitą 1..100.");
  }
  const dateFrom = asDate(args.date_from);
  const dateTo = asDate(args.date_to);
  if (args.date_from !== undefined && !dateFrom) {
    throw new Error("Parametr \"date_from\" musi być datą YYYY-MM-DD.");
  }
  if (args.date_to !== undefined && !dateTo) {
    throw new Error("Parametr \"date_to\" musi być datą YYYY-MM-DD.");
  }
  const result: ListActivitiesArgs = {};
  if (dateFrom) result.date_from = dateFrom;
  if (dateTo) result.date_to = dateTo;
  const status = asText(args.status, 64);
  if (status) result.status = status;
  const type = asText(args.type, 64);
  if (type) result.type = type;
  if (limit !== undefined) result.limit = limit as number;
  const cursor = asText(args.cursor, 256);
  if (cursor) result.cursor = cursor;
  return result;
}

export function parseGetActivityArgs(raw: unknown): GetActivityArgs {
  const args = asRecord(raw);
  assertNoClientScope(args);
  const activityId = asText(args.activity_id, 128);
  if (!activityId) throw new Error("Parametr \"activity_id\" jest wymagany.");
  return { activity_id: activityId };
}

/**
 * Walidacja mutacji nagłówka aktywności. Dozwolone są wyłącznie pola
 * nagłówkowe (tytuł/data/czas); wszystko inne — w szczególności identyfikatory
 * zdarzeń Google, tokeny, zespół i uczestnicy — jest odrzucane.
 */
export function parseManageActivityArgs(raw: unknown): ManageActivityArgs {
  const args = asRecord(raw);
  assertNoClientScope(args);
  const action = asText(args.action, 32);
  if (!action || !(MANAGE_ACTIVITY_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`Parametr "action" musi być jedną z wartości: ${MANAGE_ACTIVITY_ACTIONS.join(", ")}.`);
  }
  const activityId = asText(args.activity_id, 128);
  if (!activityId) throw new Error("Parametr \"activity_id\" jest wymagany.");
  const fieldsRaw = asRecord(args.fields);
  for (const key of Object.keys(fieldsRaw)) {
    if (!(MANAGE_ACTIVITY_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Pole "${key}" nie jest modyfikowalne przez MCP (dozwolone: ${MANAGE_ACTIVITY_FIELDS.join(", ")}).`);
    }
  }
  const fields: Partial<Record<ManageActivityField, string>> = {};
  const title = asText(fieldsRaw.title, 200);
  if (title) fields.title = title;
  if (fieldsRaw.date !== undefined) {
    const date = asDate(fieldsRaw.date);
    if (!date) throw new Error("Pole \"date\" musi być datą YYYY-MM-DD.");
    fields.date = date;
  }
  if (fieldsRaw.start_at !== undefined) {
    const start = asInstant(fieldsRaw.start_at);
    if (!start) throw new Error("Pole \"start_at\" musi być znacznikiem czasu ISO 8601.");
    fields.start_at = start;
  }
  if (fieldsRaw.end_at !== undefined) {
    const end = asInstant(fieldsRaw.end_at);
    if (!end) throw new Error("Pole \"end_at\" musi być znacznikiem czasu ISO 8601.");
    fields.end_at = end;
  }
  if (fieldsRaw.timezone !== undefined) {
    const timezone = asText(fieldsRaw.timezone, 64);
    if (!timezone || !TIMEZONE_RE.test(timezone)) throw new Error("Pole \"timezone\" musi być strefą IANA.");
    fields.timezone = timezone;
  }
  if (Object.keys(fields).length === 0) {
    throw new Error("Modyfikacja wymaga co najmniej jednego pola nagłówka.");
  }
  const expectedVersion = args.expected_version === undefined ? null : asVersion(args.expected_version);
  if (args.expected_version !== undefined && expectedVersion === null) {
    throw new Error("Parametr \"expected_version\" musi być liczbą całkowitą.");
  }
  const idempotencyKey = asText(args.idempotency_key, 128);
  const result: ManageActivityArgs = {
    action: action as ManageActivityArgs["action"],
    activity_id: activityId,
    fields,
  };
  if (expectedVersion !== null) result.expected_version = expectedVersion;
  if (idempotencyKey) result.idempotency_key = idempotencyKey;
  return result;
}
