import http from "node:http";

// The retired hostname is a transport alias only. Authentication and tools are
// owned exclusively by the canonical OAuth gateway on port 3103.
const port = Number(process.env.PORT || 3102);
const canonicalPort = Number(process.env.PAPERCLIP_MCP_CANONICAL_PORT || 3103);
const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function headers(input) {
  return Object.fromEntries(Object.entries(input).filter(([name]) => !hopByHop.has(name.toLowerCase()) && name.toLowerCase() !== "host"));
}

const server = http.createServer((request, response) => {
  if (request.url === "/health" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, aliasFor: "https://mcp.kompaszbiorek.pl/mcp" }));
    return;
  }
  if (request.url !== "/mcp" || request.method !== "POST") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const upstream = http.request({ host: "127.0.0.1", port: canonicalPort, path: "/mcp", method: "POST", headers: { ...headers(request.headers), host: `127.0.0.1:${canonicalPort}` } }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, headers(upstreamResponse.headers));
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Canonical MCP unavailable" }));
    } else response.destroy();
  });
  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => console.log(`[paperclip-mcp-alias] http://127.0.0.1:${port}/mcp -> ${canonicalPort}`));
