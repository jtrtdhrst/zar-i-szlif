import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4098";
const here = path.dirname(fileURLToPath(import.meta.url));
const documentation = fs.readFileSync(path.join(here, "..", "documentation.md"), "utf8");
const registryPath = path.join(here, ".runtime", "ctb-runs.json");
const registrySnapshot = () => fs.existsSync(registryPath) ? fs.readFileSync(registryPath, "utf8") : null;
const runRegistrySnapshot = () => {
  const registry = JSON.parse(registrySnapshot() || '{"runs":{}}');
  return JSON.stringify(registry.runs || registry);
};
const credentials = Object.fromEntries(
  fs.readFileSync(path.join(here, ".runtime", "credentials.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/=(.*)/, 2)),
);

async function rpc(token, sessionId, id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return { sessionId: response.headers.get("mcp-session-id") || sessionId, body: await response.json() };
}

const health = await fetch(`${base}/health`);
assert.equal(health.status, 200);
const healthBody = await health.json();
assert.equal(healthBody.engine, "AlaeddineMessadi/opencode-mcp@1.11.0");

const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
assert.equal(metadata.status, 200);
const protectedResource = await metadata.json();
assert.deepEqual(protectedResource.scopes_supported, ["opencode:read", "opencode:session", "opencode:ctb:execute", "opencode:admin", "opencode:write", "mcp:read", "mcp:write", "offline_access"]);

const redirectUri = "http://127.0.0.1/callback";
const registration = await fetch(`${base}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "OpenCode CTB smoke test", redirect_uris: [redirectUri] }),
});
assert.equal(registration.status, 201);
const client = await registration.json();
const verifier = crypto.randomBytes(48).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(`${base}/oauth/authorize`);
authorize.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  resource: protectedResource.resource,
  scope: "offline_access mcp:read mcp:write",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "ctb-smoke-test",
}).toString();
const authResponse = await fetch(authorize, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: credentials.username, password: credentials.password }),
  redirect: "manual",
});
assert.equal(authResponse.status, 302);
const code = new URL(authResponse.headers.get("location")).searchParams.get("code");
assert.ok(code);
const tokenResponse = await fetch(`${base}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }),
});
assert.equal(tokenResponse.status, 200);
const token = await tokenResponse.json();

let response = await rpc(token.access_token, null, 1, "initialize", { protocolVersion: "2025-03-26" });
assert.equal(response.body.result.serverInfo.name, "kompas-opencode-ctb");
assert.ok(response.sessionId);
const sessionId = response.sessionId;
response = await rpc(token.access_token, sessionId, 2, "tools/list");
assert.ok(response.body.result.tools, JSON.stringify(response.body));
const names = response.body.result.tools.map((tool) => tool.name);
// Public surface is intentionally slim; only the explicitly documented execution
// aliases are exposed, while compatibility aliases and redundant getters stay hidden.
const ALIASES = ["opencode_list_runs", "opencode_get_run", "opencode_read_logs", "opencode_get_diff", "opencode_list_agents", "opencode_run_prompt", "opencode_continue_run", "opencode_abort_run"];
const REDUNDANT_GETTERS = ["paperclipGetRunMetrics", "paperclipGetRunEvents", "paperclipGetRunTokenUsage", "paperclipGetRunSteps", "paperclipGetRunContextBreakdown", "paperclipGetRunModelTurns", "opencode_ctb_get_events", "opencode_ctb_get_metrics"];
for (const leaked of [...ALIASES, ...REDUNDANT_GETTERS]) assert.ok(!names.includes(leaked), `${leaked} leaked into eager schema`);
assert.ok(names.length >= 20 && names.length <= 45, `expected slim canonical surface, received ${names.length}`);
assert.ok(names.includes("opencode_ask"));
assert.ok(names.includes("opencode_list_skills"));
assert.ok(names.includes("opencode_run_inspect"));
const LIFECYCLE_TOOLS = ["opencode_execution_start", "opencode_execution_get", "opencode_execution_status", "opencode_execution_abort"];
for (const toolName of LIFECYCLE_TOOLS) assert.ok(names.includes(toolName), `${toolName} missing from public tools/list`);
for (const toolName of LIFECYCLE_TOOLS) assert.match(documentation, new RegExp(`\\b${toolName}\\b`), `${toolName} is public but undocumented`);
const ask = response.body.result.tools.find((tool) => tool.name === "opencode_ask");
assert.equal(ask._meta.kompas.toolClass, "WRITE");
assert.ok(ask.inputSchema.properties.ctb);
response = await rpc(token.access_token, sessionId, 3, "resources/list");
assert.ok(response.body.result.resources.length >= 10);
response = await rpc(token.access_token, sessionId, 4, "prompts/list");
assert.ok(response.body.result.prompts.length >= 6);
response = await rpc(token.access_token, sessionId, 41, "skills/list");
assert.equal(response.body.result.skills.length, 6);
response = await rpc(token.access_token, sessionId, 42, "skills/get", { name: "ctb-intake" });
assert.equal(response.body.result.name, "ctb-intake");
response = await rpc(token.access_token, sessionId, 5, "tools/call", { name: "opencode_list_skills", arguments: {} });
assert.ok(response.body.result.structuredContent.skills.length >= 6);
const beforeReadRegistry = registrySnapshot();
response = await rpc(token.access_token, sessionId, 51, "tools/call", { name: "opencode_context", arguments: { directory: "C:\\Kompas Zbiórek", ctb: { mode: "DIAGNOSE", changeClass: "ctb" } } });
assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body));
response = await rpc(token.access_token, sessionId, 52, "tools/call", { name: "opencode_context", arguments: { directory: "C:\\Kompas Zbiórek", ctb: { mode: "PLAN", changeClass: "ctb" } } });
assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body));
assert.equal(registrySnapshot(), beforeReadRegistry, "DIAGNOSE and PLAN reads must not mutate the CTB registry");
response = await rpc(token.access_token, sessionId, 53, "tools/call", { name: "opencode_ask", arguments: { prompt: "Zmień copy przycisku dashboardu produktu." } });
assert.equal(response.body.result.structuredContent.handoffTo, "PRODUCT_DELIVERY");
response = await rpc(token.access_token, sessionId, 54, "tools/call", { name: "opencode_ask", arguments: { prompt: "Engineer robi za dużo searchy. Popraw jego bieżący skill." } });
assert.equal(response.body.result.structuredContent.handoffTo, "Paperclip");
response = await rpc(token.access_token, sessionId, 6, "tools/call", { name: "opencode_ask", arguments: { prompt: "This must not execute." } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_INTAKE_REQUIRED");
response = await rpc(token.access_token, sessionId, 7, "tools/call", { name: "opencode_config_update", arguments: { config: {}, ctb: { mode: "EXECUTE", changeClass: "ctb", paperclipIssueId: "missing", changeIntent: "test", scope: "test", acceptanceCriteria: "test", idempotencyKey: "test" } } });
assert.equal(response.body.result.structuredContent.errorCode, "INSUFFICIENT_SCOPE");
response = await rpc(token.access_token, sessionId, 8, "tools/call", { name: "opencode_context", arguments: { directory: "C:\\Windows" } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_PROJECT_DENIED");

// Metadata consistency: exposed tool class metadata must match the policy classification exactly.
{
  const { classifyTool } = await import("./ctb-policy.mjs");
  const tools = (await rpc(token.access_token, sessionId, 71, "tools/list")).body.result.tools;
  let checked = 0;
  for (const tool of tools) {
    const expected = classifyTool(tool.name);
    if (!expected) continue; // compatibility aliases carry kompas.compatibilityAliasFor instead
    assert.equal(tool._meta?.kompas?.toolClass, expected, `${tool.name} metadata drift`);
    assert.ok(tool.description.startsWith(`[${expected}]`), `${tool.name} description prefix drift`);
    checked += 1;
  }
  const askSchema = tools.find((tool) => tool.name === "opencode_ask").inputSchema.properties.ctb;
  assert.deepEqual(askSchema.properties.mode, { enum: ["DIAGNOSE", "PLAN", "EXECUTE"] }, "model entrypoint must expose DIAGNOSE/PLAN in public schema");
  assert.deepEqual(askSchema.required, ["mode", "changeClass"]);
  assert.ok(askSchema.properties.retry, "opencode_ask ctb.retry missing from public schema");
  const runSchema = tools.find((tool) => tool.name === "opencode_run").inputSchema.properties.ctb;
  assert.ok(runSchema.properties.retry, "opencode_run ctb.retry missing from public schema");
  const executionStart = tools.find((tool) => tool.name === "opencode_execution_start");
  assert.ok(executionStart.inputSchema.properties.ctb.properties.retry, "opencode_execution_start ctb.retry missing from public schema");
  assert.deepEqual(tools.find((tool) => tool.name === "opencode_execution_get").securitySchemes[0].scopes, ["opencode:read"]);
  assert.deepEqual(tools.find((tool) => tool.name === "opencode_execution_abort").securitySchemes[0].scopes, ["opencode:session"]);
  assert.match(documentation, /ctb\.retry=true/, "documentation must declare the retry contract exposed by tools/list");
  const configUpdate = tools.find((tool) => tool.name === "opencode_shell_execute").inputSchema.properties.ctb;
  assert.deepEqual(configUpdate.properties.mode, { const: "EXECUTE" }, "non-model write must stay EXECUTE-only");
  console.log(`Public metadata consistency (${checked} classified tools): PASS`);
}

// Secret containment: runtime secret files are unreachable through tool path arguments.
response = await rpc(token.access_token, sessionId, 61, "tools/call", { name: "opencode_file_read", arguments: { directory: "C:\\Kompas Zbiórek", path: "C:\\Kompas Zbiórek\\opencode-mcp\\.runtime\\credentials.txt" } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_SECRET_PATH_DENIED", JSON.stringify(response.body));
response = await rpc(token.access_token, sessionId, 62, "tools/call", { name: "opencode_file_list", arguments: { directory: "C:\\Kompas Zbiórek\\opencode-mcp\\.runtime" } });
assert.equal(response.body.result.structuredContent.errorCode, "CTB_SECRET_PATH_DENIED", JSON.stringify(response.body));
console.log("Secret path isolation (.runtime denylist): PASS");

// DIAGNOSE model runtime: real inference on Hy3 Free via the read-only plan agent,
// without EXECUTE envelope and with zero CTB run mutation.
{
  const beforeModelRuns = runRegistrySnapshot();
  const expectedModel = process.env.OPENCODE_TEST_MODEL_ID || "hy3-free";
  let text = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await rpc(token.access_token, sessionId, 63, "tools/call", {
      name: "opencode_ask",
      arguments: {
        prompt: "Zwróć dokładnie: HY3_MCP_TEST_PASS",
        providerID: process.env.OPENCODE_TEST_PROVIDER_ID || "opencode",
        modelID: expectedModel,
        directory: "C:\\Kompas Zbiórek",
        ctb: { mode: "DIAGNOSE", changeClass: "ctb" },
      },
    });
    assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body));
    text = JSON.stringify(response.body.result);
    if (/HY3_MCP_TEST_PASS/.test(text)) break;
    if (!/no text content/.test(text)) break;
  }
  assert.match(text, /HY3_MCP_TEST_PASS/, `expected model echo in response: ${text.slice(0, 400)}`);
  assert.equal(runRegistrySnapshot(), beforeModelRuns, "DIAGNOSE model inference must not mutate the CTB run registry");
  // Gateway-owned correlation is returned structurally; never parse identity from model text.
  const modelExecutionId = response.body.result.structuredContent.executionId;
  const modelSessionId = response.body.result.structuredContent.sessionId;
  assert.ok(modelExecutionId && modelSessionId, "expected executionId and sessionId in DIAGNOSE response");
  response = await rpc(token.access_token, sessionId, 641, "tools/call", { name: "opencode_execution_status", arguments: { executionId: modelExecutionId } });
  assert.equal(response.body.result.structuredContent.sessionId, modelSessionId, "DIAGNOSE lifecycle status keeps the same session");
  assert.equal(response.body.result.structuredContent.status, "completed", "DIAGNOSE lifecycle reaches completed");
  response = await rpc(token.access_token, sessionId, 64, "tools/call", { name: "opencode_message_model_info", arguments: { sessionId: modelSessionId } });
  assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body));
  const conversation = JSON.stringify(response.body.result);
  assert.match(conversation, new RegExp(expectedModel), `assistant metadata missing modelID: ${conversation.slice(0, 300)}`);
  assert.match(conversation, /providerID":"opencode/, "assistant metadata missing providerID");
  assert.match(conversation, /"agent":"(plan|ctb-plan)"/, "DIAGNOSE inference must run on a read-only plan agent");
  console.log("Runtime model identity via read-only message history: PASS");
  console.log(`DIAGNOSE real model inference (${expectedModel}, plan agent, authoritative lifecycle): PASS`);
}

// Telemetry integrity fixture: served runs must have contiguous sequences and no events after finishedAt.
{
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")).runs;
  const completed = Object.values(registry).filter((run) => run.status !== "running" && run.finishedAt && (run.events || []).length > 0);
  assert.ok(completed.length >= 1, "expected at least one completed CTB run as telemetry fixture");
  for (const fixture of completed.slice(0, 3)) {
    response = await rpc(token.access_token, sessionId, 72, "tools/call", { name: "opencode_ctb_get_run", arguments: { runId: fixture.runId } });
    const served = response.body.result.structuredContent;
    const cutoff = Date.parse(served.finishedAt);
    const timestamps = (served.events || []).map((event) => Date.parse(event.timestamp) || 0);
    assert.ok(timestamps.every((at) => at <= cutoff), `${served.runId} has events after finishedAt`);
    assert.deepEqual((served.events || []).map((event) => event.sequence), (served.events || []).map((_, index) => index + 1), `${served.runId} sequences not contiguous`);
  }
  console.log(`Telemetry integrity over ${Math.min(completed.length, 3)} served runs: PASS`);
}

// Run analytics surface: consolidated inspector + compare/aggregate registered, honest payloads served.
{
  const analyticsToolNames = ["opencode_run_inspect", "paperclipCompareRunMetrics", "paperclipAggregateRunMetrics"];
  const listing = await rpc(token.access_token, sessionId, 73, "tools/list");
  for (const toolName of analyticsToolNames) {
    const tool = listing.body.result.tools.find((entry) => entry.name === toolName);
    assert.ok(tool, `${toolName} missing from tools/list`);
    assert.equal(tool.annotations.readOnlyHint, true, `${toolName} must stay read-only`);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")).runs;
  const fixture = Object.values(registry).find((run) => run.status !== "running" && run.finishedAt);
  assert.ok(fixture, "expected at least one finished CTB run as analytics fixture");
  for (const view of ["summary", "events", "tokens", "steps", "context", "models"]) {
    response = await rpc(token.access_token, sessionId, 74, "tools/call", { name: "opencode_run_inspect", arguments: { runId: fixture.runId, view } });
    assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body).slice(0, 300));
  }
  const metrics = (await rpc(token.access_token, sessionId, 76, "tools/call", { name: "opencode_run_inspect", arguments: { runId: fixture.runId, view: "summary" } })).body.result.structuredContent;
  assert.ok(Number.isInteger(metrics.metrics.modelTurnCount), "modelTurnCount must be an integer");
  assert.ok(["fresh_invocation", "continuation_same_session", "reconstructed_continuation", "retry_after_failure"].includes(metrics.invocationKind));
  for (const [key, entry] of Object.entries(metrics.supportedObservability)) {
    if (!entry.available) assert.equal(entry.measurementSource, "unavailable", `fake observability flag on ${key}`);
  }
  if (metrics.metrics.providers.length) assert.match(JSON.stringify(metrics.metrics.providers), /\//, "provider/model identity must be providerID/modelID");
  response = await rpc(token.access_token, sessionId, 75, "tools/call", { name: "opencode_run_inspect", arguments: { runId: fixture.runId, view: "tokens" } });
  const usage = response.body.result.isError ? null : response.body.result.structuredContent;
  if (usage) {
    for (const field of ["inputTokens", "outputTokens"]) {
      for (const turn of usage.turns) {
        assert.ok(turn[field].value === null || typeof turn[field].value === "number", `${field} must be number or explicit null`);
        assert.ok(["provider_reported", "opencode_reported", "locally_tokenized", "unavailable"].includes(turn[field].measurementSource));
      }
    }
  }
  console.log(`Run analytics read-only surface (${analyticsToolNames.length} tools, honest observability): PASS`);
}

if (process.env.PAPERCLIP_ITB_ISSUE_ID) {
  response = await rpc(token.access_token, sessionId, 9, "tools/call", {
    name: "opencode_run",
    arguments: {
      directory: "C:\\paperclip",
      prompt: "Run a narrow CTB ITB check. In this exact order: search and read package.json, write C:\\paperclip\\ctb-itb-proof.txt containing PASS, run node --check C:\\paperclip\\mcp-public-gateway.mjs, then delete only C:\\paperclip\\ctb-itb-proof.txt. Do not modify any other file. Report the completed steps.",
      ctb: {
        mode: "EXECUTE",
        changeClass: "ctb",
        paperclipIssueId: process.env.PAPERCLIP_ITB_ISSUE_ID,
        changeIntent: "Validate CTB OpenCode tool telemetry end-to-end.",
        scope: "C:\\paperclip only",
        acceptanceCriteria: "search/read, write and test are recorded in normalized run events.",
        idempotencyKey: `ctb-itb-${process.env.PAPERCLIP_ITB_ISSUE_ID}`,
      },
    },
  });
  assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body.result.structuredContent));
  const runId = /(?:ses|session)_[A-Za-z0-9_-]+/.exec(JSON.stringify(response.body.result))?.[0];
  assert.ok(runId, "CTB ITB execute must return an OpenCode run id");
  console.log(`OpenCode CTB real EXECUTE: PASS (${runId})`);
}

console.log("OpenCode CTB upstream surface, OAuth, resources/prompts, skills, policy scopes and path isolation: PASS");
