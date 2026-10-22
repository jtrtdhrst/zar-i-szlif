import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const base = process.env.PENPOT_ROUTER_URL || 'http://127.0.0.1:3001/mcp'
const token = readFileSync(process.env.MCP_TOKEN_FILE || '/run/secrets/mcp-token', 'utf8').trim()
const mode = process.env.EXPECT_PLUGIN === '1' ? 'interactive' : 'headless'
let id = 0
let sessionId

function parseResponse(text) {
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue
    try { return JSON.parse(line.slice(6)) } catch {}
  }
  throw new Error('MCP response was neither JSON nor SSE JSON data')
}

async function post(method, params = {}, auth = token) {
  const url = new URL(base)
  url.searchParams.set('userToken', auth)
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(60000),
  })
  sessionId = response.headers.get('mcp-session-id') || sessionId
  const text = await response.text()
  return { status: response.status, body: parseResponse(text) }
}

const denied = await post('initialize', {}, 'invalid-test-token')
assert.equal(denied.status, 401, 'invalid token must be rejected')
const init = await post('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'penpot-hybrid-router-smoke', version: '1.0' },
})
assert.equal(init.status, 200, 'initialize must succeed')
await post('notifications/initialized')
const listed = await post('tools/list')
assert.equal(listed.status, 200, 'tools/list must succeed')
const tools = listed.body.result.tools.map((tool) => tool.name)

if (mode === 'headless') {
  assert.ok(tools.includes('penpot_add_shapes'), 'headless tools must be present without a plugin')
  assert.ok(!tools.includes('execute_code'), 'native plugin tools must be hidden without an active plugin')
  const fileId = process.env.HEADLESS_TEST_FILE_ID
  assert.ok(fileId, 'HEADLESS_TEST_FILE_ID required for the headless route smoke')
  const call = await post('tools/call', { name: 'penpot_get_file_snapshot', arguments: { fileId } })
  assert.equal(call.status, 200)
  assert.equal(call.body.result.isError, undefined)
  const snapshot = JSON.parse(call.body.result.content[0].text)
  assert.equal(snapshot.id, fileId)
} else {
  assert.ok(tools.includes('execute_code'), 'native plugin tools should appear when the plugin is connected')
  assert.ok(tools.includes('penpot_add_shapes'), 'headless fallback tools should remain available if the plugin closes mid-session')
  const call = await post('tools/call', {
    name: 'execute_code',
    arguments: { code: 'return {ok:true,file:penpot.currentFile?.name||null};' },
  })
  assert.equal(call.status, 200)
  assert.equal(call.body.result.isError, undefined)
}

console.log(JSON.stringify({ result: 'PASS', mode, exposedToolCount: tools.length, execute_code: tools.includes('execute_code') }))
