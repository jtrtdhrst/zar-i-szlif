// Deterministic mascot renderer: SVG sources -> PNG exports + labeled contact sheets.
// Run: NODE_PATH=<deps>/node_modules node assets/mascots/concepts/minimal-flat-v4/render.mjs
// Deps: @resvg/resvg-js (rasteriser), pngjs (compositor). No system fonts needed (3x5 bitmap labels).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'exports');
mkdirSync(outDir, { recursive: true });

const SIZES = [512, 256, 128, 64, 32];
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- 3x5 bitmap font (hex nibbles per row, bit2 = left pixel) -------------------
const GLYPHS = {
  A: '75755', B: '65656', C: '74447', D: '65556', E: '74647', F: '74644', G: '74557',
  H: '55755', I: '72227', J: '11157', K: '55655', L: '44447', M: '57755', N: '57755',
  O: '75557', P: '65644', Q: '75563', R: '65655', S: '74717', T: '72222', U: '55557',
  V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247',
  0: '75557', 1: '26227', 2: '71747', 3: '71717', 4: '55711', 5: '74717',
  6: '74757', 7: '71122', 8: '75757', 9: '75717',
  '-': '00700', '.': '00002', ' ': '00000', '/': '11244',
};

function textWidth(text, s) { return text.length * 4 * s - s; }

function drawText(img, x, y, text, s, rgb = [40, 44, 52]) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g && g !== '00000') {
      for (let r = 0; r < 5; r++) {
        const bits = parseInt(g[r], 16);
        for (let c = 0; c < 3; c++) {
          if (bits & (4 >> c)) {
            for (let dy = 0; dy < s; dy++) {
              for (let dx = 0; dx < s; dx++) {
                const px = cx + c * s + dx, py = y + r * s + dy;
                if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
                const i = (py * img.width + px) * 4;
                img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
              }
            }
          }
        }
      }
    }
    cx += 4 * s;
  }
}

// ---- source handling ------------------------------------------------------------
function listSources() {
  const dirs = ['directions', 'masters', 'scenes'];
  const out = [];
  for (const d of dirs) {
    const p = path.join(here, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).filter((f) => f.endsWith('.svg')).sort()) {
      out.push({ id: f.replace(/\.svg$/, ''), group: d, file: path.join(p, f) });
    }
  }
  return out;
}

const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const titleOf = (svg) => (svg.match(/<title[^>]*>([^<]*)</) || [, ''])[1].trim();
const viewBoxOf = (svg) => (svg.match(/viewBox="([^"]*)"/) || [, '0 0 512 512'])[1];

function toBlack(svg) {
  return svg.replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="#000000"');
}

function backgroundWrap(svg, kind) {
  const body = inner(svg);
  const vb = viewBoxOf(svg);
  const [vx, vy, vw, vh] = vb.split(' ').map(Number);
  const w = vw || 512;
  const h = vh || 512;
  if (kind === 'white') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"><rect x="${vx}" y="${vy}" width="${w}" height="${h}" fill="#FFFFFF"/>${body}</svg>`;
  if (kind === 'dark') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"><rect x="${vx}" y="${vy}" width="${w}" height="${h}" fill="#16202E"/>${body}</svg>`;
  // camp scene: dusk sky, forest line, ground, warm fire glow
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">`
    + `<rect x="${vx}" y="${vy}" width="${w}" height="${h}" fill="#22405C"/>`
    + `<circle cx="${vx + w * 0.715}" cy="${vy + h * 0.293}" r="${h * 0.09}" fill="#F2C97C"/>`
    + `<path d="M${vx},${vy + h * 0.69} L${vx + w * 0.125},${vy + h * 0.46} L${vx + w * 0.234},${vy + h * 0.69} Z" fill="#16321F"/>`
    + `<path d="M${vx + w * 0.188},${vy + h * 0.69} L${vx + w * 0.344},${vy + h * 0.41} L${vx + w * 0.484},${vy + h * 0.69} Z" fill="#12291A"/>`
    + `<path d="M${vx + w * 0.586},${vy + h * 0.69} L${vx + w * 0.719},${vy + h * 0.48} L${vx + w * 0.844},${vy + h * 0.69} Z" fill="#16321F"/>`
    + `<rect x="${vx}" y="${vy + h * 0.69}" width="${w}" height="${h * 0.31}" fill="#1E3D28"/>`
    + `<circle cx="${vx + w * 0.5}" cy="${vy + h * 0.84}" r="${h * 0.11}" opacity="0.55" fill="#C8742C"/>`
    + `${body}</svg>`;
}

function rasterise(svgText, width) {
  const r = new Resvg(svgText, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: false },
  });
  const img = r.render();
  return { width: img.width, height: img.height, data: Buffer.from(img.pixels) };
}

// minimal 8-bit RGBA PNG encoder (filter 0, zlib deflate)
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function savePng(file, raw) { writeFileSync(file, encodePng(raw.width, raw.height, raw.data)); return encodePng(raw.width, raw.height, raw.data); }
function readPng(buf) { return buf; }

function blit(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const si = (sy * src.width + sx) * 4;
      const alpha = src.data[si + 3] / 255;
      if (alpha === 0) continue;
      const dx = x + sx, dy = y + sy;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const di = (dy * dst.width + dx) * 4;
      const a = alpha + (dst.data[di + 3] / 255) * (1 - alpha);
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round((src.data[si + c] * alpha + dst.data[di + c] * (dst.data[di + 3] / 255) * (1 - alpha)) / (a || 1));
      dst.data[di + 3] = Math.round(a * 255);
    }
  }
}

function newCanvas(w, h, bg = [255, 255, 255]) {
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = bg[0]; img.data[i + 1] = bg[1]; img.data[i + 2] = bg[2]; img.data[i + 3] = 255;
  }
  return img;
}

// ---- render ---------------------------------------------------------------------
const sources = listSources();
const manifest = { generatedBy: 'render.mjs', resvg: '2.6.2', sizes: SIZES, sources: [], sheets: [] };

// resolve the SVG actually used for one source at one size
function planFor(source, size) {
  const raw = readFileSync(source.file);
  return { svg: raw.toString('utf8'), file: path.relative(here, source.file), sha256: sha(raw), view: 'full' };
}

for (const s of sources) {
  const raw = readFileSync(s.file);
  const svg = raw.toString('utf8');
  const rec = {
    id: s.id, group: s.group, file: path.relative(here, s.file), title: titleOf(svg),
    sourceSha256: sha(raw),
    shapes: (svg.match(/<path/g) || []).length,
    colors: [...new Set((svg.match(/fill="#[0-9a-fA-F]{6}"/g) || []).map((c) => c.slice(6, -1)))].sort(),
    optical: [],
    outputs: [],
  };
  const out = {};
  for (const w of SIZES) {
    const plan = planFor(s, w);
    const r = rasterise(plan.svg, w);
    const f = path.join(outDir, `${s.id}-${w}.png`);
    const buf = savePng(f, r);
    out[w] = r;
    rec.outputs.push({ file: path.relative(here, f), size: w, sha256: sha(buf), sourceFile: plan.file, sourceSha256: plan.sha256, view: plan.view });
    if (plan.optical && !rec.optical.find((o) => o.id === plan.optical.id)) {
      rec.optical.push({
        id: plan.optical.id,
        file: plan.file,
        sha256: plan.sha256,
        sizes: plan.optical.sizes,
        derivedFrom: plan.optical.derivedFrom.map((f) => ({ file: f, sha256: sha(readFileSync(path.join(here, f))) })),
        recipe: plan.optical.layers,
      });
    }
  }
  for (const w of [64, 32]) {
    const plan = planFor(s, w);
    const r = rasterise(toBlack(plan.svg), w);
    const f = path.join(outDir, `${s.id}-sil-${w}.png`);
    const buf = savePng(f, r);
    out[`sil${w}`] = r;
    rec.outputs.push({ file: path.relative(here, f), size: w, silhouette: true, sha256: sha(buf), sourceFile: plan.file, sourceSha256: plan.sha256, view: plan.view });
  }
  for (const bg of ['white', 'dark', 'camp']) {
    for (const w of [128, 64]) {
      const plan = planFor(s, w);
      const r = rasterise(backgroundWrap(plan.svg, bg), w);
      const f = path.join(outDir, `${s.id}-${bg}-${w}.png`);
      const buf = savePng(f, r);
      out[`${bg}${w}`] = r;
      rec.outputs.push({ file: path.relative(here, f), size: w, background: bg, sha256: sha(buf), sourceFile: plan.file, sourceSha256: plan.sha256, view: plan.view });
    }
  }
  manifest.sources.push(rec);
  s.rasters = out;
}

// ---- contact sheets --------------------------------------------------------------
// Each column is sized to its own widest cell: a small sprite must not be padded
// out to the width of a 512 px column (the old "massive whitespace" problem).
function sheet(name, rows, cols, title) {
  const pad = 12, labelH = 16, headH = 26;
  const nCols = rows[0] ? rows[0].cells.length : 0;
  const colW = cols.map((_, ci) => Math.max(...rows.map((r) => (r.cells[ci] ? r.cells[ci].buf.width : 0))));
  const rowH = rows.map((r) => Math.max(...r.cells.map((c) => c.buf.height), 0));
  const w = pad + colW.reduce((a, b) => a + b + pad, 0);
  const h = headH + pad + rows.reduce((a, r, ri) => a + rowH[ri] + labelH + pad, 0);
  const canvas = newCanvas(w, h);
  drawText(canvas, pad, 8, title, 2, [20, 24, 32]);
  let y = headH + pad;
  rows.forEach((r, ri) => {
    drawText(canvas, pad, y, r.label, 2, [20, 24, 32]);
    y += labelH;
    let x = pad;
    r.cells.forEach((c, ci) => {
      const img = c.buf;
      blit(canvas, img, x, y + (rowH[ri] - img.height));
      x += colW[ci] + pad;
    });
    y += rowH[ri] + pad;
  });
  const buf = encodePng(canvas.width, canvas.height, canvas.data);
  const f = path.join(outDir, name);
  writeFileSync(f, buf);
  manifest.sheets.push({ file: path.relative(here, f), sha256: sha(buf), width: w, height: h, title });
  return f;
}

// nearest-neighbour zoom: every source pixel becomes an f x f block, so a 32 px
// sprite can be inspected without any resampling blur.
function zoomNearest(src, f) {
  const out = { width: src.width * f, height: src.height * f, data: Buffer.alloc(src.width * f * src.height * f * 4) };
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const di = ((y * f + dy) * out.width + (x * f + dx)) * 4;
          out.data[di] = src.data[si];
          out.data[di + 1] = src.data[si + 1];
          out.data[di + 2] = src.data[si + 2];
          out.data[di + 3] = src.data[si + 3];
        }
      }
    }
  }
  return out;
}

const directions = sources.filter((s) => s.group === 'directions');
if (directions.length) {
  sheet('sheet-directions.png',
    directions.map((s) => ({ label: s.id.replace('-', ' ').toUpperCase(), cells: [
      { buf: s.rasters[512] }, { buf: s.rasters[128] }, { buf: s.rasters[64] }, { buf: s.rasters[32] },
      { buf: s.rasters.sil64 }, { buf: s.rasters.sil32 }] })),
    [0, 1, 2, 3, 4, 5], 'DIRECTIONS 512 128 64 32 SIL64 SIL32');

  sheet('sheet-backgrounds.png',
    directions.map((s) => ({ label: s.id.replace('-', ' ').toUpperCase(), cells: [
      { buf: s.rasters.white128 }, { buf: s.rasters.dark128 }, { buf: s.rasters.camp128 }, { buf: s.rasters.camp64 }] })),
    [0, 1, 2, 3], 'BACKGROUNDS WHITE DARK CAMP128 CAMP64');
}

const pair = sources.filter((s) => s.group === 'masters' || s.group === 'scenes');
if (pair.length) {
  sheet('sheet-pair.png',
    pair.map((s) => ({ label: s.id.replace('-', ' ').toUpperCase(), cells: [
      { buf: s.rasters[512] }, { buf: s.rasters[128] }, { buf: s.rasters[64] }, { buf: s.rasters[32] },
      { buf: s.rasters.sil64 }, { buf: s.rasters.camp128 }] })),
    [0, 1, 2, 3, 4, 5], 'MASTERS AND SCENE 512 128 64 32 SIL64 CAMP');
}

// proof sheet: the exact small sprites next to their nearest-neighbour zooms.
// The zoom is an inspection aid only; it is never presented as the result.
if (pair.length) {
  sheet('sheet-proof.png',
    pair.map((s) => ({ label: `${s.id.replace('-', ' ').toUpperCase()} - OPTICAL SIZE PROOF`, cells: [
      { buf: s.rasters[32] }, { buf: zoomNearest(s.rasters[32], 8) },
      { buf: s.rasters[64] }, { buf: zoomNearest(s.rasters[64], 4) },
    ] })),
    [0, 1, 2, 3],
    '32PX ACTUAL - 32PX 8X ZOOM - 64PX ACTUAL - 64PX 4X ZOOM - ZOOM IS NOT ACTUAL SIZE');
}


// ---- comparison against the rejected V4 baseline (negative reference) -------
// The owner rejected V4 (SHA 2a092734) on its real appearance. The reviewer has
// to see the old candidate and the new one at equal dimensions, not a claim.
const v4Dir = path.join(here, '..', 'minimal-flat-v4', 'exports');
function readPngFile(f) {
  const p = PNG.sync.read(readFileSync(f));
  return { width: p.width, height: p.height, data: Buffer.from(p.data) };
}
function v4Raster(id, suffix) {
  const f = path.join(v4Dir, `${id}-${suffix}.png`);
  return existsSync(f) ? readPngFile(f) : null;
}
const byId = (id) => sources.find((x) => x.id === id);
const cmpRows = [];
for (const [label, id] of [
  ['V4 REJECTED ISKRA', 'iskra-master'],
  ['V5 ISKRA', 'iskra-master'],
  ['V4 REJECTED SZLIF', 'szlif-master'],
  ['V5 SZLIF', 'szlif-master'],
  ['V4 REJECTED PAIR', 'iskra-szlif-vignette'],
  ['V5 PAIR', 'iskra-szlif-vignette'],
]) {
  const isV5 = label.startsWith('V5');
  const src = byId(id);
  const cells = isV5
    ? [src.rasters[512], src.rasters[128], src.rasters[64], src.rasters[32], src.rasters.sil64]
    : ['512', '128', '64', '32', 'sil-64'].map((sfx) => v4Raster(id, sfx)).filter(Boolean);
  cmpRows.push({ label, cells: cells.filter(Boolean).map((buf) => ({ buf })) });
}
sheet('sheet-compare-v4.png', cmpRows, [0, 1, 2, 3, 4],
  'V4 REJECTED BASELINE VS V5 - EQUAL DIMENSIONS 512 128 64 32 SIL64');

// ---- real UI context panels (phone + desktop, light / dark / camp) ---------
const sceneSrc = sources.find((x) => x.group === 'scenes');
const sceneInner = sceneSrc ? inner(readFileSync(sceneSrc.file, 'utf8')) : '';
function panelSvg(w, h, bg, extra, sceneTx, sceneTy, sceneScale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + `<rect width="${w}" height="${h}" fill="${bg}"/>${extra}`
    + `<g transform="translate(${sceneTx},${sceneTy}) scale(${sceneScale})">${sceneInner}</g></svg>`;
}
const contexts = [];
if (sceneInner) {
  // phone, light app surface
  contexts.push({ label: 'PHONE 375 LIGHT', buf: rasterise(panelSvg(375, 640, '#F2F4F7',
    '<rect x="20" y="28" width="120" height="14" rx="7" fill="#C9D2DE"/><rect x="20" y="120" width="335" height="360" rx="24" fill="#FFFFFF"/>'
    + '<rect x="20" y="520" width="335" height="60" rx="18" fill="#2BB8A6"/>', 20, 150, 0.62), 375) });
  // phone, dark app surface
  contexts.push({ label: 'PHONE 375 DARK', buf: rasterise(panelSvg(375, 640, '#16202E',
    '<rect x="20" y="28" width="120" height="14" rx="7" fill="#3C4757"/><rect x="20" y="120" width="335" height="360" rx="24" fill="#1E2A3A"/>'
    + '<rect x="20" y="520" width="335" height="60" rx="18" fill="#2BB8A6"/>', 20, 150, 0.62), 375) });
  // desktop, light
  contexts.push({ label: 'DESKTOP LIGHT', buf: rasterise(panelSvg(900, 420, '#FFFFFF',
    '<rect x="0" y="0" width="900" height="64" fill="#F2F4F7"/><rect x="40" y="96" width="330" height="270" rx="20" fill="#F2F4F7"/>'
    + '<rect x="420" y="96" width="180" height="18" rx="9" fill="#2B2A33"/><rect x="420" y="130" width="300" height="12" rx="6" fill="#C9D2DE"/>'
    + '<rect x="420" y="156" width="260" height="12" rx="6" fill="#C9D2DE"/><rect x="420" y="196" width="150" height="44" rx="14" fill="#2BB8A6"/>',
    30, 84, 0.52), 900) });
  // desktop, camp scene
  contexts.push({ label: 'DESKTOP CAMP', buf: rasterise(panelSvg(900, 420, '#22405C',
    '<path d="M0,300 L120,140 L240,300 Z" fill="#16321F"/><path d="M180,300 L300,120 L420,300 Z" fill="#12291A"/>'
    + '<rect y="300" width="900" height="120" fill="#1E3D28"/><circle cx="780" cy="90" r="42" fill="#F2C97C"/>'
    + '<rect x="420" y="120" width="200" height="16" rx="8" fill="#F7E8D3"/><rect x="420" y="152" width="280" height="12" rx="6" fill="#4C6A88"/>',
    30, 60, 0.52), 900) });
  sheet('sheet-context.png', contexts.map((c) => ({ label: c.label, cells: [{ buf: c.buf }] })), [0],
    'REAL UI CONTEXT 375 PHONE LIGHT / DARK - DESKTOP LIGHT / CAMP');
}

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`rendered ${sources.length} sources -> ${outDir}`);
console.log(manifest.sheets.map((s) => `${s.file} ${s.width}x${s.height}`).join('\n'));
