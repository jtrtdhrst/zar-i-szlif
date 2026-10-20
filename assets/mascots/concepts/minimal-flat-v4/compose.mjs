#!/usr/bin/env node
// compose.mjs — deterministic affine placement of mascot SVGs.
//
// Rewrites every path `d` with an affine transform (scale + translate, optional
// mirror) and writes a new standalone SVG. Used to re-centre direction art into
// the master frame and to compose the paired interaction vignette.
//
// Usage: node compose.mjs <out.svg> <viewBox> <layer> [<layer> ...]
//   layer = <src.svg>[@<id1>,<id2>]:<tx>,<ty>,<scale>[:flip]   (@ids are dropped)
import { readFileSync, writeFileSync } from 'node:fs';

const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
const isNum = (t) => t !== undefined && /^[+-]?(\d|\.\d)/.test(t);

function transformD(d, m) {
  const { s, tx, ty, flip } = m;
  const out = [];
  const toks = d.match(/[A-Za-z]|[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g) || [];
  let i = 0;
  let cmd = null;
  const xf = (x, y) => {
    const sx = flip ? -x : x;
    return [sx * s + tx, y * s + ty];
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

function layer(spec) {
  const [fileAndDrops, place, flip] = spec.split(':');
  const [file, drops] = fileAndDrops.split('@');
  const [tx, ty, scale] = place.split(',').map(Number);
  if (!Number.isFinite(scale)) throw new Error(`bad layer spec: ${spec}`);
  const m = { s: scale, tx, ty, flip: flip === 'flip' };
  const drop = new Set((drops || '').split(',').filter(Boolean));
  const svg = readFileSync(file, 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return body
    .replace(/<path id="([^"]+)"[^>]*d="([^"]+)"/g, (full, id, d) => (drop.has(id) ? '' : full))
    .replace(/(?<![\w-])d="([^"]+)"/g, (_, d) => `d="${transformD(d, m)}"`);
}

const argv = process.argv.slice(2);
const titleArg = argv.find((a) => a.startsWith('--title='));
if (titleArg) argv.splice(argv.indexOf(titleArg), 1);
const TITLE = titleArg ? titleArg.slice(8) : 'Iskra and Szlif — paired interaction vignette';
const [outFile, viewBox, ...layers] = argv;
if (!outFile || !viewBox || !layers.length) {
  console.error('usage: node compose.mjs <out.svg> <viewBox> <src>:<tx>,<ty>,<scale>[:flip] ...');
  process.exit(1);
}
const body = layers.map(layer).join('\n');
writeFileSync(
  outFile,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${viewBox.split(' ')[2]}" height="${viewBox.split(' ')[3]}" role="img" aria-labelledby="title desc">\n`
  + `  <title id="title">${TITLE}</title>\n`
  + '  <desc id="desc">Iskra the fox proposes, Szlif the raven evaluates with a plan notebook. Composed from the master pair with deterministic transforms.</desc>\n'
  + body
  + '\n</svg>\n',
);
console.log(`composed ${outFile} from ${layers.length} layer(s)`);
