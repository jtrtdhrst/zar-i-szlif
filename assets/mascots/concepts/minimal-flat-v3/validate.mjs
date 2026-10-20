#!/usr/bin/env node
// Dependency-free structural gate for the provisional V3 mascot sources.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const contracts = [
  { name: "iskra", expectedParts: 20 },
  { name: "szlif", expectedParts: 19 },
];
let failures = 0;
for (const contract of contracts) {
  const svg = readFileSync(join(dir, contract.name + ".svg"), "utf8");
  const errors = [];
  const banned = /<(?:image|script|foreignObject|filter|linearGradient|radialGradient|pattern|use|animate)\b|(?:xlink:)?href\s*=|url\s*\(|data\s*:/i;
  if (banned.test(svg)) errors.push("embedded/external image, script, gradient or unsafe reference");
  if (!/viewBox="0 0 512 512"/.test(svg)) errors.push("missing 512x512 viewBox");
  if (!/<title\s+id="title">/.test(svg) || !/<desc\s+id="desc">/.test(svg)) errors.push("missing accessible title/desc");
  const shapes = [...svg.matchAll(/<(?:path|ellipse)\b[^>]*\/>/g)];
  if (shapes.length !== contract.expectedParts) errors.push("parts: " + shapes.length + ", expected " + contract.expectedParts);
  const palette = new Set([...svg.matchAll(/\bfill="(#[A-Fa-f0-9]{6})"/g)].map(x => x[1].toUpperCase()));
  if (palette.size !== 5) errors.push("palette: " + palette.size + " colors, expected 5");
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  if (new Set(ids).size !== ids.length) errors.push("duplicate ids");
  if (/<(?:rect|circle|text|line|polygon|polyline)\b/.test(svg)) errors.push("unexpected primitive");
  if (!svg.includes("Penpot native vector export")) errors.push("provenance marker missing");
  console.log((errors.length ? "FAIL" : "PASS") + " " + contract.name + ": " + shapes.length + " parts / " + palette.size + " colors");
  for (const error of errors) console.error("  - " + error);
  failures += errors.length;
}
if (failures) process.exit(1);
