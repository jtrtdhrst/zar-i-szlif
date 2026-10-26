import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function loadSkills(definitions, requiredName = "paperclip") {
  return definitions.flatMap(({ name, path }) => {
    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch (error) {
      if (name === requiredName || error.code !== "ENOENT") throw error;
      console.warn(`[paperclip-mcp-gateway] optional skill ${name} unavailable; omitting ${path}`);
      return [];
    }
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error(`Skill ${path} has no frontmatter`);
    const frontmatter = Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      return field ? [[field[1], field[2].trim().replace(/^(['"])(.*)\1$/, "$2")]] : [];
    }));
    if (!frontmatter.name || !frontmatter.description) {
      throw new Error(`Skill ${path} frontmatter needs name and description`);
    }
    const uri = `skill://paperclip/${name}/SKILL.md`;
    const entry = Object.freeze({
      uri,
      frontmatter: Object.freeze(frontmatter),
      resources: Object.freeze([{
        uri,
        digest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
      }]),
    });
    return [Object.freeze({ name, uri, content, entry })];
  });
}
