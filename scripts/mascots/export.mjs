// Mascot STYLE_2 deterministic SVG -> PNG export pipeline (KOMAA-1011).
// One CLI: validate inputs, render transparent PNGs, verify pixels,
// write manifest.json + contact-sheet.png. Exit 0 on PASS, 1 on any FAIL.
// Renderer: @resvg/resvg-js (prebuilt Rust resvg). PNG inspect/compose: pngjs.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)));
const { Resvg } = require("@resvg/resvg-js");
const { PNG } = require("pngjs");

export const SIZES = [512, 256, 128, 64, 32];
export const SHEET_SIZES = [256, 128, 64, 32];
// Free margin kept around the master on every side, as a fraction of the
// viewBox. Downscale rounding clips art that sits within a pixel of the edge
// (real case: szlif@32), so the pipeline renders inside a safe area instead.
export const SAFE_MARGIN = 0.04;
export const MAX_SVG_BYTES = 1024 * 1024;
export const MIN_OPAQUE_RATIO = 0.01;
export const ALPHA_THRESHOLD = 16;
const GAP = 16;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = join(here, "..", "..", "assets", "mascots", "style-2");

const fail = (errors, msg) => errors.push(msg);
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---- validation -----------------------------------------------------------
export function validateCharacterJson(raw) {
  const errors = [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { errors: ["character.json is not valid JSON"], data: null };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["character.json must be a JSON object"], data: null };
  }
  for (const key of ["id", "species", "role", "styleVersion"]) {
    if (data[key] !== undefined && (typeof data[key] !== "string" || !data[key].trim())) {
      fail(errors, `character.json ${key} must be a non-empty string`);
    }
  }
  for (const key of ["id", "species", "role", "styleVersion", "palette"]) {
    if (data[key] === undefined) fail(errors, `character.json missing required field: ${key}`);
  }
  if (data.role !== undefined && !["npc", "player"].includes(data.role)) {
    fail(errors, `character.json role must be npc|player, got: ${data.role}`);
  }
  if (data.palette !== undefined) {
    if (!Array.isArray(data.palette) || data.palette.length === 0) {
      fail(errors, "character.json palette must be a non-empty array of hex colors");
    } else if (!data.palette.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) {
      fail(errors, "character.json palette entries must be #rrggbb");
    }
    // Archived STYLE_2_V0 masters use 7/10 colors; keep existing art
    // reproducible and require five functional colors on NEW style versions.
    if (data.styleVersion !== "style-2-v0" && Array.isArray(data.palette) && data.palette.length > 5) {
      fail(errors, "character.json palette exceeds 5 functional colors");
    }
    if (Array.isArray(data.palette) &&
        new Set(data.palette.filter((c) => typeof c === "string").map((c) => c.toLowerCase())).size !== data.palette.length) {
      fail(errors, "character.json palette has duplicate colors");
    }
  }
  return { errors, data };
}

export function validateSvg(svg) {
  const errors = [];
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) fail(errors, "source.svg exceeds 1 MiB");
  if (!/<svg[\s>]/.test(svg)) fail(errors, "source.svg has no <svg> root");
  const viewBox = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!viewBox) fail(errors, "source.svg missing viewBox");
  else {
    const nums = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n)) || nums[2] <= 0 || nums[3] <= 0) {
      fail(errors, "source.svg viewBox must contain four finite numbers with positive width/height");
    }
  }
  // Safe-input handling: resvg never executes scripts, but reject risky input outright.
  const banned = [
    [/<!ENTITY/i, "source.svg contains <!ENTITY (XXE risk)"],
    [/<!DOCTYPE/i, "source.svg contains DOCTYPE"],
    [/<image[\s/>]/i, "source.svg embeds raster/external image instead of editable vector"],
    [/<script[\s>]/i, "source.svg contains <script>"],
    [/<foreignObject[\s>]/i, "source.svg contains <foreignObject>"],
    [/<(?:animate|animateTransform|animateMotion|set)[\s>]/i, "source.svg contains dynamic animation"],
    [/\son\w+\s*=/i, "source.svg contains event-handler attribute"],
    [/(?:xlink:)?href\s*=\s*["'](?!#)[^"']+/i, "source.svg contains non-local href"],
    [/url\s*\(\s*["']?\s*(?:https?:|data:|\/\/)/i, "source.svg contains remote or embedded url()"],
    [/xlink:href\s*=\s*["']https?:/i, "source.svg contains remote xlink:href"],
    [/href\s*=\s*["']https?:/i, "source.svg contains remote href"],
  ];
  for (const [re, msg] of banned) if (re.test(svg)) fail(errors, msg);
  return errors;
}

// Expand the master viewBox by SAFE_MARGIN on every side (render-space only,
// the committed source.svg is never modified) so no export clips at any size.
export function withSafeMargin(svg) {
  const m = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!m) return svg;
  const nums = m[1].trim().split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return svg;
  const [x, y, w, h] = nums;
  const dx = w * SAFE_MARGIN;
  const dy = h * SAFE_MARGIN;
  return svg.replace(m[0], `viewBox="${x - dx} ${y - dy} ${w + 2 * dx} ${h + 2 * dy}"`);
}

// 4-connected components of the opaque mask, as pixel counts (largest first).
// A shipped character must be one piece: a detached ear/hand/limb shows up
// here as extra components. Ported from the Designer's sharp renderer
// (KOMAA-1010), which is not in this tree, so the canonical renderer owns the
// gate too.
export function countComponents(img, threshold = ALPHA_THRESHOLD) {
  const { width: w, height: h } = img;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = img.data[i * 4 + 3] > threshold ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const sizes = [];
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || seen[s]) continue;
    seen[s] = 1;
    stack.length = 0;
    stack.push(s);
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && on[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && on[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && on[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && on[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}

// A detached part must be a real shape, not a stray anti-aliasing pixel.
// Components below this share of the largest component are noise, not parts
// (UI QA: 1px alpha islands at ungated sizes are anti-aliasing, not limbs).
export const NOISE_COMPONENT_RATIO = 0.01;

export function detachedParts(sizes) {
  if (sizes.length < 2) return [];
  const largest = sizes[0];
  return sizes.slice(1).filter((n) => n >= largest * NOISE_COMPONENT_RATIO);
}

// ---- pixel analysis -------------------------------------------------------
export function analyzePng(buf, expectedSize) {
  const errors = [];
  let img;
  try {
    img = PNG.sync.read(Buffer.from(buf));
  } catch {
    return { errors: ["PNG decode failed"], img: null };
  }
  if (img.width !== expectedSize || img.height !== expectedSize) {
    fail(errors, `PNG is ${img.width}x${img.height}, expected ${expectedSize}x${expectedSize}`);
  }
  let transparent = 0;
  let opaque = 0;
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3];
      if (a === 0) transparent++;
      else {
        opaque++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (transparent === 0) fail(errors, "PNG has no transparent pixel (background must stay transparent)");
  const ratio = opaque / (img.width * img.height);
  if (ratio < MIN_OPAQUE_RATIO) {
    fail(errors, `PNG looks blank: opaque ratio ${ratio.toFixed(4)} < ${MIN_OPAQUE_RATIO}`);
  }
  const bbox = opaque === 0 ? null : { minX, minY, maxX, maxY };
  if (bbox && (minX <= 0 || minY <= 0 || maxX >= img.width - 1 || maxY >= img.height - 1)) {
    fail(errors, `content touches canvas edge (bbox ${JSON.stringify(bbox)}): clipped art?`);
  }
  const components = countComponents(img);
  return { errors, img, opaque, opaqueRatio: ratio, bbox, components };
}

// ---- per-character pipeline -----------------------------------------------
export function exportCharacter(charDir, characterId) {
  const errors = [];
  const sourceSvgPath = join(charDir, "source.svg");
  const characterJsonPath = join(charDir, "character.json");
  if (!existsSync(characterJsonPath)) fail(errors, `${characterId}: missing character.json`);
  if (!existsSync(sourceSvgPath)) fail(errors, `${characterId}: missing source.svg`);
  if (errors.length > 0) return { ok: false, errors };

  const { errors: jsonErrors, data: meta } = validateCharacterJson(readFileSync(characterJsonPath, "utf8"));
  for (const e of jsonErrors) fail(errors, `${characterId}: ${e}`);
  const svg = readFileSync(sourceSvgPath, "utf8");
  for (const e of validateSvg(svg)) fail(errors, `${characterId}: ${e}`);
  if (meta && meta.id !== characterId) fail(errors, `${characterId}: id mismatch in character.json (${meta.id})`);
  if (errors.length > 0) return { ok: false, errors };

  const outDir = join(charDir, "exports");
  mkdirSync(outDir, { recursive: true });
  const renderSvg = withSafeMargin(svg);
  const sizes = [];
  const rendered = [];
  for (const size of SIZES) {
    let png;
    try {
      png = Buffer.from(new Resvg(renderSvg, { fitTo: { mode: "width", value: size } }).render().asPng());
    } catch (err) {
      fail(errors, `${characterId}@${size}: render failed: ${err.message}`);
      continue;
    }
    const { errors: pxErrors, opaque, opaqueRatio, bbox, components } = analyzePng(png, size);
    for (const e of pxErrors) fail(errors, `${characterId}@${size}: ${e}`);
    // Gated at every exported size: a split that only shows up at 512 must not
    // slip through an ungated size (UI QA: iskra-c splits at 512 *and* 256).
    const detached = detachedParts(components);
    if (detached.length > 0) {
      fail(
        errors,
        `${characterId}@${size}: renders as ${components.length} disconnected pieces (sizes ${components.join(",")}; detached ${detached.join(",")}): a detached part (ear/hand/limb) is not shippable`,
      );
    }
    const file = `export-${size}.png`;
    writeFileSync(join(outDir, file), png);
    rendered.push({ size, file, png });
    sizes.push({
      size,
      file,
      sha256: sha256(png),
      bytes: png.length,
      opaquePixels: opaque,
      opaqueRatio,
      bbox,
      connectedComponents: components.length,
      detachedParts: detached.length,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Contact sheet: horizontal strip of actual-size exports on transparency.
  const sheetWidth = SIZES.reduce((a, s) => a + s, 0) + GAP * (SIZES.length - 1);
  const sheet = new PNG({ width: sheetWidth, height: SIZES[0] });
  let dx = 0;
  for (const { size, png } of rendered) {
    PNG.bitblt(PNG.sync.read(png), sheet, 0, 0, size, size, dx, 0);
    dx += size + GAP;
  }
  const sheetBuf = PNG.sync.write(sheet);
  writeFileSync(join(outDir, "contact-sheet.png"), sheetBuf);

  const manifest = {
    character: characterId,
    styleVersion: meta.styleVersion,
    safeMargin: SAFE_MARGIN,
    source: { file: "source.svg", sha256: sha256(Buffer.from(svg)), bytes: Buffer.byteLength(svg) },
    renderer: {
      resvgJs: require("@resvg/resvg-js/package.json").version,
      pngjs: require("pngjs/package.json").version,
    },
    sizes,
    contactSheet: {
      file: "contact-sheet.png",
      sha256: sha256(sheetBuf),
      bytes: sheetBuf.length,
      width: sheet.width,
      height: sheet.height,
    },
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Fail on missing outputs: re-read every expected file from disk.
  const expected = [...SIZES.map((s) => `export-${s}.png`), "contact-sheet.png", "manifest.json"];
  for (const f of expected) {
    if (!existsSync(join(outDir, f))) fail(errors, `${characterId}: missing output ${f}`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], manifest };
}

// A directory is a character iff it carries a master source or metadata.
// Design artifacts that live beside the characters (e.g. silhouettes/) are ignored.
export function discoverCharacters(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => existsSync(join(root, id, "source.svg")) || existsSync(join(root, id, "character.json")))
    .sort();
}

// ---- silhouettes -----------------------------------------------------------
// The silhouette sketches are design artifacts, but their PNG renders are
// renderer output: they must come from this pipeline too, otherwise the tree
// ships PNGs that no committed command can reproduce (UI QA F3/C1, KOMAA-1010).
export const SILHOUETTE_SHEET_SIZE = 256;

export function discoverSilhouettes(root) {
  const dir = join(root, "silhouettes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".svg")).sort();
}

export function exportSilhouettes(root) {
  const errors = [];
  const dir = join(root, "silhouettes");
  const files = discoverSilhouettes(root);
  if (files.length === 0) {
    fail(errors, "no silhouette SVGs found in silhouettes/");
    return { ok: false, errors };
  }
  const outDir = join(dir, "png");
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  for (const file of files) {
    const svg = readFileSync(join(dir, file), "utf8");
    for (const e of validateSvg(svg)) fail(errors, `silhouettes/${file}: ${e}`);
    const name = file.replace(/\.svg$/, "");
    const renderSvg = withSafeMargin(svg);
    const exports = [];
    for (const size of SIZES) {
      let png;
      try {
        png = Buffer.from(new Resvg(renderSvg, { fitTo: { mode: "width", value: size } }).render().asPng());
      } catch (err) {
        fail(errors, `silhouettes/${file}@${size}: render failed: ${err.message}`);
        continue;
      }
      const { errors: pxErrors, components } = analyzePng(png, size);
      for (const e of pxErrors) fail(errors, `silhouettes/${file}@${size}: ${e}`);
      const detached = detachedParts(components);
      if (detached.length > 0) {
        fail(
          errors,
          `silhouettes/${file}@${size}: renders as ${components.length} disconnected pieces (sizes ${components.join(",")}; detached ${detached.join(",")}): a detached part (ear/wing/limb) is not shippable`,
        );
      }
      const outFile = `${name}-${size}.png`;
      writeFileSync(join(outDir, outFile), png);
      exports.push({
        size,
        file: `silhouettes/png/${outFile}`,
        sha256: sha256(png),
        bytes: png.length,
        connectedComponents: components.length,
        detachedParts: detached.length,
      });
    }
    entries.push({
      name,
      source: { file: `silhouettes/${file}`, sha256: sha256(Buffer.from(svg)), bytes: Buffer.byteLength(svg) },
      exports,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Grid sheet: silhouettes in name order (iskra row, then szlif row).
  const cols = Math.min(3, entries.length);
  const rows = Math.ceil(entries.length / cols);
  const cell = SILHOUETTE_SHEET_SIZE;
  const sheet = new PNG({ width: cols * cell + (cols - 1) * GAP, height: rows * cell + (rows - 1) * GAP });
  entries.forEach((entry, i) => {
    const src = PNG.sync.read(readFileSync(join(outDir, `${entry.name}-${cell}.png`)));
    PNG.bitblt(src, sheet, 0, 0, cell, cell, (i % cols) * (cell + GAP), Math.floor(i / cols) * (cell + GAP));
  });
  const sheetBuf = PNG.sync.write(sheet);
  writeFileSync(join(dir, "sheet.png"), sheetBuf);

  // Fail on missing outputs: re-read every expected file from disk.
  for (const entry of entries) {
    for (const e of entry.exports) {
      if (!existsSync(join(root, e.file))) fail(errors, `missing output ${e.file}`);
    }
  }
  if (!existsSync(join(dir, "sheet.png"))) fail(errors, "missing output silhouettes/sheet.png");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    silhouettes: entries,
    sheet: {
      file: "silhouettes/sheet.png",
      sha256: sha256(sheetBuf),
      bytes: sheetBuf.length,
      width: sheet.width,
      height: sheet.height,
    },
  };
}

// Pair sheet: one row per size, every character side by side on transparency.
export function buildSetContactSheet(root, ids) {
  const width = ids.length * SHEET_SIZES[0] + GAP * (ids.length - 1);
  const height = SHEET_SIZES.reduce((a, s) => a + s, 0) + GAP * (SHEET_SIZES.length - 1);
  const sheet = new PNG({ width, height });
  let y = 0;
  for (const size of SHEET_SIZES) {
    let x = 0;
    for (const id of ids) {
      const src = PNG.sync.read(readFileSync(join(root, id, "exports", `export-${size}.png`)));
      PNG.bitblt(src, sheet, 0, 0, size, size, x, y);
      x += size + GAP;
    }
    y += size + GAP;
  }
  return PNG.sync.write(sheet);
}

// Set-level outputs: manifest index + pair contact sheet (one renderer, one SSOT).
export function writeSetOutputs(root, ids, silhouettes = null) {
  const errors = [];
  const sheetBuf = buildSetContactSheet(root, ids);
  writeFileSync(join(root, "contact-sheet.png"), sheetBuf);
  const characters = ids.map((id) => {
    const manifestPath = join(root, id, "exports", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return {
      id,
      styleVersion: manifest.styleVersion,
      source: manifest.source,
      manifest: { file: `${id}/exports/manifest.json`, sha256: sha256(readFileSync(manifestPath)) },
      exports: manifest.sizes.map((s) => ({ size: s.size, file: `${id}/exports/${s.file}`, sha256: s.sha256 })),
    };
  });
  const setManifest = {
    generator: "scripts/mascots/export.mjs",
    renderer: {
      resvgJs: require("@resvg/resvg-js/package.json").version,
      pngjs: require("pngjs/package.json").version,
    },
    characters,
    contactSheet: { file: "contact-sheet.png", sha256: sha256(sheetBuf), bytes: sheetBuf.length },
  };
  if (silhouettes) {
    setManifest.silhouettes = silhouettes.silhouettes;
    setManifest.silhouetteSheet = silhouettes.sheet;
  }
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(setManifest, null, 2)}\n`);
  for (const f of ["manifest.json", "contact-sheet.png"]) {
    if (!existsSync(join(root, f))) fail(errors, `set output missing ${f}`);
  }
  return { errors, manifest: setManifest };
}

export function runAll(root = DEFAULT_ROOT, only = null) {
  const all = discoverCharacters(root);
  const ids = only ? all.filter((id) => id === only) : all;
  if (only && ids.length === 0) return { ok: false, errors: [`unknown character: ${only}`] };
  if (ids.length === 0) return { ok: false, errors: [`no characters found in root: ${root}`] };
  const errors = [];
  for (const id of ids) {
    const r = exportCharacter(join(root, id), id);
    if (!r.ok) errors.push(...r.errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (!only) {
    const sil = exportSilhouettes(root);
    if (!sil.ok) {
      errors.push(...sil.errors);
    } else {
      const set = writeSetOutputs(root, ids, sil);
      if (set.errors.length > 0) errors.push(...set.errors);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  let root = DEFAULT_ROOT;
  let only = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--character") only = args[++i];
    else {
      console.error(`usage: export.mjs [--root <dir>] [--character <id>]`);
      process.exit(1);
    }
  }
  const t0 = Date.now();
  const result = runAll(root, only);
  if (result.ok) {
    console.log(`mascot export PASS (${Date.now() - t0}ms) root=${root}`);
    for (const size of SIZES) console.log(`  verified PNG size ${size}x${size}`);
    console.log("  manifest.json + contact-sheet.png written per character");
    console.log("  silhouette exports + silhouettes/sheet.png written");
    console.log("  set manifest.json + pair contact-sheet.png written at root");
  } else {
    console.error("mascot export FAIL:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
