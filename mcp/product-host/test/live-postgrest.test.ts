// Optional live PostgREST check — the regression the staging E2E exposed.
//
// Disabled by default so `npm test` needs no network and no real credentials.
// Enable it against a real project to prove that equality filters actually match
// rows (a quoted `eq."<value>"` returns [] there):
//
//   PRODUCT_HOST_LIVE_TEST=1 \
//   LIVE_SUPABASE_URL=https://<project>.supabase.co \
//   LIVE_SUPABASE_ANON_KEY=<anon key> \
//   LIVE_ACCESS_TOKEN=<access token of a signed-in test user> \
//   npm test
//
// Never commit a token; pass it through the environment of a single run.

import test from "node:test";
import assert from "node:assert/strict";
import { createSprawnoscRepository } from "../src/supabase.ts";

const liveUrl = process.env.LIVE_SUPABASE_URL;
const liveKey = process.env.LIVE_SUPABASE_ANON_KEY;
const liveToken = process.env.LIVE_ACCESS_TOKEN;
const enabled =
  process.env.PRODUCT_HOST_LIVE_TEST === "1" && Boolean(liveUrl && liveKey && liveToken);

const skip = enabled
  ? {}
  : {
      skip:
        "live PostgREST check disabled: set PRODUCT_HOST_LIVE_TEST=1, LIVE_SUPABASE_URL, " +
        "LIVE_SUPABASE_ANON_KEY and LIVE_ACCESS_TOKEN",
    };

test("live PostgREST: equality filters match the rows they name", skip, async () => {
  const repository = createSprawnoscRepository({
    config: { url: liveUrl as string, anonKey: liveKey as string },
  });
  const token = liveToken as string;

  const page = await repository.list(token, { limit: 1, offset: 0 });
  const expected = page.items[0];
  assert.ok(expected, "the token must see at least one sprawnosc row");

  const byId = await repository.get(token, expected.id);
  assert.equal(byId.id, expected.id, "get_sprawnosc must find a row that list returned");

  const byPoziom = await repository.list(token, { poziom: expected.poziom, limit: 10, offset: 0 });
  assert.ok(
    byPoziom.items.some((item) => item.id === expected.id),
    `poziom=${expected.poziom} must match the row`,
  );

  const byAspekt = await repository.list(token, { aspekt: expected.aspekt, limit: 10, offset: 0 });
  assert.ok(
    byAspekt.items.some((item) => item.id === expected.id),
    `aspekt=${expected.aspekt} must match the row`,
  );

  const byGrupa = await repository.list(token, { grupa: expected.grupa, limit: 10, offset: 0 });
  assert.ok(
    byGrupa.items.some((item) => item.id === expected.id),
    `grupa=${expected.grupa} must match the row`,
  );

  const searched = await repository.list(token, { query: expected.tytul.split(" ")[0] ?? expected.id, limit: 10, offset: 0 });
  assert.ok(searched.items.length > 0, "a query term from a real tytul must match something");
});
