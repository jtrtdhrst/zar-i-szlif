// Mascot STYLE_2 deterministic SVG -> PNG export pipeline (KOMAA-1011).
// One CLI: validate inputs, render transparent PNGs, verify pixels,
// write manifest.json + contact-sheet.png. Exit 0 on PASS, 1 on any FAIL.
// Renderer: @resvg/resvg-js (prebuilt Rust resvg). PNG inspect/compose: pngjs.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)));
const { Resvg } = require("@resvg/resvg-js");
const { PNG } = require("pngjs");

export const SIZES = [512, 256, 128, 64, 32];
export const MAX_SVG_BYTES = 1024 * 1024;
export const MIN_OPAQUE_RATIO = 0.01;
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
  for (const key of ["id", "species", "role", "styleVersion", "palette"]) {
    if (data[key] === undefined) fail(errors, `character.json missing required field: ${key}`);
  }
  if (data.role !== undefined && !["npc", "player"].includes(data.role)) {
    fail(errors, `character.json role must be npc|player, got: ${data.role}`);
  }
  if (data.palette !== undefined) {
    if (!Array.isArray(data.palette) || data.palette.length === 0 || data.palette.length > 6) {
      fail(errors, "character.json palette must be an array of 1..6 hex colors");
    } else if (!data.palette.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) {
      fail(errors, "character.json palette entries must be #rrggbb");
    }
  }
  return { errors, data };
}

export function validateSvg(svg) {
  const errors = [];
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) fail(errors, "source.svg exceeds 1 MiB");
  if (!/<svg[\s>]/.test(svg)) fail(errors, "source.svg has no <svg> root");
  if (!/viewBox\s*=/.test(svg)) fail(errors, "source.svg missing viewBox");
  // Safe-input handling: resvg never executes scripts, but reject risky input outright.
  const banned = [
    [/<!ENTITY/i, "source.svg contains <!ENTITY (XXE risk)"],
    [/<!DOCTYPE[^>]*\[/i, "source.svg contains DOCTYPE with internal subset"],
    [/<script[\s>]/i, "source.svg contains <script>"],
    [/<foreignObject[\s>]/i, "source.svg contains <foreignObject>"],
    [/\son\w+\s*=/i, "source.svg contains event-handler attribute"],
    [/xlink:href\s*=\s*["']https?:/i, "source.svg contains remote xlink:href"],
    [/href\s*=\s*["']https?:/i, "source.svg contains remote href"],
  ];
  for (const [re, msg] of banned) if (re.test(svg)) fail(errors, msg);
  return errors;
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
  return { errors, img, opaque, opaqueRatio: ratio, bbox };
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
  const sizes = [];
  const rendered = [];
  for (const size of SIZES) {
    let png;
    try {
      png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
    } catch (err) {
      fail(errors, `${characterId}@${size}: render failed: ${err.message}`);
      continue;
    }
    const { errors: pxErrors, opaque, opaqueRatio, bbox } = analyzePng(png, size);
    for (const e of pxErrors) fail(errors, `${characterId}@${size}: ${e}`);
    const file = `export-${size}.png`;
    writeFileSync(join(outDir, file), png);
    rendered.push({ size, file, png });
    sizes.push({ size, file, sha256: sha256(png), bytes: png.length, opaquePixels: opaque, opaqueRatio, bbox });
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

export function runAll(root = DEFAULT_ROOT, only = null) {
  const ids = [require("node:fs").readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)]
    .flat()
    .filter((id) => !only || id === only)
    .sort();
  if (only && ids.length === 0) return { ok: false, errors: [`unknown character: ${only}`] };
  const errors = [];
  for (const id of ids) {
    const r = exportCharacter(join(root, id), id);
    if (!r.ok) errors.push(...r.errors);
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
  } else {
    console.error("mascot export FAIL:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
