// Deterministic STYLE_2 exporter: SVG masters -> transparent PNGs + sheets + manifest.
// Run: node scripts/mascots/render-style-2.mjs  (repeatable; overwrites outputs)
// Requires: sharp. Resolved from SHARP_DIR, then ./node_modules, then the repo root.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const STYLE = path.join(ROOT, "assets/mascots/style-2");

function loadSharp() {
  const candidates = [process.env.SHARP_DIR, path.join(ROOT, "node_modules")].filter(Boolean);
  for (const dir of candidates) {
    try {
      const m = createRequire(path.join(dir, "package.json"))("sharp");
      return m.default ?? m;
    } catch {}
  }
  try {
    const m = createRequire(import.meta.url)("sharp");
    return m.default ?? m;
  } catch {}
  throw new Error(
    "sharp not found. Install it in the repo (npm i -D sharp) or set SHARP_DIR to a directory that contains node_modules/sharp.",
  );
}
const sharp = loadSharp();

const SIZES = [512, 256, 128, 64, 32];
const SILHOUETTE_SIZES = [256, 128, 64, 32];
const MASTERS = ["iskra", "szlif"];
const SILHOUETTES = ["iskra-a", "iskra-b", "iskra-c", "szlif-a", "szlif-b", "szlif-c"];
const ALPHA_THRESHOLD = 16;
const manifest = {
  styleVersion: "style-2-v0",
  renderer: `sharp/${sharp.versions?.sharp ?? "unknown"}`,
  opaqueAlphaThreshold: ALPHA_THRESHOLD,
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
  for (let i = 3; i < data.length; i += 4) if (data[i] > ALPHA_THRESHOLD) opaque++;
  return {
    width: w, height: h, channels: info.channels,
    transparentCorners: corners.every((a) => a === 0),
    opaqueFraction: +(opaque / (w * h)).toFixed(4),
    expectTransparentCorners,
  };
}

// 4-connected components of the opaque mask. A shipped character must be one
// piece: a detached ear/hand/limb shows up here as extra components.
async function components(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const found = [];
  const stack = [];
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
    found.push(n);
  }
  return found.sort((a, b) => b - a);
}

async function record(relPath, buf, analysis) {
  await writeFile(path.join(STYLE, relPath), buf);
  manifest.files.push({ path: `assets/mascots/style-2/${relPath}`, sha256: sha256(buf), ...analysis });
}

async function recordSource(relPath) {
  const buf = await readFile(path.join(STYLE, relPath));
  const viewBox = /viewBox="([^"]+)"/.exec(buf.toString("utf8"))?.[1] ?? null;
  manifest.files.push({
    path: `assets/mascots/style-2/${relPath}`,
    type: relPath.endsWith(".svg") ? "source-svg" : "source-json",
    bytes: buf.length,
    viewBox,
    sha256: sha256(buf),
  });
}

// 1. Master exports
for (const m of MASTERS) {
  const src = path.join(STYLE, m, "source.svg");
  for (const size of SIZES) {
    const buf = await pngFromSvg(src, size);
    const a = await analyze(buf);
    if (size === 512 && (!a.transparentCorners || a.opaqueFraction < 0.05))
      throw new Error(`alpha check failed for ${m}@512: ${JSON.stringify(a)}`);
    if (size === 512) {
      const parts = await components(buf);
      a.connectedComponents = parts.length;
      if (parts.length !== 1)
        throw new Error(
          `${m}@512 renders as ${parts.length} disconnected pieces (sizes ${parts.join(",")}): ` +
            "a detached part (ear/hand/limb) is not shippable",
        );
    }
    await record(`${m}/exports/export-${size}.png`, buf, a);
  }
}

// 2. Silhouette previews (256/128/64/32)
await mkdir(path.join(STYLE, "silhouettes/png"), { recursive: true });
for (const s of SILHOUETTES) {
  const src = path.join(STYLE, "silhouettes", `${s}.svg`);
  for (const size of SILHOUETTE_SIZES) {
    const buf = await pngFromSvg(src, size);
    const a = await analyze(buf);
    a.connectedComponents = (await components(buf)).length;
    if (size === 256 && a.connectedComponents !== 1)
      throw new Error(
        `${s}@256 renders as ${a.connectedComponents} disconnected pieces: ` +
          "a detached part (ear/wing/limb) is not shippable",
      );
    await record(`silhouettes/png/${s}-${size}.png`, buf, a);
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

// 5. Source SVGs (editable masters + silhouette sketches) and the character
//    contracts are hashed too: the Engineer consumes source.svg + character.json
//    and must be able to verify them against the manifest.
for (const m of MASTERS) {
  await recordSource(`${m}/source.svg`);
  await recordSource(`${m}/character.json`);
}
for (const s of SILHOUETTES) await recordSource(`silhouettes/${s}.svg`);

await writeFile(path.join(STYLE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const fails = manifest.files.filter((f) => f.expectTransparentCorners && !f.transparentCorners);
console.log(`files=${manifest.files.length} renderer=${manifest.renderer}`);
if (fails.length) { console.error("ALPHA FAILS:", fails.map((f) => f.path)); process.exit(1); }
console.log("alpha checks passed");
