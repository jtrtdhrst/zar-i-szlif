import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
await mkdir("web/dist", { recursive: true });
const runtimeParts = [
  "../registry/kompas/ui/kompas-button.js",
  "../registry/kompas/components/brand-header.js",
  "../registry/kompas/blocks/stage-checklist.js",
  "../registry/kompas/shells/app-shell.js"
];
const [baseCss, extraCss, app, ...runtime] = await Promise.all([
  readFile("web/src/styles.css", "utf8"),
  readFile("web/src/extended.css", "utf8"),
  readFile("web/src/static-app-v2.js", "utf8"),
  ...runtimeParts.map((path) => readFile(path, "utf8"))
]);
const css = baseCss + extraCss;
const registryRuntime = runtime.join("\n").replace(/^export /gm, "");
const applicationRuntime = app.replace("__SKILL_ICON_ASSETS__", "{}");
await writeFile("web/dist/index.html", `<!doctype html><html lang="pl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Kompas Zbiórek</title><style>${css}</style></head><body><div id="root"></div><script>${registryRuntime}\n${applicationRuntime}</script></body></html>`);
await copyFile("web/public/kompas-logo.png", "web/dist/kompas-logo.png");

// Isolated Plasmic MCP smoke route. Never replace the application's /login route.
await mkdir('web/dist/mcp-smoke/login', { recursive: true });
await copyFile('web/public/mcp-smoke/login/index.html', 'web/dist/mcp-smoke/login/index.html');
