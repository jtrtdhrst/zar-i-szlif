import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const base = process.env.HEADLESS_MCP_URL || 'http://127.0.0.1:3000/mcp'
const tokenFile = process.env.PENPOT_MCP_AUTH_TOKEN_FILE || '/run/secrets/mcp-token'
const token = readFileSync(tokenFile, 'utf8').trim()
let id = 0

async function post(method, params = {}, auth = token) {
  const url = new URL(base)
  url.searchParams.set('userToken', auth)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

async function connect() {
  const init = await post('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'penpot-headless-e2e', version: '1.0' },
  })
  assert.equal(init.status, 200, 'MCP initialize')
  await post('notifications/initialized')
  const listed = await post('tools/list')
  assert.equal(listed.status, 200, 'MCP tools/list')
  const names = listed.body.result.tools.map((tool) => tool.name)
  for (const required of ['penpot_create_file', 'penpot_create_page', 'penpot_add_shapes', 'penpot_get_file_snapshot']) {
    assert.ok(names.includes(required), `missing headless tool ${required}`)
  }
  for (const forbidden of ['execute_code', 'penpot_delete_file', 'penpot_delete_shapes', 'penpot_restore_file_snapshot']) {
    assert.ok(!names.includes(forbidden), `unsafe tool ${forbidden} must not be exposed`)
  }
  return names
}

async function tool(name, args) {
  const response = await post('tools/call', { name, arguments: args })
  assert.equal(response.status, 200, `${name} HTTP status`)
  assert.equal(response.body.error, undefined, `${name} JSON-RPC error`)
  const result = response.body.result
  const text = result?.content?.find((item) => item.type === 'text')?.text
  assert.ok(text, `${name} text result`)
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

function fileRows(value) {
  if (Array.isArray(value)) return value
  for (const key of ['files', 'items']) if (Array.isArray(value?.[key])) return value[key]
  throw new Error('penpot_list_files returned an unexpected shape')
}

async function createTestFile() {
  const projectId = process.env.HEADLESS_TEST_PROJECT_ID
  assert.ok(projectId, 'set HEADLESS_TEST_PROJECT_ID to the empty Drafts project')
  const name = `MCP-Headless-RPC-${Date.now()}`

  const denied = await post('initialize', {}, 'invalid-test-token')
  assert.equal(denied.status, 401, 'invalid MCP token must be rejected')
  const names = await connect()
  const before = fileRows(await tool('penpot_list_files', { projectId }))
  assert.ok(!before.some((file) => file.name === name), 'unique test file name')

  await tool('penpot_create_file', { projectId, name })
  const after = fileRows(await tool('penpot_list_files', { projectId }))
  const file = after.find((item) => item.name === name)
  assert.ok(file?.id, 'created file must be discoverable by file ID')

  const snapshot = await tool('penpot_get_file_snapshot', { fileId: file.id })
  assert.ok(snapshot.data.pages[0], 'new file must contain its default page')
  const pageName = 'Headless RPC verification'
  const pageId = randomUUID()
  const pageWrite = await tool('penpot_create_page', { fileId: file.id, name: pageName, pageId })
  assert.ok(pageWrite.pageId === pageId, 'page create must return the explicit pageId')
  const afterPage = await tool('penpot_get_file_snapshot', { fileId: file.id })
  assert.equal(afterPage.data.pagesIndex[pageId]?.name, pageName, 'page must be readable after create')

  const shapeName = 'Headless RPC line'
  const shapeId = randomUUID()
  await tool('penpot_add_shapes', {
    fileId: file.id,
    pageId,
    shapes: [{
      id: shapeId,
      type: 'path',
      name: shapeName,
      content: [
        { command: 'move-to', params: { x: 80, y: 180 } },
        { command: 'line-to', params: { x: 420, y: 180 } },
      ],
      stroke: { color: '#2563EB', opacity: 1, width: 4, style: 'solid', alignment: 'center' },
    }],
  })
  // Read back by caller-chosen IDs. Never retry a timed-out/stale write blindly.
  const shape = await tool('penpot_get_shape', {
    fileId: file.id,
    pageId,
    shapeId,
    includeDescendants: false,
  })
  assert.equal(shape.id, shapeId)
  assert.equal(shape.type, 'path')
  assert.equal(shape.name, shapeName)
  assert.ok(JSON.stringify(shape.content).includes('420'), 'line endpoint must be readable')

  console.log(JSON.stringify({
    result: 'CREATE_PASS',
    exposedTools: names.length,
    fileId: file.id,
    fileName: name,
    pageId,
    pageName,
    shapeId,
    shapeName,
  }))
}

async function verifyPersistedFile() {
  const fileId = process.env.HEADLESS_TEST_FILE_ID
  const pageId = process.env.HEADLESS_TEST_PAGE_ID
  const shapeId = process.env.HEADLESS_TEST_SHAPE_ID
  assert.ok(fileId && pageId && shapeId, 'set HEADLESS_TEST_FILE_ID, HEADLESS_TEST_PAGE_ID and HEADLESS_TEST_SHAPE_ID')
  const names = await connect()
  const snapshot = await tool('penpot_get_file_snapshot', { fileId })
  const page = snapshot.data.pagesIndex[pageId]
  assert.equal(page?.name, 'Headless RPC verification', 'page must persist after server restart')
  const shape = await tool('penpot_get_shape', { fileId, pageId, shapeId, includeDescendants: false })
  assert.equal(shape.id, shapeId)
  assert.equal(shape.type, 'path')
  assert.equal(shape.name, 'Headless RPC line')
  assert.ok(JSON.stringify(shape.content).includes('420'), 'line must persist after server restart')
  console.log(JSON.stringify({ result: 'PERSISTENCE_PASS', exposedTools: names.length, fileId, pageId, shapeId }))
}

async function addLineToExistingFile() {
  const fileId = process.env.HEADLESS_TEST_FILE_ID
  const pageId = process.env.HEADLESS_TEST_PAGE_ID
  assert.ok(fileId && pageId, 'set HEADLESS_TEST_FILE_ID and HEADLESS_TEST_PAGE_ID')
  await connect()
  const before = await tool('penpot_get_file_snapshot', { fileId })
  assert.equal(before.data.pagesIndex[pageId]?.name, 'Headless RPC verification', 'test page must exist')
  const shapeId = randomUUID()
  await tool('penpot_add_shapes', {
    fileId,
    pageId,
    shapes: [{
      id: shapeId,
      type: 'path',
      name: 'Headless RPC line',
      content: [
        { command: 'move-to', params: { x: 80, y: 180 } },
        { command: 'line-to', params: { x: 420, y: 180 } },
      ],
      stroke: { color: '#2563EB', opacity: 1, width: 4, style: 'solid', alignment: 'center' },
    }],
  })
  const shape = await tool('penpot_get_shape', { fileId, pageId, shapeId, includeDescendants: false })
  assert.equal(shape.id, shapeId)
  assert.equal(shape.type, 'path')
  assert.equal(shape.name, 'Headless RPC line')
  assert.ok(JSON.stringify(shape.content).includes('420'), 'line endpoint must be readable')
  console.log(JSON.stringify({ result: 'WRITE_PASS', fileId, pageId, shapeId }))
}

if (process.argv[2] === 'create') await createTestFile()
else if (process.argv[2] === 'recover') await addLineToExistingFile()
else if (process.argv[2] === 'verify') await verifyPersistedFile()
else throw new Error('usage: node test/headless-e2e.mjs create|recover|verify')
