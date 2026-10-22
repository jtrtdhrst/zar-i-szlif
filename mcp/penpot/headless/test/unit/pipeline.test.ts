/**
 * Unit tests for the headless design pipeline (no network — client is mocked).
 * Covers: SVG sanitizer/converter, SVG serializer basics, hierarchy validation
 * (protected root, cycles, dryRun), and the export-frame input contract.
 */
import { describe, it, expect, vi } from 'vitest'
import { sanitizeSvg, convertSvg } from '../../src/render/svg-import.js'
import { serializeSubtree } from '../../src/render/svg-serialize.js'
import { mutateHierarchyTool } from '../../src/tools/hierarchy.js'
import { exportFrameTool } from '../../src/tools/export-frame.js'
import { ROOT_FRAME_ID } from '../../src/shape-builders.js'
import type { PenpotRpcClient } from '../../src/rpc-client.js'

const PAGE = 'page-1'
const FILE = 'file-1'

function pageObjects() {
  return {
    [ROOT_FRAME_ID]: {
      id: ROOT_FRAME_ID, type: 'frame', name: 'root',
      'parent-id': ROOT_FRAME_ID, 'frame-id': ROOT_FRAME_ID,
      selrect: { x: 0, y: 0, width: 800, height: 600, x1: 0, y1: 0, x2: 800, y2: 600 },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      'transform-inverse': { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      shapes: ['rect-a'],
    },
    'rect-a': {
      id: 'rect-a', type: 'rect', name: 'A', x: 10, y: 20, width: 100, height: 50,
      'parent-id': ROOT_FRAME_ID, 'frame-id': ROOT_FRAME_ID,
      selrect: { x: 10, y: 20, width: 100, height: 50, x1: 10, y1: 20, x2: 110, y2: 70 },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      'transform-inverse': { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      fills: [{ 'fill-color': '#FF0000', 'fill-opacity': 1 }],
      strokes: [],
      shapes: [],
    },
  }
}

function mockClient(): PenpotRpcClient {
  return {
    getFile: vi.fn(async () => ({ id: FILE, revn: 7, vern: 3, name: 'f', data: { pagesIndex: { [PAGE]: { id: PAGE, name: 'p', objects: pageObjects() } } } })),
    updateFile: vi.fn(async () => ({ revn: 8, lagged: [] })),
  } as unknown as PenpotRpcClient
}

describe('svg-import sanitizer', () => {
  it('rejects scripts, doctype and javascript: URLs', () => {
    expect(() => sanitizeSvg('<svg><script>alert(1)</script></svg>').root).toThrow()
    expect(() => sanitizeSvg('<!DOCTYPE svg><svg></svg>')).toThrow()
    expect(() => sanitizeSvg('<svg><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>')).toThrow()
  })

  it('converts rect+path to native shapes', () => {
    const { root } = sanitizeSvg('<svg width="100" height="100"><rect x="10" y="10" width="20" height="20" fill="#ff0000"/><path d="M0 0L10 10"/></svg>')
    const out = convertSvg(root, { parentId: ROOT_FRAME_ID, frameId: ROOT_FRAME_ID })
    expect(out.nativeEditable).toBe(true)
    expect(out.rootIds).toHaveLength(2)
    const types = out.shapes.map((s) => s.obj['type']).sort()
    expect(types).toEqual(['path', 'rect'])
  })

  it('marks non-convertible content honestly', () => {
    const { root, dropped } = sanitizeSvg('<svg><filter id="f"></filter><rect width="5" height="5"/></svg>')
    const out = convertSvg(root, { parentId: ROOT_FRAME_ID, frameId: ROOT_FRAME_ID })
    const structuralLoss = dropped.some((d) => d.startsWith('<'))
    expect(structuralLoss).toBe(true)
    // Same composition rule as penpot_import_asset: structural drops clear nativeEditable.
    expect(out.nativeEditable && !structuralLoss).toBe(false)
  })
})

describe('svg-serialize', () => {
  it('serializes a rect subtree with tight viewBox', () => {
    const { svg, width, height } = serializeSubtree('rect-a', pageObjects() as never)
    expect(width).toBe(100)
    expect(height).toBe(50)
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="0 0 100 50"')
    expect(svg).toContain('#FF0000')
  })
})

describe('penpot_mutate_hierarchy validation', () => {
  it('refuses to delete the protected page root', async () => {
    await expect(
      mutateHierarchyTool.handler(mockClient(), {
        fileId: FILE, pageId: PAGE,
        operations: [{ op: 'delete', shapeIds: [ROOT_FRAME_ID] }],
        dryRun: true,
      } as never),
    ).rejects.toThrow(/protected page root/)
  })

  it('rejects circular reparent', async () => {
    await expect(
      mutateHierarchyTool.handler(mockClient(), {
        fileId: FILE, pageId: PAGE,
        operations: [{ op: 'reparent', shapeIds: [ROOT_FRAME_ID], newParentId: 'rect-a' }],
        dryRun: true,
      } as never),
    ).rejects.toThrow()
  })

  it('dryRun plans without calling updateFile', async () => {
    const client = mockClient()
    const result = (await mutateHierarchyTool.handler(client, {
      fileId: FILE, pageId: PAGE,
      operations: [{ op: 'reorder', shapeId: 'rect-a', action: 'front' }],
      dryRun: true,
    } as never)) as { status: string; plannedChangeCount: number }
    expect(result.status).toBe('dry-run')
    expect(result.plannedChangeCount).toBe(1)
    expect(client.updateFile).not.toHaveBeenCalled()
  })
})

describe('penpot_export_frame input contract', () => {
  it('rejects invalid background and missing shape', async () => {
    await expect(
      exportFrameTool.handler(mockClient(), {
        fileId: FILE, pageId: PAGE, shapeId: 'rect-a', format: 'png', scale: 1, background: 'nope',
      } as never),
    ).rejects.toThrow(/background/)
    await expect(
      exportFrameTool.handler(mockClient(), {
        fileId: FILE, pageId: PAGE, shapeId: 'ghost', format: 'svg', scale: 1, background: 'transparent',
      } as never),
    ).rejects.toThrow(/not found/)
  })
})
