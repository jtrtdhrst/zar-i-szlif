/**
 * tools/import-asset.ts
 *
 * penpot_import_asset — import raster images and SVGs into Penpot as real,
 * editable objects. Raster bytes go through Penpot's own
 * `upload-file-media-object` RPC (real media IDs, never faked) and are placed
 * as native `type: image` shapes. SVGs are sanitized and converted to native
 * shapes (rect/circle/path/text/groups); only genuinely convertible content
 * is claimed as editable.
 *
 * Security: base64 sources are size- and type-checked; URL sources must be
 * https, resolve to public IPs only (SSRF guard), follow at most 3 redirects
 * (each re-validated), and honor byte caps. SVG input is sanitized by the
 * strict subset parser in ../render/svg-import.ts.
 */
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { PenpotStaleWriteError } from '../rpc-client.js'
import { isIP } from 'node:net'
import type { PenpotRpcClient, FileSummary } from '../rpc-client.js'
import type { ToolDefinition } from './project-files.js'
import { sanitizeSvg, convertSvg } from '../render/svg-import.js'
import { rememberMedia } from '../render/media-cache.js'
import { image } from '../shape-builders.js'
import { addObj } from '../shape-builders.js'
import { ROOT_FRAME_ID } from '../shape-builders.js'

const MAX_RASTER_BYTES = 8 * 1024 * 1024
const MAX_SVG_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 8000
const FETCH_TIMEOUT_MS = 15000

function sniffMtype(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  const head = bytes.subarray(0, 512).toString('utf8').trimStart()
  if (head.startsWith('<svg')) return 'image/svg+xml'
  return null
}

function isPublicIp(addr: string): boolean {
  const fam = isIP(addr)
  if (fam === 4) {
    const parts = addr.split('.').map(Number)
    const a = parts[0] ?? -1
    const b = parts[1] ?? -1
    if (a === 10) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a >= 224) return false
    return true
  }
  if (fam === 6) {
    const low = addr.toLowerCase()
    if (low === '::1' || low === '::') return false
    if (/^(fc|fd)/.test(low.replace(/:/g, ''))) return false
    if (low.startsWith('fe80')) return false
    if (low.startsWith('ff')) return false
    return true
  }
  return false
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('penpot_import_asset: source.url is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('penpot_import_asset: only https:// URLs are accepted')
  if (url.username || url.password) throw new Error('penpot_import_asset: URLs with credentials are rejected')
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(url.hostname, { all: true })
  } catch {
    throw new Error(`penpot_import_asset: DNS resolution failed for ${url.hostname}`)
  }
  for (const a of addrs) {
    const addr: string = a.address ?? ''
    if (!isPublicIp(addr)) {
      throw new Error(`penpot_import_asset: ${url.hostname} resolves to a non-public address (SSRF guard)`)
    }
  }
  return url
}

async function fetchBytesGuarded(rawUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  let current = rawUrl
  for (let hop = 0; hop <= 3; hop++) {
    const url = await assertPublicHttpsUrl(current)
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'penpot-headless-import/1.0', accept: 'image/*,image/svg+xml' },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc || hop === 3) throw new Error('penpot_import_asset: too many redirects or missing Location')
      current = new URL(loc, url.toString()).toString()
      continue
    }
    if (!res.ok) throw new Error(`penpot_import_asset: URL fetch failed with HTTP ${res.status}`)
    const len = res.headers.get('content-length')
    if (len && Number(len) > MAX_RASTER_BYTES) {
      throw new Error(`penpot_import_asset: remote file declares ${len} bytes, over the cap`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_RASTER_BYTES) throw new Error('penpot_import_asset: remote file exceeds the 8 MB cap')
    return { bytes: buf, contentType: res.headers.get('content-type') ?? '' }
  }
  throw new Error('penpot_import_asset: redirect loop')
}

export const importAssetInput = z.object({
  fileId: z.string().min(1),
  pageId: z.string().min(1),
  name: z.string().min(1).max(120),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']).optional(),
  sourceBase64: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().max(MAX_IMAGE_DIMENSION).optional(),
  height: z.number().positive().max(MAX_IMAGE_DIMENSION).optional(),
  importMode: z.enum(['image', 'editable-svg']).optional(),
  parentId: z.string().default(ROOT_FRAME_ID),
  frameId: z.string().default(ROOT_FRAME_ID),
})

export type ImportAssetInput = z.infer<typeof importAssetInput>

export const importAssetTool: ToolDefinition<ImportAssetInput> = {
  name: 'penpot_import_asset',
  description:
    'Import a raster image (PNG/JPEG/WebP) or SVG into a Penpot file as real editable objects. ' +
    'Raster sources become native image shapes backed by Penpot media IDs. SVGs are sanitized and ' +
    'converted to native shapes (rect/circle/path/text/groups) when convertible; otherwise they are ' +
    'rasterized and imported as images with nativeEditable=false stated explicitly. Sources: bounded ' +
    'base64 payload or https URL (SSRF-guarded, public IPs only).',
  inputSchema: importAssetInput,
  handler: async (client, input) => {
    const warnings: string[] = []
    if ((input.sourceBase64 && input.sourceUrl) || (!input.sourceBase64 && !input.sourceUrl)) {
      throw new Error('penpot_import_asset: provide exactly one of sourceBase64 or sourceUrl')
    }

    let bytes: Buffer
    let declared = input.mimeType
    if (input.sourceBase64) {
      bytes = Buffer.from(input.sourceBase64, 'base64')
      if (bytes.length === 0) throw new Error('penpot_import_asset: sourceBase64 decodes to empty bytes')
      if (bytes.length > MAX_RASTER_BYTES) throw new Error('penpot_import_asset: base64 payload exceeds the 8 MB cap')
    } else {
      const fetched = await fetchBytesGuarded(input.sourceUrl!)
      bytes = fetched.bytes
      if (!declared && /svg/i.test(fetched.contentType)) declared = 'image/svg+xml'
    }

    const sniffed = sniffMtype(bytes)
    if (!sniffed) throw new Error('penpot_import_asset: source bytes are not a recognized PNG/JPEG/WebP/SVG')
    const mtype = declared ?? sniffed
    if (declared && declared !== sniffed && !(declared === 'image/jpeg' && sniffed === 'image/jpeg')) {
      throw new Error(`penpot_import_asset: declared ${declared} does not match detected ${sniffed}`)
    }
    if (sniffed === 'image/svg+xml' && bytes.length > MAX_SVG_BYTES) {
      throw new Error('penpot_import_asset: SVG exceeds the 2 MB cap')
    }

    const file = (await client.getFile(input.fileId)) as FileSummary
    const page = file.data.pagesIndex[input.pageId] as Record<string, unknown> | undefined
    if (!page) throw new Error(`penpot_import_asset: page ${input.pageId} not found in file ${input.fileId}`)

    const mode = input.importMode ?? (mtype === 'image/svg+xml' ? 'editable-svg' : 'image')
    const mediaIds: string[] = []
    const shapeIds: string[] = []

    if (mode === 'image') {
      let raster = bytes
      let rasterMtype = mtype
      if (mtype === 'image/svg+xml') {
        // Rasterize the SVG for image-mode import.
        const { Resvg } = await import('@resvg/resvg-js')
        const text = bytes.toString('utf8')
        const wMatch = text.match(/<svg[^>]*\bwidth="([\d.]+)/i)
        const hMatch = text.match(/<svg[^>]*\bheight="([\d.]+)/i)
        const vbMatch = text.match(/viewBox="([\d.\s,+-]+)"/i)
        let w = wMatch ? Math.round(Number(wMatch[1])) : 0
        let h = hMatch ? Math.round(Number(hMatch[1])) : 0
        if ((!w || !h) && vbMatch) {
          const parts = vbMatch[1]!.trim().split(/[\s,]+/).map(Number)
          if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
            w = Math.round(parts[2]!)
            h = Math.round(parts[3]!)
          }
        }
        if (!w || !h) throw new Error('penpot_import_asset: SVG has no resolvable dimensions for rasterization')
        if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
          throw new Error('penpot_import_asset: SVG dimensions exceed the import cap')
        }
        raster = Buffer.from(new Resvg(text, { fitTo: { mode: 'width', value: w } }).render().asPng())
        rasterMtype = 'image/png'
        warnings.push('SVG rasterized to PNG for image-mode import (nativeEditable=false)')
      }
      const media = await client.uploadFileMediaObject(input.fileId, input.name, raster, rasterMtype, true)
      mediaIds.push(media.id)
      rememberMedia(media.id, raster, rasterMtype)
      const W = input.width ?? media.width
      const H = input.height ?? media.height
      if (W > MAX_IMAGE_DIMENSION || H > MAX_IMAGE_DIMENSION) {
        throw new Error('penpot_import_asset: requested dimensions exceed the import cap')
      }
      // Explicit id up front so a lagged write can be read back without a blind retry.
      const shapeId = randomUUID()
      const obj = image({
        id: shapeId,
        name: input.name,
        x: input.x,
        y: input.y,
        width: W,
        height: H,
        parentId: input.parentId,
        frameId: input.frameId,
        metadata: { id: media.id, width: media.width, height: media.height, mtype: media.mtype },
      }) as Record<string, unknown> & { id: string }
      shapeIds.push(shapeId)
      try {
        const result = await client.updateFile(input.fileId, file.revn, file.vern, [addObj(input.pageId, obj)])
        return {
          status: 'ok',
          mediaId: media.id,
          mediaIds,
          shapeIds,
          sourceSha256: requireSha(bytes),
          importModeUsed: 'image',
          nativeEditable: false,
          warnings,
          revision: result.revn,
        }
      } catch (err) {
        if (!(err instanceof PenpotStaleWriteError)) throw err
        return {
          status: 'write_applied_with_lagged_changes',
          writeApplied: true,
          fileId: input.fileId,
          pageId: input.pageId,
          mediaId: media.id,
          mediaIds,
          shapeIds,
          sourceSha256: requireSha(bytes),
          importModeUsed: 'image',
          nativeEditable: false,
          revn: err.result.revn,
          laggedChangeCount: err.laggedCount,
          nextAction: 'Read back the shape IDs before any retry. The import has already been applied.',
          warnings,
        }
      }
    }

    // editable-svg path.
    const svgText = bytes.toString('utf8')
    const { root, warnings: sanitizeWarnings, dropped } = sanitizeSvg(svgText)
    warnings.push(...sanitizeWarnings)
    const structuralLoss = dropped.some((d) => d.startsWith('<'))
    if (structuralLoss) warnings.push(`unsupported SVG elements dropped: ${dropped.filter((d) => d.startsWith('<')).slice(0, 8).join(', ')}`)
    const converted = convertSvg(root, { parentId: input.parentId, frameId: input.frameId, offsetX: input.x, offsetY: input.y, namePrefix: input.name })
    warnings.push(...converted.warnings)
    if (input.width !== undefined || input.height !== undefined) {
      warnings.push('width/height are ignored for editable-svg import; the SVG keeps its own dimensions')
    }

    // Resolve raster placeholders (embedded data URIs decode locally; http(s) via guarded fetch).
    const mediaByUpload = new Map<number, { id: string; width: number; height: number; mtype: string }>()
    for (let i = 0; i < converted.uploads.length; i++) {
      const job = converted.uploads[i]!
      let payload = job.bytes
      let mtype = job.mtype
      if (payload.length === 0 && mtype.startsWith('url:')) {
        const fetched = await fetchBytesGuarded(mtype.slice(4))
        payload = fetched.bytes
        const sn = sniffMtype(payload)
        if (!sn || sn === 'image/svg+xml') throw new Error('penpot_import_asset: SVG image href must resolve to a raster image')
        mtype = sn
      }
      if (payload.length === 0 || payload.length > MAX_RASTER_BYTES) {
        throw new Error('penpot_import_asset: embedded image payload missing or over cap')
      }
      const media = await client.uploadFileMediaObject(input.fileId, job.name, payload, mtype, true)
      mediaIds.push(media.id)
      rememberMedia(media.id, payload, mtype)
      mediaByUpload.set(i, { id: media.id, width: media.width, height: media.height, mtype: media.mtype })
    }

    // Swap rect placeholders for true image shapes now that media IDs exist.
    const objects = converted.shapes.map((s) => s.obj)
    for (const patch of converted.uploadPatches) {
      const slot = objects.findIndex((o) => o['id'] === patch.shapeId)
      if (slot < 0) continue
      const resolved = mediaByUpload.get(patch.uploadIndex)
      if (!resolved) throw new Error('penpot_import_asset: image upload did not resolve to a media id')
      const prev = objects[slot] as Record<string, unknown>
      objects[slot] = image({
        id: patch.shapeId,
        name: (prev['name'] as string) ?? input.name,
        x: (prev['x'] as number) ?? input.x,
        y: (prev['y'] as number) ?? input.y,
        width: Math.max((prev['width'] as number) ?? resolved.width, 1),
        height: Math.max((prev['height'] as number) ?? resolved.height, 1),
        parentId: (prev['parent-id'] as string) ?? input.parentId,
        frameId: input.frameId,
        metadata: { id: resolved.id, width: resolved.width, height: resolved.height, mtype: resolved.mtype },
      })
    }

    const changes = objects.map((o) => addObj(input.pageId, o))
    for (const s of converted.shapes) shapeIds.push(s.id)
    try {
      const result = await client.updateFile(input.fileId, file.revn, file.vern, changes)
      return {
        status: 'ok',
        mediaId: mediaIds[0] ?? null,
        mediaIds,
        shapeIds,
        sourceSha256: requireSha(bytes),
        importModeUsed: 'editable-svg',
        nativeEditable: converted.nativeEditable && !structuralLoss,
        warnings,
        revision: result.revn,
      }
    } catch (err) {
      if (!(err instanceof PenpotStaleWriteError)) throw err
      return {
        status: 'write_applied_with_lagged_changes',
        writeApplied: true,
        fileId: input.fileId,
        pageId: input.pageId,
        mediaId: mediaIds[0] ?? null,
        mediaIds,
        shapeIds,
        sourceSha256: requireSha(bytes),
        importModeUsed: 'editable-svg',
        nativeEditable: converted.nativeEditable && !structuralLoss,
        revn: err.result.revn,
        laggedChangeCount: err.laggedCount,
        nextAction: 'Read back the shape IDs before any retry. The import has already been applied.',
        warnings,
      }
    }
  },
}

function requireSha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
