import { describe, expect, it } from 'vitest'
import { toMcpToolResult } from '../../src/mcp-result.js'

describe('MCP tool-result envelopes', () => {
  it.each([
    ['text', { children: [{ type: 'paragraph', text: 'Żar i Szlif' }] }],
    ['path', [{ command: 'move-to', params: { x: 1, y: 2 } }]],
    ['bool', { op: 'union', shapes: ['a', 'b'] }],
  ])('preserves %s shape content without protocol-level content collision', (type, shapeContent) => {
    const shape = { id: 'shape-1', type, name: 'E2E specimen', content: shapeContent }
    const response = toMcpToolResult('penpot_get_shape', shape)
    const textPayload = JSON.parse(response.content[0]!.text)
    expect(textPayload).toEqual({ shape })
    expect(Object.keys(textPayload)).toEqual(['shape'])
    expect('content' in textPayload).toBe(false)
    expect(response.structuredContent).toEqual({ shape })
    expect((response.structuredContent as { shape: typeof shape }).shape.content).toEqual(shapeContent)
  })

  it('wraps a plain rectangle in the same stable shape envelope', () => {
    const rect = { id: 'rect-1', type: 'rect', fills: [{ fillColor: '#123456' }] }
    const response = toMcpToolResult('penpot_get_shape', rect)
    expect(JSON.parse(response.content[0]!.text)).toEqual({ shape: rect })
    expect(response.structuredContent).toEqual({ shape: rect })
  })

  it('does not change existing responses for other actions', () => {
    const value = { shapeIds: ['a'], revn: 7 }
    const response = toMcpToolResult('penpot_add_shapes', value)
    expect(JSON.parse(response.content[0]!.text)).toEqual(value)
    expect(response).not.toHaveProperty('structuredContent')
  })
})
