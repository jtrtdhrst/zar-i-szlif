import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import worker from "./src/index.ts";
import { resolveService } from "./coolify-routing.mjs";

const port = Number(process.env.PORT || 8787);
const maxBody = 12 * 1024 * 1024;
// Read-back fingerprint of exactly the sources packaged into the running image.
// This is an artifact fingerprint, NOT a Docker image digest or Git commit SHA.
const sourceFiles = ["./coolify-server.mjs", "./coolify-routing.mjs", "./src/index.ts"];
const artifactSha256 = createHash("sha256")
  .update(sourceFiles.map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n--mcp-edge--\n"))
  .digest("hex");
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/healthz") {
      res.writeHead(200, {"content-type":"application/json", "cache-control":"no-store"});
      res.end(JSON.stringify({ ok: true, artifactSha256 }));
      return;
    }
    const service = resolveService(req.headers.host);
    if (service.error) {
      const status = service.error === "unknown_host" ? 404 : 503;
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: service.error }));
      return;
    }
    // Trust only the Host validated by resolveService. Don't trust client-controlled X-Forwarded-*.
    const proto = "https";
    const url = new URL(req.url || "/", proto + "://" + req.headers.host);
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > maxBody) {
          res.writeHead(413);
          res.end("Request too large");
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const headers = new Headers();
    // Never forward arbitrary inbound headers to privileged upstreams.
    for (const key of ["authorization", "content-type", "accept", "mcp-session-id",
                       "mcp-protocol-version", "x-paperclip-board-api-key", "x-paperclip-run-id"]) {
      if (req.headers[key]) headers.set(key, String(req.headers[key]));
    }
    const request = new Request(url, { method: req.method, headers, body, redirect: "manual" });
    const upstream = await worker.fetch(request, service.config);
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (["content-type", "mcp-session-id", "mcp-protocol-version", "location",
           "www-authenticate", "cache-control", "allow"].includes(key)) responseHeaders[key] = value;
    });
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body && req.method !== "HEAD") {
      Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
    } else res.end();
  } catch (err) {
    console.error("mcp-edge request failed:", err instanceof Error ? err.name : "unknown");
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: "gateway_error" }));
  }
});
server.listen(port, "0.0.0.0", () => console.log("coolify-mcp-edge listening on", port));
process.on("SIGTERM", () => server.close());
