/**
 * Calendar D (KOMAA-1278) — adapter klienta backendu aplikacji dla MCP.
 *
 * Kontrakt: MCP NIE łączy się z Supabase/Postgres ani z Google Calendar API.
 * Rozmawia wyłącznie z backendem aplikacji, który jest właścicielem SSOT
 * (aktywności), outboxu do kalendarza Google i autoryzacji zespołu/roli.
 * MCP przekazuje zweryfikowany subject z tokenu OAuth (serwerowo) i nic więcej.
 *
 * Backend jest oczekiwanym interfejsem (implementacja: Engineer):
 *   GET   {base}/activities?date_from&date_to&status&type&limit&cursor
 *   GET   {base}/activities/{activity_id}
 *   PATCH {base}/activities/{activity_id}  body: { fields, expected_version?, idempotency_key? }
 * Odpowiedź: rekord aktywności lub { items: [...], next_cursor }.
 */

import {
  toActivityDto,
  type ActivityDto,
  type ListActivitiesArgs,
  type ManageActivityArgs,
} from "./contract.js";

export interface ActivityBackendEnv {
  APP_ACTIVITY_API_BASE?: string;
  APP_ACTIVITY_API_TOKEN?: string;
}

/** Błąd backendu: bez treści odpowiedzi (może zawierać PII lub sekrety). */
export class ActivityBackendError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(
      status === 401 || status === 403
        ? "Brak autoryzacji do aktywności."
        : `Backend aktywności zwrócił błąd ${status}${code ? ` (${code})` : ""}.`,
    );
    this.name = "ActivityBackendError";
    this.status = status;
    this.code = code;
  }
}

export interface ActivityBackend {
  listActivities(subject: string, args: ListActivitiesArgs): Promise<{ items: ActivityDto[]; next_cursor: string | null }>;
  getActivity(subject: string, activityId: string): Promise<ActivityDto>;
  manageActivity(subject: string, mutation: ManageActivityArgs): Promise<ActivityDto>;
}

/** Backend jest opcjonalny: bez konfiguracji narzędzia aktywności nie są rejestrowane. */
export function isActivityBackendConfigured(env: ActivityBackendEnv): boolean {
  return Boolean(env.APP_ACTIVITY_API_BASE?.trim() && env.APP_ACTIVITY_API_TOKEN?.trim());
}

function normalizeBase(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) {
    throw new Error("APP_ACTIVITY_API_BASE musi być adresem HTTPS.");
  }
  return base;
}

/** Kod błędu z odpowiedzi: tylko krótki, bezpieczny identyfikator — nigdy komunikat backendu. */
function safeCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const code = record.code ?? record.error;
  return typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code) ? code : null;
}

export function createActivityBackend(
  opts: { baseUrl: string; token: string; fetchImpl?: typeof fetch },
): ActivityBackend {
  const base = normalizeBase(opts.baseUrl);
  const doFetch = opts.fetchImpl ?? fetch;

  async function call(
    subject: string,
    path: string,
    init: { method: "GET" | "PATCH"; query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<unknown> {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${opts.token}`,
      "x-mcp-subject": subject,
    });
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await doFetch(url.toString(), {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new ActivityBackendError(response.status, safeCode(payload));
    }
    return payload;
  }

  return {
    async listActivities(subject, args) {
      const payload = await call(subject, "/activities", {
        method: "GET",
        query: {
          date_from: args.date_from,
          date_to: args.date_to,
          status: args.status,
          type: args.type,
          limit: args.limit === undefined ? undefined : String(args.limit),
          cursor: args.cursor,
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const items = Array.isArray(record.items) ? record.items : [];
      const next = typeof record.next_cursor === "string" ? record.next_cursor : null;
      return { items: items.map(toActivityDto), next_cursor: next };
    },

    async getActivity(subject, activityId) {
      const payload = await call(subject, `/activities/${encodeURIComponent(activityId)}`, { method: "GET" });
      return toActivityDto(payload);
    },

    async manageActivity(subject, mutation) {
      const body: Record<string, unknown> = { fields: mutation.fields };
      if (mutation.expected_version !== undefined) body.expected_version = mutation.expected_version;
      if (mutation.idempotency_key !== undefined) body.idempotency_key = mutation.idempotency_key;
      const payload = await call(subject, `/activities/${encodeURIComponent(mutation.activity_id)}`, {
        method: "PATCH",
        body,
      });
      return toActivityDto(payload);
    },
  };
}
