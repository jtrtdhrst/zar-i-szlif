#!/usr/bin/env node
// verify.mjs — release gate for the mascot sprite set.
//
// Checks the rendered set the way a reviewer would: provenance, editability,
// transparency, clipping, connectedness and reproducibility. Every check that
// can be negative is written so that a broken input fails the run instead of
// producing a quietly wrong sprite.
//
// Run: NODE_PATH=<deps>/node_modules node assets/mascots/concepts/minimal-flat-v4/verify.mjs
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { pathBBox } from './compose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const failures = [];
const checks = [];
const ok = (name, detail = '') => checks.push(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
const bad = (name, detail) => { failures.push(`${name}: ${detail}`); checks.push(`FAIL ${name} — ${detail}`); };

const viewBoxOf = (svg) => (svg.match(/viewBox="([^"]*)"/) || [, '0 0 512 512'])[1];
const manifestPath = path.join(here, 'exports', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FAIL no exports/manifest.json — run "node render.mjs" first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// ---- 1. source provenance: every recorded SVG path + SHA must still hold ----
for (const rec of manifest.sources) {
  const src = path.join(here, rec.file);
  if (!existsSync(src)) { bad('source exists', rec.file); continue; }
  const cur = sha(readFileSync(src));
  if (cur !== rec.sourceSha256) { bad('source sha256', `${rec.file} changed since render`); continue; }
  ok('source sha256', rec.file);

  // no raster, no scripts, no filters/gradients: the source stays editable vector
  const svg = readFileSync(src, 'utf8');
  const raster = /<image\b|data:image\/|xlink:href\s*=\s*"(?!#)/i.test(svg);
  if (raster) bad('no raster in source', rec.file);
  else ok('no raster in source', rec.file);
  if (/<script\b|<foreignObject\b|<filter\b|<linearGradient\b|<radialGradient\b/i.test(svg)) {
    bad('source is plain editable vector', rec.file);
  } else ok('source is plain editable vector', rec.file);
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  const unnamed = paths.filter((p) => !/\sid="/.test(p));
  if (unnamed.length) bad('every shape is named', `${rec.file}: ${unnamed.length} unnamed path(s)`);
  else ok('every shape is named', `${rec.file}: ${paths.length} paths`);
  if (rec.group === 'masters') {
    const colors = [...new Set((svg.match(/fill="#[0-9a-fA-F]{6}"/gi)||[]).map(x=>x.slice(6,-1).toLowerCase()))];
    if (paths.length > 22) bad('master shape budget <=22', `${rec.file}: ${paths.length}`);
    else ok('master shape budget <=22', `${rec.file}: ${paths.length}`);
    if (colors.length > 5) bad('master palette <=5', `${rec.file}: ${colors.length}`);
    else ok('master palette <=5', `${rec.file}: ${colors.length}`);
  }

  // canonical art must not be cropped by its own viewBox (optical views are crops on purpose)
  if (rec.group !== 'optical') {
    const [vx, vy, vw, vh] = viewBoxOf(svg).split(' ').map(Number);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) {
      const b = pathBBox(m[1]);
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (Number.isFinite(minX) && (minX < vx - 0.5 || minY < vy - 0.5 || maxX > vx + vw + 0.5 || maxY > vy + vh + 0.5)) {
      bad('canonical art fits its viewBox', `${rec.file} content ${minX.toFixed(1)},${minY.toFixed(1)}-${maxX.toFixed(1)},${maxY.toFixed(1)} in viewBox ${vx},${vy},${vw},${vh}`);
    } else ok('canonical art fits its viewBox', rec.file);
  }

  // optical views must be listed with the master they were derived from
  for (const o of rec.optical || []) {
    const of = path.join(here, o.file);
    if (!existsSync(of)) { bad('optical view exists', o.file); continue; }
    if (sha(readFileSync(of)) !== o.sha256) { bad('optical view sha256', o.file); continue; }
    ok('optical view sha256', o.file);
    for (const d of o.derivedFrom) {
      const df = path.join(here, d.file);
      if (!existsSync(df)) { bad('optical master exists', d.file); continue; }
      if (sha(readFileSync(df)) !== d.sha256) bad('optical master sha256', d.file);
      else ok('optical master sha256', d.file);
    }
  }
}

// ---- 2. outputs: sha, transparency, clipping, connectedness -------------------
function analyse(pngPath) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const { width, height, data } = png;
  const ink = new Uint8Array(width * height);
  let opaque = 0;
  let transparent = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a === 0) { transparent++; continue; }
      if (a < 255) transparent++;
      ink[y * width + x] = 1;
      opaque++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // connected components over the ink (4-neighbour)
  const seen = new Uint8Array(width * height);
  const comps = [];
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let size = 0;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const n of nb) if (n >= 0 && ink[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
    comps.push(size);
  }
  comps.sort((a, b) => b - a);
  return { width, height, opaque, transparent, minX, minY, maxX, maxY, comps, inkTotal: opaque };
}

for (const rec of manifest.sources) {
  const isCharacter = rec.group === 'directions' || rec.group === 'masters';
  for (const o of rec.outputs) {
    const f = path.join(here, o.file);
    if (!existsSync(f)) { bad('export exists', o.file); continue; }
    if (sha(readFileSync(f)) !== o.sha256) { bad('export sha256', o.file); continue; }
    // provenance: the export must name the SVG it was actually rasterised from
    const srcFile = path.join(here, o.sourceFile);
    if (!existsSync(srcFile)) { bad('export source exists', `${o.file} -> ${o.sourceFile}`); continue; }
    if (sha(readFileSync(srcFile)) !== o.sourceSha256) { bad('export source sha256', `${o.file} -> ${o.sourceFile}`); continue; }
    const a = analyse(f);
    if (a.opaque === 0) { bad('export has content', o.file); continue; }
    // background proofs are deliberately opaque; sprites must keep transparency
    if (!o.background && a.transparent === 0) { bad('export keeps a transparent background', o.file); continue; }
    // a full figure must not be cut by the canvas edge. Below 128 px a one-pixel
    // margin is sub-pixel rounding, so the exact check lives on the source
    // geometry instead; optical views are crops on purpose and are exempt.
    if (o.view === 'full' && !o.background && o.size >= 128 &&
        (a.minX <= 0 || a.minY <= 0 || a.maxX >= a.width - 1 || a.maxY >= a.height - 1)) {
      bad('export is not clipped at the canvas edge', `${o.file} (ink bbox ${a.minX},${a.minY}-${a.maxX},${a.maxY} in ${a.width}x${a.height})`);
      continue;
    }
    const biggest = a.comps[0] || 0;
    const dust = a.comps.filter((c) => c > 1 && c / a.inkTotal < 0.002).length;
    if (dust > 0) { bad('export has no dust fragments', `${o.file} (${dust} fragment(s) under 0.2% of ink)`); continue; }
    if (isCharacter) {
      if (biggest / a.inkTotal < 0.9) { bad('export reads as one connected figure', `${o.file} (largest ${(biggest / a.inkTotal).toFixed(3)})`); continue; }
    } else if (a.comps.length > 3) {
      bad('export keeps the pair together', `${o.file} (${a.comps.length} components)`);
      continue;
    } else if (biggest / a.inkTotal < 0.5) {
      bad('export keeps the pair together', `${o.file} (largest ${(biggest / a.inkTotal).toFixed(3)})`);
      continue;
    }
    ok('export', `${o.file} ${a.width}x${a.height} from ${o.sourceFile} (${o.view})`);
  }
}

// ---- 3. sheets ---------------------------------------------------------------
for (const s of manifest.sheets) {
  const f = path.join(here, s.file);
  if (!existsSync(f)) { bad('sheet exists', s.file); continue; }
  if (sha(readFileSync(f)) !== s.sha256) { bad('sheet sha256', s.file); continue; }
  ok('sheet sha256', s.file);
}

// ---- 4. adversarial tests: truly isolated V5 + pinned V4 baseline -------
function runRenderIn(cwd) {
  return spawnSync(process.execPath, ['render.mjs'], { cwd, encoding: 'utf8' });
}
function makeTestWorkspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mascot-v5-verify-'));
  const dir = path.join(root, 'minimal-flat-v5');
  const baseline = path.join(here, '..', 'minimal-flat-v4', 'exports');
  if (!existsSync(baseline)) throw new Error('MISSING_V4_NEGATIVE_BASELINE: exports dir');
  cpSync(here, dir, { recursive: true, dereference: false });
  cpSync(baseline, path.join(root, 'minimal-flat-v4', 'exports'), { recursive: true });
  return { root, dir };
}
for (const [label, mutate, expected] of [
  ['missing required source', (dir) => rmSync(path.join(dir, 'directions', 'iskra-a.svg')), /REQUIRED_SOURCE_MISSING/],
  ['malformed SVG source', (dir) => writeFileSync(path.join(dir, 'directions', 'szlif-b.svg'), '<svg><path id="broken" d="bad-missing-end"'), /Error|failed|parse|svg/i],
  ['missing V4 baseline', (dir) => rmSync(path.join(dir, '..', 'minimal-flat-v4', 'exports', 'iskra-master-512.png')), /MISSING_V4_NEGATIVE_BASELINE/],
]) {
  const fixture = makeTestWorkspace();
  try {
    mutate(fixture.dir);
    const r = runRenderIn(fixture.dir);
    if (r.status === 0) bad('render rejects '+label, 'render exited 0');
    else if (!expected.test(r.stderr || '')) bad('render explains '+label, (r.stderr || '').split('\n')[0]);
    else ok('render rejects '+label);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

// ---- 5. reproducibility: a second render must be byte-identical ------------
{
  const fixture = makeTestWorkspace();
  try {
    const r = runRenderIn(fixture.dir);
    if (r.status !== 0) { bad('reproducible render', (r.stderr || '').split('\n')[0]); }
    else {
      const before = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const after = JSON.parse(readFileSync(path.join(fixture.dir, 'exports', 'manifest.json'), 'utf8'));
      const flat = (m) => [...m.sources.flatMap((s) => s.outputs.map((o) => `${o.file}:${o.sha256}`)), ...m.sheets.map((s) => `${s.file}:${s.sha256}`)].sort();
      if (JSON.stringify(flat(before)) !== JSON.stringify(flat(after))) bad('reproducible render', 'export shas differ between runs');
      else ok('reproducible render', `${flat(before).length} exports identical`);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

for (const c of checks) console.log(c);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('verify: OK');
