// Mascot STYLE_2 pipeline tests (KOMAA-1011). Fixtures are copied to isolated
// tmp dirs outside the repo; the repo's canonical sources are inputs only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { exportCharacter, runAll, SIZES } from "../scripts/mascots/export.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const canonical = join(root, "assets", "mascots", "style-2");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function isolatedTmp() {
  const dir = mkdtempSync(join(tmpdir(), "mascot-"));
  assert.ok(isAbsolute(dir));
  const realDir = realpathSync(dir);
  const realRoot = realpathSync(root);
  assert.ok(!realDir.startsWith(`${realRoot}/`), `fixture dir inside repo: ${realDir}`);
  return dir;
}

function stageCharacter(id, mutate = null) {
  const dir = isolatedTmp();
  cpSync(join(canonical, id), join(dir, id), { recursive: true });
  if (mutate) mutate(join(dir, id));
  return dir;
}

const EXPECTED_FILES = [...SIZES.map((s) => `export-${s}.png`), "contact-sheet.png", "manifest.json"];

test("positive: iskra and szlif export, verify and manifest", () => {
  const dir = stageCharacter("iskra");
  try {
    const r = exportCharacter(join(dir, "iskra"), "iskra");
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    for (const f of EXPECTED_FILES) assert.ok(existsSync(join(dir, "iskra", "exports", f)), `missing ${f}`);
    const manifest = JSON.parse(readFileSync(join(dir, "iskra", "exports", "manifest.json"), "utf8"));
    assert.equal(manifest.character, "iskra");
    assert.equal(manifest.sizes.length, 5);
    for (const s of manifest.sizes) {
      const buf = readFileSync(join(dir, "iskra", "exports", s.file));
      assert.equal(sha256(buf), s.sha256, `hash drift in ${s.file}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("positive: runAll covers every character in root", () => {
  const dir = isolatedTmp();
  try {
    cpSync(canonical, dir, { recursive: true });
    const r = runAll(dir);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("set outputs: root manifest index and pair contact sheet are generated and reproducible", () => {
  const a = isolatedTmp();
  const b = isolatedTmp();
  try {
    cpSync(canonical, a, { recursive: true });
    cpSync(canonical, b, { recursive: true });
    assert.equal(runAll(a).ok, true);
    assert.equal(runAll(b).ok, true);
    const ma = JSON.parse(readFileSync(join(a, "manifest.json"), "utf8"));
    const mb = JSON.parse(readFileSync(join(b, "manifest.json"), "utf8"));
    assert.deepEqual(ma, mb, "set manifest is not reproducible");
    assert.deepEqual(ma.characters.map((c) => c.id), ["iskra", "szlif"]);
    for (const c of ma.characters) {
      const perCharacter = JSON.parse(readFileSync(join(a, c.manifest.file), "utf8"));
      assert.equal(perCharacter.character, c.id);
      for (const e of c.exports) {
        assert.equal(sha256(readFileSync(join(a, e.file))), e.sha256, `hash drift: ${e.file}`);
      }
    }
    assert.ok(existsSync(join(a, "contact-sheet.png")), "missing pair contact sheet");
    assert.equal(
      sha256(readFileSync(join(a, "contact-sheet.png"))),
      sha256(readFileSync(join(b, "contact-sheet.png"))),
      "pair contact sheet is not reproducible",
    );
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("negative: corrupted SVG fails validation", () => {
  for (const bad of [
    "<svg><g><unclosed>",
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<!DOCTYPE foo [<!ENTITY x "y">]><svg viewBox="0 0 1 1"></svg>',
    '<svg viewBox="0 0 1 1"><rect onclick="x()"/></svg>',
    '<svg viewBox="0 0 1 1"><image href="https://example.com/x.png"/></svg>',
  ]) {
    const dir = stageCharacter("szlif", (d) => writeFileSync(join(d, "source.svg"), bad));
    try {
      const r = exportCharacter(join(dir, "szlif"), "szlif");
      assert.equal(r.ok, false, `accepted bad SVG: ${bad.slice(0, 40)}`);
      assert.ok(r.errors.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("negative: missing assets and invalid character.json fail", () => {
  const missing = stageCharacter("iskra", (d) => rmSync(join(d, "source.svg")));
  try {
    assert.equal(exportCharacter(join(missing, "iskra"), "iskra").ok, false);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  for (const badJson of [
    "{not json",
    JSON.stringify({ id: "iskra" }),
    JSON.stringify({ id: "iskra", species: "fox", role: "npc", styleVersion: "v", palette: ["red"] }),
    JSON.stringify({ id: "iskra", species: "fox", role: "enemy", styleVersion: "v", palette: ["#E07B39"] }),
  ]) {
    const dir = stageCharacter("iskra", (d) => writeFileSync(join(d, "character.json"), badJson));
    try {
      const r = exportCharacter(join(dir, "iskra"), "iskra");
      assert.equal(r.ok, false, `accepted bad character.json: ${badJson.slice(0, 40)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("reproducibility: two runs produce byte-identical PNGs", () => {
  const a = stageCharacter("szlif");
  const b = stageCharacter("szlif");
  try {
    assert.equal(exportCharacter(join(a, "szlif"), "szlif").ok, true);
    assert.equal(exportCharacter(join(b, "szlif"), "szlif").ok, true);
    for (const f of EXPECTED_FILES.filter((f) => f.endsWith(".png"))) {
      const ha = sha256(readFileSync(join(a, "szlif", "exports", f)));
      const hb = sha256(readFileSync(join(b, "szlif", "exports", f)));
      assert.equal(ha, hb, `non-reproducible output: ${f}`);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("silhouettes: every sketch is rendered at all sizes, hashed in the set manifest and reproducible", () => {
  const a = isolatedTmp();
  const b = isolatedTmp();
  try {
    cpSync(canonical, a, { recursive: true });
    cpSync(canonical, b, { recursive: true });
    assert.equal(runAll(a).ok, true);
    assert.equal(runAll(b).ok, true);
    const ma = JSON.parse(readFileSync(join(a, "manifest.json"), "utf8"));
    assert.ok(ma.silhouettes, "set manifest has no silhouette entries");
    assert.equal(ma.silhouettes.length, 6);
    for (const s of ma.silhouettes) {
      assert.ok(existsSync(join(a, s.source.file)), `missing silhouette source ${s.source.file}`);
      assert.equal(
        sha256(readFileSync(join(a, s.source.file))),
        s.source.sha256,
        `source hash drift: ${s.source.file}`,
      );
      assert.deepEqual(s.exports.map((e) => e.size), SIZES, `silhouette ${s.name} misses an export size`);
      for (const e of s.exports) {
        assert.ok(existsSync(join(a, e.file)), `missing ${e.file}`);
        assert.equal(sha256(readFileSync(join(a, e.file))), e.sha256, `hash drift: ${e.file}`);
      }
      // 32px silhouette exports were the UI QA C1 gap on the Designer branch.
      assert.ok(
        existsSync(join(a, "silhouettes", "png", `${s.name}-32.png`)),
        `missing 32px silhouette export: ${s.name}`,
      );
    }
    assert.ok(ma.silhouetteSheet, "set manifest has no silhouette sheet");
    assert.equal(sha256(readFileSync(join(a, ma.silhouetteSheet.file))), ma.silhouetteSheet.sha256);
    assert.equal(
      sha256(readFileSync(join(b, "manifest.json"))),
      sha256(readFileSync(join(a, "manifest.json"))),
      "set manifest with silhouettes is not reproducible",
    );
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("docs: the mascot docs reference only scripts that exist and a runnable npm command", () => {
  const docs = [
    join(canonical, "README.md"),
    join(canonical, "PROVENANCE.md"),
    join(root, "docs", "mascots", "style-2-character-bible.md"),
  ];
  const referenced = new Set();
  for (const doc of docs) {
    for (const m of readFileSync(doc, "utf8").matchAll(/scripts\/mascots\/[\w.-]+\.mjs/g)) referenced.add(m[0]);
  }
  assert.ok(referenced.size > 0, "no renderer script referenced in the mascot docs");
  for (const ref of referenced) {
    assert.ok(existsSync(join(root, ref)), `doc references a missing script: ${ref}`);
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.mascots, "node scripts/mascots/export.mjs");
  assert.ok(existsSync(join(root, "scripts", "mascots", "export.mjs")), "npm run mascots target is missing");
  // The pipeline must be exercised by CI, otherwise "repeatable" is a claim
  // with nothing behind it (the defect UI QA raised as F3).
  const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.ok(ci.includes("npm run mascots"), "CI does not run the mascot pipeline");
  assert.ok(
    ci.includes("git status --porcelain -- assets/mascots/style-2"),
    "CI does not check that committed mascot assets match the pipeline output",
  );
});
