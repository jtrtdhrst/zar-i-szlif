import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const css = await readFile("src/styles.css", "utf8");
await writeFile("dist/index.html", `<!doctype html><html lang="pl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
await copyFile("public/kompas-logo.png", "dist/kompas-logo.png");
