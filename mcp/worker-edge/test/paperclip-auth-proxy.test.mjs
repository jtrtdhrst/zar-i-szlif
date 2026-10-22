import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const base = {
  UPSTREAM_URL: "https://paperclip-engine.zariszlif.pl/mcp",
  PAPERCLIP_AUTH_PROXY: "1",
};

function capture(t, upstreamResponse) {
  let forwarded = null;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    forwarded = { url: String(url), init };
    return upstreamResponse;
  });
  return () => forwarded;
}

test("Paperclip OAuth redirect Location survives the edge proxy", async (t) => {
  const read = capture(t, new Response(null, { status: 302, headers: {
    location: "https://chatgpt.com/connector/callback?code=opaque",
    "set-cookie": "session=private",
  }}));
  const res = await worker.fetch(
    new Request("https://paperclip-mcp.zariszlif.pl/oauth/authorize?client_id=cli"),
    base,
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://chatgpt.com/connector/callback?code=opaque");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(read().url, "https://paperclip-engine.zariszlif.pl/oauth/authorize?client_id=cli");
  assert.equal(read().init.headers.get("x-forwarded-host"), "paperclip-mcp.zariszlif.pl");
  assert.equal(read().init.headers.get("x-forwarded-proto"), "https");
});

test("OAuth challenge and protected-resource metadata link survive an unauthorized MCP call", async (t) => {
  const challenge = 'Bearer resource_metadata="https://paperclip-mcp.zariszlif.pl/.well-known/oauth-protected-resource/mcp", scope="mcp"';
  capture(t, new Response('{"error":"Unauthorized"}', {
    status: 401, headers: { "content-type": "application/json", "www-authenticate": challenge },
  }));
  const res = await worker.fetch(
    new Request("https://paperclip-mcp.zariszlif.pl/mcp", { method: "POST", body: "{}" }),
    base,
  );
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), challenge);
});

test("verified board/run context reaches only the Paperclip gateway, never a forged actor id", async (t) => {
  const read = capture(t, new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));
  const res = await worker.fetch(new Request("https://paperclip-mcp.zariszlif.pl/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer caller-credential",
      "x-paperclip-run-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "x-paperclip-board-api-key": "caller-provided-board-key",
      "x-paperclip-agent-id": "forged-agent",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
    },
    body: "{}",
  }), base);
  assert.equal(res.status, 200);
  const h = read().init.headers;
  assert.equal(h.get("authorization"), "Bearer caller-credential");
  assert.equal(h.get("x-paperclip-run-id"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(h.get("x-paperclip-board-api-key"), "caller-provided-board-key");
  assert.equal(h.get("x-paperclip-agent-id"), null);
  assert.equal(h.get("x-forwarded-host"), "paperclip-mcp.zariszlif.pl");
  assert.equal(h.get("x-forwarded-proto"), "https");
});

test("Paperclip proxy fails closed if a shared edge credential could collapse principals", async (t) => {
  const read = capture(t, new Response("unreachable"));
  const res = await worker.fetch(new Request("https://paperclip-mcp.zariszlif.pl/mcp", {
    headers: { Authorization: "Bearer real-user" },
  }), { ...base, UPSTREAM_TOKEN: "shared-service-token" });
  assert.equal(res.status, 503);
  assert.equal(read(), null);
  const health = await worker.fetch(new Request("https://paperclip-mcp.zariszlif.pl/health"), { ...base, UPSTREAM_TOKEN: "shared-service-token" });
  assert.equal(health.status, 503);
  assert.equal((await health.json()).ok, false);
});

test("unrelated MCP worker keeps existing auth-header allowlist", async (t) => {
  const read = capture(t, new Response(null, { status: 302, headers: { location: "https://example.org" } }));
  const res = await worker.fetch(new Request("https://qdrant-mcp.zariszlif.pl/mcp", {
    headers: { "x-paperclip-board-api-key": "secret" },
  }), { UPSTREAM_URL: "https://qdrant-engine.zariszlif.pl/mcp" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), null);
  assert.equal(read().init.headers.get("x-paperclip-board-api-key"), null);
  assert.equal(read().init.headers.get("x-forwarded-host"), null);
});
