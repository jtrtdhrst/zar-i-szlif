/**
 * svg-serialize.ts
 *
 * Serializes Penpot shape trees (as returned by `get-file`) into standalone
 * SVG markup for the headless export pipeline. This is a data-driven
 * serializer: it renders what Penpot stored, it never invents geometry.
 *
 * Fidelity notes (deliberate, documented approximations):
 * - Multiple fills/strokes per shape: only the first of each is rendered.
 * - Stroke alignment inner/outer is approximated as center.
 * - Non-union boolean shapes render as a bounds placeholder (union renders children).
 * - Image shapes need caller-supplied media bytes; otherwise a placeholder is drawn.
 * - Inner shadows are skipped; drop shadows use feDropShadow (no spread support).
 * - Exotic blend modes pass through as CSS mix-blend-mode and may vary by rasterizer.
 */

import { parsePathData } from './svg-import.js'
import type { PathCommand } from '../shape-builders.js'

export type MediaBytes = Map<string, { bytes: Buffer; mtype: string }>

export type SerializeWarnings = string[]

type Shape = Record<string, unknown>
type Objects = Record<string, Shape>

const f2 = (n: unknown): string => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return String(Math.round(v * 100) / 100)
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function get<T>(shape: Shape, kebab: string, camel: string): T | undefined {
  const v = shape[kebab] ?? shape[camel]
  return (v === undefined || v === null ? undefined : v) as T | undefined
}

/**
 * Penpot normalizes stored shapes to camelCase on read (fillColor,
 * strokeWidth, parentId, ...) while writes accept kebab-case. Every paint
 * reader below therefore accepts both spellings.
 */
function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null) return v as T
  }
  return undefined
}

function num(shape: Shape, kebab: string, camel: string, fallback = 0): number {
  const v = get<unknown>(shape, kebab, camel)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(shape: Shape, kebab: string, camel: string, fallback = ''): string {
  const v = get<unknown>(shape, kebab, camel)
  return typeof v === 'string' ? v : fallback
}

/** Bounds prefer selrect, fall back to x/y/width/height. */
export function shapeBounds(shape: Shape): { x: number; y: number; width: number; height: number } {
  const sel = get<Record<string, unknown>>(shape, 'selrect', 'selrect')
  if (sel && typeof sel.x === 'number' && typeof sel.width === 'number') {
    return {
      x: sel.x,
      y: typeof sel.y === 'number' ? sel.y : 0,
      width: Math.max(sel.width, 0),
      height: typeof sel.height === 'number' ? Math.max(sel.height, 0) : 0,
    }
  }
  return {
    x: num(shape, 'x', 'x'),
    y: num(shape, 'y', 'y'),
    width: Math.max(num(shape, 'width', 'width'), 0),
    height: Math.max(num(shape, 'height', 'height'), 0),
  }
}

type Ctx = {
  objects: Objects
  media: MediaBytes
  warnings: SerializeWarnings
  defs: string[]
  defSeq: { n: number }
}

function fillOpacity(fill: Record<string, unknown>): number {
  const o = pick<number>(fill, 'fill-opacity', 'fillOpacity')
  return typeof o === 'number' ? o : 1
}

function gradientDef(fill: Record<string, unknown>, ctx: Ctx): string | null {
  const g = pick<Record<string, unknown>>(fill, 'fill-color-gradient', 'fillColorGradient')
  if (!g || typeof g !== 'object') return null
  const id = `grad${ctx.defSeq.n++}`
  const type = g['type'] === 'radial' ? 'radialGradient' : 'linearGradient'
  const stops = Array.isArray(g['stops']) ? g['stops'] : []
  const stopTags = stops
    .map((s: unknown) => {
      const st = s as Record<string, unknown>
      const color = pick<string>(st, 'color') ?? '#000000'
      const offset = pick<number>(st, 'offset') ?? 0
      const opacity = pick<number>(st, 'opacity') ?? 1
      return `<stop offset="${offset}" stop-color="${esc(color)}" stop-opacity="${opacity}"/>`
    })
    .join('')
  if (type === 'linearGradient') {
    const x1 = pick<number>(g, 'start-x', 'startX') ?? 0
    const y1 = pick<number>(g, 'start-y', 'startY') ?? 0
    const x2 = pick<number>(g, 'end-x', 'endX') ?? pick<number>(g, 'width') ?? 1
    const y2 = pick<number>(g, 'end-y', 'endY') ?? 0
    ctx.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}">${stopTags}</linearGradient>`,
    )
  } else {
    ctx.defs.push(`<radialGradient id="${id}">${stopTags}</radialGradient>`)
  }
  return `url(#${id})`
}

/** Returns SVG fill attributes for the first fill, or null for "no fill". */
function fillAttrs(shape: Shape, ctx: Ctx, shapeId: string): string | null {
  const fills = (get<unknown[]>(shape, 'fills', 'fills') ?? []) as Record<string, unknown>[]
  if (fills.length === 0) return null
  if (fills.length > 1) ctx.warnings.push(`${shapeId}: ${fills.length} fills, rendering first only`)
  const fill = fills[0]!
  const opacity = fillOpacity(fill)
  const opAttr = opacity !== 1 ? ` fill-opacity="${opacity}"` : ''
  const solid = pick<string>(fill, 'fill-color', 'fillColor')
  if (typeof solid === 'string') {
    return `fill="${esc(solid)}"${opAttr}`
  }
  if (pick(fill, 'fill-color-gradient', 'fillColorGradient')) {
    const ref = gradientDef(fill, ctx)
    if (ref) return `fill="${ref}"${opAttr}`
    ctx.warnings.push(`${shapeId}: unparseable gradient fill, skipped`)
    return null
  }
  if (pick(fill, 'fill-image', 'fillImage')) {
    const meta = pick<Record<string, unknown>>(fill, 'fill-image', 'fillImage') ?? {}
    const entry = typeof meta['id'] === 'string' ? ctx.media.get(meta['id']) : undefined
    if (entry) {
      const id = `img${ctx.defSeq.n++}`
      const b = shapeBounds(shape)
      const w = Math.max(Math.round(b.width), 1)
      const h = Math.max(Math.round(b.height), 1)
      ctx.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${f2(b.x)}" y="${f2(b.y)}" width="${w}" height="${h}"><image href="data:${entry.mtype};base64,${entry.bytes.toString('base64')}" x="${f2(b.x)}" y="${f2(b.y)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></pattern>`,
      )
      return `fill="url(#${id})"${opAttr}`
    }
    ctx.warnings.push(`${shapeId}: fill-image media bytes unavailable, fill skipped`)
    return null
  }
  return null
}

function strokeAttrs(shape: Shape, ctx: Ctx, shapeId: string): string {
  const strokes = (get<unknown[]>(shape, 'strokes', 'strokes') ?? []) as Record<string, unknown>[]
  if (strokes.length === 0) return 'stroke="none"'
  if (strokes.length > 1) ctx.warnings.push(`${shapeId}: ${strokes.length} strokes, rendering first only`)
  const s = strokes[0]!
  const color = pick<string>(s, 'stroke-color', 'strokeColor') ?? '#000000'
  const opacity = pick<number>(s, 'stroke-opacity', 'strokeOpacity') ?? 1
  const width = pick<number>(s, 'stroke-width', 'strokeWidth') ?? 1
  const style = pick<string>(s, 'stroke-style', 'strokeStyle')
  const dash =
    style === 'dashed' ? ' stroke-dasharray="6 4"' : style === 'dotted' ? ' stroke-dasharray="0.1 3" stroke-linecap="round"' : ''
  const alignment = s['stroke-alignment']
  if (alignment === 'inner' || alignment === 'outer') {
    ctx.warnings.push(`${shapeId}: stroke-alignment ${alignment} approximated as center`)
  }
  const op = opacity !== 1 ? ` stroke-opacity="${opacity}"` : ''
  return `stroke="${esc(color)}" stroke-width="${f2(width)}"${dash}${op}`
}

function commonAttrs(shape: Shape, ctx: Ctx, shapeId: string): string {
  const parts: string[] = []
  const opacity = num(shape, 'opacity', 'opacity', 1)
  if (opacity !== 1) parts.push(`opacity="${opacity}"`)
  const blend = str(shape, 'blend-mode', 'blendMode')
  if (blend && blend !== 'normal') parts.push(`style="mix-blend-mode:${esc(blend)}"`)
  const rotation = num(shape, 'rotation', 'rotation', 0)
  if (rotation !== 0) {
    const b = shapeBounds(shape)
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    parts.push(`transform="rotate(${f2(rotation)} ${f2(cx)} ${f2(cy)})"`)
  }
  void ctx
  void shapeId
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

function dropShadowFilter(shape: Shape, ctx: Ctx, shapeId: string): string {
  const shadows = (get<unknown[]>(shape, 'shadows', 'shadows') ?? []) as Record<string, unknown>[]
  const drop = shadows.find((s) => s['style'] === 'drop-shadow' && !s['hidden'])
  if (shadows.some((s) => s['style'] === 'inner-shadow' && !s['hidden'])) {
    ctx.warnings.push(`${shapeId}: inner-shadow skipped (no SVG equivalent in this renderer)`)
  }
  if (!drop) return ''
  const color = drop['color'] as Record<string, unknown> | undefined
  const id = `sh${ctx.defSeq.n++}`
  const dx = typeof drop['offset-x'] === 'number' ? drop['offset-x'] : 0
  const dy = typeof drop['offset-y'] === 'number' ? drop['offset-y'] : 4
  const blur = typeof drop['blur'] === 'number' ? drop['blur'] / 2 : 4
  const flood = typeof color?.['color'] === 'string' ? (color['color'] as string) : '#000000'
  const floodOp = typeof color?.['opacity'] === 'number' ? (color['opacity'] as number) : 0.3
  ctx.defs.push(
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f2(dx)}" dy="${f2(dy)}" stdDeviation="${f2(blur)}" flood-color="${esc(flood)}" flood-opacity="${floodOp}"/></filter>`,
  )
  return ` filter="url(#${id})"`
}

function rectPathD(x: number, y: number, w: number, h: number, r: number[]): string {
  const [r1 = 0, r2 = 0, r3 = 0, r4 = 0] = r
  const arc = (rx: number, ry: number, xAxis: number, yAxis: number) =>
    rx > 0 && ry > 0 ? `A${f2(rx)} ${f2(ry)} 0 0 1 ${f2(xAxis)} ${f2(yAxis)}` : `L${f2(xAxis)} ${f2(yAxis)}`
  return (
    `M${f2(x + r1)} ${f2(y)}` +
    `L${f2(x + w - r2)} ${f2(y)}` +
    arc(r2, r2, x + w, y + r2) +
    `L${f2(x + w)} ${f2(y + h - r3)}` +
    arc(r3, r3, x + w - r3, y + h) +
    `L${f2(x + r4)} ${f2(y + h)}` +
    arc(r4, r4, x, y + h - r4) +
    `L${f2(x)} ${f2(y + r1)}` +
    arc(r1, r1, x + r1, y) +
    'Z'
  )
}

function pathDFromCommands(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const c of content) {
    const cmd = c as { command?: string; params?: Record<string, number> }
    const p = cmd.params ?? {}
    if (cmd.command === 'move-to' && typeof p['x'] === 'number') parts.push(`M${f2(p['x'])} ${f2(p['y'] ?? 0)}`)
    else if (cmd.command === 'line-to' && typeof p['x'] === 'number') parts.push(`L${f2(p['x'])} ${f2(p['y'] ?? 0)}`)
    else if (cmd.command === 'curve-to' && typeof p['x'] === 'number') {
      parts.push(
        `C${f2(p['c1x'] ?? 0)} ${f2(p['c1y'] ?? 0)} ${f2(p['c2x'] ?? 0)} ${f2(p['c2y'] ?? 0)} ${f2(p['x'])} ${f2(p['y'] ?? 0)}`,
      )
    } else if (cmd.command === 'close-path') parts.push('Z')
    else return null
  }
  return parts.length > 0 ? parts.join('') : null
}

type TextRun = { text: string; fontFamily: string; fontSize: number; fontWeight: string; fill: string; letterSpacing: number }

function parseFontSize(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = v.trim().match(/^([\d.]+)(px)?$/)
    if (m) return Number(m[1])
  }
  return fallback
}

function collectRuns(node: unknown, inherited: Omit<TextRun, 'text'>, out: TextRun[]): void {
  const n = node as Record<string, unknown>
  if (!n || typeof n !== 'object') return
  const strOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  if (typeof n['text'] === 'string') {
    const fillArr = Array.isArray(n['fills']) ? (n['fills'] as Record<string, unknown>[]) : []
    const fill = pick<string>(fillArr[0] ?? {}, 'fill-color', 'fillColor') ?? inherited.fill
    out.push({
      text: n['text'] as string,
      fontFamily: strOf(pick(n, 'font-family', 'fontFamily')) ?? inherited.fontFamily,
      fontSize: parseFontSize(pick(n, 'font-size', 'fontSize'), inherited.fontSize),
      fontWeight: strOf(pick(n, 'font-weight', 'fontWeight')) ?? inherited.fontWeight,
      fill,
      letterSpacing: parseFontSize(pick(n, 'letter-spacing', 'letterSpacing'), inherited.letterSpacing),
    })
    return
  }
  const kids = n['children']
  const next: Omit<TextRun, 'text'> = {
    fontFamily: strOf(pick(n, 'font-family', 'fontFamily')) ?? inherited.fontFamily,
    fontSize: parseFontSize(pick(n, 'font-size', 'fontSize'), inherited.fontSize),
    fontWeight: strOf(pick(n, 'font-weight', 'fontWeight')) ?? inherited.fontWeight,
    fill: (() => {
      const fa = Array.isArray(n['fills']) ? (n['fills'] as Record<string, unknown>[]) : []
      return pick<string>(fa[0] ?? {}, 'fill-color', 'fillColor') ?? inherited.fill
    })(),
    letterSpacing: parseFontSize(pick(n, 'letter-spacing', 'letterSpacing'), inherited.letterSpacing),
  }
  if (Array.isArray(kids)) for (const k of kids) collectRuns(k, next, out)
}

function renderText(shape: Shape, ctx: Ctx, shapeId: string): string {
  const b = shapeBounds(shape)
  const content = shape['content'] as Record<string, unknown> | undefined
  const setNode = content && Array.isArray(content['children']) ? (content['children'][0] as Record<string, unknown>) : undefined
  const paras: Record<string, unknown>[] = []
  if (setNode && setNode['type'] === 'paragraph-set' && Array.isArray(setNode['children'])) {
    for (const p of setNode['children'] as Record<string, unknown>[]) paras.push(p)
  }
  if (paras.length === 0) {
    ctx.warnings.push(`${shapeId}: text has no paragraphs, skipped`)
    return `<g data-shape="${esc(shapeId)}"/>`
  }
  const shapeFills = (get<unknown[]>(shape, 'fills', 'fills') ?? []) as Record<string, unknown>[]
  const baseFill = pick<string>(shapeFills[0] ?? {}, 'fill-color', 'fillColor') ?? '#000000'
  const lines: string[] = []
  let cursorY = b.y
  for (const para of paras) {
    const runs: TextRun[] = []
    collectRuns(para, { fontFamily: 'sans-serif', fontSize: 14, fontWeight: '400', fill: baseFill, letterSpacing: 0 }, runs)
    const firstSize = runs[0]?.fontSize ?? 14
    const lineHeightRaw = pick<string>(para, 'line-height', 'lineHeight')
    const lineHeight =
      typeof lineHeightRaw === 'string' && lineHeightRaw.trim().endsWith('px')
        ? parseFontSize(lineHeightRaw, firstSize * 1.2)
        : firstSize * (typeof lineHeightRaw === 'string' ? Number(lineHeightRaw) || 1.2 : 1.2)
    cursorY += Math.max(firstSize * 0.8, 1)
    const textAlign = pick<string>(para, 'text-align', 'textAlign')
    const align = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start'
    const anchorX = align === 'middle' ? b.x + b.width / 2 : align === 'end' ? b.x + b.width : b.x
    const tspans = runs
      .map((r) => {
        const deco = pick<string>(para, 'text-decoration', 'textDecoration') === 'underline' ? ' text-decoration="underline"' : ''
        const ls = r.letterSpacing ? ` letter-spacing="${f2(r.letterSpacing)}"` : ''
        return `<tspan font-family="${esc(r.fontFamily)}, sans-serif" font-size="${f2(r.fontSize)}" font-weight="${esc(r.fontWeight)}" fill="${esc(r.fill)}"${ls}${deco}>${esc(r.text)}</tspan>`
      })
      .join('')
    lines.push(
      `<text x="${f2(anchorX)}" y="${f2(cursorY)}" text-anchor="${align}"${commonAttrs(shape, ctx, shapeId)}${dropShadowFilter(shape, ctx, shapeId)}>${tspans}</text>`,
    )
    cursorY += Math.max(lineHeight - firstSize * 0.8, 1)
  }
  return `<g data-shape="${esc(shapeId)}">${lines.join('')}</g>`
}

function renderChildren(shape: Shape, ctx: Ctx): string {
  const ids = (get<string[]>(shape, 'shapes', 'shapes') ?? []) as string[]
  return ids.map((id) => renderShape(id, ctx)).join('')
}

function renderShape(shapeId: string, ctx: Ctx): string {
  const shape = ctx.objects[shapeId]
  if (!shape) {
    ctx.warnings.push(`${shapeId}: referenced shape missing from page data, skipped`)
    return ''
  }
  const type = str(shape, 'type', 'type')
  if (get<unknown>(shape, 'hidden', 'hidden') === true) return ''
  const sid = typeof shape['id'] === 'string' ? (shape['id'] as string) : shapeId
  const common = commonAttrs(shape, ctx, sid)
  const filter = dropShadowFilter(shape, ctx, sid)
  const open = `<g data-shape="${esc(sid)}"${common}${filter}>`
  const close = `</g>`
  const paint = (inner: string) => `${open}${inner}${close}`

  if (type === 'frame' || type === 'group') {
    return `${open}${renderChildren(shape, ctx)}${close}`
  }
  if (type === 'rect' || type === 'frame-cover') {
    const b = shapeBounds(shape)
    const r = [num(shape, 'r1', 'r1'), num(shape, 'r2', 'r2'), num(shape, 'r3', 'r3'), num(shape, 'r4', 'r4')]
    const fill = fillAttrs(shape, ctx, sid) ?? 'fill="none"'
    const stroke = strokeAttrs(shape, ctx, sid)
    const geom =
      r.every((v) => v === r[0]) && r[0]! > 0
        ? `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" rx="${f2(r[0])}" ${fill} ${stroke}/>`
        : r.some((v) => v > 0)
          ? `<path d="${rectPathD(b.x, b.y, b.width, b.height, r)}" ${fill} ${stroke} fill-rule="evenodd"/>`
          : `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" ${fill} ${stroke}/>`
    return paint(geom)
  }
  if (type === 'circle') {
    const b = shapeBounds(shape)
    const fill = fillAttrs(shape, ctx, sid) ?? 'fill="none"'
    const stroke = strokeAttrs(shape, ctx, sid)
    return paint(
      `<ellipse cx="${f2(b.x + b.width / 2)}" cy="${f2(b.y + b.height / 2)}" rx="${f2(b.width / 2)}" ry="${f2(b.height / 2)}" ${fill} ${stroke}/>`,
    )
  }
  if (type === 'path') {
    // Penpot normalizes stored path geometry to an SVG `d` string on read.
    const content = shape['content']
    let commands: PathCommand[] | null = null
    if (typeof content === 'string') {
      try {
        commands = parsePathData(content)
      } catch {
        commands = null
      }
    } else {
      commands = content as PathCommand[]
    }
    const d = commands ? pathDFromCommands(commands) : null
    if (!d) {
      ctx.warnings.push(`${sid}: path has no parseable geometry, bounds placeholder drawn`)
      const b = shapeBounds(shape)
      return paint(`<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" fill="none" stroke="#FF0000" stroke-dasharray="4 2"/>`)
    }
    const fill = fillAttrs(shape, ctx, sid) ?? 'fill="none"'
    const stroke = strokeAttrs(shape, ctx, sid)
    return paint(`<path d="${esc(d)}" ${fill} ${stroke}/>`)
  }
  if (type === 'bool') {
    const boolType = str(shape, 'bool-type', 'boolType')
    if (boolType === 'union' || !boolType) return `${open}${renderChildren(shape, ctx)}${close}`
    const b = shapeBounds(shape)
    ctx.warnings.push(`${sid}: boolean ${boolType || 'unknown'} not expanded, bounds placeholder drawn`)
    return paint(
      `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" fill="none" stroke="#FF0000" stroke-dasharray="4 2"/>`,
    )
  }
  if (type === 'text') {
    return renderText(shape, ctx, sid)
  }
  if (type === 'image') {
    const meta = (shape['metadata'] ?? {}) as Record<string, unknown>
    const mid = typeof meta['id'] === 'string' ? meta['id'] : undefined
    const entry = mid ? ctx.media.get(mid) : undefined
    const b = shapeBounds(shape)
    if (entry) {
      return paint(
        `<image href="data:${entry.mtype};base64,${entry.bytes.toString('base64')}" x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(Math.max(b.width, 1))}" height="${f2(Math.max(b.height, 1))}" preserveAspectRatio="xMidYMid meet"/>`,
      )
    }
    ctx.warnings.push(`${sid}: image media bytes unavailable in this headless session, placeholder drawn`)
    return paint(
      `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" fill="#E5E7EB" stroke="#9CA3AF" stroke-dasharray="6 3"/>`,
    )
  }
  if (type === 'svg-raw') {
    ctx.warnings.push(`${sid}: svg-raw node skipped (not convertible in headless export)`)
    return ''
  }
  ctx.warnings.push(`${sid}: unsupported shape type ${type}, bounds placeholder drawn`)
  const b = shapeBounds(shape)
  return paint(`<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.width)}" height="${f2(b.height)}" fill="none" stroke="#FF0000" stroke-dasharray="4 2"/>`)
}

export type SerializeResult = { svg: string; width: number; height: number; warnings: SerializeWarnings }

/**
 * Serializes the subtree rooted at `rootId` into a standalone SVG with a
 * tight viewBox. Coordinates are shifted so the root bounds start at (0,0).
 */
export function serializeSubtree(
  rootId: string,
  objects: Objects,
  media: MediaBytes = new Map(),
): SerializeResult {
  const warnings: SerializeWarnings = []
  const ctx: Ctx = { objects, media, warnings, defs: [], defSeq: { n: 0 } }
  const root = objects[rootId]
  if (!root) throw new Error(`serializeSubtree: shape ${rootId} not found in page objects`)
  const b = shapeBounds(root)
  const width = Math.max(Math.round(b.width), 1)
  const height = Math.max(Math.round(b.height), 1)
  const body = renderShape(rootId, ctx)
  const defs = ctx.defs.length > 0 ? `<defs>${ctx.defs.join('')}</defs>` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${defs}<g transform="translate(${f2(-b.x)} ${f2(-b.y)})">${body}</g></svg>`
  return { svg, width, height, warnings }
}
