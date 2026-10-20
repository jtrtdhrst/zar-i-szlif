// Deterministic mascot renderer: SVG sources -> PNG exports + labeled contact sheets.
// Run: NODE_PATH=<deps>/node_modules node assets/mascots/concepts/minimal-flat-v4/render.mjs
// Deps: @resvg/resvg-js (rasteriser), pngjs (compositor). No system fonts needed (3x5 bitmap labels).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'exports');
mkdirSync(outDir, { recursive: true });

const SIZES = [512, 128, 64, 32];
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

function toBlack(svg) {
  return svg.replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="#000000"');
}

function backgroundWrap(svg, kind) {
  const body = inner(svg);
  if (kind === 'white') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#FFFFFF"/>${body}</svg>`;
  if (kind === 'dark') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#16202E"/>${body}</svg>`;
  // camp scene: dusk sky, forest line, ground, warm fire glow
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
    + `<rect width="512" height="512" fill="#22405C"/>`
    + `<circle cx="366" cy="150" r="46" fill="#F2C97C"/>`
    + `<path d="M0,352 L64,236 L120,352 Z" fill="#16321F"/><path d="M96,352 L176,208 L248,352 Z" fill="#12291A"/>`
    + `<path d="M300,352 L368,244 L432,352 Z" fill="#16321F"/>`
    + `<rect y="352" width="512" height="160" fill="#1E3D28"/>`
    + `<circle cx="256" cy="430" r="56" fill="#C8742C" opacity="0.55"/>`
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

for (const s of sources) {
  const raw = readFileSync(s.file);
  const svg = raw.toString('utf8');
  const rec = {
    id: s.id, group: s.group, file: path.relative(here, s.file), title: titleOf(svg),
    sourceSha256: sha(raw),
    shapes: (svg.match(/<path/g) || []).length,
    colors: [...new Set((svg.match(/fill="#[0-9a-fA-F]{6}"/g) || []).map((c) => c.slice(6, -1)))].sort(),
    outputs: [],
  };
  const out = {};
  for (const w of SIZES) {
    const raw = rasterise(svg, w);
    const f = path.join(outDir, `${s.id}-${w}.png`);
    const buf = savePng(f, raw);
    out[w] = raw;
    rec.outputs.push({ file: path.relative(here, f), size: w, sha256: sha(buf) });
  }
  for (const w of [64, 32]) {
    const raw = rasterise(toBlack(svg), w);
    const f = path.join(outDir, `${s.id}-sil-${w}.png`);
    const buf = savePng(f, raw);
    out[`sil${w}`] = raw;
    rec.outputs.push({ file: path.relative(here, f), size: w, silhouette: true, sha256: sha(buf) });
  }
  for (const bg of ['white', 'dark', 'camp']) {
    for (const w of [128, 64]) {
      const raw = rasterise(backgroundWrap(svg, bg), w);
      const f = path.join(outDir, `${s.id}-${bg}-${w}.png`);
      const buf = savePng(f, raw);
      out[`${bg}${w}`] = raw;
      rec.outputs.push({ file: path.relative(here, f), size: w, background: bg, sha256: sha(buf) });
    }
  }
  manifest.sources.push(rec);
  s.rasters = out;
}

// ---- contact sheets --------------------------------------------------------------
function sheet(name, rows, cols, title) {
  const pad = 12, labelH = 16, headH = 26;
  const nCols = rows[0] ? rows[0].cells.length : 0;
  const cellW = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.buf.width)));
  const rowH = Math.max(...rows.map((r) => Math.max(...r.cells.map((c) => c.buf.height), 0)));
  const w = pad + nCols * (cellW + pad);
  const h = headH + pad + rows.length * (rowH + labelH + pad);
  const canvas = newCanvas(w, h);
  drawText(canvas, pad, 8, title, 2, [20, 24, 32]);
  rows.forEach((r, ri) => {
    let y = headH + pad + ri * (rowH + labelH + pad);
    drawText(canvas, pad, y, r.label, 2, [20, 24, 32]);
    y += labelH;
    r.cells.forEach((c, ci) => {
      const img = c.buf;
      blit(canvas, img, pad + ci * (cellW + pad), y + (rowH - img.height));
    });
  });
  const buf = encodePng(canvas.width, canvas.height, canvas.data);
  const f = path.join(outDir, name);
  writeFileSync(f, buf);
  manifest.sheets.push({ file: path.relative(here, f), sha256: sha(buf), width: w, height: h, title });
  return f;
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

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`rendered ${sources.length} sources -> ${outDir}`);
console.log(manifest.sheets.map((s) => `${s.file} ${s.width}x${s.height}`).join('\n'));
