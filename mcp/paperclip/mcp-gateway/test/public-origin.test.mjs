import assert from "node:assert/strict";
import test from "node:test";
import { createOriginResolver, normalizeOrigin } from "../public-origin.mjs";

const CANONICAL = "https://paperclip-mcp.kompaszbiorek.pl";
const ALIAS = "https://paperclip-mcp.zariszlif.pl";

function resolver(extra = {}) {
  return createOriginResolver({
    publicBaseUrl: CANONICAL,
    publicOrigins: [ALIAS],
    ...extra,
  });
}

test("normalizeOrigin accepts origins and rejects junk", () => {
  assert.equal(normalizeOrigin("https://example.test/path"), "https://example.test");
  assert.equal(normalizeOrigin("not a url"), "");
  assert.equal(normalizeOrigin(""), "");
  assert.equal(normalizeOrigin(undefined), "");
});

test("canonical origin wins when no request headers are present", () => {
  assert.equal(resolver().resolve({ headers: {} }), CANONICAL);
});

test("allowlisted alias origin is advertised per request", () => {
  const origin = resolver().resolve({
    headers: { "x-forwarded-host": "paperclip-mcp.zariszlif.pl", "x-forwarded-proto": "https" },
  });
  assert.equal(origin, ALIAS);
});

test("canonical forwarded host stays canonical", () => {
  const origin = resolver().resolve({
    headers: { "x-forwarded-host": "paperclip-mcp.kompaszbiorek.pl", "x-forwarded-proto": "https" },
  });
  assert.equal(origin, CANONICAL);
});

test("unlisted host cannot rewrite OAuth metadata", () => {
  const origin = resolver().resolve({
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
  });
  assert.equal(origin, CANONICAL);
});

test("plain host header is honoured only for allowlisted origins", () => {
  assert.equal(resolver().resolve({ headers: { host: "paperclip-mcp.zariszlif.pl" } }), ALIAS);
  assert.equal(resolver().resolve({ headers: { host: "evil.example" } }), CANONICAL);
});

test("local/internal hosts default to http (no forwarded proto)", () => {
  const local = createOriginResolver({ publicBaseUrl: "", publicOrigins: "" });
  assert.equal(local.resolve({ headers: { host: "127.0.0.1:3101" } }), "http://127.0.0.1:3101");
});

test("without an allowlist the request origin is derived (legacy behaviour)", () => {
  const derived = createOriginResolver({ publicBaseUrl: "", publicOrigins: "" });
  assert.equal(
    derived.resolve({ headers: { "x-forwarded-host": "any.example", "x-forwarded-proto": "https" } }),
    "https://any.example",
  );
});

test("origin list accepts a comma separated env value", () => {
  const csv = createOriginResolver({ publicBaseUrl: CANONICAL, publicOrigins: `${ALIAS}, https://third.example` });
  assert.equal(csv.publicOrigins.size, 3);
  assert.equal(csv.resolve({ headers: { "x-forwarded-host": "third.example", "x-forwarded-proto": "https" } }), "https://third.example");
});
