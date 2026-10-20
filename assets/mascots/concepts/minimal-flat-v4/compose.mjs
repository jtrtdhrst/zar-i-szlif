#!/usr/bin/env node
// compose.mjs — deterministic affine placement of mascot SVGs.
//
// Rewrites every path `d` with an affine transform (scale + translate, optional
// mirror) and writes a new standalone SVG. Used to re-centre direction art into
// the master frame and to compose the paired interaction vignette.
//
// Usage: node compose.mjs <out.svg> <viewBox> <layer> [<layer> ...]
//   layer = <src.svg>[@<id1>,<id2>]:<tx>,<ty>,<scale>[,<deg>[,<px>,<py>]]   (@ids are dropped)
//   deg rotates the placed layer about the scene-space pivot (px,py); default 0, pivot 0,0
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
const isNum = (t) => t !== undefined && /^[+-]?(\d|\.\d)/.test(t);

function transformD(d, m) {
  const { s, tx, ty, flip, deg, px, py } = m;
  const out = [];
  const toks = d.match(/[A-Za-z]|[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g) || [];
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let i = 0;
  let cmd = null;
  const xf = (x, y) => {
    const sx = flip ? -x : x;
    const dx = sx * s + tx - px;
    const dy = y * s + ty - py;
    return [px + dx * cos - dy * sin, py + dx * sin + dy * cos];
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) { cmd = toks[i]; out.push(cmd); i++; continue; }
    const n = ARITY[cmd];
    if (!n) throw new Error(`unsupported path command "${cmd}"`);
    const args = toks.slice(i, i + n).map(Number);
    i += n;
    if (cmd === 'A') {
      const [rx, ry, rot, , , x, y] = args;
      const [nx, ny] = xf(x, y);
      out.push(String(rx * s), String(ry * s), String(rot), args[3], args[4], String(nx), String(ny));
    } else if (cmd === 'H') {
      const [nx] = xf(args[0], 0);
      out.push(String(nx));
    } else if (cmd === 'V') {
      const [, ny] = xf(0, args[0]);
      out.push(String(ny));
    } else {
      const nums = [];
      for (let k = 0; k < args.length; k += 2) {
        const [nx, ny] = xf(args[k], args[k + 1]);
        nums.push(String(nx), String(ny));
      }
      out.push(...nums);
    }
  }
  return out.join(' ');
}

// control-point bounding box of a path `d` (an over-estimate of the true box,
// which is fine for cropping: bezier control points bound their curve)
export function pathBBox(d) {
  const toks = d.match(/[A-Za-z]|[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g) || [];
  let i = 0;
  let cmd = null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const put = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) { cmd = toks[i]; i++; continue; }
    const n = ARITY[cmd];
    if (!n) throw new Error(`unsupported path command "${cmd}"`);
    const args = toks.slice(i, i + n).map(Number);
    i += n;
    if (cmd === 'H') put(args[0], 0);
    else if (cmd === 'V') put(0, args[0]);
    else if (cmd === 'A') put(args[5], args[6]);
    else for (let k = 0; k + 1 < args.length; k += 2) put(args[k], args[k + 1]);
  }
  return { minX, minY, maxX, maxY };
}

function layer(spec) {
  const [fileAndFilter, place] = spec.split(':');
  const [file, filter] = fileAndFilter.split('@');
  const f = place.split(',').map(Number);
  const [tx, ty, scale, deg = 0, px = 0, py = 0] = f;
  if (!Number.isFinite(scale)) throw new Error(`bad layer spec: ${spec}`);
  const m = { s: scale, tx, ty, flip: false, deg, px, py };
  // @drop=a,b removes those ids; @only=a,b keeps just those ids
  let drop = new Set();
  let only = null;
  if (filter) {
    const [mode, list] = filter.includes('=') ? filter.split('=') : ['drop', filter];
    const ids = list.split(',').filter(Boolean);
    if (mode === 'only') only = new Set(ids);
    else drop = new Set(ids);
  }
  const svg = readFileSync(file, 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return body
    .replace(/<path id="([^"]+)"[^>]*d="([^"]+)"/g, (full, id, d) => {
      if (drop.has(id)) return '';
      if (only && !only.has(id)) return '';
      return full;
    })
    .replace(/(?<![\w-])d="([^"]+)"/g, (_, d) => `d="${transformD(d, m)}"`);
}

// compose layers into a standalone SVG; `fit` crops the viewBox to the placed geometry
export function compose(layers, { viewBox = '0 0 512 512', title, desc, fit = 0 } = {}) {
  const body = layers.map(layer).join('\n');
  let vb = viewBox;
  if (fit) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of body.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) {
      const b = pathBBox(m[1]);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) throw new Error('nothing to fit');
    const pad = fit;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    vb = `${Math.round(minX * 100) / 100} ${Math.round(minY * 100) / 100} ${Math.round((maxX - minX) * 100) / 100} ${Math.round((maxY - minY) * 100) / 100}`;
  }
  const [, , w, h] = vb.split(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-labelledby="title desc">\n`
    + `  <title id="title">${title}</title>\n`
    + `  <desc id="desc">${desc}</desc>\n`
    + body
    + '\n</svg>\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const titleArg = argv.find((a) => a.startsWith('--title='));
  if (titleArg) argv.splice(argv.indexOf(titleArg), 1);
  const descArg = argv.find((a) => a.startsWith('--desc='));
  if (descArg) argv.splice(argv.indexOf(descArg), 1);
  const fitArg = argv.find((a) => a.startsWith('--fit='));
  if (fitArg) argv.splice(argv.indexOf(fitArg), 1);
  const TITLE = titleArg ? titleArg.slice(8) : 'Iskra and Szlif — paired interaction vignette';
  const DESC = descArg ? descArg.slice(7) : 'Iskra the fox proposes, Szlif the raven evaluates with a plan notebook. Composed from the master pair with deterministic transforms.';
  const FIT = fitArg ? Number(fitArg.slice(7)) : 0;
  const [outFile, viewBox, ...layers] = argv;
  if (!outFile || !viewBox || !layers.length) {
    console.error('usage: node compose.mjs <out.svg> <viewBox> [--fit=N] [--title=..] <src>[@only=a,b]:<tx>,<ty>,<scale>[,<deg>[,<px>,<py>]] ...');
    process.exit(1);
  }
  writeFileSync(outFile, compose(layers, { viewBox, title: TITLE, desc: DESC, fit: FIT }));
  console.log(`composed ${outFile} from ${layers.length} layer(s)${FIT ? ` fit=${FIT}` : ''}`);
}
