import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

const env = {
  UPSTREAM_URL: 'https://penpot-engine.zariszlif.pl/mcp/stream',
  UPSTREAM_TOKEN_PARAM: 'userToken',
  UPSTREAM_TOKEN: 'upstream-test-secret',
  MCP_AUTH_TOKEN: 'edge-test-secret',
};

test('Penpot standard /mcp is routed to the hybrid /mcp/stream endpoint', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'test-session' },
    });
  });
  const response = await worker.fetch(new Request('https://penpot-mcp.zariszlif.pl/mcp?client=sandbox', {
    method: 'POST',
    headers: { authorization: 'Bearer edge-test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 7 }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), 'test-session');
  assert.equal(calls.length, 1);
  const routed = new URL(calls[0].url);
  assert.equal(routed.origin, 'https://penpot-engine.zariszlif.pl');
  assert.equal(routed.pathname, '/mcp/stream');
  assert.equal(routed.searchParams.get('client'), 'sandbox');
  assert.equal(routed.searchParams.get('userToken'), 'upstream-test-secret');
});

test('Penpot /mcp/stream remains unchanged; missing client credential fails closed', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return new Response('upstream');
  });
  const denied = await worker.fetch(new Request('https://penpot-mcp.zariszlif.pl/mcp'), env);
  assert.equal(denied.status, 401);
  assert.equal(calls.length, 0);
  const ok = await worker.fetch(new Request('https://penpot-mcp.zariszlif.pl/mcp/stream', {
    headers: { authorization: 'Bearer edge-test-secret' },
  }), env);
  assert.equal(ok.status, 200);
  assert.equal(new URL(calls[0]).pathname, '/mcp/stream');
});

test('An unrelated MCP service keeps its original /mcp route', async (t) => {
  let requested;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested = String(url);
    return new Response('ok');
  });
  const response = await worker.fetch(new Request('https://qdrant-mcp.zariszlif.pl/mcp'),
    { UPSTREAM_URL: 'https://qdrant-engine.zariszlif.pl/mcp' });
  assert.equal(response.status, 200);
  assert.equal(new URL(requested).pathname, '/mcp');
});
