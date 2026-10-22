/**
 * tools/visual-diff.ts
 *
 * penpot_visual_diff — pixel-level comparison of a reference PNG against a
 * fresh Penpot render (or a supplied PNG). Every comparison records the SHA-256
 * and provenance of BOTH inputs; a deliberate-defect test (Suite E) proves a
 * real defect produces nonzero mismatch.
 */
import { z } from 'zod'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { PenpotRpcClient } from '../rpc-client.js'
import type { ToolDefinition } from './project-files.js'
import { getArtifact, putArtifact, sha256Hex } from '../render/artifacts.js'
import { exportFrameTool } from './export-frame.js'

const MAX_PIXELS = 16 * 1024 * 1024
const MAX_INLINE_BYTES = Math.floor(2.5 * 1024 * 1024)

function decodePng(label: string, bytes: Buffer): { width: number; height: number; data: Buffer } {
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    throw new Error(`penpot_visual_diff: ${label} is not a PNG (bad magic bytes)`)
  }
  try {
    return PNG.sync.read(bytes)
  } catch {
    throw new Error(`penpot_visual_diff: ${label} PNG does not decode`)
  }
}

function bytesFromInput(label: string, base64?: string, artifactId?: string): { bytes: Buffer; provenance: string } {
  if (base64) {
    if (base64.length > MAX_INLINE_BYTES * 1.4) {
      throw new Error(`penpot_visual_diff: ${label} base64 payload exceeds the inline cap`)
    }
    return { bytes: Buffer.from(base64, 'base64'), provenance: `inline-base64 sha256=${sha256Hex(Buffer.from(base64, 'base64'))}` }
  }
  if (artifactId) {
    const a = getArtifact(artifactId)
    if (!a.mimeType.includes('png')) throw new Error(`penpot_visual_diff: artifact ${artifactId} is ${a.mimeType}, need image/png`)
    return { bytes: a.bytes, provenance: `artifact:${a.id} label=${a.label} sha256=${a.sha256}` }
  }
  throw new Error(`penpot_visual_diff: ${label} needs base64 or artifactId`)
}

type Region = { x: number; y: number; width: number; height: number; pixels: number; severity: number; candidateShapeIds?: string[] }

/** Cluster diff pixels into regions via a coarse grid, then merge overlaps. */
function clusterRegions(diff: Buffer, width: number, height: number, diffPixels: number): Region[] {
  if (diffPixels === 0) return []
  const cell = 32
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  type Box = { x0: number; y0: number; x1: number; y1: number; pixels: number }
  const boxes: Box[] = []
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let n = 0
      const x0 = cx * cell
      const y0 = cy * cell
      for (let y = y0; y < Math.min(y0 + cell, height); y++) {
        for (let x = x0; x < Math.min(x0 + cell, width); x++) {
          const i = (y * width + x) * 4
          if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0) n++
        }
      }
      if (n > 8) boxes.push({ x0, y0, x1: Math.min(x0 + cell, width), y1: Math.min(y0 + cell, height), pixels: n })
    }
  }
  // Merge boxes that touch or overlap (single pass, boxes few in practice).
  const merged: Box[] = []
  for (const b of boxes) {
    const target = merged.find((m) => b.x0 <= m.x1 + cell && b.x1 >= m.x0 - cell && b.y0 <= m.y1 + cell && b.y1 >= m.y0 - cell)
    if (target) {
      target.x0 = Math.min(target.x0, b.x0)
      target.y0 = Math.min(target.y0, b.y0)
      target.x1 = Math.max(target.x1, b.x1)
      target.y1 = Math.max(target.y1, b.y1)
      target.pixels += b.pixels
    } else {
      merged.push({ ...b })
    }
  }
  return merged.map((m) => ({
    x: m.x0,
    y: m.y0,
    width: m.x1 - m.x0,
    height: m.y1 - m.y0,
    pixels: m.pixels,
    severity: Math.round((m.pixels / Math.max(diffPixels, 1)) * 1000) / 1000,
  }))
}

export const visualDiffInput = z.object({
  referenceBase64: z.string().optional(),
  referenceArtifactId: z.string().optional(),
  targetBase64: z.string().optional(),
  targetArtifactId: z.string().optional(),
  targetFileId: z.string().optional(),
  targetPageId: z.string().optional(),
  targetShapeId: z.string().optional(),
  targetScale: z.number().positive().max(4).default(1),
  targetBackground: z.string().default('transparent'),
  targetProjectId: z.string().optional(),
  pixelThreshold: z.number().min(0).max(1).default(0.1),
  allowedMismatchRatio: z.number().min(0).max(1).default(0),
  includeHeatmap: z.boolean().default(true),
  includeOverlay: z.boolean().default(true),
})

export type VisualDiffInput = z.infer<typeof visualDiffInput>

export const visualDiffTool: ToolDefinition<VisualDiffInput> = {
  name: 'penpot_visual_diff',
  description:
    'Compare a reference PNG against a fresh Penpot render (or a supplied PNG) pixel by pixel. ' +
    'Records SHA-256 and provenance of both inputs, reports mismatch ratio, difference regions with ' +
    'bounding boxes, and retrievable heatmap/overlay artifacts. Dimension mismatches are reported, never ' +
    'silently resized away. At least one reference source (referenceBase64/referenceArtifactId) and one ' +
    'target source (targetBase64/targetArtifactId or targetFileId+targetPageId+targetShapeId) are required.',
  inputSchema: visualDiffInput,
  handler: async (client, input) => {
    const warnings: string[] = []
    const { bytes: refBytes, provenance: refProv } = bytesFromInput('reference', input.referenceBase64, input.referenceArtifactId)

    let targetBytes: Buffer
    let targetProv: string
    let candidateBounds: Array<{ id: string; x: number; y: number; w: number; h: number }> = []
    if (input.targetBase64 || input.targetArtifactId) {
      const t = bytesFromInput('target', input.targetBase64, input.targetArtifactId)
      targetBytes = t.bytes
      targetProv = t.provenance
    } else if (input.targetFileId && input.targetPageId && input.targetShapeId) {
      const rendered = (await exportFrameTool.handler(client, {
        fileId: input.targetFileId,
        pageId: input.targetPageId,
        shapeId: input.targetShapeId,
        format: 'png',
        scale: input.targetScale,
        background: input.targetBackground,
        projectId: input.targetProjectId,
      })) as { dataBase64: string; sha256: string; revision: number; warnings: string[] }
      targetBytes = Buffer.from(rendered.dataBase64, 'base64')
      targetProv = `fresh-render file=${input.targetFileId} page=${input.targetPageId} shape=${input.targetShapeId} revn=${rendered.revision} sha256=${rendered.sha256}`
      warnings.push(...(rendered.warnings ?? []))
      // Candidate shapes: intersect diff regions with stored shape bounds.
      try {
        const file = (await client.getFile(input.targetFileId)) as {
          data: { pagesIndex: Record<string, { objects: Record<string, Record<string, unknown>> }> }
        }
        const objects = file.data.pagesIndex[input.targetPageId]?.objects ?? {}
        for (const [id, s] of Object.entries(objects)) {
          const sel = (s['selrect'] ?? {}) as Record<string, number>
          if (typeof sel['x'] === 'number' && typeof sel['width'] === 'number') {
            candidateBounds.push({ id, x: sel['x'], y: sel['y'] ?? 0, w: sel['width'], h: sel['height'] ?? 0 })
          }
        }
      } catch {
        warnings.push('candidate shape intersection skipped (page re-read failed)')
      }
    } else {
      throw new Error('penpot_visual_diff: supply targetBase64/targetArtifactId or targetFileId+targetPageId+targetShapeId')
    }

    const ref = decodePng('reference', refBytes)
    const tgt = decodePng('target', targetBytes)
    const referenceSha256 = sha256Hex(refBytes)
    const renderSha256 = sha256Hex(targetBytes)

    if (ref.width !== tgt.width || ref.height !== tgt.height) {
      const msg =
        `dimension mismatch: reference ${ref.width}x${ref.height} vs target ${tgt.width}x${tgt.height}; ` +
        `no pixel comparison performed (never silently resized)`
      warnings.push(msg)
      return {
        status: 'dimension-mismatch',
        referenceSha256,
        renderSha256,
        referenceProvenance: refProv,
        targetProvenance: targetProv,
        referenceDimensions: { width: ref.width, height: ref.height },
        renderDimensions: { width: tgt.width, height: tgt.height },
        totalPixels: tgt.width * tgt.height,
        differentPixels: null,
        mismatchRatio: 1,
        pixelThreshold: input.pixelThreshold,
        passed: false,
        regions: [],
        warnings,
      }
    }

    const totalPixels = ref.width * ref.height
    if (totalPixels > MAX_PIXELS) {
      throw new Error(`penpot_visual_diff: ${totalPixels} pixels exceeds the ${MAX_PIXELS} pixel cap`)
    }
    const diff = Buffer.alloc(ref.data.length)
    const differentPixels = pixelmatch(ref.data, tgt.data, diff, ref.width, ref.height, { threshold: input.pixelThreshold })
    const mismatchRatio = totalPixels === 0 ? 0 : differentPixels / totalPixels
    const passed = mismatchRatio <= input.allowedMismatchRatio

    const regions = clusterRegions(diff, ref.width, ref.height, differentPixels)
    if (candidateBounds.length > 0) {
      for (const r of regions) {
        // Region coords are in export space (root bounds at 0,0); shape bounds are absolute.
        // Without the root offset here, intersection is approximate — mark as such.
        r.candidateShapeIds = candidateBounds
          .filter((s) => s.x < r.x + r.width + 64 && s.x + s.w > r.x - 64 && s.y < r.y + r.height + 64 && s.y + s.h > r.y - 64)
          .slice(0, 8)
          .map((s) => s.id)
      }
      if (regions.length > 0) warnings.push('candidateShapeIds are geometric overlaps, not semantic matches')
    }

    let heatmapArtifactUri: string | null = null
    let overlayArtifactUri: string | null = null
    let heatmapBase64: string | null = null
    let overlayBase64: string | null = null
    if (input.includeHeatmap && differentPixels > 0) {
      const heat = PNG.sync.write({ width: ref.width, height: ref.height, data: diff } as never) as Buffer
      const art = putArtifact(heat, 'image/png', 'visual-diff heatmap')
      heatmapArtifactUri = `artifact:${art.id}`
      if (heat.length <= MAX_INLINE_BYTES) heatmapBase64 = heat.toString('base64')
    }
    if (input.includeOverlay && differentPixels > 0) {
      const overlay = Buffer.from(tgt.data)
      for (let i = 0; i < overlay.length; i += 4) {
        const d = (i / 4) * 4
        if (diff[d] === 255 && diff[d + 1] === 0 && diff[d + 2] === 0) {
          overlay[i] = 255
          overlay[i + 1] = Math.round((overlay[i + 1] ?? 0) * 0.35)
          overlay[i + 2] = Math.round((overlay[i + 2] ?? 0) * 0.35)
        }
      }
      const out = PNG.sync.write({ width: tgt.width, height: tgt.height, data: overlay } as never) as Buffer
      const art = putArtifact(out, 'image/png', 'visual-diff overlay')
      overlayArtifactUri = `artifact:${art.id}`
      if (out.length <= MAX_INLINE_BYTES) overlayBase64 = out.toString('base64')
    }

    return {
      status: 'ok',
      referenceSha256,
      renderSha256,
      referenceProvenance: refProv,
      targetProvenance: targetProv,
      referenceDimensions: { width: ref.width, height: ref.height },
      renderDimensions: { width: tgt.width, height: tgt.height },
      totalPixels,
      differentPixels,
      mismatchRatio: Math.round(mismatchRatio * 1e6) / 1e6,
      pixelThreshold: input.pixelThreshold,
      allowedMismatchRatio: input.allowedMismatchRatio,
      passed,
      diffArtifactUri: heatmapArtifactUri,
      overlayArtifactUri,
      heatmapArtifactUri,
      heatmapBase64,
      overlayBase64,
      regions,
      warnings,
    }
  },
}
