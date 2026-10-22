/**
 * tools/export-frame.ts
 *
 * penpot_export_frame — headless render of a real Penpot object to PNG or SVG.
 *
 * Pipeline: get-file (PAT) -> serialize shape subtree to SVG -> PNG via resvg
 * (isolated in-process rasterizer, no browser, no plugin) or raw SVG output.
 * Uses the existing Penpot exporter only where technically possible — it is
 * not, with access-token-only auth (verified against 2.18.3 source), so the
 * adapter path below is used and documented as such.
 */
import { z } from 'zod'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import type { PenpotRpcClient, FileSummary } from '../rpc-client.js'
import type { ToolDefinition } from './project-files.js'
import { serializeSubtree, shapeBounds } from '../render/svg-serialize.js'
import { putArtifact, sha256Hex } from '../render/artifacts.js'
import { recallMedia } from '../render/media-cache.js'
import { resolveFileFonts } from '../render/fonts.js'

const MAX_BASE64_BYTES = Math.floor(2.5 * 1024 * 1024)
const MAX_SCALE = 4
const MAX_EXPORT_DIMENSION = 4096

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)
}

export const exportFrameInput = z.object({
  fileId: z.string().min(1),
  pageId: z.string().min(1),
  shapeId: z.string().min(1),
  format: z.enum(['png', 'svg']).default('png'),
  scale: z.number().positive().max(MAX_SCALE).default(1),
  background: z.string().default('transparent'),
  expectedRevision: z.number().int().optional(),
  projectId: z.string().min(1).optional(),
})

export type ExportFrameInput = z.infer<typeof exportFrameInput>

export const exportFrameTool: ToolDefinition<ExportFrameInput> = {
  name: 'penpot_export_frame',
  description:
    'Render a real Penpot frame or shape to PNG or SVG without an open browser tab. ' +
    'Takes explicit fileId/pageId/shapeId, serializes the stored shape subtree to SVG, and rasterizes PNG ' +
    'with an isolated in-process renderer (the hosted Penpot exporter requires a session cookie and cannot ' +
    'authenticate with an API token). Returns validated artifact bytes as bounded base64 plus metadata. ' +
    'Text uses team fonts when downloadable, otherwise fallback fonts (reported in warnings). ' +
    'Image shapes render only when their bytes were uploaded through penpot_import_asset in this server ' +
    'session; older images render as placeholders (reported in warnings).',
  inputSchema: exportFrameInput,
  handler: async (client, { fileId, pageId, shapeId, format, scale, background, expectedRevision, projectId }) => {
    const t0 = Date.now()
    const warnings: string[] = []

    if (background !== 'transparent' && background !== 'white' && !isHexColor(background)) {
      throw new Error(`penpot_export_frame: background must be "transparent", "white" or #rrggbb[aa], got ${JSON.stringify(background)}`)
    }

    const file = (await client.getFile(fileId)) as FileSummary
    if (expectedRevision !== undefined && file.revn !== expectedRevision) {
      throw new Error(
        `penpot_export_frame: revision precondition failed (expected ${expectedRevision}, current ${file.revn}); ` +
          `re-read the file and retry deliberately`,
      )
    }
    const page = file.data.pagesIndex[pageId] as Record<string, unknown> | undefined
    if (!page) throw new Error(`penpot_export_frame: page ${pageId} not found in file ${fileId}`)
    const objects = page['objects'] as Record<string, Record<string, unknown>>
    if (!objects?.[shapeId]) throw new Error(`penpot_export_frame: shape ${shapeId} not found on page ${pageId}`)

    const { svg, width, height, warnings: serializeWarnings } = serializeSubtree(shapeId, objects, recallMedia())
    warnings.push(...serializeWarnings)

    const targetWidth = Math.max(Math.round(width * scale), 1)
    const targetHeight = Math.max(Math.round(height * scale), 1)
    if (targetWidth > MAX_EXPORT_DIMENSION || targetHeight > MAX_EXPORT_DIMENSION) {
      throw new Error(
        `penpot_export_frame: export dimensions ${targetWidth}x${targetHeight} exceed the ${MAX_EXPORT_DIMENSION}px cap; lower the scale`,
      )
    }

    let bytes: Buffer
    let mimeType: string
    if (format === 'svg') {
      if (!svg.startsWith('<svg')) throw new Error('penpot_export_frame: serializer produced invalid SVG')
      bytes = Buffer.from(svg, 'utf8')
      mimeType = 'image/svg+xml'
    } else {
      let fontBuffers: Buffer[] = []
      if (projectId) {
        try {
          const fonts = await resolveFileFonts(client, projectId, fileId, objects)
          fontBuffers = fonts.buffers
          warnings.push(...fonts.warnings)
        } catch {
          warnings.push('font resolution failed; fallback fonts used')
        }
      } else {
        warnings.push('projectId not supplied; text renders with fallback fonts')
      }
      // resvg-js 2.x loads fonts from file paths only: stage buffers as temp
      // files (best-effort cleanup; a few hundred KB transient, never on VPS disk).
      // Font files must outlive render(), so staging happens before construction
      // and cleanup after the PNG bytes are produced (see below).
      let fontDir: string | null = null
      const fontFiles: string[] = []
      if (fontBuffers.length > 0) {
        fontDir = mkdtempSync(join(tmpdir(), 'penpot-fonts-'))
        fontBuffers.forEach((buf, i) => {
          const p = join(fontDir as string, `font-${i}.ttf`)
          writeFileSync(p, buf)
          fontFiles.push(p)
        })
      }
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: targetWidth },
        font: {
          loadSystemFonts: false,
          fontFiles,
          defaultFontFamily: 'sans-serif',
        },
        ...(background === 'transparent' ? {} : { background: background === 'white' ? '#ffffff' : background }),
      })
      const rendered = resvg.render()
      bytes = Buffer.from(rendered.asPng())
      if (fontDir) {
        try {
          rmSync(fontDir, { recursive: true, force: true })
        } catch {
          // Transient cache only; OS temp reclamation covers leftovers.
        }
      }
      mimeType = 'image/png'
      if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
        throw new Error('penpot_export_frame: rasterizer did not return PNG magic bytes')
      }
      let decoded: { width: number; height: number; data: Buffer }
      try {
        decoded = PNG.sync.read(bytes)
      } catch {
        throw new Error('penpot_export_frame: rendered PNG does not decode')
      }
      if (Math.abs(decoded.width - targetWidth) > 1 || Math.abs(decoded.height - targetHeight) > 1) {
        throw new Error(
          `penpot_export_frame: raster dimensions ${decoded.width}x${decoded.height} do not match expected ${targetWidth}x${targetHeight}`,
        )
      }
      let opaque = 0
      const step = Math.max(1, Math.floor(decoded.data.length / 4 / 4096))
      for (let i = 3; i < decoded.data.length; i += 4 * step) {
        if (decoded.data[i]! > 0) {
          opaque++
          if (opaque > 4) break
        }
      }
      if (opaque === 0) {
        throw new Error('penpot_export_frame: render is fully transparent; refusing to return a placeholder image')
      }
      void shapeBounds
    }

    const artifact = putArtifact(bytes, mimeType, `export ${shapeId} ${format}@${scale}x revn=${file.revn}`)
    if (bytes.length > MAX_BASE64_BYTES) {
      throw new Error(
        `penpot_export_frame: artifact ${bytes.length} bytes exceeds the ${MAX_BASE64_BYTES} byte inline cap ` +
          `(artifact ${artifact.id} retained server-side for visual_diff); re-export at a lower scale`,
      )
    }

    return {
      status: 'ok',
      fileId,
      pageId,
      shapeId,
      revision: file.revn,
      format,
      width: format === 'png' ? Math.round(width * scale) : width,
      height: format === 'png' ? Math.round(height * scale) : height,
      mimeType,
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
      artifactId: artifact.id,
      dataBase64: bytes.toString('base64'),
      renderDurationMs: Date.now() - t0,
      warnings,
    }
  },
}
