import test from "node:test";
import assert from "node:assert/strict";
import {
  InvalidArgumentError,
  PostgrestError,
  SELECT_COLUMNS,
  SprawnoscNotFoundError,
  createSprawnoscRepository,
  equalityValue,
  getUrl,
  listUrl,
  mapRow,
  normalizeSearchTerm,
} from "../src/supabase.ts";
import { createFetchStub, sampleRow } from "./helpers/postgrest.ts";

const config = { url: "https://project.supabase.co", anonKey: "anon-key-for-tests" };
const accessToken = "caller-access-token";

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

test("list query selects exactly the ten catalog columns", () => {
  const url = listUrl(config, { limit: 25, offset: 0 });
  assert.equal(url.startsWith("https://project.supabase.co/rest/v1/sprawnosci?"), true);
  assert.equal(params(url).get("select"), SELECT_COLUMNS);
  assert.deepEqual(SELECT_COLUMNS.split(","), [
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
  ]);
  assert.equal(params(url).get("limit"), "25");
  assert.equal(params(url).get("offset"), "0");
  assert.equal(params(url).get("or"), null);
  assert.equal(params(url).get("poziom"), null);
});

test("list query composes every supported filter", () => {
  const url = listUrl(config, {
    query: "rozpalanie ognia",
    poziom: "odkrywcy",
    aspekt: "fizyczny",
    grupa: "ognisko",
    limit: 5,
    offset: 10,
  });
  const search = params(url);
  assert.equal(search.get("or"), "(tytul.ilike.*rozpalanie ognia*,opis.ilike.*rozpalanie ognia*)");
  // Unquoted on purpose: `eq."value"` compares the literal quoted string on a
  // text column and matches nothing on a live PostgREST (ZARI-155 live E2E).
  assert.equal(search.get("poziom"), "eq.odkrywcy");
  assert.equal(search.get("aspekt"), "eq.fizyczny");
  assert.equal(search.get("grupa"), "eq.ognisko");
  assert.equal(search.get("limit"), "5");
  assert.equal(search.get("offset"), "10");
  assert.ok(url.includes("poziom=eq.odkrywcy"));
  assert.ok(url.includes("aspekt=eq.fizyczny"));
  assert.ok(url.includes("grupa=eq.ognisko"));
  assert.equal(url.includes("%22"), false, "equality values must not be double-quoted");
});

test("a multi-word query term is one encoded ilike value, never form-encoded", () => {
  const url = listUrl(config, { query: "  rozpalanie   ognia ", limit: 25, offset: 0 });
  assert.ok(
    url.includes("or=(tytul.ilike.*rozpalanie%20ognia*%2Copis.ilike.*rozpalanie%20ognia*)"),
    url,
  );
  assert.equal(url.includes("+"), false, "a plus would be read as a literal plus by PostgREST");
  assert.equal(params(url).get("or"), "(tytul.ilike.*rozpalanie ognia*,opis.ilike.*rozpalanie ognia*)");
  assert.equal(params(url).get("limit"), "25");
});

test("search terms cannot break out of the or() expression", () => {
  assert.equal(normalizeSearchTerm('a,b(c)"d\\e*f%g'), "a b c d e f g");
  assert.equal(normalizeSearchTerm("  wielo   słowne  "), "wielo słowne");
  assert.throws(
    () => normalizeSearchTerm(',,,""()'),
    (error: unknown) => error instanceof InvalidArgumentError,
  );

  // The comma that would have split the filter list is gone, and the trailing
  // wildcard was stripped, so the term stays one literal value.
  const url = listUrl(config, { query: 'x,tytul.not.is.null,opis.ilike.*', limit: 25, offset: 0 });
  const search = params(url);
  assert.equal(
    search.get("or"),
    "(tytul.ilike.*x tytul.not.is.null opis.ilike.*,opis.ilike.*x tytul.not.is.null opis.ilike.*)",
  );
});

test("equality values are unquoted and fail closed on expression characters", () => {
  assert.equal(equalityValue("ognisko", "grupa"), "ognisko");
  assert.equal(equalityValue("  odkrywcy  ", "poziom"), "odkrywcy");
  assert.equal(equalityValue("ognisko leśne", "grupa"), "ognisko leśne");

  for (const bad of ["a,b", "a(b", "a)b", 'a"b']) {
    assert.throws(
      () => equalityValue(bad, "grupa"),
      (error: unknown) =>
        error instanceof InvalidArgumentError && /grupa must not contain/.test(error.message),
      bad,
    );
  }
  for (const empty of ["", "   ", "\u0000\u0001"]) {
    assert.throws(
      () => equalityValue(empty, "id"),
      (error: unknown) => error instanceof InvalidArgumentError,
    );
  }
});

test("values with reserved characters are URL-encoded, not quoted", () => {
  const url = getUrl(config, "ognisko leśne/1");
  assert.ok(url.includes("id=eq.ognisko%20le%C5%9Bne%2F1"), url);
  assert.equal(params(url).get("id"), "eq.ognisko leśne/1");
  assert.equal(url.includes("%22"), false);
});

test("a filter value that would change the filter logic never reaches the network", async () => {
  const stub = createFetchStub(() => ({ body: [] }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });

  for (const grupa of ["ognisko,ognisko", "ognisko)", 'ognisko"', "a(b"]) {
    await assert.rejects(
      () => repository.list(accessToken, { grupa, limit: 25, offset: 0 }),
      (error: unknown) => error instanceof InvalidArgumentError,
      grupa,
    );
  }
  await assert.rejects(
    () => repository.get(accessToken, "id,id"),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  assert.equal(stub.calls.length, 0, "no widened filter may be sent to PostgREST");
});

test("single record query is id-filtered and capped at one row", () => {
  const url = getUrl(config, "odkrywcy-alarm-jezyk-indian");
  const search = params(url);
  assert.equal(search.get("select"), SELECT_COLUMNS);
  assert.equal(search.get("id"), "eq.odkrywcy-alarm-jezyk-indian");
  assert.equal(search.get("limit"), "1");
  // Exact form reproduced against the deployed PostgREST during the live E2E:
  // `id=eq.<id>` returns the row, `id=eq."<id>"` returns [].
  assert.ok(url.includes("id=eq.odkrywcy-alarm-jezyk-indian"), url);
  assert.equal(url.includes("%22"), false);
});

test("rows map to the documented DTO and drop unknown fields", () => {
  const item = mapRow({ ...sampleRow(), service_role_secret: "must-not-leak" });
  assert.deepEqual(item, {
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
  });
  assert.equal("service_role_secret" in item, false);
});

test("null opis and null tagi degrade to safe defaults", () => {
  const item = mapRow(sampleRow({ opis: null, tagi: null }));
  assert.equal(item.opis, null);
  assert.deepEqual(item.tagi, []);
});

test("list forwards the caller token and the anon key, never a service-role key", async () => {
  const stub = createFetchStub(() => ({ body: [sampleRow()] }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });

  const result = await repository.list(accessToken, { query: "ogień", limit: 25, offset: 0 });

  assert.equal(stub.calls.length, 1);
  const call = stub.calls[0];
  assert.ok(call);
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${accessToken}`);
  assert.equal(headers.apikey, config.anonKey);
  assert.equal(call.init.method, "GET");
  assert.ok(call.init.signal instanceof AbortSignal, "request must carry a timeout signal");
  assert.equal(result.count, 1);
  assert.equal(result.limit, 25);
  assert.equal(result.offset, 0);
  assert.equal(result.items[0]?.tytul, "Rozpalanie ognia");
});

test("get returns one record", async () => {
  const stub = createFetchStub(() => ({ body: [sampleRow({ id: "42" })] }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });
  const item = await repository.get(accessToken, "42");
  assert.equal(item.id, "42");
});

test("get raises a not-found error for an empty result", async () => {
  const stub = createFetchStub(() => ({ body: [] }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });
  await assert.rejects(
    () => repository.get(accessToken, "does-not-exist"),
    (error: unknown) =>
      error instanceof SprawnoscNotFoundError && /does-not-exist/.test(error.message),
  );
});

test("get rejects an empty id without touching the network", async () => {
  const stub = createFetchStub(() => ({ body: [] }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });
  await assert.rejects(
    () => repository.get(accessToken, "   "),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  assert.equal(stub.calls.length, 0);
});

test("PostgREST failures surface status and message without the caller token", async () => {
  const stub = createFetchStub(() => ({
    status: 401,
    body: { message: "JWT expired", code: "PGRST301" },
  }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });

  await assert.rejects(
    () => repository.list(accessToken, { limit: 25, offset: 0 }),
    (error: unknown) => {
      if (!(error instanceof PostgrestError)) return false;
      assert.equal(error.status, 401);
      assert.match(error.message, /401/);
      assert.match(error.message, /JWT expired/);
      assert.equal(error.message.includes(accessToken), false);
      return true;
    },
  );
});

test("a non-JSON PostgREST body does not crash the mapping layer", async () => {
  const stub = createFetchStub(() => ({ status: 502, body: "<html>bad gateway</html>" }));
  const repository = createSprawnoscRepository({ config, fetchImpl: stub.fetchImpl });
  await assert.rejects(
    () => repository.list(accessToken, { limit: 25, offset: 0 }),
    (error: unknown) => error instanceof PostgrestError && error.status === 502,
  );
});
