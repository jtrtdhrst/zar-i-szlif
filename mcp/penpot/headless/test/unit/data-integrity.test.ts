/**
 * Unit regression tests for P0/P1 Penpot MCP data-integrity fixes:
 * - SHAPE_ID_CONFLICT on duplicate UUID (existing, in-batch, reserved root, batch create)
 * - lossless text patching (characters-only preserves fills/typography)
 * - penpot_get_shape never returns {} (typed errors instead)
 */
import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { contentTools } from '../../src/tools/content.js'
import { ROOT_FRAME_ID, applyCharactersToParagraphs } from '../../src/shape-builders.js'
import type { PenpotRpcClient } from '../../src/rpc-client.js'
import type { ZodType } from 'zod'

const TOKENS_PATH = resolve(import.meta.dirname, '../integration/fixtures/tokens.json')

type AnyTool = {
  name: string
  description: string
  inputSchema: ZodType<unknown>
  handler: (client: PenpotRpcClient, input: Record<string, unknown>) => Promise<unknown>
}

const TOOLS = contentTools(TOKENS_PATH) as unknown as AnyTool[]
function getTool(name: string): AnyTool {
  const t = TOOLS.find((t) => t.name === name)
  if (!t) throw new Error(`Tool not found: ${name}`)
  return t
}
async function callTool(tool: AnyTool, client: PenpotRpcClient, input: Record<string, unknown>) {
  const parsed = tool.inputSchema.parse(input) as Record<string, unknown>
  return tool.handler(client, parsed)
}

function makeTextContent(color = '#336699'): Record<string, unknown> {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph-set',
        children: [
          {
            type: 'paragraph',
            fontFamily: 'Inter',
            fontSize: '14',
            fontWeight: '400',
            fills: [{ fillColor: color, fillOpacity: 1 }],
            children: [
              { text: 'Hello', fontFamily: 'Inter', fontSize: '14', fontWeight: '400', fills: [{ fillColor: color, fillOpacity: 1 }] },
            ],
          },
        ],
      },
    ],
  }
}

function makeRoot(childIds: string[] = []): Record<string, unknown> {
  return {
    id: ROOT_FRAME_ID, type: 'frame', name: 'root', x: 0, y: 0, width: 1920, height: 1080, rotation: 0,
    parentId: ROOT_FRAME_ID, frameId: ROOT_FRAME_ID, 'parent-id': ROOT_FRAME_ID, 'frame-id': ROOT_FRAME_ID,
    shapes: childIds, fills: [], strokes: [], shadows: [],
  }
}

function makeTextShape(id: string, color = '#336699'): Record<string, unknown> {
  return {
    id, type: 'text', name: 'T', x: 10, y: 20, width: 200, height: 40, rotation: 0,
    parentId: ROOT_FRAME_ID, frameId: ROOT_FRAME_ID, 'parent-id': ROOT_FRAME_ID, 'frame-id': ROOT_FRAME_ID,
    fills: [{ fillColor: color, fillOpacity: 1 }], strokes: [], shadows: [],
    'grow-type': 'auto-width', content: makeTextContent(color),
  }
}

function makeRectShape(id: string): Record<string, unknown> {
  return {
    id, type: 'rect', name: 'R', x: 0, y: 0, width: 10, height: 10, rotation: 0,
    parentId: ROOT_FRAME_ID, frameId: ROOT_FRAME_ID, 'parent-id': ROOT_FRAME_ID, 'frame-id': ROOT_FRAME_ID,
    fills: [{ fillColor: '#FF0000', fillOpacity: 1 }], strokes: [], shadows: [], r1: 0, r2: 0, r3: 0, r4: 0,
  }
}

function makeClient(objects: Record<string, Record<string, unknown>>): PenpotRpcClient {
  return {
    getFile: vi.fn().mockResolvedValue({
      id: 'file-1', revn: 0, vern: 0,
      data: { pages: ['page-1'], pagesIndex: { 'page-1': { name: 'Page 1', objects } }, components: {} },
    }),
    updateFile: vi.fn().mockResolvedValue({ revn: 1 }),
  } as unknown as PenpotRpcClient
}

describe('SHAPE_ID_CONFLICT', () => {
  it('rejects create with an already-existing UUID without calling updateFile', async () => {
    const existingId = 'a52c96d0-b9e2-4e8f-8b6f-000000000064'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([existingId]), [existingId]: makeRectShape(existingId) })
    const tool = getTool('penpot_add_shapes')
    await expect(callTool(tool, client, {
      fileId: 'file-1', pageId: 'page-1',
      shapes: [{ type: 'rect', id: existingId, name: 'DUPLICATE', x: 800, y: 700, width: 30, height: 30, fillColor: '#F50057' }],
    })).rejects.toThrow(/SHAPE_ID_CONFLICT/)
    expect((client.updateFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('rejects a batch containing the same UUID twice (atomic, no partial write)', async () => {
    const dup = '11111111-1111-4111-8111-111111111111'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([]) })
    const tool = getTool('penpot_add_shapes')
    await expect(callTool(tool, client, {
      fileId: 'file-1', pageId: 'page-1',
      shapes: [
        { type: 'rect', id: dup, name: 'A', x: 0, y: 0, width: 10, height: 10 },
        { type: 'rect', id: dup, name: 'B', x: 20, y: 20, width: 10, height: 10 },
      ],
    })).rejects.toThrow(/SHAPE_ID_CONFLICT/)
    expect((client.updateFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('rejects the reserved root UUID as a new shape id', async () => {
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([]) })
    const tool = getTool('penpot_add_shapes')
    await expect(callTool(tool, client, {
      fileId: 'file-1', pageId: 'page-1',
      shapes: [{ type: 'rect', id: ROOT_FRAME_ID, name: 'Root?', x: 0, y: 0, width: 10, height: 10 }],
    })).rejects.toThrow(/SHAPE_ID_CONFLICT/)
  })

  it('penpot_batch create rejects a duplicate UUID without mutation', async () => {
    const existingId = '22222222-2222-4222-8222-222222222222'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([existingId]), [existingId]: makeRectShape(existingId) })
    const tool = getTool('penpot_batch')
    await expect(callTool(tool, client, {
      fileId: 'file-1', pageId: 'page-1',
      ops: [{ op: 'create', shape: { type: 'rect', id: existingId, name: 'Dup', x: 0, y: 0, width: 5, height: 5 } }],
    })).rejects.toThrow(/SHAPE_ID_CONFLICT/)
    expect((client.updateFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})

describe('lossless text patching', () => {
  it('characters-only update preserves the original fill color', async () => {
    const id = '33333333-3333-4333-8333-333333333333'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([id]), [id]: makeTextShape(id, '#336699') })
    const tool = getTool('penpot_update_shapes')
    await callTool(tool, client, { fileId: 'file-1', pageId: 'page-1', patches: [{ shapeId: id, characters: 'UPDATED' }] })
    const call = (client.updateFile as ReturnType<typeof vi.fn>).mock.calls[0]!
    const change = (call[3] as Array<{ obj: Record<string, unknown> }>)[0]!.obj
    // Shape-level fills preserved
    expect(change.fills).toEqual([{ 'fill-color': '#336699', 'fill-opacity': 1 }])
    // Content still carries the original color (not reset to black)
    const content = change.content as { children: Array<{ children: Array<{ fills: unknown[]; children: Array<{ text: string; fills: unknown[] }> }> }> }
    const para = content.children[0]!.children[0]!
    expect(JSON.stringify(para)).toContain('#336699')
    expect(JSON.stringify(para)).not.toContain('#000000')
    const leafTexts = para.children.map((l) => l.text).join('')
    expect(leafTexts).toContain('UPDATED')
  })

  it('applyCharactersToParagraphs preserves Polish diacritics, emoji and multiline', () => {
    const paras = [
      { ranges: [{ text: 'old', fontWeight: '700', fills: [{ 'fill-color': '#22AF55', 'fill-opacity': 1 }] }] },
    ]
    const out = applyCharactersToParagraphs(paras, 'Żar i Szlif\nZażółć gęślą jaźń 🎨')
    expect(out).toHaveLength(2)
    expect(out[0]!.ranges[0]!.text).toBe('Żar i Szlif')
    expect(out[1]!.ranges[0]!.text).toContain('Zażółć')
    expect(out[0]!.ranges[0]!.fontWeight).toBe('700')
    expect(out[0]!.ranges[0]!.fills).toEqual([{ 'fill-color': '#22AF55', 'fill-opacity': 1 }])
  })
})

describe('penpot_get_shape', () => {
  it('returns a non-empty text shape with content', async () => {
    const id = '44444444-4444-4444-8444-444444444444'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([id]), [id]: makeTextShape(id) })
    const tool = getTool('penpot_get_shape')
    const res = (await callTool(tool, client, { fileId: 'file-1', pageId: 'page-1', shapeId: id })) as Record<string, unknown>
    expect(res.id).toBe(id)
    expect(res.type).toBe('text')
    expect(res.content).toBeDefined()
    expect(Object.keys(res).length).toBeGreaterThan(1)
  })

  it('throws SHAPE_NOT_FOUND for a missing shape instead of returning {}', async () => {
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([]) })
    const tool = getTool('penpot_get_shape')
    await expect(callTool(tool, client, { fileId: 'file-1', pageId: 'page-1', shapeId: 'nope' })).rejects.toThrow(/SHAPE_NOT_FOUND/)
  })

  it('throws SHAPE_SERIALIZATION_FAILED instead of returning {} for an empty stored object', async () => {
    const id = '55555555-5555-4555-8555-555555555555'
    const client = makeClient({ [ROOT_FRAME_ID]: makeRoot([id]), [id]: {} })
    const tool = getTool('penpot_get_shape')
    await expect(callTool(tool, client, { fileId: 'file-1', pageId: 'page-1', shapeId: id })).rejects.toThrow(/SHAPE_SERIALIZATION_FAILED/)
  })
})
