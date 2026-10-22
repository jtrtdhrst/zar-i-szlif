import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const targets = JSON.parse(readFileSync(new URL("../ops/coolify/targets.json", import.meta.url), "utf8"));
const errors = [];
const dirs = new Set();
const ids = new Set();
for (const target of targets.coolifyTargets) {
  const d = target.sourceDirectory;
  if (ids.has(target.id)) errors.push("duplicate ID: " + target.id);
  ids.add(target.id);
  if (dirs.has(d)) errors.push("duplicate service source: " + d);
  dirs.add(d);
  if (!/^(app|mcp)\/[a-z0-9-]+\/$/.test(d)) errors.push("invalid canonical path: " + d);
  if (!existsSync(resolve(d))) errors.push("missing source directory: " + d);
  if (!target.triggerPaths?.length) errors.push("missing scoped trigger: " + target.id);
  if (target.triggerPaths?.some(p => p === "**" || p === "**/*")) errors.push("unscoped trigger: " + target.id);
  if (target.status.toLowerCase().includes("not-coolify-ready") || target.status === "source-incomplete") {
    if (target.dockerfile || target.containerPort) errors.push("source incomplete but Dockerfile/port declared: " + target.id);
  }
  if (target.dockerfile) {
    const p = target.coolifyBaseDirectory === "/" ? target.dockerfile : target.sourceDirectory + target.dockerfile;
    if (!existsSync(resolve(p))) errors.push("missing Dockerfile: " + p);
  }
  if (target.sourceDirectory.includes("/_branches/") || target.buildContext?.includes("/_branches/")) {
    errors.push("raw alternative branch selected as deploy context: " + target.id);
  }
}
for (const needed of ["product-app","product-website","product-mcp","mantic-mcp","plasmic-mcp","qdrant-mcp","penpot-mcp","supabase-mcp","ubuntu-mcp"]) if (!ids.has(needed)) errors.push("missing service: " + needed);
if (errors.length) {
  for (const e of errors) console.error("COOLIFY_TARGET_INVALID: " + e);
  process.exit(1);
}
console.log("PASS validated " + ids.size + " independent Coolify source targets; nondeployable sources fail closed");
