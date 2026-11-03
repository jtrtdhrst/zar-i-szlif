import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function startRegistryServer({ port = 4173 } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const name = url.pathname === "/r/registry.json" ? "registry" : /^\/r\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
    if (!name) {
      response.writeHead(404).end();
      return;
    }

    const artifact = path.join(root, "registry-dist", "r", `${name}.json`);
    try {
      await access(artifact, constants.R_OK);
      response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(await readFile(artifact));
    } catch {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "Registry item not found." }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex === -1 ? 4173 : Number(process.argv[portIndex + 1]);
  const server = await startRegistryServer({ port });
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
