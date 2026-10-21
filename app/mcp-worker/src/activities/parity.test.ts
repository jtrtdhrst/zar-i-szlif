/**
 * Calendar D (KOMAA-1278) — parzystość panel <-> MCP na TYM SAMYM activity_id.
 *
 * Test przepuszcza prawdziwe handlery narzędzi (`registerActivityTools`) przez
 * PRAWDZIWY transport HTTP: klient MCP (`createActivityBackend`) łączy się po
 * sieci do serwera referencyjnego backendu aplikacji (`node:http`). Nie jest to
 * atrapa w pamięci — żądanie, nagłówki, kod odpowiedzi i statusy HTTP są realne.
 *
 * Serwer referencyjny jest wykonanym kontraktem (`backend.ts`): SSOT aktywności,
 * scoping zespołu (RLS), konflikt wersji oraz outbox do POŁĄCZONEGO wydarzenia
 * Google (ta sama mapa `activity_id -> google_event_id`, upsert, bez drugiego
 * wydarzenia). Implementacja tego kontraktu w produkcyjnym backendzie aplikacji
 * należy do właściciela backendu (Engineer); MCP jest wyłącznie klientem.
 *
 * Strona panelu czyta TEN SAM rekord SSOT przez ten sam interfejs aplikacji
 * (a nie przez DTO MCP), a nazwy pól nagłówka są dodatkowo sprawdzane wobec
 * PRAWDZIWEGO kodu panelu (`app/web/src/static-app-v2.js`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, it } from "vitest";

import { PANEL_FIELD_MAPPING } from "./contract";
import { registerActivityTools } from "./tools";

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const SUBJECT_A = "google-sub-team-a";
const SUBJECT_B = "google-sub-team-b";
const SERVICE_TOKEN = "service-token-app-backend";

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

interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  subject: string | null;
  authorization: string | null;
}

/**
 * Referencyjny backend aplikacji: realny serwer HTTP implementujący udokumentowany
 * kontrakt (SSOT + scoping zespołu + wersje + outbox do kalendarza Google).
 */
class ReferenceAppBackend {
  readonly rows = new Map<string, ActivityRow>();
  readonly outbox: OutboxEntry[] = [];
  /** Połączone wydarzenia Google — jedno na aktywność, nigdy drugie. */
  readonly googleEvents = new Map<string, { event_id: string; activity_id: string; fields: Record<string, string> }>();
  readonly requests: RecordedRequest[] = [];

  private readonly teamOf = new Map<string, string>([
    [SUBJECT_A, TEAM_A],
    [SUBJECT_B, TEAM_B],
  ]);

  constructor() {
    this.seed({
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
    this.seed({
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
  }

  private seed(row: ActivityRow): void {
    this.rows.set(row.activity_id, { ...row });
    this.googleEvents.set(row.google_event_id, {
      event_id: row.google_event_id,
      activity_id: row.activity_id,
      fields: { title: row.title, date: row.date, start_at: row.start_at, end_at: row.end_at },
    });
  }

  /** Kolumny prywatne (id wydarzenia Google) nie opuszczają backendu. */
  private publicRow(row: ActivityRow) {
    const { google_event_id: _private, ...rest } = row;
    return rest;
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const authorization = req.headers.authorization ?? null;
    const subject = (req.headers["x-mcp-subject"] as string | undefined) ?? null;
    this.requests.push({
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.search,
      subject,
      authorization,
    });

    if (authorization !== `Bearer ${SERVICE_TOKEN}`) {
      this.json(res, 401, { code: "unauthorized" });
      return;
    }
    const team = subject ? this.teamOf.get(subject) : undefined;
    if (!team) {
      this.json(res, 403, { code: "forbidden" });
      return;
    }

    if (req.method === "GET" && /\/activities\/?$/.test(url.pathname)) {
      const items = [...this.rows.values()].filter((row) => row.team_id === team).map((row) => this.publicRow(row));
      this.json(res, 200, { items, next_cursor: null });
      return;
    }

    const match = /\/activities\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const row = this.rows.get(id);
      // Scoping zespołu: obca aktywność wygląda jak niedostępna, nie jak istniejąca.
      if (!row || row.team_id !== team) {
        this.json(res, 403, { code: "forbidden" });
        return;
      }
      if (req.method === "GET") {
        this.json(res, 200, this.publicRow(row));
        return;
      }
      if (req.method === "PATCH") {
        const body = (await readBody(req)) as {
          fields?: Record<string, string>;
          expected_version?: number;
        };
        if (body.expected_version !== undefined && body.expected_version !== row.version) {
          this.json(res, 409, { code: "version_conflict" });
          return;
        }
        const updated: ActivityRow = { ...row, ...body.fields, version: row.version + 1 };
        this.rows.set(id, updated);
        // Outbox: ta sama aktywność -> TO SAMO połączone wydarzenie Google (upsert).
        this.outbox.push({
          activity_id: id,
          google_event_id: row.google_event_id,
          op: "upsert",
          fields: body.fields ?? {},
        });
        const linked = this.googleEvents.get(row.google_event_id);
        if (linked) linked.fields = { ...linked.fields, ...body.fields };
        this.json(res, 200, this.publicRow(updated));
        return;
      }
    }

    this.json(res, 404, { code: "not_found" });
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const backend = new ReferenceAppBackend();
let server: http.Server;
let baseUrl: string;

/** Backend referencyjny + zarejestrowane handlery narzędzi dla podmiotu. */
function setupMcp(subject: string) {
  const handlers = new Map<string, ToolHandler>();
  const serverStub = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as Parameters<typeof registerActivityTools>[0];
  registerActivityTools(
    serverStub,
    { APP_ACTIVITY_API_BASE: baseUrl, APP_ACTIVITY_API_TOKEN: SERVICE_TOKEN },
    { googleSub: subject },
    "https://mcp.example.test",
  );
  return { handlers };
}

/**
 * Panel: niezależny klient tego samego backendu aplikacji (nie DTO MCP).
 * Panel i MCP czytają TEN SAM rekord SSOT.
 */
async function panelRead(activityId: string, subject: string): Promise<ActivityRow> {
  const response = await fetch(`${baseUrl}/activities/${encodeURIComponent(activityId)}`, {
    headers: { authorization: `Bearer ${SERVICE_TOKEN}`, "x-mcp-subject": subject },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as ActivityRow;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void backend.handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("parzystość panel <-> MCP na tym samym activity_id (transport HTTP)", () => {
  it("lista, odczyt i zapis MCP dotyczą kanonicznej aktywności panelu", async () => {
    const { handlers } = setupMcp(SUBJECT_A);

    // Rejestracja musi zarejestrować dokładnie trzy narzędzia aktywności.
    assert.deepEqual([...handlers.keys()], ["list_activities", "get_activity", "manage_activity"]);

    const panel = await panelRead(ACTIVITY_ID, SUBJECT_A);
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
    const panelAfter = await panelRead(ACTIVITY_ID, SUBJECT_A);
    assert.equal(panelAfter.activity_id, afterDto.activity_id);
    assert.equal(panelAfter.title, afterDto.title);
    assert.equal(panelAfter.date, afterDto.date);
    assert.equal(panelAfter.version, afterDto.version);

    // 6) OUTBOX — zapis przez MCP aktualizuje TO SAMO połączone wydarzenie,
    //    nie tworzy drugiego wydarzenia w kalendarzu.
    assert.equal(backend.outbox.length, 1);
    assert.equal(backend.outbox[0].activity_id, ACTIVITY_ID);
    assert.equal(backend.outbox[0].google_event_id, GOOGLE_EVENT_ID);
    assert.equal(backend.outbox[0].op, "upsert");
    assert.equal(backend.googleEvents.size, 2, "liczba połączonych wydarzeń Google nie może wzrosnąć");
    assert.equal(backend.googleEvents.get(GOOGLE_EVENT_ID)?.fields.title, "Zbiórka — zmieniony termin");

    // 7) Brak duplikatu w bazie: nadal dokładnie jedna karta aktywności w zespole.
    assert.equal([...backend.rows.values()].filter((row) => row.team_id === TEAM_A).length, 1);
  });

  it("zapis MCP jest widoczny w panelu przy tej samej wartości pola", async () => {
    const { handlers } = setupMcp(SUBJECT_A);
    const panel = await panelRead(ACTIVITY_ID, SUBJECT_A);

    await handlers.get("manage_activity")!({
      action: "update",
      activity_id: ACTIVITY_ID,
      fields: { title: panel.title },
    });

    const panelAfter = await panelRead(ACTIVITY_ID, SUBJECT_A);
    assert.equal(panelAfter.title, panel.title);
    assert.equal(panelAfter.version, panel.version + 1);
  });

  it("obca aktywność zespołu jest niedostępna bez ujawniania jej treści", async () => {
    const { handlers } = setupMcp(SUBJECT_A);

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
  });

  it("klient nie może przekierować zapisu do innego zespołu ani ominąć wersji", async () => {
    const { handlers } = setupMcp(SUBJECT_A);
    const outboxBefore = backend.outbox.length;

    // Próba zapisu cudzej aktywności: backend odrzuca, nic się nie zmienia.
    const foreignWrite = await handlers.get("manage_activity")!({
      action: "update",
      activity_id: OTHER_TEAM_ACTIVITY_ID,
      fields: { title: "Przejęta" },
    });
    assert.equal(foreignWrite.isError, true);
    assert.equal(backend.rows.get(OTHER_TEAM_ACTIVITY_ID)?.title, FOREIGN_TITLE);

    // Konflikt wersji: zapis z nieaktualną wersją jest odrzucany.
    const stale = await handlers.get("manage_activity")!({
      action: "update",
      activity_id: ACTIVITY_ID,
      fields: { title: "Stara wersja" },
      expected_version: 1,
    });
    assert.equal(stale.isError, true);
    assert.equal(backend.outbox.length, outboxBefore, "odrzucone zapis nie mogą tworzyć outboxu");
  });

  it("token usługi idzie w nagłówku autoryzacji, nigdy do zapytania ani do wyniku", async () => {
    const { handlers } = setupMcp(SUBJECT_A);
    const requestsBefore = backend.requests.length;

    await handlers.get("get_activity")!({ activity_id: ACTIVITY_ID });
    const sent = backend.requests.slice(requestsBefore);
    assert.ok(sent.length > 0);
    for (const request of sent) {
      assert.equal(request.query.includes(SERVICE_TOKEN), false, "token nie może być w query");
      assert.equal(request.path.includes(SERVICE_TOKEN), false, "token nie może być w ścieżce");
      assert.equal(request.authorization, `Bearer ${SERVICE_TOKEN}`, "backend wymaga tokenu usługi");
      assert.equal(request.subject, SUBJECT_A, "subject pochodzi z grantu, nie z argumentów");
    }
  });

  it("podmiot bez grantu nie dostaje danych", async () => {
    const { handlers } = setupMcp(SUBJECT_A);
    const result = await handlers.get("list_activities")!({});
    assert.equal(result.isError, undefined);

    // Backend rozróżnia zespół po subject — bez subjectu nie ma listy.
    const anonymous = await fetch(`${baseUrl}/activities`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    assert.equal(anonymous.status, 403);
  });
});

describe("mapowanie pól panel <-> MCP wobec prawdziwego kodu panelu", () => {
  it("nazwy pól nagłówka istnieją w kodzie panelu, a MCP nie ma własnych nazw", () => {
    const panelSource = readFileSync(
      new URL("../../../../app/web/src/static-app-v2.js", import.meta.url),
      "utf8",
    );
    for (const mapping of PANEL_FIELD_MAPPING) {
      assert.match(
        panelSource,
        new RegExp(`\\b${mapping.panel}\\b`),
        `panel nie zawiera pola ${mapping.panel}`,
      );
    }
    // Model aktywności panelu (S.activity) trzyma tytuł i datę — nazwy, które MCP
    // projekcjoną, nie własne nazwy wymyślone w warstwie MCP.
    assert.match(panelSource, /activity:\{[^}]*title:[^}]*date:/);
    // Panel nie trzyma identyfikatora wydarzenia Google ani tokenów kalendarza —
    // jedno źródło prawdy (SSOT) zostaje w backendzie aplikacji.
    assert.doesNotMatch(panelSource, /google_event_id/);
    assert.doesNotMatch(panelSource, /refresh_token/);
  });
});
