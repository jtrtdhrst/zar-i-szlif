import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
await mkdir("web/dist", { recursive: true });
const [baseCss, extraCss, app] = await Promise.all([readFile("web/src/styles.css", "utf8"), readFile("web/src/extended.css", "utf8"), readFile("web/src/static-app-v2.js", "utf8")]);
const css = baseCss + extraCss;
await writeFile("web/dist/index.html", `<!doctype html><html lang="pl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${app}</script></body></html>`);
await copyFile("web/public/kompas-logo.png", "web/dist/kompas-logo.png");
