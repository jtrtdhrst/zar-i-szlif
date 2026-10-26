#!/usr/bin/env node
// Health-check publicznych endpointów MCP (Cloudflare Workers).
//
// Sprawdza, czy każdy endpoint odpowiada. Nie wymaga sekretów: poprawny
// endpoint MCP odpowiada 401 (wymaga Bearer) albo 200 — oba dowodzą, że
// Worker żyje i trasuje do silnika. Pełną funkcjonalność (tools/list z
// tokenem) sprawdzają health-checki połączeń w Paperclipie.
//
// usage: node scripts/check-mcp-endpoints.mjs [--json]
const ENDPOINTS = [
  ["mantic-mcp", "https://mantic-mcp.zariszlif.pl/mcp"],
  ["qdrant-mcp", "https://qdrant-mcp.zariszlif.pl/mcp"],
  ["supabase-mcp", "https://supabase-mcp.zariszlif.pl/mcp"],
  ["ubuntu-mcp", "https://ubuntu-mcp.zariszlif.pl/mcp"],
  ["penpot-mcp", "https://penpot-mcp.zariszlif.pl/mcp/stream"],
  ["plasmic-mcp", "https://plasmic-mcp.zariszlif.pl/mcp"],
  ["paperclip-mcp", "https://paperclip-mcp.zariszlif.pl/mcp"],
  ["emailens-mcp", "https://emailens-mcp.zariszlif.pl/mcp"],
  ["langfuse-mcp", "https://langfuse-mcp.zariszlif.pl/api/public/mcp"],
  ["comfy-mcp", "https://mcp-comfy.kompaszbiorek.pl/mcp"],
];

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "repo-health-check", version: "1.0" },
  },
};

async function probe(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INIT),
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Date.now() - started;
    // 401 = Worker żyje i pilnuje tokena; 200 = odpowiada; inne = problem.
    const ok = res.status === 200 || res.status === 401;
    return { name, url, status: res.status, ok, ms, error: ok ? null : `http ${res.status}` };
  } catch (error) {
    return { name, url, status: 0, ok: false, ms: Date.now() - started, error: String(error?.message || error) };
  }
}

const results = [];
for (const [name, url] of ENDPOINTS) results.push(await probe(name, url));

const broken = results.filter((r) => !r.ok);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ results, ok: broken.length === 0 }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(15)} ${String(r.status).padEnd(4)} ${r.ms}ms ${r.error || ""}`);
  }
  console.log(`\n${results.length - broken.length}/${results.length} endpointów odpowiada poprawnie`);
}
process.exit(broken.length === 0 ? 0 : 1);
