/**
 * Calendar D (KOMAA-1278) — test parzystości panel <-> MCP na TYM SAMYM activity_id.
 *
 * Uruchomiony przez prawdziwe handlery narzędzi (`registerActivityTools`), a nie
 * przez czyste funkcje kontraktu: to jedyny test, który dowodzi, że panel i MCP
 * czytają oraz zapisują TEN SAM kanoniczny rekord aktywności (SSOT) i że zapis
 * przez MCP nie tworzy drugiego wydarzenia.
 *
 * Model backendu aplikacji jest atrapą (in-memory) implementującą udokumentowany
 * interfejs z `backend.ts`, w tym scoping zespołu (RLS) oraz outbox do połączonego
 * kalendarza Google. Atrapa udowadnia kontrakt po stronie MCP; implementacja
 * backendu i outboxu należy do właściciela backendu aplikacji.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

import { registerActivityTools } from "./tools";

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const SUBJECT_A = "google-sub-team-a";

/** Kanoniczna aktywność SSOT — ten sam rekord widzi panel i MCP. */
const ACTIVITY_ID = "0f2a1c74-6a1e-4a44-9a0e-2f8f9c2b7d11";
const OTHER_TEAM_ACTIVITY_ID = "9a1c0f3e-1111-4a44-9a0e-2f8f9c2b7d22";
/** Połączone wydarzenie Google — mapa outboxu; MCP nie może go zobaczyć. */
const GOOGLE_EVENT_ID = "gcal-evt-42";
const FOREIGN_TITLE = "Obca zbiórka";

interface ActivityRow {
  activity_id: string;
  team_id: string;
  title: string;
  type: string;
  status: string;
  date: string;
  start_at: string;
  end_at: string;
  timezone: string;
  location: string;
  calendar_sync_status: string;
  google_event_id: string;
  updated_at: string;
  version: number;
}

interface OutboxEntry {
  activity_id: string;
  google_event_id: string;
  op: "upsert";
  fields: Record<string, string>;
}

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Atrapowy backend aplikacji: SSOT + scoping zespołu + outbox do kalendarza. */
function createFakeAppBackend() {
  const rows = new Map<string, ActivityRow>();
  const outbox: OutboxEntry[] = [];
  const requests: { method: string; path: string; subject: string | null }[] = [];

  const seed = (row: ActivityRow) => rows.set(row.activity_id, { ...row });

  seed({
    activity_id: ACTIVITY_ID,
    team_id: TEAM_A,
    title: "Zbiórka przed biwakiem",
    type: "zbiórka",
    status: "scheduled",
    date: "2026-10-24",
    start_at: "2026-10-24T08:30:00.000Z",
    end_at: "2026-10-24T10:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: "Boisko szkolne",
    calendar_sync_status: "pending",
    google_event_id: GOOGLE_EVENT_ID,
    updated_at: "2026-10-21T12:00:00.000Z",
    version: 3,
  });
  seed({
    activity_id: OTHER_TEAM_ACTIVITY_ID,
    team_id: TEAM_B,
    title: FOREIGN_TITLE,
    type: "zbiórka",
    status: "scheduled",
    date: "2026-10-26",
    start_at: "2026-10-26T08:00:00.000Z",
    end_at: "2026-10-26T09:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: "Tajne miejsce",
    calendar_sync_status: "synced",
    google_event_id: "gcal-evt-99",
    updated_at: "2026-10-21T12:00:00.000Z",
    version: 1,
  });

  const teamOf = new Map<string, string>([
    [SUBJECT_A, TEAM_A],
    ["google-sub-team-b", TEAM_B],
  ]);

  /** Kolumny prywatne (id wydarzenia Google) nie opuszczają backendu. */
  function publicRow(row: ActivityRow) {
    const { google_event_id: _private, ...rest } = row;
    return rest;
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const subject = headers.get("x-mcp-subject");
    const method = init?.method ?? "GET";
    requests.push({ method, path: `${url.pathname}${url.search}`, subject });

    const team = subject ? teamOf.get(subject) : undefined;
    if (!team) {
      return Response.json({ code: "forbidden" }, { status: 403 });
    }

    if (method === "GET" && /\/activities\/?$/.test(url.pathname)) {
      const items = [...rows.values()].filter((row) => row.team_id === team).map(publicRow);
      return Response.json({ items, next_cursor: null });
    }

    const match = /\/activities\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const row = rows.get(id);
      // Scoping zespołu: obca aktywność wygląda jak niedostępna, nie jak istniejąca.
      if (!row || row.team_id !== team) {
        return Response.json({ code: "forbidden" }, { status: 403 });
      }
      if (method === "GET") return Response.json(publicRow(row));

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        fields?: Record<string, string>;
        expected_version?: number;
      };
      if (body.expected_version !== undefined && body.expected_version !== row.version) {
        return Response.json({ code: "version_conflict" }, { status: 409 });
      }
      const updated: ActivityRow = { ...row, ...body.fields, version: row.version + 1 };
      rows.set(id, updated);
      // Outbox: ta sama aktywność -> to samo połączone wydarzenie Google.
      outbox.push({
        activity_id: id,
        google_event_id: row.google_event_id,
        op: "upsert",
        fields: body.fields ?? {},
      });
      return Response.json(publicRow(updated));
    }

    return Response.json({ code: "not_found" }, { status: 404 });
  }) as unknown as typeof fetch;

  return { rows, outbox, requests, fetchImpl };
}

/** Panel czyta TEN SAM rekord SSOT co backend (Supabase/Postgres). */
function panelActivity(rows: Map<string, ActivityRow>, activityId: string) {
  const row = rows.get(activityId);
  assert.ok(row, "panel nie widzi aktywności");
  return row;
}

/** Backend atrapowy + zarejestrowane handlery narzędzi dla podmiotu. */
function setupMcp(subject: string) {
  const backend = createFakeAppBackend();
  vi.stubGlobal("fetch", backend.fetchImpl);
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as Parameters<typeof registerActivityTools>[0];
  registerActivityTools(
    server,
    { APP_ACTIVITY_API_BASE: "https://app.example.test/api", APP_ACTIVITY_API_TOKEN: "service-token" },
    { googleSub: subject },
    "https://mcp.example.test",
  );
  return { backend, handlers };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parzystość panel <-> MCP na tym samym activity_id", () => {
  it("lista, odczyt i zapis MCP dotyczą kanonicznej aktywności panelu", async () => {
    const { backend, handlers } = setupMcp(SUBJECT_A);

    // Rejestracja musi zarejestrować dokładnie trzy narzędzia aktywności.
    assert.deepEqual([...handlers.keys()], ["list_activities", "get_activity", "manage_activity"]);

    const panel = panelActivity(backend.rows, ACTIVITY_ID);
    assert.equal(panel.activity_id, ACTIVITY_ID);

    // 1) LIST — ta sama aktywność co w panelu, bez danych prywatnych.
    const listed = await handlers.get("list_activities")!({});
    assert.equal(listed.isError, undefined);
    const items = (listed.structuredContent as { items: Record<string, unknown>[] }).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].activity_id, ACTIVITY_ID);
    assert.equal(items[0].title, panel.title);
    assert.equal(items[0].date, panel.date);
    const serialized = JSON.stringify(listed.structuredContent);
    assert.equal(serialized.includes(GOOGLE_EVENT_ID), false, "lista nie może ujawniać wydarzenia Google");
    assert.equal(serialized.includes(FOREIGN_TITLE), false, "lista nie może zawierać cudzej aktywności");

    // 2) GET — ten sam kanoniczny id co w panelu.
    const fetched = await handlers.get("get_activity")!({ activity_id: ACTIVITY_ID });
    assert.equal((fetched.structuredContent as { activity_id: string }).activity_id, ACTIVITY_ID);

    // 3) WRITE przez MCP — aktualizacja nagłówka tej samej aktywności.
    const managed = await handlers.get("manage_activity")!({
      action: "update",
      activity_id: ACTIVITY_ID,
      fields: { title: "Zbiórka — zmieniony termin", date: "2026-10-25" },
      expected_version: panel.version,
    });
    assert.equal(managed.isError, undefined);
    assert.equal((managed.structuredContent as { activity_id: string }).activity_id, ACTIVITY_ID);

    // 4) READBACK — ten sam id, zaktualizowane wartości, wyższa wersja.
    const after = await handlers.get("get_activity")!({ activity_id: ACTIVITY_ID });
    const afterDto = after.structuredContent as { activity_id: string; title: string; date: string; version: number };
    assert.equal(afterDto.activity_id, ACTIVITY_ID);
    assert.equal(afterDto.title, "Zbiórka — zmieniony termin");
    assert.equal(afterDto.date, "2026-10-25");
    assert.equal(afterDto.version, panel.version + 1);

    // 5) PARITY — panel widzi tę samą zmianę (ten sam rekord SSOT).
    const panelAfter = panelActivity(backend.rows, ACTIVITY_ID);
    assert.equal(panelAfter.title, afterDto.title);
    assert.equal(panelAfter.date, afterDto.date);
    assert.equal(panelAfter.version, afterDto.version);

    // 6) OUTBOX — zapis przez MCP aktualizuje TO SAMO połączone wydarzenie,
    //    nie tworzy drugiego wydarzenia w kalendarzu.
    assert.equal(backend.outbox.length, 1);
    assert.equal(backend.outbox[0].activity_id, ACTIVITY_ID);
    assert.equal(backend.outbox[0].google_event_id, GOOGLE_EVENT_ID);
    assert.equal(backend.outbox[0].op, "upsert");

    // 7) Brak duplikatu w bazie: nadal dokładnie jedna karta aktywności.
    assert.equal([...backend.rows.values()].filter((row) => row.team_id === TEAM_A).length, 1);
  });

  it("aktualizacja MCP jest widoczna w panelu przy tej samej wartości pola", async () => {
    const { backend, handlers } = setupMcp(SUBJECT_A);

    const panel = panelActivity(backend.rows, ACTIVITY_ID);
    await handlers.get("manage_activity")!({
      action: "update",
      activity_id: ACTIVITY_ID,
      fields: { title: panel.title },
    });

    assert.equal(panelActivity(backend.rows, ACTIVITY_ID).title, panel.title);
    assert.equal(panelActivity(backend.rows, ACTIVITY_ID).version, panel.version + 1);
  });

  it("obca aktywność zespołu jest niedostępna bez ujawniania jej treści", async () => {
    const { backend, handlers } = setupMcp(SUBJECT_A);

    const result = await handlers.get("get_activity")!({ activity_id: OTHER_TEAM_ACTIVITY_ID });
    assert.equal(result.isError, true);
    const text = result.content?.[0]?.text ?? "";
    assert.equal(text.includes(FOREIGN_TITLE), false, "odmowa nie może ujawnić tytułu cudzej aktywności");
    assert.equal(text.includes(OTHER_TEAM_ACTIVITY_ID), false, "odmowa nie może ujawnić cudzego identyfikatora");
    assert.equal(text.includes("Tajne miejsce"), false, "odmowa nie może ujawnić lokalizacji");

    // Rekord cudzego zespołu pozostaje nietknięty.
    const foreign = backend.rows.get(OTHER_TEAM_ACTIVITY_ID);
    assert.equal(foreign?.title, FOREIGN_TITLE);
    assert.equal(foreign?.version, 1);
    assert.equal(backend.outbox.length, 0);
  });

  it("klient nie może przekierować zapisu do innego zespołu ani ominąć wersji", async () => {
    const { backend, handlers } = setupMcp(SUBJECT_A);

    // Próba zapisu cudzej aktywności: backend odrzuca, nic się nie zmienia.
    const foreignWrite = await handlers.get("manage_activity")!({
      action: "update",
      activity_id: OTHER_TEAM_ACTIVITY_ID,
      fields: { title: "Przejęta" },
    });
    assert.equal(foreignWrite.isError, true);
    assert.equal(backend.rows.get(OTHER_TEAM_ACTIVITY_ID)?.title, FOREIGN_TITLE);
    assert.equal(backend.outbox.length, 0);

    // Konflikt wersji: zapis z nieaktualną wersją jest odrzucany.
    const stale = await handlers.get("manage_activity")!({
      action: "update",
      activity_id: ACTIVITY_ID,
      fields: { title: "Stara wersja" },
      expected_version: 1,
    });
    assert.equal(stale.isError, true);
    assert.equal(panelActivity(backend.rows, ACTIVITY_ID).title, "Zbiórka przed biwakiem");
    assert.equal(backend.outbox.length, 0);
  });

  it("token usługi nie trafia do zapytania ani do wyniku", async () => {
    const { backend, handlers } = setupMcp(SUBJECT_A);

    await handlers.get("get_activity")!({ activity_id: ACTIVITY_ID });
    for (const request of backend.requests) {
      assert.equal(request.path.includes("service-token"), false);
      assert.equal(request.subject, SUBJECT_A, "subject pochodzi z grantu, nie z argumentów");
    }
  });
});
