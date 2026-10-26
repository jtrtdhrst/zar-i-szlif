#!/usr/bin/env node
// E2E narzędzi MCP: initialize -> tools/list -> tools/call (jedno read-only).
//
// Tokeny z env: MCP_TOKEN_<USLUGA> (np. MCP_TOKEN_QDRANT, MCP_TOKEN_MANTIC).
// Brak tokenu = test tylko liveness (oczekiwane 401 — Worker żyje i pilnuje
// tokena). Narzędzie do wywołania można nadpisać: MCP_TOOL_<USLUGA>.
//
// usage: node scripts/test-mcp-tools.mjs [--json]
const SERVICES = [
  { name: "mantic", url: "https://mantic-mcp.zariszlif.pl/mcp", tool: "list_campaigns" },
  { name: "qdrant", url: "https://qdrant-mcp.zariszlif.pl/mcp", tool: "list_collection_info" },
  { name: "supabase", url: "https://supabase-mcp.zariszlif.pl/mcp", tool: "list_tables" },
  { name: "ubuntu", url: "https://ubuntu-mcp.zariszlif.pl/mcp", tool: "ssh_list_servers" },
  { name: "penpot", url: "https://penpot-mcp.zariszlif.pl/mcp/stream", tool: "penpot_list_teams" },
  { name: "plasmic", url: "https://plasmic-mcp.zariszlif.pl/mcp" },
  { name: "paperclip", url: "https://paperclip-mcp.zariszlif.pl/mcp" },
  { name: "emailens", url: "https://emailens-mcp.zariszlif.pl/mcp", tool: "list_clients" },
  { name: "langfuse", url: "https://langfuse-mcp.zariszlif.pl/api/public/mcp", tool: "listPrompts" },
  { name: "comfy", url: "https://mcp-comfy.kompaszbiorek.pl/mcp" },
];

const envName = (service) => `MCP_TOKEN_${service.toUpperCase()}`;

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const line = text.split("\n").reverse().find((l) => l.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : null;
  }
}

async function rpc(url, token, payload) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, data: parse(await res.text()) };
}

async function test(service) {
  const token = process.env[envName(service.name)] ?? "";
  const tool = process.env[`MCP_TOOL_${service.name.toUpperCase()}`] ?? service.tool;
  const started = Date.now();
  const out = { name: service.name, token: Boolean(token), status: 0, ok: false };

  const init = await rpc(service.url, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-mcp-tools", version: "1" } },
  });
  out.status = init.status;

  if (!token) {
    // Bez tokenu poprawny Worker odpowiada 401; 200 = endpoint otwarty.
    out.ok = init.status === 200 || init.status === 401;
    out.mode = "liveness";
    out.detail = init.status === 401 ? "401 (token wymagany)" : `200 otwarty (${init.data?.result?.serverInfo?.name ?? "?"})`;
    out.ms = Date.now() - started;
    return out;
  }

  if (init.status !== 200 || !init.data?.result) {
    out.detail = `initialize ${init.status}: ${JSON.stringify(init.data).slice(0, 120)}`;
    out.ms = Date.now() - started;
    return out;
  }
  out.mode = "tools";
  out.server = init.data.result.serverInfo?.name;

  const list = await rpc(service.url, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = list.data?.result?.tools ?? [];
  out.tools = tools.length;

  if (!tool || !tools.some((t) => t.name === tool)) {
    out.ok = tools.length > 0;
    out.detail = tool ? `${tool}: brak w liście` : "brak wywołania (skan)";
    out.ms = Date.now() - started;
    return out;
  }

  const call = await rpc(service.url, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: tool, arguments: {} },
  });
  const result = call.data?.result;
  const text = (result?.content ?? []).map((c) => c.text ?? "").join(" ");
  out.ok = call.status === 200 && !result?.isError;
  out.call = tool;
  out.detail = out.ok
    ? text.replace(/\s+/g, " ").slice(0, 100)
    : `${call.status}: ${text.replace(/\s+/g, " ").slice(0, 100)}`;
  out.ms = Date.now() - started;
  return out;
}

const results = [];
for (const service of SERVICES) {
  try {
    results.push(await test(service));
  } catch (error) {
    results.push({ name: service.name, ok: false, detail: String(error?.message || error) });
  }
}

const failed = results.filter((r) => !r.ok);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    const mode = r.mode === "tools" ? `${r.tools ?? 0} tools` : "liveness";
    console.log(`${icon} ${r.name.padEnd(10)} ${mode.padEnd(12)} ${r.ms ?? 0}ms  ${r.detail ?? ""}`);
  }
  console.log(failed.length ? `\n${failed.length} usług z błędem` : "\nwszystkie sprawdzone usługi OK");
}
process.exit(failed.length ? 1 : 0);
