// Deterministic STYLE_2 exporter: SVG masters -> transparent PNGs + sheets + manifest.
// Run: node scripts/mascots/render-style-2.mjs  (repeatable; overwrites outputs)
// Requires: sharp (npm i sharp). Resolved via SHARP_DIR or ./node_modules.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const STYLE = path.join(ROOT, "assets/mascots/style-2");
const SHARP_DIR =
  process.env.SHARP_DIR ??
  "/tmp/paperclip-run-komaa-1010-71ad6ac5-835-ehjEhY/opencode/mascot-render";
const require = createRequire(path.join(SHARP_DIR, "package.json"));
const sharp = require("sharp").default ?? require("sharp");

const SIZES = [512, 256, 128, 64, 32];
const MASTERS = ["iskra", "szlif"];
const SILHOUETTES = ["iskra-a", "iskra-b", "iskra-c", "szlif-a", "szlif-b", "szlif-c"];
const manifest = {
  styleVersion: "style-2-v0",
  renderer: `sharp/${sharp.versions?.sharp ?? "unknown"}`,
  generatedAt: new Date().toISOString(),
  files: [],
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function pngFromSvg(svgPath, size) {
  const svg = await readFile(svgPath);
  return sharp(svg, { density: 144 }).resize(size, size).png().toBuffer();
}

async function analyze(buf, { expectTransparentCorners = true } = {}) {
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[(y * info.width + x) * 4 + 3];
  const w = info.width, h = info.height;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque++;
  return {
    width: w, height: h, channels: info.channels,
    transparentCorners: corners.every((a) => a === 0),
    opaqueFraction: +(opaque / (w * h)).toFixed(4),
    expectTransparentCorners,
  };
}

async function record(relPath, buf, analysis) {
  await writeFile(path.join(STYLE, relPath), buf);
  manifest.files.push({ path: `assets/mascots/style-2/${relPath}`, sha256: sha256(buf), ...analysis });
}

// 1. Master exports
for (const m of MASTERS) {
  const src = path.join(STYLE, m, "source.svg");
  for (const size of SIZES) {
    const buf = await pngFromSvg(src, size);
    const a = await analyze(buf);
    if (size === 512 && (!a.transparentCorners || a.opaqueFraction < 0.05))
      throw new Error(`alpha check failed for ${m}@512: ${JSON.stringify(a)}`);
    await record(`${m}/exports/export-${size}.png`, buf, a);
  }
}

// 2. Silhouette previews (256 + 64)
await mkdir(path.join(STYLE, "silhouettes/png"), { recursive: true });
for (const s of SILHOUETTES) {
  const src = path.join(STYLE, "silhouettes", `${s}.svg`);
  for (const size of [256, 64]) {
    const buf = await pngFromSvg(src, size);
    await record(`silhouettes/png/${s}-${size}.png`, buf, await analyze(buf));
  }
}

// 3. Pair contact sheet: rows 256/128/64/32, cols iskra|szlif
{
  const rows = [256, 128, 64, 32], pad = 24;
  const W = 256 + 256 + pad * 3, H = rows.reduce((a, b) => a + b, 0) + pad * (rows.length + 1);
  const base = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const comp = []; let y = pad;
  for (const n of rows) {
    for (const [i, m] of MASTERS.entries()) {
      const buf = await pngFromSvg(path.join(STYLE, m, "source.svg"), n);
      comp.push({ input: buf, left: pad + i * (n + pad), top: y });
    }
    y += n + pad;
  }
  const buf = await base.composite(comp).png().toBuffer();
  await record("contact-sheet.png", buf, await analyze(buf, { expectTransparentCorners: true }));
}

// 4. Silhouette sheet: 3x2 grid at 256
{
  const n = 256, pad = 20, W = 3 * n + 4 * pad, H = 2 * n + 3 * pad;
  const base = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const comp = [];
  for (const [i, s] of SILHOUETTES.entries()) {
    const buf = await pngFromSvg(path.join(STYLE, "silhouettes", `${s}.svg`), n);
    comp.push({ input: buf, left: pad + (i % 3) * (n + pad), top: pad + Math.floor(i / 3) * (n + pad) });
  }
  const buf = await base.composite(comp).png().toBuffer();
  await record("silhouettes/sheet.png", buf, await analyze(buf, { expectTransparentCorners: true }));
}

await writeFile(path.join(STYLE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const fails = manifest.files.filter((f) => f.expectTransparentCorners && !f.transparentCorners);
console.log(`files=${manifest.files.length} renderer=${manifest.renderer}`);
if (fails.length) { console.error("ALPHA FAILS:", fails.map((f) => f.path)); process.exit(1); }
console.log("alpha checks passed");
