import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

// Regression suite for the paperclip MCP edge (KOMAA-1008).
//
// The edge must never collapse a real caller credential into the shared
// UPSTREAM_TOKEN: doing so makes `paperclipMe` resolve the service identity
// (or fail with unresolved_identity when the service credential has no run
// context) instead of the authenticated owner. It must also carry the
// identity/run headers that the engine needs to bind run-scoped calls.

type Captured = { url: string; headers: Headers };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubUpstream(make: () => Response): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return make();
  }) as typeof fetch;
  return calls;
}

const UPSTREAM = "https://paperclip-engine.zariszlif.pl/mcp";
const ENV = { UPSTREAM_URL: UPSTREAM };
const ENV_SECRET = { UPSTREAM_URL: UPSTREAM, UPSTREAM_TOKEN: "pcp_service_secret" };
const ENV_GATED = { ...ENV_SECRET, MCP_AUTH_TOKEN: "edge-gate" };
const RUN_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";

function request(headers: Record<string, string> = {}, path = "/mcp") {
  return new Request(`https://paperclip-mcp.zariszlif.pl${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "paperclipMe", arguments: {} },
    }),
  });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("preserves the caller bearer instead of replacing it with UPSTREAM_TOKEN", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  const res = await worker.fetch(request({ authorization: "Bearer pcmcp_at_owner" }), ENV_SECRET);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get("authorization"), "Bearer pcmcp_at_owner");
});

test("forwards run/board/agent identity headers with the caller credential", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  await worker.fetch(
    request({
      authorization: "Bearer pcmcp_at_owner",
      "x-paperclip-run-id": RUN_ID,
      "x-paperclip-board-api-key": "pcp_board_owner",
      "x-paperclip-agent-id": AGENT_ID,
    }),
    ENV_SECRET,
  );
  assert.equal(calls[0].headers.get("x-paperclip-run-id"), RUN_ID);
  assert.equal(calls[0].headers.get("x-paperclip-board-api-key"), "pcp_board_owner");
  assert.equal(calls[0].headers.get("x-paperclip-agent-id"), AGENT_ID);
});

test("uses UPSTREAM_TOKEN only when the caller presents no credential", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  await worker.fetch(request({ "x-paperclip-run-id": RUN_ID }), ENV_SECRET);
  assert.equal(calls[0].headers.get("authorization"), "Bearer pcp_service_secret");
  // A run id must never be attached to a service-owned credential.
  assert.equal(calls[0].headers.get("x-paperclip-run-id"), null);
});

test("shared edge gate keeps service identity and does not forward caller run context", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  await worker.fetch(
    request({ authorization: "Bearer edge-gate", "x-paperclip-run-id": RUN_ID }),
    ENV_GATED,
  );
  assert.equal(calls[0].headers.get("authorization"), "Bearer pcp_service_secret");
  assert.equal(calls[0].headers.get("x-paperclip-run-id"), null);
});

test("unauthenticated denial is deterministic and advertises OAuth metadata", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  for (let i = 0; i < 2; i += 1) {
    const res = await worker.fetch(request(), ENV_GATED);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, -32001);
    assert.match(res.headers.get("www-authenticate") ?? "", /oauth-protected-resource\/mcp/);
  }
  assert.equal(calls.length, 0);
});

test("preserves upstream 403 and OAuth challenge verbatim", async () => {
  const calls = stubUpstream(() =>
    jsonResponse(403, { error: "caller identity could not be bound to a Paperclip principal" }, {
      "www-authenticate": 'Bearer resource_metadata="https://paperclip-mcp.zariszlif.pl/.well-known/oauth-protected-resource/mcp"',
    }),
  );
  for (let i = 0; i < 2; i += 1) {
    const res = await worker.fetch(request({ authorization: "Bearer stale" }), ENV);
    assert.equal(res.status, 403);
    assert.match(res.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  }
  assert.equal(calls.length, 2);
});

test("repeated/paginated issue reads keep the same caller identity deterministically", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  for (let i = 0; i < 25; i += 1) {
    const res = await worker.fetch(request({ authorization: "Bearer pcmcp_at_owner" }), ENV);
    assert.equal(res.status, 200);
  }
  assert.equal(calls.length, 25);
  for (const call of calls) assert.equal(call.headers.get("authorization"), "Bearer pcmcp_at_owner");
});

test("query-token services keep replacing the client token (Penpot contract)", async () => {
  const calls = stubUpstream(() => jsonResponse(200, { result: { ok: true } }));
  const res = await worker.fetch(
    request({}, "/mcp?userToken=client-token"),
    { UPSTREAM_URL: UPSTREAM, UPSTREAM_TOKEN: "server-token", UPSTREAM_TOKEN_PARAM: "userToken" },
  );
  assert.equal(res.status, 200);
  assert.equal(new URL(calls[0].url).searchParams.get("userToken"), "server-token");
  assert.equal(calls[0].headers.get("authorization"), null);
});
