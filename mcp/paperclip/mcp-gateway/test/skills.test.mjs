import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "../skills.mjs";

const skill = (name) => `---\nname: ${name}\ndescription: test skill\n---\ncontent`;

test("loads required skill and omits only missing optional skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-skills-"));
  try {
    const corePath = join(dir, "core.md");
    writeFileSync(corePath, skill("paperclip"));
    const warn = console.warn;
    console.warn = () => {};
    try {
      const loaded = loadSkills([
        { name: "paperclip", path: corePath },
        { name: "paperclip-plan-dag", path: join(dir, "missing.md") },
      ]);
      assert.deepEqual(loaded.map(({ name }) => name), ["paperclip"]);
      assert.equal(loaded[0].entry.uri, "skill://paperclip/paperclip/SKILL.md");
    } finally {
      console.warn = warn;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails closed when the required core skill is missing", () => {
  assert.throws(() => loadSkills([{ name: "paperclip", path: "/missing/core/SKILL.md" }]), { code: "ENOENT" });
});

test("does not hide malformed optional skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-skills-"));
  try {
    const path = join(dir, "optional.md");
    writeFileSync(path, "not valid frontmatter");
    assert.throws(() => loadSkills([{ name: "optional", path }]), /no frontmatter/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
