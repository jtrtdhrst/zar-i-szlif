import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import {
  parseGetActivityArgs,
  parseListActivitiesArgs,
  parseManageActivityArgs,
  toActivityDto,
} from "./contract";
import { ActivityBackendError, createActivityBackend, isActivityBackendConfigured } from "./backend";
import { ACTIVITY_TOOL_NAMES, registerActivityTools } from "./tools";

/** Kanoniczny rekord aktywności taki, jaki zwraca backend aplikacji (SSOT). */
const CANONICAL_ROW = {
  activity_id: "0f2a1c74-6a1e-4a44-9a0e-2f8f9c2b7d11",
  team_id: "team-7",
  title: "Zbiórka przed biwakiem",
  type: "zbiórka",
  status: "scheduled",
  date: "2026-10-24",
  start_at: "2026-10-24T08:30:00.000Z",
  end_at: "2026-10-24T10:00:00.000Z",
  timezone: "Europe/Warsaw",
  location: "Boisko szkolne",
  calendar_sync_status: "pending",
  updated_at: "2026-10-21T12:00:00.000Z",
  version: 3,
};

describe("kontrakt aktywności (wycinek calendar-D)", () => {
  it("list_activities i get_activity zwracają ten sam kanoniczny activity_id", () => {
    const listed = toActivityDto(CANONICAL_ROW);
    const fetched = toActivityDto(CANONICAL_ROW);
    assert.equal(listed.activity_id, fetched.activity_id);
    assert.equal(listed.activity_id, CANONICAL_ROW.activity_id);
    assert.equal(listed.date, "2026-10-24");
    assert.equal(listed.start_at, CANONICAL_ROW.start_at);
    assert.equal(listed.end_at, CANONICAL_ROW.end_at);
    assert.equal(listed.title, CANONICAL_ROW.title);
    assert.equal(listed.version, 3);
  });

  it("nie mintuje identyfikatora — rekord bez activity_id jest odrzucany", () => {
    assert.throws(() => toActivityDto({ title: "bez id" }), /activity_id/);
  });

  it("pomija PII, sekrety i dane Google w DTO", () => {
    const dto = toActivityDto({
      ...CANONICAL_ROW,
      children: [{ name: "Jan Kowalski" }],
      participants: ["Jan Kowalski"],
      notes: "notatka prywatna",
      report: "treść raportu",
      email: "jan@example.com",
      google_event_id: "g-123",
      google_calendar_id: "primary",
      refresh_token: "rt-secret",
      access_token: "at-secret",
      oauth_client_secret: "sekret",
    });
    assert.deepEqual(Object.keys(dto).sort(), [
      "activity_id",
      "calendar_sync_status",
      "date",
      "end_at",
      "location",
      "start_at",
      "status",
      "team_id",
      "timezone",
      "title",
      "type",
      "updated_at",
      "version",
    ]);
    const serialized = JSON.stringify(dto);
    for (const forbidden of ["Jan Kowalski", "g-123", "rt-secret", "at-secret", "sekret", "notatka"]) {
      assert.equal(serialized.includes(forbidden), false, `DTO nie może zawierać: ${forbidden}`);
    }
  });

  it("nieznany status kalendarza spoza allowlisty jest pomijany", () => {
    const dto = toActivityDto({ ...CANONICAL_ROW, calendar_sync_status: "token=abc" });
    assert.equal(dto.calendar_sync_status, null);
  });

  it("manage_activity przyjmuje wyłącznie pola nagłówkowe", () => {
    const parsed = parseManageActivityArgs({
      action: "update",
      activity_id: CANONICAL_ROW.activity_id,
      fields: { title: "Nowy tytuł", date: "2026-10-25", start_at: "2026-10-25T08:00:00Z" },
    });
    assert.equal(parsed.action, "update");
    assert.equal(parsed.activity_id, CANONICAL_ROW.activity_id);
    assert.equal(parsed.fields.title, "Nowy tytuł");
    assert.equal(parsed.fields.date, "2026-10-25");
    assert.equal(parsed.fields.start_at, "2026-10-25T08:00:00.000Z");
  });

  it("manage_activity odrzuca pola spoza allowlisty (Google, tokeny, zespół, uczestnicy)", () => {
    for (const field of ["google_event_id", "refresh_token", "team_id", "participants", "calendar_sync_status"]) {
      assert.throws(
        () =>
          parseManageActivityArgs({
            action: "update",
            activity_id: CANONICAL_ROW.activity_id,
            fields: { [field]: "x" },
          }),
        /nie jest modyfikowalne/,
        `pole ${field} musi być odrzucone`,
      );
    }
  });

  it("klient nie może wskazać zespołu ani użytkownika", () => {
    assert.throws(() => parseListActivitiesArgs({ team_id: "team-7" }), /niedozwolony/);
    assert.throws(() => parseGetActivityArgs({ activity_id: "a", user_id: "u" }), /niedozwolony/);
    assert.throws(() => parseListActivitiesArgs({ limit: 0 }), /limit/);
    assert.throws(() => parseListActivitiesArgs({ date_from: "24-10-2026" }), /date_from/);
  });
});

describe("adapter backendu aplikacji", () => {
  it("wysyła subject z tokenu, a nie z argumentów klienta", async () => {
    const seen: { url: string; headers: Headers; body?: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify(CANONICAL_ROW), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const backend = createActivityBackend({
      baseUrl: "https://app.example.test/api/mcp",
      token: "service-token",
      fetchImpl,
    });
    await backend.getActivity("google-sub-123", CANONICAL_ROW.activity_id);
    await backend.manageActivity("google-sub-123", {
      action: "update",
      activity_id: CANONICAL_ROW.activity_id,
      fields: { title: "Zmiana" },
      expected_version: 3,
    });

    assert.equal(seen.length, 2);
    for (const call of seen) {
      assert.equal(call.headers.get("x-mcp-subject"), "google-sub-123");
      assert.equal(call.headers.get("authorization"), "Bearer service-token");
      assert.equal(call.url.includes("service-token"), false);
    }
    assert.equal(seen[1].body?.includes("service-token"), false);
    assert.equal(seen[1].url.includes(CANONICAL_ROW.activity_id), true);
    assert.equal(seen[1].body?.includes("google"), false);
    assert.deepEqual(JSON.parse(seen[1].body ?? "{}"), { fields: { title: "Zmiana" }, expected_version: 3 });
  });

  it("błąd backendu nie wycieka treści odpowiedzi", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "internal_error", detail: "refresh_token=rt-secret" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const backend = createActivityBackend({ baseUrl: "https://app.example.test/api/mcp", token: "t", fetchImpl });
    await assert.rejects(
      () => backend.getActivity("sub", CANONICAL_ROW.activity_id),
      (error: unknown) => {
        assert.ok(error instanceof ActivityBackendError);
        assert.equal(error.status, 500);
        assert.equal(error.message.includes("rt-secret"), false);
        return true;
      },
    );
  });

  it("backend bez konfiguracji nie jest aktywny", () => {
    assert.equal(isActivityBackendConfigured({}), false);
    assert.equal(isActivityBackendConfigured({ APP_ACTIVITY_API_BASE: "https://app.example.test" }), false);
    assert.equal(
      isActivityBackendConfigured({ APP_ACTIVITY_API_BASE: "https://app.example.test", APP_ACTIVITY_API_TOKEN: "t" }),
      true,
    );
  });

  it("narzędzia aktywności nie są rejestrowane bez backendu", () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      },
    } as unknown as Parameters<typeof registerActivityTools>[0];
    registerActivityTools(fakeServer, {}, { googleSub: "sub" }, "https://mcp.example.test");
    assert.deepEqual(registered, []);
  });
});

describe("architektura MCP", () => {
  it("nie ma osobnego narzędzia Google ani dostępu do kalendarza w kodzie MCP", () => {
    const srcDir = fileURLToPath(new URL("..", import.meta.url));
    const files = readdirSync(srcDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const source = readFileSync(`${srcDir}/${String(file)}`, "utf8");
      assert.doesNotMatch(source, /registerTool\(\s*["'][^"']*google/i);
      assert.doesNotMatch(source, /calendar\.googleapis\.com/i);
      assert.doesNotMatch(source, /\brefresh_token\b/i);
    }
    assert.deepEqual([...ACTIVITY_TOOL_NAMES], ["list_activities", "get_activity", "manage_activity"]);
  });
});
