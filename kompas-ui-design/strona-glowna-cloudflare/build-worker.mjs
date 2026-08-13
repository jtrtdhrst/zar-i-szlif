import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

const escaped = html
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

const worker = `const HOME_URL = "https://kompaszbiorek.pl/";

const PAGE = \`${escaped}\`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return new Response(\`User-agent: *\nAllow: /\nSitemap: \${HOME_URL}\n\`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  },
};
`;

writeFileSync(join(here, "worker.js"), worker, "utf8");
console.log("worker.js written:", worker.length, "bytes");
