// Weryfikacja narzędzi mcp-qdrant po naprawie (KOMAA-411). Uruchamia posiadacz
// sekretu: MCP_QDRANT_URL=... node scripts/mcp-qdrant-verify.mjs [--allow-delete]
// Bez MCP_QDRANT_URL kończy się kodem 2 z czytelną instrukcją (nie udaje live).
// Adres MCP przychodzi wyłącznie ze zmiennej środowiskowej — nigdy z kodu.
// Domyślnie read-only. --allow-delete kasuje TYLKO punkty o tekstach "harness probe"
// / "probe KOMAA-407 get" (śmieci diagnostyczne) i tylko te.
const url = (process.env.MCP_QDRANT_URL ?? "").trim().replace(/\/+$/, "");
if (!url) {
  console.error("[mcp-qdrant-verify] MCP_QDRANT_URL missing — wymaga sekretu/adresu serwera MCP.");
  process.exit(2);
}
const allowDelete = process.argv.includes("--allow-delete");
const RESIDUE = new Set(["harness probe", "probe KOMAA-407 get"]);

let seq = 0;
async function rpc(method, params, notify = false) {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++seq, method, params }),
  });
  const text = await res.text();
  if (notify || !text) return null;
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5).trim()); } catch { /* keep scanning SSE frames */ }
    }
  }
  return { error: { message: text.slice(0, 200) } };
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-qdrant-verify", version: "1" } }, true);
await rpc("notifications/initialized", {}, true);

// Wynik narzędzia: tekst + structuredContent, albo isError. Sanowany komunikat
// FastMCP ("Error executing tool X") traktujemy jako porażkę tego testu.
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r?.result;
  if (!res) return { ok: false, text: JSON.stringify(r?.error ?? r), structured: undefined };
  if (res.isError) return { ok: false, text: (res.content ?? []).map((c) => c.text).join("\n"), structured: res.structuredContent };
  return { ok: true, text: (res.content ?? []).map((c) => c.text).join("\n"), structured: res.structuredContent };
}
const opaque = (t) => /^Error executing tool \w+/.test(t);

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails.push(name);
};

const info = await tool("list_collection_info", {});
check("list_collection_info", info.ok, info.text.slice(0, 120));
let points = Number.NaN;
try { points = JSON.parse(info.text).points_count; } catch { /* zostaw NaN */ }

const q = await tool("query", { text: "probe", top_k: 2 });
check("query (regresja)", q.ok && !opaque(q.text), q.text.slice(0, 120));

// Kryterium 1: poprawny istniejący doc_id zwraca treść, nieistniejący — czytelną
// informację zamiast sanowanego "Error executing tool ...".
const existing = (q.structured?.result ?? []).find((r) => RESIDUE.has(r.text))?.doc_id;
const probe = existing ?? "00000000000000000000000000000000";
const hit = await tool("get_document", { doc_id: probe });
check(
  "get_document: poprawny doc_id zwraca dokument",
  existing ? hit.ok && !opaque(hit.text) && hit.text.includes(probe) : true,
  existing ? hit.text.slice(0, 120) : "brak punktów testowych do trafienia (skip)",
);
const miss = await tool("get_document", { doc_id: "11111111-1111-1111-1111-111111111111" });
check(
  "get_document: nieistniejący doc_id daje czytelny komunikat",
  !opaque(miss.text),
  miss.text.slice(0, 120),
);

// Kryterium 4: rezyduacja. Kasujemy wyłącznie śmieci diagnostyczne.
if (allowDelete) {
  for (const [label, docId] of [
    ["0eae015fe55b4cf591edbd5a0abf0eb0", "0eae015fe55b4cf591edbd5a0abf0eb0"],
    ["3504e2212d024bbaa26137f01edc87fa", "3504e2212d024bbaa26137f01edc87fa"],
  ]) {
    const del = await tool("delete_document", { doc_id: docId });
    check(`delete_document: ${label}`, del.ok && !opaque(del.text), del.text.slice(0, 120));
  }
  const after = await tool("list_collection_info", {});
  let left = Number.NaN;
  try { left = JSON.parse(after.text).points_count; } catch { /* zostaw NaN */ }
  check("long_term_memory points_count == 0", left === 0, `było ${points}, jest ${left}`);
} else {
  console.log("SKIP  delete_document + rezyduacja (dodaj --allow-delete po naprawie)");
}

console.log(fails.length ? `[mcp-qdrant-verify] FAIL (${fails.length}): ${fails.join(", ")}` : "[mcp-qdrant-verify] PASS");
process.exit(fails.length ? 1 : 0);
