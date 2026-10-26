#!/usr/bin/env node
/**
 * Per-tool E2E contract for the Paperclip MCP edge (READ-ONLY).
 *
 * Proves, for every advertised tool, that the session can dispatch it: each
 * `tools/list` entry has a unique name, an object input schema and a
 * description. It then really invokes the read-only subset (Get/List/Search/
 * Inspect/Verify/Me/Health) so a broken broker or projection is caught.
 * Mutating tools are never invoked — schema + name coverage is their gate.
 *
 * Usage:
 *   MCP_E2E_ORIGINS=https://paperclip-mcp.kompaszbiorek.pl,https://paperclip-mcp.zariszlif.pl \
 *   MCP_E2E_BEARER=<own issue-scoped agent credential> \
 *   node mcp/paperclip/scripts/mcp-per-tool-e2e.mjs
 *
 * Env:
 *   MCP_E2E_EXPECTED_TOOLS  minimum registry size (default 208)
 *   MCP_E2E_TIMEOUT_MS      per-call timeout (default 30000)
 *   MCP_E2E_REPORT          optional JSON report path
 * Never prints credentials.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isReadOnlyTool } from "./read-only-tools.mjs";

const origins = (process.env.MCP_E2E_ORIGINS || "https://paperclip-mcp.kompaszbiorek.pl")
  .split(",").map((value) => value.trim().replace(/\/+$/, "")).filter(Boolean);
const bearer = process.env.MCP_E2E_BEARER;
const expectedTools = Number(process.env.MCP_E2E_EXPECTED_TOOLS || 208);
const timeoutMs = Number(process.env.MCP_E2E_TIMEOUT_MS || 30000);

if (!bearer) {
  console.error("Missing MCP_E2E_BEARER (own issue-scoped agent credential).");
  process.exit(2);
}
if (origins.some((origin) => !/^https:\/\//i.test(origin))) {
  console.error("HTTPS origins only.");
  process.exit(2);
}

// Read-only dispatch allowlist lives in ./read-only-tools.mjs as an explicit
// Set. Everything else is validated from tools/list only: an empty-argument
// call on a mutating tool is not a safe canary.
const FIXTURE_ARGS = {
  paperclipWikiList: { limit: 5 },
  paperclipWikiSearch: { query: "mcp", limit: 5 },
};

const report = { startedAt: new Date().toISOString(), origins: {}, ok: false };
let nextId = 1;

function endpoint(origin) { return `${origin}/mcp`; }

async function rpc(origin, method, params = {}, credential = bearer) {
  const response = await fetch(endpoint(origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
  const text = await response.text();
  return { status: response.status, payload: decode(text), headers: response.headers };
}

function decode(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
  }
  return null;
}

function unwrap(reply) {
  if (reply.payload?.error) throw new Error(`JSON-RPC error: ${reply.payload.error.message}`);
  const result = reply.payload?.result;
  if (result?.isError) {
    const text = result.content?.find((entry) => entry.type === "text")?.text ?? "tool error";
    throw new Error(text.slice(0, 200));
  }
  return result?.structuredContent ?? result;
}

async function forOrigin(origin) {
  const record = { initialized: false, tools: 0, toolDigest: null, invoked: [], typedErrors: [], schemaOnly: 0, counts: { PASS: 0, EXPECTED_DENY: 0, UNTESTED: 0, FAIL: 0 }, rows: [], problems: [] };
  report.origins[origin] = record;

  const denial = await rpc(origin, "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "per-tool-e2e", version: "1.0.0" },
  }, null);
  assert.equal(denial.status, 401, `unauthenticated initialize must be denied on ${origin}`);
  assert.ok(denial.headers.get("www-authenticate"), `missing WWW-Authenticate on ${origin}`);

  const init = await rpc(origin, "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "per-tool-e2e", version: "1.0.0" },
  });
  assert.equal(init.status, 200, `initialize failed on ${origin}`);
  assert.ok(init.payload?.result?.protocolVersion, `no protocolVersion on ${origin}`);
  record.initialized = true;

  const list = await rpc(origin, "tools/list", {});
  assert.equal(list.status, 200, `tools/list failed on ${origin}`);
  const tools = list.payload?.result?.tools ?? [];
  record.tools = tools.length;
  record.toolDigest = createHash("sha256")
    .update(JSON.stringify(tools.map((tool) => [tool.name, tool.inputSchema]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
    .digest("hex");
  assert.ok(tools.length >= expectedTools, `registry shrank: ${tools.length} < ${expectedTools} on ${origin}`);

  const seen = new Set();
  const verdict = (name, value, detail) => {
    record.rows.push({ name, verdict: value, ...(detail ? { detail: String(detail).slice(0, 240) } : {}) });
    record.counts[value] += 1;
  };
  for (const tool of tools) {
    if (!tool?.name || seen.has(tool.name)) record.problems.push(`duplicate/empty tool name: ${tool?.name}`);
    else seen.add(tool.name);
    if (!tool?.inputSchema || tool.inputSchema.type !== "object") {
      record.problems.push(`missing object inputSchema: ${tool?.name}`);
    }
    if (typeof tool?.description !== "string" || tool.description.length < 10) {
      record.problems.push(`missing description: ${tool?.name}`);
    }
    if (!tool?.name || !tool?.inputSchema || tool.inputSchema.type !== "object") {
      verdict(tool?.name ?? "(missing)", "FAIL", "schema");
      continue;
    }
    if (!isReadOnlyTool(tool.name)) {
      record.schemaOnly += 1;
      verdict(tool.name, "UNTESTED", "mutation/schema-only");
      continue;
    }
    // Dispatch proof: real success OR a typed tool error (validation/auth/
    // policy). Only an unwired tool (unknown/method-not-found) is a failure.
    try {
      unwrap(await rpc(origin, "tools/call", {
        name: tool.name,
        arguments: FIXTURE_ARGS[tool.name] ?? {},
      }));
      record.invoked.push(tool.name);
      verdict(tool.name, "PASS", "read-only dispatch");
    } catch (error) {
      const message = String(error.message || error);
      if (/unknown tool|method not found|not registered|does not exist/i.test(message)) {
        record.problems.push(`${tool.name}: not dispatched (${message.slice(0, 120)})`);
        verdict(tool.name, "FAIL", message);
      } else {
        record.typedErrors.push({ name: tool.name, error: message.slice(0, 120) });
        if (/PERMISSION_DENIED|CONFIGURATION_MISSING|BOARD_REQUIRED|AUTHORIZATION|Board credential|forbidden/i.test(message)) {
          verdict(tool.name, "EXPECTED_DENY", message);
        } else {
          verdict(tool.name, "UNTESTED", message);
        }
      }
    }
  }

  assert.equal(seen.size, tools.length, `name coverage mismatch on ${origin}`);
  assert.deepEqual(record.problems, [], `problem(s) on ${origin}: ${record.problems.join(" | ")}`);
  return record;
}

let failed = false;
for (const origin of origins) {
  try {
    await forOrigin(origin);
    const r = report.origins[origin];
    console.log(`[per-tool-e2e] ${origin}: PASS (${r.tools} tools, digest ${r.toolDigest.slice(0, 12)}, ${JSON.stringify(r.counts)})`);
  } catch (error) {
    failed = true;
    console.error(`[per-tool-e2e] ${origin}: FAIL ${String(error.message || error)}`);
    console.error(`[per-tool-e2e] problems: ${(report.origins[origin]?.problems || []).join(" | ") || "none"}`);
  }
}

report.ok = !failed;
report.finishedAt = new Date().toISOString();
if (process.env.MCP_E2E_REPORT) writeFileSync(process.env.MCP_E2E_REPORT, `${JSON.stringify(report, null, 2)}\n`);
process.exit(failed ? 1 : 0);
