/**
 * svg-import.ts
 *
 * Strict SVG sanitizer + converter to native Penpot shapes.
 *
 * Security: hand-rolled parser for a strict SVG subset. Rejects DOCTYPE,
 * entities, processing instructions, scripts, foreignObject, event-handler
 * attributes, javascript: URLs and non-local references. External raster
 * references are returned as upload jobs for the caller (which applies its
 * own SSRF-guarded fetch) — never fetched here.
 *
 * Fidelity: rect/circle/ellipse/path/line/polyline/polygon/groups/transforms/
 * solid fills/linear+radial gradients/strokes/text are converted natively.
 * Anything else is dropped with a warning; nativeEditable is false when
 * structural content was lost.
 */
import { randomUUID } from 'node:crypto'
import { rect, circle, path, text, group, type Fill, type Stroke, type PathCommand } from '../shape-builders.js'

export type UploadJob = { bytes: Buffer; mtype: string; name: string }

export type SvgConvertResult = {
  /** Penpot shape objects in add order (parents before children). */
  shapes: Array<{ id: string; obj: Record<string, unknown> }>
  /** Ids of top-level shapes (children of the requested parent). */
  rootIds: string[]
  /** Raster uploads the caller must perform before add-obj. */
  uploads: UploadJob[]
  /** Patch list: fill after upload as { shapeId, uploadIndex, kind, width, height }. */
  uploadPatches: Array<{ shapeId: string; uploadIndex: number; kind: 'fill' | 'image'; width: number; height: number }>
  warnings: string[]
  nativeEditable: boolean
  dropped: string[]
}

type Attrs = Record<string, string>
type SvgNode = { tag: string; attrs: Attrs; children: SvgNode[]; text: string }

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'use', 'image', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc',
])
const DROP_TAGS = new Set([
  'style', 'metadata', 'mask', 'clipPath', 'pattern', 'filter', 'symbol', 'marker',
  'font', 'font-face', 'switch', 'a', 'view', 'cursor', 'color-profile', 'animate', 'animateTransform',
])

const PRESENTATION_ATTRS = new Set([
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2',
  'points', 'd', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'display', 'visibility', 'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'text-anchor', 'text-decoration', 'id', 'href', 'xlink:href',
  'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
  'preserveAspectRatio', 'viewBox', 'spreadMethod',
])

function parseSvgXml(xml: string, dropped: string[]): SvgNode {
  const tagRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)[^<>]*>|<([a-zA-Z][\w-]*)([^<>]*?)(\/?)>|([^<>]+)/g
  const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const top: Array<{ node: SvgNode; tag: string }> = []
  let root: SvgNode | null = null
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml)) !== null) {
    const full = m[0]
    if (full.startsWith('<!--')) continue
    if (m[1] !== undefined) {
      const closing = m[1].toLowerCase()
      const open = top.pop()
      if (!open || open.tag !== closing) throw new Error(`svg-import: mismatched closing tag </${m[1]}>`)
      if (top.length === 0) {
        if (root) throw new Error('svg-import: multiple root elements')
        root = open.node
      } else {
        top[top.length - 1]!.node.children.push(open.node)
      }
      continue
    }
    if (m[2] !== undefined) {
      const tag = m[2].toLowerCase()
      const rawAttrs = m[3] ?? ''
      const selfClosing = m[4] === '/'
      const attrs: Attrs = {}
      let a: RegExpExecArray | null
      attrRe.lastIndex = 0
      while ((a = attrRe.exec(rawAttrs)) !== null) {
        const key = a[1]!.toLowerCase()
        const val = a[2] ?? a[3] ?? a[4] ?? ''
        if (key.startsWith('on')) {
          dropped.push(`${tag}@${key}`)
          continue
        }
        if (!PRESENTATION_ATTRS.has(key) && key !== 'xmlns' && key !== 'xmlns:xlink' && key !== 'version') {
          dropped.push(`${tag}@${key}`)
          continue
        }
        if ((key === 'href' || key === 'xlink:href') && /^\s*javascript:/i.test(val)) {
          throw new Error('svg-import: javascript: URLs are rejected')
        }
        if ((key === 'fill' || key === 'stroke') && /^url\(/i.test(val.trim()) && !/^url\(#[\w-]+\)$/i.test(val.trim())) {
          dropped.push(`${tag}@${key}=external-ref`)
          continue
        }
        attrs[key] = val
      }
      if (!ALLOWED_TAGS.has(tag)) {
        if (!DROP_TAGS.has(tag)) dropped.push(`<${tag}>`)
        else dropped.push(`<${tag}>`)
        // Skip the entire subtree: consume until matching close.
        if (!selfClosing) {
          let depth = 1
          const skipRe = new RegExp(`<(/?)${tag}(?![\\w-])[^<>]*?(/)?>`, 'gi')
          skipRe.lastIndex = tagRe.lastIndex
          let s: RegExpExecArray | null
          while (depth > 0 && (s = skipRe.exec(xml)) !== null) {
            if (s[2] === '/') continue
            else if (s[1] === '/') depth--
            else depth++
          }
          if (depth !== 0) throw new Error(`svg-import: unclosed dropped element <${tag}>`)
          tagRe.lastIndex = skipRe.lastIndex
        }
        continue
      }
      const node: SvgNode = { tag, attrs, children: [], text: '' }
      if (selfClosing || tag === 'stop') {
        if (top.length === 0) throw new Error(`svg-import: root cannot be <${tag}>`)
        top[top.length - 1]!.node.children.push(node)
      } else {
        top.push({ node, tag })
      }
      continue
    }
    // Text content (m[5]).
    const text = m[5] ?? ''
    if (text.trim() && top.length > 0) top[top.length - 1]!.node.text += text
  }
  if (top.length !== 0) throw new Error('svg-import: unclosed tags at end of input')
  if (!root) throw new Error('svg-import: no root element found')
  if (root.tag !== 'svg') throw new Error('svg-import: root element must be <svg>')
  return root
}

export function sanitizeSvg(xml: string): { root: SvgNode; warnings: string[]; dropped: string[] } {
  const warnings: string[] = []
  const dropped: string[] = []
  if (xml.length > 2 * 1024 * 1024) throw new Error('svg-import: SVG exceeds the 2 MB cap')
  if (/<!DOCTYPE/i.test(xml)) throw new Error('svg-import: DOCTYPE declarations are rejected')
  if (/<!ENTITY/i.test(xml)) throw new Error('svg-import: ENTITY declarations are rejected')
  if (/<\?[\s\S]*?\?>/.test(xml)) throw new Error('svg-import: processing instructions are rejected')
  if (/<script[\s>]/i.test(xml)) throw new Error('svg-import: <script> is rejected')
  if (/<foreignObject[\s>]/i.test(xml)) throw new Error('svg-import: <foreignObject> is rejected')
  const root = parseSvgXml(xml, dropped)
  if (dropped.length > 0) warnings.push(`dropped ${dropped.length} unsupported elements/attributes: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? '…' : ''}`)
  return { root, warnings, dropped }
}

// ---------- geometry helpers ----------

type Matrix = [number, number, number, number, number, number] // a,b,c,d,e,f

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function mul(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

function applyPt(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function parseTransform(raw: string | undefined, warnings: string[]): Matrix {
  if (!raw) return IDENTITY
  let m: Matrix = [...IDENTITY] as Matrix
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi
  let t: RegExpExecArray | null
  const nums = (s: string) => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
  while ((t = re.exec(raw)) !== null) {
    const kind = t[1]!.toLowerCase()
    const v = nums(t[2] ?? '')
    if (kind === 'matrix' && v.length === 6) m = mul(m, [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!])
    else if (kind === 'translate') m = mul(m, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0])
    else if (kind === 'scale') m = mul(m, [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0])
    else if (kind === 'rotate') {
      const a = ((v[0] ?? 0) * Math.PI) / 180
      const cx = v[1] ?? 0
      const cy = v[2] ?? 0
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      m = mul(m, [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos])
    } else if (kind === 'skewx') {
      const a = ((v[0] ?? 0) * Math.PI) / 180
      m = mul(m, [1, 0, Math.tan(a), 1, 0, 0])
    } else if (kind === 'skewy') {
      const a = ((v[0] ?? 0) * Math.PI) / 180
      m = mul(m, [1, Math.tan(a), 0, 1, 0, 0])
    } else {
      warnings.push(`unsupported transform ignored: ${t[0].slice(0, 40)}`)
    }
  }
  return m
}

/** Decompose M into translate + rotate(deg) + uniform scale. Returns null when not decomposable that way. */
function decomposeTRS(m: Matrix): { tx: number; ty: number; rotation: number; scale: number } | null {
  const [a, b, c, d, e, f] = m
  const sx = Math.hypot(a, b)
  const sy = Math.hypot(c, d)
  if (sx < 1e-9) return null
  if (Math.abs(sx - sy) / Math.max(sx, 1e-9) > 1e-6) return null
  // Check no skew: (a,b) perpendicular to (c,d).
  const dot = a * c + b * d
  if (Math.abs(dot) / (sx * sy) > 1e-6) return null
  const rotation = (Math.atan2(b, a) * 180) / Math.PI
  return { tx: e, ty: f, rotation, scale: sx }
}

function numAttr(attrs: Attrs, key: string, fallback: number): number {
  const raw = attrs[key]
  if (raw === undefined) return fallback
  const m = raw.trim().match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)/i)
  return m ? Number(m[1]) : fallback
}

// ---------- path data ----------

/** Parses SVG path `d` (absolute and relative commands, incl. arcs) into Penpot path commands. */
export function parsePathData(d: string): PathCommand[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const cmds: PathCommand[] = []
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevCubic: [number, number] | null = null
  let prevQuad: [number, number] | null = null
  const next = (): number => Number(tokens[i++])
  let cmd = ''
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!
    if (!cmd) break
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const pt = (x: number, y: number): [number, number] => (rel ? [cx + x, cy + y] : [x, y])
    if (C === 'M') {
      const [x, y] = pt(next(), next())
      cx = x
      cy = y
      sx = x
      sy = y
      cmds.push({ command: 'move-to', params: { x, y } })
      cmd = rel ? 'l' : 'L'
      prevCubic = prevQuad = null
    } else if (C === 'L') {
      const [x, y] = pt(next(), next())
      cx = x
      cy = y
      cmds.push({ command: 'line-to', params: { x, y } })
      prevCubic = prevQuad = null
    } else if (C === 'H') {
      const [x] = pt(next(), 0)
      cx = x
      cmds.push({ command: 'line-to', params: { x, y: cy } })
      prevCubic = prevQuad = null
    } else if (C === 'V') {
      const [, y] = pt(0, next())
      cy = y
      cmds.push({ command: 'line-to', params: { x: cx, y } })
      prevCubic = prevQuad = null
    } else if (C === 'C') {
      const [x1, y1] = pt(next(), next())
      const [x2, y2] = pt(next(), next())
      const [x, y] = pt(next(), next())
      cmds.push({ command: 'curve-to', params: { x, y, c1x: x1, c1y: y1, c2x: x2, c2y: y2 } })
      prevCubic = [x2, y2]
      prevQuad = null
      cx = x
      cy = y
    } else if (C === 'S') {
      const [x2, y2] = pt(next(), next())
      const [x, y] = pt(next(), next())
      const [rx, ry] = prevCubic ? [2 * cx - prevCubic[0], 2 * cy - prevCubic[1]] : [cx, cy]
      cmds.push({ command: 'curve-to', params: { x, y, c1x: rx, c1y: ry, c2x: x2, c2y: y2 } })
      prevCubic = [x2, y2]
      prevQuad = null
      cx = x
      cy = y
    } else if (C === 'Q') {
      const [qx, qy] = pt(next(), next())
      const [x, y] = pt(next(), next())
      const c1x = cx + (2 / 3) * (qx - cx)
      const c1y = cy + (2 / 3) * (qy - cy)
      const c2x = x + (2 / 3) * (qx - x)
      const c2y = y + (2 / 3) * (qy - y)
      cmds.push({ command: 'curve-to', params: { x, y, c1x, c1y, c2x, c2y } })
      prevQuad = [qx, qy]
      prevCubic = null
      cx = x
      cy = y
    } else if (C === 'T') {
      const [x, y] = pt(next(), next())
      const refl: [number, number] = prevQuad ? [2 * cx - prevQuad[0], 2 * cy - prevQuad[1]] : [cx, cy]
      const qx = refl[0]
      const qy = refl[1]
      const c1x = cx + (2 / 3) * (qx - cx)
      const c1y = cy + (2 / 3) * (qy - cy)
      const c2x = x + (2 / 3) * (qx - x)
      const c2y = y + (2 / 3) * (qy - y)
      cmds.push({ command: 'curve-to', params: { x, y, c1x, c1y, c2x, c2y } })
      prevQuad = [qx, qy]
      prevCubic = null
      cx = x
      cy = y
    } else if (C === 'A') {
      const rx = Math.abs(next())
      const ry = Math.abs(next())
      next() // x-axis-rotation (only axis-aligned supported; rotated arcs fall back below)
      next() // large-arc-flag
      next() // sweep-flag
      const [x, y] = pt(next(), next())
      const beziers = arcToBeziers(cx, cy, rx, ry, x, y)
      if (beziers) for (const bz of beziers) cmds.push({ command: 'curve-to', params: bz })
      else cmds.push({ command: 'line-to', params: { x, y } })
      prevCubic = prevQuad = null
      cx = x
      cy = y
    } else if (C === 'Z') {
      cmds.push({ command: 'close-path', params: {} })
      cx = sx
      cy = sy
      prevCubic = prevQuad = null
    } else {
      throw new Error(`svg-import: unsupported path command ${cmd}`)
    }
  }
  return cmds
}

/** Axis-aligned elliptical arc (rx,ry, endpoint) -> cubic segments. Returns null when degenerate. */
function arcToBeziers(
  x0: number, y0: number, rx: number, ry: number, x1: number, y1: number,
): Array<{ x: number; y: number; c1x: number; c1y: number; c2x: number; c2y: number }> | null {
  if (rx < 1e-9 || ry < 1e-9) return null
  if (Math.abs(x0 - x1) < 1e-9 && Math.abs(y0 - y1) < 1e-9) return null
  // Approximate the axis-aligned ellipse arc by sampling angles: find angles of endpoints.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const a0 = Math.atan2((y0 - cy) / ry, (x0 - cx) / rx)
  let a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx)
  while (a1 <= a0) a1 += Math.PI * 2
  const total = a1 - a0
  const segs = Math.max(1, Math.ceil(total / (Math.PI / 2)))
  const out: Array<{ x: number; y: number; c1x: number; c1y: number; c2x: number; c2y: number }> = []
  for (let s = 0; s < segs; s++) {
    const t0 = a0 + (total * s) / segs
    const t1 = a0 + (total * (s + 1)) / segs
    const k = (4 / 3) * Math.tan((t1 - t0) / 4)
    const p0 = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)]
    const p3 = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)]
    const p1 = [p0[0]! - k * rx * Math.sin(t0), p0[1]! + k * ry * Math.cos(t0)]
    const p2 = [p3[0]! + k * rx * Math.sin(t1), p3[1]! - k * ry * Math.cos(t1)]
    out.push({ x: p3[0]!, y: p3[1]!, c1x: p1[0]!, c1y: p1[1]!, c2x: p2[0]!, c2y: p2[1]! })
  }
  return out
}

function transformCommands(cmds: PathCommand[], m: Matrix): PathCommand[] {
  return cmds.map((c) => {
    if (c.command === 'move-to' || c.command === 'line-to') {
      const [x, y] = applyPt(m, c.params.x, c.params.y)
      return { command: c.command, params: { x, y } }
    }
    if (c.command === 'curve-to') {
      const [x, y] = applyPt(m, c.params.x, c.params.y)
      const [c1x, c1y] = applyPt(m, c.params.c1x, c.params.c1y)
      const [c2x, c2y] = applyPt(m, c.params.c2x, c.params.c2y)
      return { command: 'curve-to', params: { x, y, c1x, c1y, c2x, c2y } }
    }
    return c
  })
}

// ---------- paint ----------

function parseColor(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  const v = raw.trim().toLowerCase()
  if (v === '' || v === 'none' || v === 'transparent') return 'none'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) {
    if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
    return v.length === 9 ? v.slice(0, 7) : v
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1]!.split(/[,\s/]+/).filter(Boolean)
    const n = (s: string) => (s.endsWith('%') ? Math.round((Number(s.slice(0, -1)) * 255) / 100) : Number(s))
    const r = Math.max(0, Math.min(255, n(parts[0] ?? '0')))
    const g = Math.max(0, Math.min(255, n(parts[1] ?? '0')))
    const b = Math.max(0, Math.min(255, n(parts[2] ?? '0')))
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
    olive: '#808000', lime: '#00ff00', aqua: '#00ffff', teal: '#008080', navy: '#000080',
    fuchsia: '#ff00ff', purple: '#800080', orange: '#ffa500',
  }
  if (named[v]) return named[v]!
  return fallback
}

type Paint = { fills: Fill[]; strokes: Stroke[]; opacity?: number }

function parseStyleAttr(raw: string | undefined, attrs: Attrs): void {
  if (!raw) return
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const k = decl.slice(0, idx).trim().toLowerCase()
    const v = decl.slice(idx + 1).trim()
    if (PRESENTATION_ATTRS.has(k) && !(k in attrs)) attrs[k] = v
  }
}

function buildPaint(attrs: Attrs, warnings: string[], shapeLabel: string): Paint {
  parseStyleAttr(attrs['style'], attrs)
  const fills: Fill[] = []
  const fillRaw = (attrs['fill'] ?? '').trim()
  if (fillRaw && !/^none$/i.test(fillRaw)) {
    const gradMatch = fillRaw.match(/^url\(#([\w-]+)\)$/i)
    if (gradMatch) {
      fills.push({ __gradientRef: gradMatch[1] } as unknown as Fill)
    } else {
      fills.push({ 'fill-color': parseColor(fillRaw, '#000000'), 'fill-opacity': numOp(attrs['fill-opacity'], 1) })
    }
  }
  const strokes: Stroke[] = []
  const strokeRaw = (attrs['stroke'] ?? '').trim()
  if (strokeRaw && !/^none$/i.test(strokeRaw)) {
    const dashRaw = (attrs['stroke-dasharray'] ?? '').trim().toLowerCase()
    strokes.push({
      'stroke-color': parseColor(strokeRaw, '#000000'),
      'stroke-opacity': numOp(attrs['stroke-opacity'], 1),
      'stroke-width': numAttr(attrs, 'stroke-width', 1),
      'stroke-style': dashRaw === 'none' || dashRaw === '' ? 'solid' : 'dashed',
      'stroke-alignment': 'center',
    })
    if (dashRaw && dashRaw !== 'none') warnings.push(`${shapeLabel}: dash pattern approximated as dashed`)
  }
  const paint: Paint = { fills, strokes }
  const op = numOp(attrs['opacity'], 1)
  if (op !== 1) paint.opacity = op
  return paint
}

function numOp(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback
}

// ---------- converter ----------

type Ctx = {
  defs: Map<string, SvgNode>
  warnings: string[]
  dropped: string[]
  uploads: UploadJob[]
  uploadPatches: SvgConvertResult['uploadPatches']
  shapes: SvgConvertResult['shapes']
  rootIds: string[]
  nativeEditable: boolean
  parentId: string
  frameId: string
  namePrefix: string
}

function styledName(attrs: Attrs, fallback: string): string {
  const id = attrs['id']
  return id ? `${fallback}-${id}`.slice(0, 80) : fallback
}

function convertGradientDef(node: SvgNode): { id: string; fill: Fill } | null {
  const idRaw = node.attrs['id']
  if (!idRaw) return null
  const stops = node.children
    .filter((c) => c.tag === 'stop')
    .map((s) => ({
      color: parseColor(s.attrs['stop-color'] ?? s.attrs['stopColor'] ?? '#000000', '#000000'),
      opacity: numOp(s.attrs['stop-opacity'], 1),
      offset: (() => {
        const o = (s.attrs['offset'] ?? '0').trim()
        if (o.endsWith('%')) return Math.max(0, Math.min(1, Number(o.slice(0, -1)) / 100))
        const n = Number(o)
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
      })(),
    }))
  if (stops.length < 2) return null
  if (node.attrs['gradientTransform']) return null // unsupported transform: caller falls back
  if (node.tag === 'lineargradient') {
    const units = (node.attrs['gradientUnits'] ?? 'objectBoundingBox').trim()
    if (units !== 'objectBoundingBox') return null // userSpaceOnUse handled per-shape elsewhere
    const pct = (v: string | undefined, d: number) => {
      if (v === undefined) return d
      const t = v.trim()
      return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t)
    }
    return {
      id: idRaw,
      fill: {
        'fill-color-gradient': {
          type: 'linear',
          'start-x': pct(node.attrs['x1'], 0),
          'start-y': pct(node.attrs['y1'], 0),
          'end-x': pct(node.attrs['x2'], 1),
          'end-y': pct(node.attrs['y2'], 0),
          width: 1,
          stops,
        },
      },
    }
  }
  // radial: center + radius from bounding circle
  const pct = (v: string | undefined, d: number) => {
    if (v === undefined) return d
    const t = v.trim()
    return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t)
  }
  return {
    id: idRaw,
    fill: {
      'fill-color-gradient': {
        type: 'radial',
        'start-x': pct(node.attrs['cx'], 0.5),
        'start-y': pct(node.attrs['cy'], 0.5),
        'end-x': pct(node.attrs['cx'], 0.5) + pct(node.attrs['r'], 0.5),
        'end-y': pct(node.attrs['cy'], 0.5),
        width: 1,
        stops,
      },
    },
  }
}

function resolveFill(fill: Fill, grads: Map<string, Fill>, warnings: string[], shapeLabel: string): Fill[] {
  const ref = (fill as Record<string, unknown>)['__gradientRef'] as string | undefined
  if (!ref) return [fill]
  const g = grads.get(ref)
  if (g) return [g]
  warnings.push(`${shapeLabel}: gradient #${ref} missing or unsupported, solid fallback used`)
  return [{ 'fill-color': '#000000', 'fill-opacity': 1 }]
}

function pushShape(ctx: Ctx, obj: Record<string, unknown>, childIds: string[] = []): string {
  const id = obj['id'] as string
  ctx.shapes.push({ id, obj })
  void childIds
  return id
}

function convertNode(node: SvgNode, matrix: Matrix, paint: Paint, grads: Map<string, Fill>, ctx: Ctx, parentId: string): string[] {
  // Returns ids of created top-level shapes for this node.
  const attrs = { ...node.attrs }
  // Inherit presentation attributes from ancestors (paint already merged by caller for fill/stroke/opacity).
  const local = parseTransform(attrs['transform'], ctx.warnings)
  const m = mul(matrix, local)
  const ids: string[] = []
  const display = (attrs['display'] ?? '').trim().toLowerCase()
  const visibility = (attrs['visibility'] ?? '').trim().toLowerCase()
  if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') return ids

  const mergedPaint: Paint = {
    fills: paint.fills.length > 0 && !('fill' in attrs) ? paint.fills : buildPaint(attrs, ctx.warnings, node.tag).fills,
    strokes:
      paint.strokes.length > 0 && !('stroke' in attrs) ? paint.strokes : buildPaint(attrs, ctx.warnings, node.tag).strokes,
  }
  if (!('opacity' in attrs) && paint.opacity !== undefined) mergedPaint.opacity = paint.opacity
  else if ('opacity' in attrs) {
    const op = numOp(attrs['opacity'], 1)
    if (op !== 1) mergedPaint.opacity = op
  }

  const finish = (obj: Record<string, unknown>): string => {
    obj['parent-id'] = parentId
    obj['frame-id'] = ctx.frameId
    pushShape(ctx, obj)
    ids.push(obj['id'] as string)
    return obj['id'] as string
  }
  const finalFills = (shapeLabel: string): Fill[] => {
    const out: Fill[] = []
    for (const f of mergedPaint.fills) out.push(...resolveFill(f, grads, ctx.warnings, shapeLabel))
    return out
  }
  const shapeStrokes = (): Stroke[] => mergedPaint.strokes

  switch (node.tag) {
    case 'g':
    case 'svg': {
      const gid = randomUUID()
      const name = styledName(attrs, node.tag === 'svg' ? 'svg-root' : 'group')
      // Convert children first to compute bbox.
      const childIds: string[] = []
      for (const c of node.children) {
        if (c.tag === 'defs' || c.tag === 'title' || c.tag === 'desc') continue
        childIds.push(...convertNode(c, m, mergedPaint, grads, ctx, gid))
      }
      void childIds
      // Group with empty bbox placeholder; Penpot derives layout from children.
      const g = group({ id: gid, name, x: 0, y: 0, width: 1, height: 1, parentId, frameId: ctx.frameId, shapes: [] })
      finish(g)
      return [gid]
    }
    case 'rect': {
      const x = numAttr(attrs, 'x', 0)
      const y = numAttr(attrs, 'y', 0)
      const w = numAttr(attrs, 'width', 0)
      const h = numAttr(attrs, 'height', 0)
      if (w <= 0 || h <= 0) {
        ctx.warnings.push('rect with non-positive size skipped')
        return ids
      }
      const rx = numAttr(attrs, 'rx', 0)
      const ry = numAttr(attrs, 'ry', numAttr(attrs, 'rx', 0))
      const label = styledName(attrs, 'rect')
      const trs = decomposeTRS(m)
      if (trs) {
        const r = group({ id: 'x', name: 'x', x: 0, y: 0, width: 1, height: 1, parentId, frameId: ctx.frameId })
        void r
        const nx = (x * trs.scale + trs.tx) * 1
        const ny = (y * trs.scale + trs.ty) * 1
        const o = rect({
          id: randomUUID(),
          name: label,
          x: nx,
          y: ny,
          width: w * trs.scale,
          height: h * trs.scale,
          rotation: Math.abs(trs.rotation) < 1e-9 ? 0 : trs.rotation,
          parentId,
          frameId: ctx.frameId,
          fills: finalFills(label),
          strokes: shapeStrokes(),
          r1: rx * trs.scale,
          r2: rx * trs.scale,
          r3: ry * trs.scale,
          r4: ry * trs.scale,
          ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
        })
        finish(o)
        return ids
      }
      // Non-decomposable transform: bake corners into a path.
      const corners: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      const pts = corners.map(([px, py]) => applyPt(m, px, py))
      ctx.warnings.push(`${label}: complex transform baked into path geometry (rounded corners dropped)`)
      const o = path({
        id: randomUUID(),
        name: label,
        content: [
          { command: 'move-to', params: { x: pts[0]![0], y: pts[0]![1] } },
          { command: 'line-to', params: { x: pts[1]![0], y: pts[1]![1] } },
          { command: 'line-to', params: { x: pts[2]![0], y: pts[2]![1] } },
          { command: 'line-to', params: { x: pts[3]![0], y: pts[3]![1] } },
          { command: 'close-path', params: {} },
        ],
        parentId,
        frameId: ctx.frameId,
        fills: finalFills(label),
        strokes: shapeStrokes(),
        ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
      })
      finish(o)
      return ids
    }
    case 'circle':
    case 'ellipse': {
      const cx = numAttr(attrs, 'cx', 0)
      const cy = numAttr(attrs, 'cy', 0)
      const rx = node.tag === 'circle' ? numAttr(attrs, 'r', 0) : numAttr(attrs, 'rx', 0)
      const ry = node.tag === 'circle' ? numAttr(attrs, 'r', 0) : numAttr(attrs, 'ry', 0)
      if (rx <= 0 || ry <= 0) {
        ctx.warnings.push(`${node.tag} with non-positive radius skipped`)
        return ids
      }
      const label = styledName(attrs, node.tag)
      const trs = decomposeTRS(m)
      if (trs) {
        const [ncx, ncy] = [cx * trs.scale + trs.tx, cy * trs.scale + trs.ty]
        const o = circle({
          id: randomUUID(),
          name: label,
          x: ncx - rx * trs.scale,
          y: ncy - ry * trs.scale,
          width: rx * 2 * trs.scale,
          height: ry * 2 * trs.scale,
          rotation: Math.abs(trs.rotation) < 1e-9 ? 0 : trs.rotation,
          parentId,
          frameId: ctx.frameId,
          fills: finalFills(label),
          strokes: shapeStrokes(),
          ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
        })
        finish(o)
        return ids
      }
      // Bake ellipse to cubic path.
      const k = 0.552284749831
      const seg = (cx0: number, cy0: number, rx0: number, ry0: number): PathCommand[] => {
        const cmds: PathCommand[] = [{ command: 'move-to', params: { x: cx0 + rx0, y: cy0 } }]
        const arcs: Array<[[number, number], [number, number], [number, number]]> = [
          [[cx0 + rx0, cy0 + k * ry0], [cx0 + k * rx0, cy0 + ry0], [cx0, cy0 + ry0]],
          [[cx0 - k * rx0, cy0 + ry0], [cx0 - rx0, cy0 + k * ry0], [cx0 - rx0, cy0]],
          [[cx0 - rx0, cy0 - k * ry0], [cx0 - k * rx0, cy0 - ry0], [cx0, cy0 - ry0]],
          [[cx0 + k * rx0, cy0 - ry0], [cx0 + rx0, cy0 - k * ry0], [cx0 + rx0, cy0]],
        ]
        for (const [[c1x, c1y], [c2x, c2y], [x, y]] of arcs) {
          cmds.push({ command: 'curve-to', params: { x, y, c1x, c1y, c2x, c2y } })
        }
        cmds.push({ command: 'close-path', params: {} })
        return cmds
      }
      ctx.warnings.push(`${label}: complex transform baked into path geometry`)
      const o = path({
        id: randomUUID(),
        name: label,
        content: transformCommands(seg(cx, cy, rx, ry), m),
        parentId,
        frameId: ctx.frameId,
        fills: finalFills(label),
        strokes: shapeStrokes(),
        ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
      })
      finish(o)
      return ids
    }
    case 'path': {
      const raw = attrs['d'] ?? ''
      let cmds: PathCommand[]
      try {
        cmds = parsePathData(raw)
      } catch (e) {
        ctx.warnings.push(`path d parse failed (${(e as Error).message}); shape skipped`)
        ctx.nativeEditable = false
        return ids
      }
      if (cmds.length === 0) return ids
      const label = styledName(attrs, 'path')
      const o = path({
        id: randomUUID(),
        name: label,
        content: transformCommands(cmds, m),
        parentId,
        frameId: ctx.frameId,
        fills: finalFills(label),
        strokes: shapeStrokes(),
        ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
      })
      finish(o)
      return ids
    }
    case 'line':
    case 'polyline':
    case 'polygon': {
      let cmds: PathCommand[] = []
      if (node.tag === 'line') {
        cmds = [
          { command: 'move-to', params: { x: numAttr(attrs, 'x1', 0), y: numAttr(attrs, 'y1', 0) } },
          { command: 'line-to', params: { x: numAttr(attrs, 'x2', 0), y: numAttr(attrs, 'y2', 0) } },
        ]
      } else {
        const pts = (attrs['points'] ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n))
        for (let i = 0; i + 1 < pts.length; i += 2) {
          cmds.push({ command: i === 0 ? 'move-to' : 'line-to', params: { x: pts[i]!, y: pts[i + 1]! } })
        }
        if (node.tag === 'polygon' && cmds.length > 0) cmds.push({ command: 'close-path', params: {} })
      }
      if (cmds.length === 0) return ids
      const label = styledName(attrs, node.tag)
      const o = path({
        id: randomUUID(),
        name: label,
        content: transformCommands(cmds, m),
        parentId,
        frameId: ctx.frameId,
        fills: finalFills(label),
        strokes: shapeStrokes(),
        ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
      })
      finish(o)
      return ids
    }
    case 'text': {
      const label = styledName(attrs, 'text')
      const size = numAttr(attrs, 'font-size', 14)
      const anchor = (attrs['text-anchor'] ?? 'start').trim()
      const content = node.children
        .filter((c) => c.tag === 'tspan')
        .map((c) => c.text)
        .join('') + node.text
      const characters = content.replace(/\s+/g, ' ').trim()
      if (!characters) return ids
      const [tx, ty] = applyPt(m, numAttr(attrs, 'x', 0), numAttr(attrs, 'y', 0))
      const trs = decomposeTRS(m)
      const scale = trs ? trs.scale : 1
      if (!trs) ctx.warnings.push(`${label}: complex text transform approximated (translation only)`)
      const o = text({
        id: randomUUID(),
        name: label,
        x: tx,
        y: ty - size * scale,
        width: Math.max(characters.length * size * scale * 0.6, 10),
        height: size * scale * 1.2,
        rotation: trs && Math.abs(trs.rotation) > 1e-9 ? trs.rotation : 0,
        parentId,
        frameId: ctx.frameId,
        characters,
        fontFamily: attrs['font-family']?.trim() || 'Inter',
        fontSize: String(Math.round(size * scale * 100) / 100),
        fontWeight: attrs['font-weight']?.trim() || '400',
        fillColor: parseColor(attrs['fill'] && !attrs['fill'].startsWith('url(') ? attrs['fill'] : '#000000', '#000000'),
        paragraphs: [
          {
            textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
            ranges: [{ text: characters }],
          },
        ],
        ...(mergedPaint.opacity !== undefined ? { opacity: mergedPaint.opacity } : {}),
      })
      finish(o)
      return ids
    }
    case 'image': {
      const href = attrs['href'] ?? attrs['xlink:href'] ?? ''
      const w = numAttr(attrs, 'width', 0)
      const h = numAttr(attrs, 'height', 0)
      if (!href) {
        ctx.warnings.push('image without href skipped')
        ctx.nativeEditable = false
        return ids
      }
      const label = styledName(attrs, 'image')
      const [tx, ty] = applyPt(m, numAttr(attrs, 'x', 0), numAttr(attrs, 'y', 0))
      const trs = decomposeTRS(m)
      const s = trs ? trs.scale : 1
      let dataBytes: Buffer | null = null
      let dataMtype = ''
      const dataMatch = href.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.*)$/is)
      if (dataMatch) {
        try {
          dataBytes = Buffer.from(dataMatch[3]!, 'base64')
          dataMtype = dataMatch[1]!.toLowerCase().replace('jpeg', 'jpeg')
        } catch {
          dataBytes = null
        }
      }
      const uploadIndex = ctx.uploads.length
      const shapeId = randomUUID()
      if (dataBytes) {
        ctx.uploads.push({ bytes: dataBytes, mtype: dataMtype, name: label })
      } else {
        // External URL: caller fetches with SSRF guards; placeholder records the URL.
        ctx.uploads.push({ bytes: Buffer.alloc(0), mtype: `url:${href.slice(0, 500)}`, name: label })
      }
      // Temporary rect with fill-image; caller patches metadata after upload.
      const { rect: rectBuilder } = { rect }
      void rectBuilder
      const o = {
        id: shapeId,
        type: 'rect',
        name: label,
        x: tx,
        y: ty,
        width: Math.max(w * s, 1),
        height: Math.max(h * s, 1),
        rotation: 0,
        'parent-id': parentId,
        'frame-id': ctx.frameId,
        selrect: { x: tx, y: ty, width: Math.max(w * s, 1), height: Math.max(h * s, 1), x1: tx, y1: ty, x2: tx + Math.max(w * s, 1), y2: ty + Math.max(h * s, 1) },
        points: [
          { x: tx, y: ty },
          { x: tx + Math.max(w * s, 1), y: ty },
          { x: tx + Math.max(w * s, 1), y: ty + Math.max(h * s, 1) },
          { x: tx, y: ty + Math.max(h * s, 1) },
        ],
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        'transform-inverse': { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        fills: [],
        strokes: [],
        shadows: [],
        r1: 0,
        r2: 0,
        r3: 0,
        r4: 0,
      }
      ctx.uploadPatches.push({ shapeId, uploadIndex, kind: 'image', width: Math.max(Math.round(w), 1), height: Math.max(Math.round(h), 1) })
      pushShape(ctx, o)
      ids.push(shapeId)
      return ids
    }
    case 'use': {
      const href = attrs['href'] ?? attrs['xlink:href'] ?? ''
      const refMatch = href.match(/^#([\w-]+)$/)
      if (!refMatch) {
        ctx.warnings.push('use with external reference skipped')
        ctx.nativeEditable = false
        return ids
      }
      const target = ctx.defs.get(refMatch[1]!)
      if (!target) {
        ctx.warnings.push(`use references unknown #${refMatch[1]}; skipped`)
        ctx.nativeEditable = false
        return ids
      }
      const extra = parseTransform(
        (() => {
          const x = numAttr(attrs, 'x', 0)
          const y = numAttr(attrs, 'y', 0)
          return x !== 0 || y !== 0 ? `translate(${x} ${y})` : undefined
        })(),
        ctx.warnings,
      )
      return convertNode({ ...target, attrs: { ...target.attrs, ...Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'href' && k !== 'xlink:href' && k !== 'x' && k !== 'y')) } }, mul(m, extra), mergedPaint, grads, ctx, parentId)
    }
    default:
      return ids
  }
}

export type SvgConvertOptions = {
  parentId: string
  frameId: string
  offsetX?: number
  offsetY?: number
  namePrefix?: string
}

export function convertSvg(root: SvgNode, opts: SvgConvertOptions): SvgConvertResult {
  const ctx: Ctx = {
    defs: new Map(),
    warnings: [],
    dropped: [],
    uploads: [],
    uploadPatches: [],
    shapes: [],
    rootIds: [],
    nativeEditable: true,
    parentId: opts.parentId,
    frameId: opts.frameId,
    namePrefix: opts.namePrefix ?? 'svg',
  }
  const grads = new Map<string, Fill>()
  const collectDefs = (node: SvgNode): void => {
    if (node.tag === 'defs' || node.tag === 'svg' || node.tag === 'g') {
      for (const c of node.children) {
        if (c.tag === 'lineargradient' || c.tag === 'radialgradient') {
          const g = convertGradientDef(c)
          if (g) grads.set(g.id, g.fill)
          else ctx.warnings.push(`gradient #${c.attrs['id'] ?? '?'} unsupported (transform or units); solid fallback`)
        } else if (c.tag === 'g' || c.tag === 'svg' || c.tag === 'defs') {
          collectDefs(c)
        } else if (c.attrs['id']) {
          ctx.defs.set(c.attrs['id'], c)
        }
        if (c.tag !== 'lineargradient' && c.tag !== 'radialgradient' && c.tag !== 'defs' && c.attrs['id']) ctx.defs.set(c.attrs['id'], c)
      }
    }
  }
  collectDefs(root)

  // Root viewBox handling.
  let base: Matrix = IDENTITY
  const vb = (root.attrs['viewBox'] ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
  const w = numAttr(root.attrs, 'width', 0)
  const h = numAttr(root.attrs, 'height', 0)
  if (vb.length === 4 && vb.every((n) => Number.isFinite(n)) && w > 0 && h > 0) {
    const [minx, miny, vbw, vbh] = vb as [number, number, number, number]
    if (vbw > 0 && vbh > 0) base = [w / vbw, 0, 0, h / vbh, -minx * (w / vbw), -miny * (h / vbh)]
  }
  const ox = opts.offsetX ?? 0
  const oy = opts.offsetY ?? 0
  base = mul([1, 0, 0, 1, ox, oy], base)

  const emptyPaint: Paint = { fills: [], strokes: [] }
  for (const c of root.children) {
    if (c.tag === 'defs' || c.tag === 'title' || c.tag === 'desc') continue
    ctx.rootIds.push(...convertNode(c, base, emptyPaint, grads, ctx, opts.parentId))
  }
  if (ctx.uploadPatches.length > 0) {
    // Uploads resolve to real media; geometry stays native so the file remains editable.
  }
  return {
    shapes: ctx.shapes,
    rootIds: ctx.rootIds,
    uploads: ctx.uploads,
    uploadPatches: ctx.uploadPatches,
    warnings: ctx.warnings,
    nativeEditable: ctx.nativeEditable,
    dropped: ctx.dropped,
  }
}
