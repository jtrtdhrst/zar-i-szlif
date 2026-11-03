import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startRegistryServer } from "./serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]?.startsWith("--") ? true : values[index + 1]]);
  return pairs;
}, []));
const required = ["name", "type", "source", "title", "description"];
const supportedTypes = new Set(["ui", "component", "block", "shell", "page"]);

for (const key of required) if (!args[key] || args[key] === true) throw new Error(`Wymagany argument: --${key}`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name)) throw new Error("--name musi być kebab-case.");
if (!supportedTypes.has(args.type)) throw new Error("--type musi mieć wartość ui, component, block, shell albo page.");
if (args.type === "page" && (!args.target || args.target === true)) throw new Error("Dla --type page wymagany jest --target.");

const source = path.resolve(root, args.source);
if (!source.startsWith(`${root}${path.sep}`)) throw new Error("--source musi wskazywać plik w repozytorium.");
const category = args.category || ({ ui: "ui", component: "components", block: "blocks", shell: "shells", page: "pages" }[args.type]);
if (!new Set(["ui", "components", "blocks", "shells", "pages"]).has(category)) throw new Error("--category ma nieprawidłową wartość.");
const registryDir = path.join(root, "registry", "kompas", category);
const registryPath = path.join(registryDir, "registry.json");
const extension = path.extname(source);
const destination = path.join(registryDir, `${args.name}${extension}`);
const storyPath = path.join(registryDir, `${args.name}.stories.js`);
const sourceCode = await readFile(source, "utf8");

async function registryItems(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await registryItems(entryPath));
    if (entry.name === "registry.json") result.push(...(JSON.parse(await readFile(entryPath, "utf8")).items || []));
  }
  return result;
}

async function registrySourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await registrySourceFiles(entryPath));
    if (entry.isFile() && entry.name !== "registry.json") result.push(entryPath);
  }
  return result;
}

const existing = await registryItems(path.join(root, "registry", "kompas"));
const existingItem = existing.find((item) => item.name === args.name);
let update = false;
if (existingItem) {
  try {
    update = await readFile(destination, "utf8") === sourceCode;
  } catch {}
  if (!update) throw new Error(`Nazwa @kompas/${args.name} jest już przypisana do innego źródła.`);
} else {
  for (const file of await registrySourceFiles(path.join(root, "registry", "kompas"))) {
    if (await readFile(file, "utf8") === sourceCode) throw new Error(`Źródło jest już promowane jako ${path.relative(root, file)}.`);
  }
}
await mkdir(registryDir, { recursive: true });
if (!update && source !== destination) await cp(source, destination, { force: false, errorOnExist: true });

let registry = { $schema: "https://ui.shadcn.com/schema/registry.json", items: [] };
try { registry = JSON.parse(await readFile(registryPath, "utf8")); } catch {}
const code = await readFile(destination, "utf8");
const imports = [...code.matchAll(/(?:from\s*|require\()["']([^"']+)["']/g)].map((match) => match[1]);
const dependencies = [...new Set(imports.filter((item) => !item.startsWith(".") && !item.startsWith("@kompas/")))];
const registryDependencies = [...new Set(imports.filter((item) => item.startsWith("@kompas/")))];
const registryType = args.type === "shell" ? "component" : args.type;
const file = { path: path.basename(destination), type: `registry:${registryType}` };
if (args.type === "page") file.target = args.target;
const item = {
  name: args.name,
  type: `registry:${registryType}`,
  title: args.title,
  description: args.description,
  categories: [category],
  dependencies,
  registryDependencies,
  meta: {
    purpose: args.purpose || args.description,
    recommendedUsage: args.usage || "Sprawdź API i zależności elementu przed użyciem.",
    responsiveBehavior: args.responsive || "Wymaga niezależnej walidacji browser/UI QA przed oznaczeniem jako VERIFIED.",
    states: args.states || "Zdefiniowane przez implementację źródłową.",
    source: path.relative(root, destination).replaceAll("\\", "/")
  },
  files: [file]
};
registry.items = registry.items.filter((candidate) => candidate.name !== args.name);
registry.items.push(item);
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

if (["ui", "component", "block", "shell", "page"].includes(args.type) && extension === ".js") {
  try {
    await readFile(storyPath, "utf8");
  } catch {
    if (!args["story-render"] || !args["story-args"]) throw new Error("Nowy wizualny element wymaga --story-render i --story-args, aby wygenerować prawdziwy Storybook story bez zgadywania API.");
    const storyArgs = JSON.parse(args["story-args"]);
    if (!storyArgs || typeof storyArgs !== "object" || Array.isArray(storyArgs)) throw new Error("--story-args musi być obiektem JSON.");
    await writeFile(storyPath, `import { ${args["story-render"]} } from "./${args.name}${extension}";\n\nexport default { title: "Kompas/${category}/${args.title}", tags: ["autodocs"], render: () => ${args["story-render"]}(${JSON.stringify(storyArgs)}) };\n\nexport const Default = {};\n`);
  }
}

function run(command, commandArgs) {
  if (process.platform === "win32" && command === "pnpm") {
    const pnpmCli = path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs");
    execFileSync(process.execPath, [pnpmCli, ...commandArgs], { cwd: root, stdio: "inherit" });
    return;
  }
  execFileSync(command, commandArgs, { cwd: root, stdio: "inherit" });
}

function runAsync(command, commandArgs) {
  const executable = process.platform === "win32" && command === "pnpm" ? process.execPath : command;
  const args = process.platform === "win32" && command === "pnpm"
    ? [path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs"), ...commandArgs]
    : commandArgs;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} zakończył się kodem ${code}.`)));
  });
}

run("pnpm", ["exec", "shadcn", "registry", "validate", "registry.json"]);
run("pnpm", ["exec", "shadcn", "build", "registry.json", "--output", "registry-dist/r"]);
run("pnpm", ["build-storybook"]);
run("pnpm", ["--dir", "app", "run", "test:all"]);

const temporaryProject = path.join(root, ".tmp-ui-registry-consumer");
await rm(temporaryProject, { recursive: true, force: true });
await mkdir(temporaryProject, { recursive: true });
await writeFile(path.join(temporaryProject, "components.json"), JSON.stringify({
  $schema: "https://ui.shadcn.com/schema.json",
  style: "base-nova",
  rsc: false,
  tsx: false,
  tailwind: { config: "", css: "styles.css", baseColor: "zinc", cssVariables: true, prefix: "" },
  aliases: { components: "@/components", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks", utils: "@/lib/utils" }
}, null, 2));
await writeFile(path.join(temporaryProject, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2));
const server = await startRegistryServer({ port: 4174 });
try {
  await runAsync("pnpm", ["exec", "shadcn", "add", `http://127.0.0.1:4174/r/${args.name}.json`, "--dry-run", "--yes", "--cwd", temporaryProject]);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryProject, { recursive: true, force: true });
}

console.log("Registry promotion checks PASS. Browser/responsive acceptance pozostaje niezależnym krokiem UI QA przed VERIFIED.");
