import { readFile, writeFile } from "node:fs/promises";

const path = "kompas-ui-plugin/web/src/static-app-v2.js";
let source = await readFile(path, "utf8");

function replaceRange(start, end, replacement) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) throw new Error(`Nie znaleziono fragmentu runtime: ${start}`);
  source = `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

if (!source.includes("const btn=renderKompasButton;")) source = source.replace(/const btn=.*?;\r?\n/, "const btn=renderKompasButton;\n");
if (!source.includes("const brand=renderKompasBrandHeader;")) source = source.replace(/const brand=.*?;\r?\n/, "const brand=renderKompasBrandHeader;\n");
if (!source.includes("const dodCompact=")) replaceRange("function dodCompact(", "function homeV2()", "const dodCompact=(tab,active)=>renderKompasStageChecklist(tab,active,{state:S,realizationLocked,canOpenStage,gateMessage,esc});\n");
if (!source.includes("const render=renderKompasAppShell;")) replaceRange("function render()", "function setByPath(", "const render=renderKompasAppShell;\n");

await writeFile(path, source);
