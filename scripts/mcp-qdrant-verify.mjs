// Weryfikacja narzędzi mcp-qdrant (KOMAA-411).
// MCP_QDRANT_URL=... node scripts/mcp-qdrant-verify.mjs [--allow-delete]
// Bez MCP_QDRANT_URL kończy się kodem 2 z czytelną instrukcją (nie udaje live).
// Adres MCP przychodzi wyłącznie ze zmiennej środowiskowej — nigdy z kodu.
//
// Skrypt zasiewa WŁASNY punkt próbny, sprawdza kryteria 1–4 i sprząta go w
// `finally`, więc działa na pustej kolekcji (śmieci diagnostyczne z poprzednich
// runów już usunięte — nie można na nich polegać jako na danych testowych).
// --allow-delete próbuje dodatkowo skasować dwa znane śmieci diagnostyczne
// (nieobecne => `false`, co jest sukcesem: brak rezyduacji).
const url = (process.env.MCP_QDRANT_URL ?? "").trim().replace(/\/+$/, "");
if (!url) {
  console.error("[mcp-qdrant-verify] MCP_QDRANT_URL missing — wymaga sekretu/adresu serwera MCP.");
  process.exit(2);
}
const allowDelete = process.argv.includes("--allow-delete");
const RESIDUE = [
  ["0eae015fe55b4cf591edbd5a0abf0eb0", "0eae015fe55b4cf591edbd5a0abf0eb0"],
  ["3504e2212d024bbaa26137f01edc87fa", "3504e2212d024bbaa26137f01edc87fa"],
];
const PROBE_TEXT = `KOMAA-411 acceptance probe ${process.pid}`;
// Adres klastra nie może wyciec w treści odpowiedzi narzędzia.
const host = (() => { try { return new URL(url).host; } catch { return ""; } })();

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
  const text = (res?.content ?? []).map((c) => c.text).join("\n");
  if (!res) return { ok: false, text: JSON.stringify(r?.error ?? r), structured: undefined };
  return { ok: !res.isError, text, structured: res.structuredContent };
}
// FastMCP sanitizuje wyjątki poza ToolError do gołego `Error executing tool <name>`
// (bez sufiksu `: {przyczyna}`). Ten sam prefiks ma jednak czytelny komunikat
// `Error executing tool get_document: document '…' not found` — odróżnia go
// wyłącznie obecność przyczyny po nazwie narzędzia.
const opaque = (t) => /^Error executing tool \w+\s*$/.test(t.trim());
const leaks = (t) => Boolean(host) && t.includes(host);

const fails = [];
const known = [];
let lastErrorText = "";
const check = (name, cond, detail, bucket = fails) => {
  console.log(`${cond ? "PASS" : bucket === known ? "WARN" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) bucket.push(name);
};

const count = async () => {
  const info = await tool("list_collection_info", {});
  try { return Number(JSON.parse(info.text).points_count); } catch { return Number.NaN; }
};

const baseline = await count();
const seed = await tool("insert_document", { text: PROBE_TEXT, metadata: { probe: "komaa-411" } });
const docId = seed.ok ? seed.structured?.result : undefined;
check("insert_document: punkt próbny zasiany", Boolean(docId), seed.text.slice(0, 120));

try {
  if (docId) {
    // Kryterium 1: istniejący doc_id zwraca treść; query bez regresji.
    const q = await tool("query", { text: PROBE_TEXT, top_k: 3 });
    check("query (regresja)", q.ok && !opaque(q.text) && q.text.includes(docId), q.text.slice(0, 120));
    const hit = await tool("get_document", { doc_id: docId });
    check("get_document: istniejący doc_id zwraca dokument", hit.ok && !opaque(hit.text) && hit.text.includes(docId), hit.text.slice(0, 120));

    const del = await tool("delete_document", { doc_id: docId });
    check("delete_document: istniejący doc_id usunięty", del.ok && !opaque(del.text) && del.text.trim() === "true", del.text.slice(0, 120));
    const gone = await tool("get_document", { doc_id: docId });
    lastErrorText = gone.text;
    check(
      "get_document: po delete czytelny not-found",
      !opaque(gone.text) && /not found/i.test(gone.text),
      gone.text.slice(0, 120),
    );
    const again = await tool("delete_document", { doc_id: docId });
    check("delete_document: powtórka idempotentna (false)", again.ok && again.text.trim() === "false", again.text.slice(0, 120));
  }

  // Kryterium 2: nieistniejący doc_id daje czytelny komunikat, nie sanowany błąd.
  const miss = await tool("get_document", { doc_id: "11111111-1111-1111-1111-111111111111" });
  check("get_document: nieistniejący doc_id daje czytelny komunikat", !opaque(miss.text) && /not found/i.test(miss.text), miss.text.slice(0, 120));
  const missDel = await tool("delete_document", { doc_id: "11111111-1111-1111-1111-111111111111" });
  check("delete_document: nieistniejący doc_id → false", missDel.ok && missDel.text.trim() === "false", missDel.text.slice(0, 120));

  // Kryterium 3: adres klastra nie wycieka w odpowiedzi narzędzia.
  check("brak wycieku adresu klastra", !leaks(miss.text) && !leaks(lastErrorText), host || "brak hosta w URL");

  // Znany defekt obrazu serwera: query na PUSTEJ kolekcji rzuca zamiast zwrócić [].
  // Nie da się tego naprawić z repo produktu — raportujemy, nie zielonymy.
  const emptyQ = await tool("query", { text: PROBE_TEXT, top_k: 3 });
  check(
    "query: pusta kolekcja zwraca [] (znany defekt serwera)",
    emptyQ.ok && Array.isArray(emptyQ.structured?.result) && emptyQ.structured.result.length === 0,
    emptyQ.text.slice(0, 120),
    known,
  );

  // Kryterium 4: rezyduacja. Kasujemy wyłącznie śmieci diagnostyczne.
  if (allowDelete) {
    for (const [, id] of RESIDUE) {
      const d = await tool("delete_document", { doc_id: id });
      check(`delete_document: śmieć ${id} usunięty lub nieobecny`, d.ok && !opaque(d.text) && ["true", "false"].includes(d.text.trim()), d.text.slice(0, 120));
    }
  } else {
    console.log("SKIP  sprzątanie rezyduacji (dodaj --allow-delete)");
  }
} finally {
  if (docId) await tool("delete_document", { doc_id: docId });
  const left = await count();
  check("long_term_memory wróciło do baseline", left === baseline, `baseline ${baseline}, jest ${left}`);
}

console.log(
  [
    fails.length ? `FAIL (${fails.length}): ${fails.join(", ")}` : null,
    known.length ? `znane defety serwera (${known.length}): ${known.join(", ")}` : null,
  ].filter(Boolean).join(" | ") || `[mcp-qdrant-verify] PASS`,
);
process.exit(fails.length ? 1 : 0);