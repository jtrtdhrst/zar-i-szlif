import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CTB_POLICY_REVISION, MODEL_ENTRYPOINTS, TOOL_CLASSES, classifyIntake, classifyTool, ctbContextError, canonicalPath, evaluateIssueCtbPolicyDetailed, isFallbackEligibleError, matchesIdempotencyRun, normalizeAllowedDirectory, parseModelRef, requiredScope, selectIdempotentRun, sessionOwnershipError, validateIssueWorkspaceToolPathArguments, validateToolPathArguments } from "./ctb-policy.mjs";
import { aggregateRunAnalytics, buildRunAnalytics, compareRunMetrics, supportedObservability } from "./run-analytics.mjs";
import { loadMcpRoleProfiles, resolveEffectiveProfile, resolveCtbAgent, reconcileProfileWithAgent } from "./mcp-role-profiles.mjs";
import { assertShellCommandAllowed, capabilitiesForAgent } from "./ctb-capability.mjs";

const GATEWAY_REVISION = "ctb-policy-8";
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "..");
const runtimeDir = process.env.OPENCODE_MCP_RUNTIME_DIR || path.join(here, ".runtime");
const port = Number(process.env.PORT || 4097);
const issuer = (process.env.MCP_ISSUER || "https://opencode.kompaszbiorek.pl").replace(/\/+$/, "");
const serverUrl = (process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");
const operatorUsername = process.env.OPENCODE_MCP_USERNAME || "operator";
const operatorPassword = process.env.OPENCODE_MCP_PASSWORD || "";
const openCodeUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const openCodePassword = process.env.OPENCODE_SERVER_PASSWORD || "";
// Module-scope OpenCode backend auth header. Used both by verifyNativeAgents (line ~231)
// and by per-session engine calls. Previously declared only inside a function, which made
// the reference at the verify site a free variable and caused every native-agent verification
// to throw a swallowed ReferenceError -> permanent verified:false (silent downgrade).
const openCodeHeaders = { authorization: `Basic ${Buffer.from(`${openCodeUsername}:${openCodePassword}`).toString("base64")}` };
const infrastructureRoot = "C:\\paperclip";
const paperclipWorktreeRoot = "C:\\paperclip-worktrees";
// Canonical allow-roots: Paperclip infrastructure, isolated Paperclip worktrees and the
// whole Kompas repo (which contains both this gateway's repo and .paperclip-worktrees).
const allowedRoots = [...new Set((process.env.OPENCODE_CTB_ALLOWED_ROOTS || [workspaceRoot, path.join(workspaceRoot, ".paperclip-worktrees"), infrastructureRoot, paperclipWorktreeRoot].join(path.delimiter)).split(path.delimiter).map((root) => root.trim()).filter(Boolean))];
const upstreamEntry = process.env.OPENCODE_MCP_UPSTREAM_ENTRY || path.join(here, "upstream", "dist", "index.js");
const skillsRoot = path.join(here, "skills");
const auditFile = path.join(runtimeDir, "ctb-audit.ndjson");
const registryFile = path.join(runtimeDir, "ctb-runs.json");
const accessTtlMs = 8 * 60 * 60 * 1000;
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;
const codeTtlMs = 10 * 60 * 1000;
const validScopes = new Set(["opencode:read", "opencode:session", "opencode:ctb:execute", "opencode:admin", "opencode:write", "mcp:read", "mcp:write", "offline_access"]);
const codes = new Map();
const sessions = new Map();
const attempts = new Map();

if (!operatorPassword || !openCodePassword) throw new Error("OPENCODE_MCP_PASSWORD and OPENCODE_SERVER_PASSWORD must be configured.");
if (!fs.existsSync(upstreamEntry)) throw new Error(`Missing upstream engine: ${upstreamEntry}`);
fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
// normalizeAllowedDirectory resolves every allowed root with realpathSync; roots must exist.
for (const root of allowedRoots) fs.mkdirSync(root, { recursive: true });
const keyFile = path.join(runtimeDir, "signing.key");
const clientsFile = path.join(runtimeDir, "clients.json");
const refreshFile = path.join(runtimeDir, "refresh-tokens.json");
const signingKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : crypto.randomBytes(48).toString("hex");
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, signingKey, { mode: 0o600 });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
const oauthSessionsFile = path.join(runtimeDir, "oauth-sessions.json");
const sessionCookieName = "__Host-opencode_session";
const oauthSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const refreshGraceMs = 60 * 1000;
const oauthSessions = readJson(oauthSessionsFile, { version: 1, sessions: {} });
function persistOauthSessions() { const now = Date.now(); for (const [hash, record] of Object.entries(oauthSessions.sessions)) { if (!record || Date.parse(record.expiresAt) <= now) delete oauthSessions.sessions[hash]; } writeJson(oauthSessionsFile, oauthSessions); }
function parseCookies(req) { const jar = {}; for (const part of String(req.headers.cookie || "").split(";")) { const index = part.indexOf("="); if (index > 0) jar[part.slice(0, index).trim()] = part.slice(index + 1).trim(); } return jar; }
function sessionCookieToken(req) { return parseCookies(req)[sessionCookieName] || ""; }
function validOauthSession(req) { const token = sessionCookieToken(req); if (!token) return null; const record = oauthSessions.sessions[crypto.createHash("sha256").update(token).digest("hex")]; return record && Date.parse(record.expiresAt) > Date.now() ? record : null; }
function issueBrowserSession(res, principal) { const token = random(32); const now = Date.now(); oauthSessions.sessions[crypto.createHash("sha256").update(token).digest("hex")] = { principal, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + oauthSessionTtlMs).toISOString() }; persistOauthSessions(); res.setHeader("set-cookie", `${sessionCookieName}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(oauthSessionTtlMs / 1000)}`); }
function revokeOauthSession(req) { const token = sessionCookieToken(req); if (!token) return false; return delete oauthSessions.sessions[crypto.createHash("sha256").update(token).digest("hex")] && (persistOauthSessions(), true); }
const clients = readJson(clientsFile, {});
const refreshTokens = readJson(refreshFile, {});
const savedRegistry = readJson(registryFile, {});
const runs = savedRegistry?.runs && typeof savedRegistry.runs === "object" ? savedRegistry.runs : savedRegistry;
const executions = savedRegistry?.executions && typeof savedRegistry.executions === "object" ? savedRegistry.executions : {};
// Telemetry integrity repair for legacy rows: events recorded after a run finished are dropped.
for (const run of Object.values(runs)) {
  if (!run || run.status === "running" || !run.finishedAt || !Array.isArray(run.events)) continue;
  const cutoff = Date.parse(run.finishedAt) || 0;
  const filtered = cutoff ? run.events.filter((event) => (Date.parse(event.timestamp) || 0) <= cutoff) : run.events;
  if (filtered.length !== run.events.length) { run.events = filtered.map((event, index) => ({ ...event, sequence: index + 1 })); }
}
persistRuns();
const pendingEvents = new Map();
const activeCtbExecutions = new Map();
const executionLocks = new Map();
const startupProcessLostRuns = reconcileInterruptedRunsAtStartup();
const COMPATIBILITY_ALIASES = Object.freeze({
  opencode_list_runs: "opencode_sessions_overview",
  opencode_get_run: "opencode_session_get",
  opencode_read_logs: "opencode_conversation",
  opencode_get_diff: "opencode_session_diff",
  opencode_list_agents: "opencode_agent_list",
  opencode_run_prompt: "opencode_run",
  opencode_continue_run: "opencode_reply",
  opencode_abort_run: "opencode_session_abort",
});
// Aliases stay callable through tools/call for backward compatibility but are NOT eagerly
// exposed in the model-facing tool schema: one canonical definition per capability.
function configuredPrincipalRoles() { try { return JSON.parse(process.env.OPENCODE_MCP_PRINCIPAL_ROLES || "{}"); } catch { return {}; } }
const roleProfilesDoc = loadMcpRoleProfiles();
// Role comes ONLY from the server-side mapping keyed by authenticated principal or OAuth
// client id — never from anything the model/client supplies in tool arguments.
function resolveConfiguredRoleForToken(token) {
  const map = configuredPrincipalRoles();
  for (const key of [token?.client_id, token?.sub]) {
    if (!key) continue;
    const hit = Object.entries(map).find(([candidate]) => candidate.toLowerCase() === String(key).toLowerCase());
    if (hit) return hit[1];
  }
  return null;
}
function effectiveProfileFor(token, trusted = {}, projectKey = null) {
  // SERVER-AUTHORITATIVE contract: taskClass/currentStage reaching this function are
  // ALWAYS server-derived (validated Paperclip issue execution policy/metadata).
  // Values supplied by the client/model never extend permissions; they survive only as
  // labeled request hints in telemetry.
  return resolveEffectiveProfile({ role: resolveConfiguredRoleForToken(token), principalId: token?.sub ?? null, taskClass: trusted.taskClass || "", currentStage: trusted.currentStage || "", projectKey: projectKey || null }, roleProfilesDoc, {});
}
// Trusted taskClass/currentStage derivation from the issue the gateway itself fetched
// from Paperclip. Absent authoritative data -> empty strings -> safe baseline role.
function trustedContextFromIssue(issue) {
  const source = issue?.executionPolicy?.ctb && typeof issue.executionPolicy.ctb === "object" ? issue.executionPolicy.ctb : (issue?.metadata?.ctb && typeof issue.metadata.ctb === "object" ? issue.metadata.ctb : {});
  return {
    taskClass: typeof source.taskClass === "string" ? source.taskClass : "",
    currentStage: typeof source.currentStage === "string" ? source.currentStage : "",
  };
}
function requestedModelFrom(args) {
  const providerRequested = typeof args?.providerID === "string" && args.providerID ? args.providerID : null;
  const modelRequested = typeof args?.modelID === "string" && args.modelID ? args.modelID : (typeof args?.model === "string" && args.model ? args.model : null);
  return providerRequested || modelRequested ? { providerRequested, modelRequested } : null;
}
// Model contract: actual model identity comes from runtime message metadata only; fields
// the runtime does not report stay null instead of being fabricated.
async function lastAssistantModelInfo(sessionId) {
  if (!sessionId) return null;
  try {
    const messages = await fetchSessionMessages(sessionId);
    const assistant = (Array.isArray(messages) ? messages : []).map((message) => message?.info && typeof message.info === "object" ? message.info : message).filter((info) => info.role === "assistant").pop();
    return assistant ? { messageId: assistant.id ?? null, providerActual: assistant.providerID ?? null, modelActual: assistant.modelID ?? null } : null;
  } catch { return null; }
}
function summarizeModelIdentity(requested, actual, explicit = {}) {
  const summary = { sessionId: null, messageId: actual?.messageId ?? null, providerRequested: requested?.providerRequested ?? null, modelRequested: requested?.modelRequested ?? null, providerActual: actual?.providerActual ?? null, modelActual: actual?.modelActual ?? null, fallbackUsed: null, fallbackReason: null, attempts: Array.isArray(explicit.attempts) ? explicit.attempts : null };
  if (summary.providerRequested && summary.modelRequested && summary.providerActual && summary.modelActual) {
    summary.fallbackUsed = summary.providerActual !== summary.providerRequested || summary.modelActual !== summary.modelRequested;
    if (summary.fallbackUsed) summary.fallbackReason = "runtime served a different provider/model than requested";
  }
  // Gateway-known invocation outcome wins over metadata inference: for a completed
  // invocation the gateway ALWAYS knows whether the fallback retry fired.
  if (typeof explicit.fallbackUsed === "boolean") {
    summary.fallbackUsed = explicit.fallbackUsed;
    summary.fallbackReason = explicit.fallbackReason ?? null;
  } else if (requested && (requested.providerRequested || requested.modelRequested)) {
    // Default injection means the gateway knows the request even without caller args.
    summary.fallbackUsed = summary.fallbackUsed ?? false;
  }
  return summary;
}
function telemetryBase(token, { name, ctb = null, directory = null, mode = null, trustedContext = null }) {
  const profile = effectiveProfileFor(token, trustedContext || {});
  return {
    gatewayRevision: GATEWAY_REVISION,
    ctbPolicyRevision: CTB_POLICY_REVISION,
    mcpRoleProfileRevision: roleProfilesDoc.revision,
    principalId: token?.sub ?? null,
    resolvedRole: profile.resolvedRole,
    effectiveProfileKnown: profile.known,
    // Server-authoritative context (null when Paperclip provides none -> baseline role).
    taskClass: trustedContext?.taskClass || null,
    currentStage: trustedContext?.currentStage || null,
    taskClassSource: trustedContext?.taskClass ? "server" : "none",
    currentStageSource: trustedContext?.currentStage ? "server" : "none",
    // Request hints NEVER influence permissions; recorded for diagnostics only.
    requestedTaskClass: ctb?.taskClass || null,
    requestedCurrentStage: ctb?.currentStage || null,
    resolutionInputs: {
      role: { value: profile.resolvedRole, source: "server" },
      taskClass: { value: trustedContext?.taskClass || null, source: trustedContext?.taskClass ? "server" : "ignored_untrusted" },
      currentStage: { value: trustedContext?.currentStage || null, source: trustedContext?.currentStage ? "server" : "ignored_untrusted" },
      projectKey: { source: "server_issue_identifier" },
    },
    effectiveProfileSource: profile.source,
    eagerConnections: profile.eagerConnections,
    deferredConnections: profile.deferredConnections,
    eagerConnectionCount: profile.eagerConnectionCount,
    cwd: directory ?? null,
    mode: mode || ctb?.mode || null,
  };
}

// Model contract (explicit, never silent): canonical default model applied when the caller
// passes none, plus a single operator-configured fallback used ONLY on a provider/model
// invocation failure — every fallback surfaces fallbackUsed=true + fallbackReason.
const DEFAULT_MODEL = parseModelRef(process.env.OPENCODE_MCP_DEFAULT_MODEL || "opencode/hy3-free") || { providerID: "opencode", modelID: "hy3-free" };
const FALLBACK_MODEL = parseModelRef(process.env.OPENCODE_MCP_FALLBACK_MODEL || "opencode/mimo-v2.5-free");
function applyDefaultModel(args) {
  const hasProvider = typeof args?.providerID === "string" && args.providerID.trim() !== "";
  const hasModel = (typeof args?.modelID === "string" && args.modelID.trim() !== "") || (typeof args?.model === "string" && args.model.trim() !== "");
  if (hasProvider || hasModel) return args;
  const def = effectiveDefaultModel();
  return { ...args, providerID: def.providerID, modelID: def.modelID };
}
// Upstream reports invocation failures either as rejected RPC calls OR as resolved tool
// results carrying isError:true — both shapes must be eligible for the explicit retry.
function upstreamErrorFromResult(result, details = {}) {
  const text = Array.isArray(result?.content) ? result.content.filter((part) => part?.type === "text").map((part) => part.text).join(" ") : "";
  const structured = result?.structuredContent && typeof result.structuredContent === "object" ? sanitize(result.structuredContent) : null;
  return Object.assign(new Error(String(text || structured?.errorCode || "UPSTREAM_TOOL_ERROR").slice(0, 500)), {
    code: "UPSTREAM_TOOL_ERROR",
    failureStage: details.failureStage || "message_result",
    upstreamTool: details.upstreamTool || null,
    providerID: details.providerID ?? null,
    modelID: details.modelID ?? null,
    upstreamResult: structured,
  });
}
function upstreamInvocationError(error, details = {}) {
  if (error?.failureStage) return error;
  return Object.assign(error instanceof Error ? error : new Error(String(error || "UPSTREAM_TOOL_ERROR")), {
    failureStage: details.failureStage || "message_transport",
    upstreamTool: details.upstreamTool || null,
    providerID: details.providerID ?? null,
    modelID: details.modelID ?? null,
  });
}
function permissionError(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${JSON.stringify(error?.data || {})}`;
  return /permission|approval|requires.?confirmation|not.?authorized/i.test(text) && !/^CTB_(?:PERMISSION|EXECUTION|SESSION)/i.test(String(error?.code || ""));
}
// Native agent governance: ctb-* agents hard-enforce role profiles at the OpenCode level.
// Activation is PERSISTENT: the mode lives in .runtime/native-agents.mode (written by
// start-opencode-mcp.ps1 -NativeAgents / activate-native-agents.ps1), so an ordinary
// gateway restart cannot silently fall back to build/plan. When native mode is required
// but the backend does not confirm the ctb-* agents, execution FAILS CLOSED with
// CTB_NATIVE_AGENTS_UNAVAILABLE instead of downgrading to built-in agents.
const REQUIRED_NATIVE_AGENTS = ["ctb-plan", "ctb-executor", "ctb-engineer", "ctb-designer", "ctb-ui-qa", "ctb-cto-infra"];
const nativeAgentsModeFile = path.join(runtimeDir, "native-agents.mode");
function readNativeAgentsMode() {
  if (String(process.env.OPENCODE_MCP_NATIVE_AGENTS || "").toLowerCase() === "on") return true;
  try { return fs.readFileSync(nativeAgentsModeFile, "utf8").trim().toLowerCase() === "on"; } catch { return false; }
}
const NATIVE_AGENTS_ENABLED = readNativeAgentsMode();
const nativeAgentState = { verified: false, foundAgents: [], configuredAgents: [], checkedAt: 0, missingAgents: [...REQUIRED_NATIVE_AGENTS], liveProbe: { ok: false, found: [], missing: [...REQUIRED_NATIVE_AGENTS], error: null } };
// Canonical agent resolver. The authoritative source of truth for which ctb-* agents exist is
// the OpenCode config agent block — the SAME source `opencode_context` reports. The live
// /agent discovery probe is kept only as a diagnostic signal, because on this backend it
// returns an empty list even when the agents are fully configured and usable, so it must
// never drive the canonical truth or trigger a false fail-closed. Both runtime native
// enforcement (selectCtbAgent) and self-audit (opencode_security_status) read this single state.
async function fetchConfiguredCtbAgents() {
  try {
    const response = await fetch(`${serverUrl}/config`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`config probe ${response.status}`);
    const config = await response.json();
    const agentKeys = config?.agent && typeof config.agent === "object" ? Object.keys(config.agent) : [];
    return agentKeys.filter((name) => name.startsWith("ctb-"));
  } catch { return []; }
}
async function verifyNativeAgents({ force = false } = {}) {
  if (!force && nativeAgentState.checkedAt && Date.now() - nativeAgentState.checkedAt < 60 * 1000) return nativeAgentState;
  const checkedAt = Date.now();
  const configured = await fetchConfiguredCtbAgents();
  // Live probe is informational only; it does not override the configured truth.
  const liveProbe = { ok: false, found: [], missing: [...REQUIRED_NATIVE_AGENTS], error: null };
  try {
    const response = await fetch(`${serverUrl}/agent`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`agent probe ${response.status}`);
    const agents = await response.json();
    const list = Array.isArray(agents) ? agents : (Array.isArray(agents?.agents) ? agents.agents : []);
    const names = list.map((agent) => String(agent?.name || agent?.id || ""));
    liveProbe.found = names.filter((name) => name.startsWith("ctb-"));
    liveProbe.missing = REQUIRED_NATIVE_AGENTS.filter((required) => !liveProbe.found.includes(required));
    liveProbe.ok = liveProbe.missing.length === 0;
  } catch (error) { liveProbe.error = String(error?.message || error); }
  const foundAgents = configured.length ? configured : liveProbe.found;
  const missingAgents = REQUIRED_NATIVE_AGENTS.filter((required) => !foundAgents.includes(required));
  const verified = missingAgents.length === 0;
  const state = { verified, foundAgents, configuredAgents: configured, checkedAt, missingAgents, liveProbe };
  Object.assign(nativeAgentState, state);
  audit({ result: "native_agents_verification", verified, configuredAgents: configured, liveProbeOk: liveProbe.ok, liveProbeMissing: liveProbe.missing });
  return nativeAgentState;
}
function selectCtbAgent(mode, profile) {
  const native = resolveCtbAgent(profile, mode);
  // No silent downgrade while native governance is active (persisted mode): a missing
  // agent is a hard failure so policy and real permissions can never diverge.
  if (!NATIVE_AGENTS_ENABLED) return mode === "EXECUTE" ? "build" : "plan";
  if (!nativeAgentState.verified || nativeAgentState.missingAgents.includes(native)) {
    throw Object.assign(new Error("CTB_NATIVE_AGENTS_UNAVAILABLE"), { code: "CTB_NATIVE_AGENTS_UNAVAILABLE", requiredAgent: native, missingAgents: [...nativeAgentState.missingAgents] });
  }
  return native;
}
// Durable per-session model invocation records (DIAGNOSE/PLAN included). Backs the
// opencode_message_model_info contract fields even when no CTB run exists.
const modelRecordsFile = path.join(runtimeDir, "ctb-model-records.json");
const modelRecords = readJson(modelRecordsFile, { version: 1, records: {} });
function recordModelIdentity(sessionId, identity) {
  if (!sessionId || !identity || typeof identity !== "object") return;
  modelRecords.records[sessionId] = { ...identity, sessionId };
  const entries = Object.entries(modelRecords.records);
  if (entries.length > 500) { for (const [key] of entries.slice(0, entries.length - 500)) delete modelRecords.records[key]; }
  try { writeJson(modelRecordsFile, modelRecords); } catch { /* telemetry best-effort */ }
}
function lookupModelRecord(sessionId) { return modelRecords.records[sessionId] || runs[sessionId]?.model || null; }
// Telemetry contract holds even for primary+fallback double failure: the thrown error
// always carries the full attempt trail so callers can persist what was tried.
function attachAttemptTrail(error, attempts, fallbackUsed, fallbackReason) {
  try { error.modelAttempts = attempts; error.fallbackUsed = fallbackUsed; error.fallbackReason = fallbackReason; } catch { /* frozen error */ }
  return error;
}
function attachExecutionIdentity(error, execution) {
  try { Object.assign(error, { executionId: execution.executionId, sessionId: execution.sessionId }); } catch { /* frozen error */ }
  return error;
}
function correlatedModelResult(result, execution, replayed = false) {
  const structuredContent = result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {};
  return {
    ...result,
    structuredContent: { ...structuredContent, executionId: execution.executionId, sessionId: execution.sessionId, state: execution.status, status: execution.status, replayed },
  };
}
function executionAbortedError() { return Object.assign(new Error("CTB_EXECUTION_ABORTED"), { code: "CTB_EXECUTION_ABORTED" }); }
async function callUpstreamModel(args) {
  const { sessionId, prompt, directory, providerID, modelID, agent, variant } = args;
  const body = { parts: [{ type: "text", text: String(prompt) }] };
  if (providerID && modelID) body.model = { providerID, modelID, ...(variant ? { variant } : {}) };
  if (agent) body.agent = agent;
  let response;
  try {
    response = await fetch(`${serverUrl}/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      headers: { ...openCodeHeaders, "content-type": "application/json", ...(directory ? { "x-opencode-directory": directory } : {}) },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw Object.assign(new Error(String(error?.message || error)), { code: "UPSTREAM_TOOL_ERROR", failureStage: "primary_message_transport", upstreamTool: "POST /session/:id/message" });
  }
  const raw = await response.text();
  if (!response.ok) return { isError: true, content: [{ type: "text", text: `POST /session/${sessionId}/message failed (${response.status}): ${sanitize(raw).slice(0, 500)}` }] };
  let message;
  try { message = JSON.parse(raw); } catch { return { isError: true, content: [{ type: "text", text: "OpenCode returned an invalid message response." }] }; }
  const text = Array.isArray(message?.parts) ? message.parts.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : "";
  return { content: [{ type: "text", text: text || JSON.stringify(message) }] };
}
async function callModelWithFallback(name, args, auditContext = {}, { shouldContinue } = {}) {
  const attempts = [{ providerID: args.providerID ?? null, modelID: args.modelID ?? null, role: "primary" }];
  let failure = null;
  let primary;
  try {
    primary = await callUpstreamModel(args);
    if (primary?.isError !== true) return { result: primary, fallbackUsed: false, fallbackReason: null, attempts };
    failure = attachAttemptTrail(upstreamErrorFromResult(primary, { failureStage: "primary_message_result", upstreamTool: name, providerID: args.providerID, modelID: args.modelID }), attempts, false, null);
  } catch (error) {
    failure = attachAttemptTrail(upstreamInvocationError(error, { failureStage: "primary_message_transport", upstreamTool: name, providerID: args.providerID, modelID: args.modelID }), attempts, false, null);
  }
  if (!FALLBACK_MODEL || !isFallbackEligibleError(failure)) throw failure;
  attempts[0].outcome = String(failure.code || failure.message || "UPSTREAM_ERROR").slice(0, 200);
  if (shouldContinue && !shouldContinue()) throw attachAttemptTrail(executionAbortedError(), attempts, false, null);
  audit({ ...auditContext, tool: name, requestedModel: { providerRequested: args.providerID ?? null, modelRequested: args.modelID ?? null }, fallbackModel: FALLBACK_MODEL, fallbackTrigger: attempts[0].outcome, result: "model_fallback_retry" });
  const retryArgs = { ...args, providerID: FALLBACK_MODEL.providerID, modelID: FALLBACK_MODEL.modelID };
  attempts.push({ providerID: FALLBACK_MODEL.providerID, modelID: FALLBACK_MODEL.modelID, role: "fallback" });
  const fallbackReason = `primary model failed (${attempts[0].outcome}); explicit retry on ${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.modelID}`;
  try {
    if (shouldContinue && !shouldContinue()) throw attachAttemptTrail(executionAbortedError(), attempts, false, null);
    const result = await callUpstreamModel(retryArgs);
    if (result?.isError === true) throw upstreamErrorFromResult(result, { failureStage: "fallback_message_result", upstreamTool: name, providerID: retryArgs.providerID, modelID: retryArgs.modelID });
    attempts[attempts.length - 1].outcome = "success";
    return { result, fallbackUsed: true, fallbackReason, attempts };
  } catch (retryError) {
    attempts[attempts.length - 1].outcome = String(retryError.code || retryError.message || "UPSTREAM_ERROR").slice(0, 200);
    throw attachAttemptTrail(upstreamInvocationError(retryError, { failureStage: "fallback_message_transport", upstreamTool: name, providerID: retryArgs.providerID, modelID: retryArgs.modelID }), attempts, true, `${fallbackReason}; fallback also failed`);
  }
}
function persistRuns() { writeJson(registryFile, { version: 3, runs, executions }); }
// Bootstrap entrypoints may start without an existing session: the gateway creates the
// upstream OpenCode session itself (POST /session) and injects the resulting sessionId,
// so run correlation stays authoritative and never derives identity from tool output text.
const BOOTSTRAP_ENTRYPOINTS = new Set(["opencode_run", "opencode_ask"]);
function b64(value) { return Buffer.from(value).toString("base64url"); }
function random(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function sign(payload) { const encoded = b64(JSON.stringify(payload)); return `${encoded}.${crypto.createHmac("sha256", signingKey).update(encoded).digest("base64url")}`; }
function verify(token) { try { const [encoded, signature] = String(token).split("."); const expected = crypto.createHmac("sha256", signingKey).update(encoded).digest("base64url"); if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; } }
function resourceUrl() { return `${issuer}/mcp`; }
function scopes(scope) { return String(scope || "").split(/\s+/).filter((entry) => validScopes.has(entry)); }
function normalizedScope(scope) { const requested = scopes(scope); const granted = new Set(requested); if (requested.includes("mcp:read")) { granted.add("opencode:read"); granted.add("opencode:session"); } if (requested.includes("mcp:write")) granted.add("opencode:ctb:execute"); if (!["opencode:read", "opencode:session", "opencode:ctb:execute", "opencode:admin", "opencode:write"].some((entry) => granted.has(entry))) { granted.add("opencode:read"); granted.add("opencode:session"); } return [...granted].join(" "); }
function hasScope(token, required) { const actual = scopes(token?.scope); return actual.includes(required) || (required === "opencode:read" && actual.includes("mcp:read")) || (required === "opencode:session" && actual.includes("mcp:read")) || (required === "opencode:ctb:execute" && (actual.includes("opencode:write") || actual.includes("mcp:write"))); }
function secureEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function allowedRedirect(value) { try { const url = new URL(value); return (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) || (url.protocol === "https:" && url.hostname === "chatgpt.com" && (url.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[^/]+$/.test(url.pathname))); } catch { return false; } }
function sendJson(res, status, body, headers = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(body)); }
function sendHtml(res, status, body) { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(body); }
async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw new Error("Request body is too large."); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function toolResult(data, text) { return { structuredContent: data, content: [{ type: "text", text: text || JSON.stringify(data) }] }; }
function errorDetails(error, isControlPlane = false) {
  return sanitize({
    errorCode: error?.code || (isControlPlane ? "CTB_CONTROL_PLANE_UNAVAILABLE" : "CTB_GATEWAY_ERROR"),
    missing: error?.missing,
    requiredScope: error?.requiredScope,
    controlPlane: Boolean(isControlPlane),
    failureStage: error?.failureStage || null,
    executionId: error?.executionId || null,
    sessionId: error?.sessionId || null,
    upstreamTool: error?.upstreamTool || null,
    upstreamStatus: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : null,
    providerID: error?.providerID ?? null,
    modelID: error?.modelID ?? null,
    modelAttempts: Array.isArray(error?.modelAttempts) ? error.modelAttempts : null,
    upstreamResult: error?.upstreamResult || null,
    upstreamBody: error?.upstreamBody || null,
  });
}
function tokenFromRequest(req) { const auth = String(req.headers.authorization || ""); return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("access_token") || ""; }
function mcpUnauthorized(res, id = null) { return sendJson(res, 401, rpcError(id, -32001, "Unauthorized"), { "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", scope="opencode:read opencode:session opencode:ctb:execute opencode:admin", error="invalid_token", error_description="Connect OpenCode with OAuth to continue"` }); }
function audit(event) { const safe = { timestamp: new Date().toISOString(), ...event }; fs.appendFileSync(auditFile, `${JSON.stringify(safe)}\n`, { mode: 0o600 }); }
function sanitize(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.replace(/(bearer\s+|token[=:]\s*|api[_-]?key[=:]\s*|password[=:]\s*)[^\s,"}]+/ig, "$1[redacted]");
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => (/token|secret|password|authorization|cookie/i.test(key) ? [key, "[redacted]"] : [key, sanitize(item, depth + 1)])));
}

class UpstreamEngine {
  constructor() { this.child = null; this.buffer = ""; this.nextId = 1; this.pending = new Map(); this.ready = null; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [upstreamEntry], { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OPENCODE_BASE_URL: serverUrl, OPENCODE_AUTO_SERVE: "false", OPENCODE_SERVER_USERNAME: openCodeUsername, OPENCODE_SERVER_PASSWORD: openCodePassword } });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.receive(chunk));
      child.stderr.on("data", (chunk) => process.stderr.write(`[opencode-upstream] ${chunk}`));
      child.once("error", reject);
      child.once("exit", () => { this.child = null; this.ready = null; for (const { reject: fail } of this.pending.values()) fail(new Error("UPSTREAM_ENGINE_EXITED")); this.pending.clear(); });
      this.call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kompas-ctb-adapter", version: "1.0.0" } }, true).then(() => { this.notify("notifications/initialized", {}); resolve(); }, reject);
    });
    return this.ready;
  }
  receive(chunk) { this.buffer += chunk; for (;;) { const index = this.buffer.indexOf("\n"); if (index < 0) return; const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1); if (!line) continue; let message; try { message = JSON.parse(line); } catch { continue; } const pending = this.pending.get(message.id); if (!pending) continue; this.pending.delete(message.id); message.error ? pending.reject(Object.assign(new Error(message.error.message), { data: message.error.data })) : pending.resolve(message.result); } }
  async call(method, params, skipReady = false) { if (!skipReady) await (this.ready || Promise.resolve()); if (!this.child) throw new Error("UPSTREAM_ENGINE_UNAVAILABLE"); const id = this.nextId++; const request = { jsonrpc: "2.0", id, method, params }; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(`${JSON.stringify(request)}\n`); }); }
  notify(method, params) { if (this.child) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`); }
}
const engine = new UpstreamEngine();

function classifyEventKind(event, data) {
  const source = `${event} ${JSON.stringify(data)}`.toLowerCase();
  if (/error|fail/.test(source)) return "error";
  if (/\bmcp\b/.test(source)) return "mcp";
  if (/search|grep|glob|find/.test(source)) return "search";
  if (/test|vitest|jest|pytest|--check/.test(source)) return "test";
  if (/git\b/.test(source)) return "git";
  if (/file|read|write|edit|patch/.test(source)) return "file";
  if (/command|shell|terminal|exec/.test(source)) return "command";
  if (/session|message|lifecycle|status|run/.test(source)) return "lifecycle";
  return "tool";
}
function eventOperation(kind, data) {
  const source = JSON.stringify(data).toLowerCase();
  if (kind === "file") return /write|edit|patch|create|delete/.test(source) ? "write" : "read";
  return null;
}
function normalizedOpenCodeEvent(event, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { data = { message: raw }; }
  data = sanitize(data);
  const kind = classifyEventKind(event, data);
  const field = (value, names, depth = 0) => {
    if (depth > 5 || !value || typeof value !== "object") return null;
    for (const name of names) if (typeof value[name] === "string") return value[name];
    for (const nested of Object.values(value)) { const found = field(nested, names, depth + 1); if (found) return found; }
    return null;
  };
  return {
    // SSE payloads are observation-only. They never establish CTB ownership.
    sessionId: null,
    event: { kind, tool: field(data, ["tool", "command", "name"]) || event || null, action: field(data, ["action", "type"]) || event || null, operation: eventOperation(kind, data), durationMs: Number.isFinite(Number(field(data, ["durationMs"]))) ? Number(field(data, ["durationMs"])) : null, status: kind === "error" || field(data, ["status"]) === "error" ? "error" : field(data, ["status"]) === "success" ? "success" : "started", retry: Number(field(data, ["retry"])) || 0, errorCode: field(data, ["errorCode", "code"]) || (kind === "error" ? "OPENCODE_EVENT_ERROR" : null), details: data },
  };
}
async function collectOpenCodeEvents() {
  for (;;) {
    try {
      const response = await fetch(`${serverUrl}/event`, { headers: { accept: "text/event-stream", authorization: `Basic ${Buffer.from(`${openCodeUsername}:${openCodePassword}`).toString("base64")}` } });
      if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = ""; let event = "message"; let data = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const index = buffer.indexOf("\n"); if (index < 0) break;
          const line = buffer.slice(0, index).replace(/\r$/, ""); buffer = buffer.slice(index + 1);
          if (!line) { if (data.length) { const normalized = normalizedOpenCodeEvent(event, data.join("\n")); appendTelemetryEvent(normalized.sessionId, normalized.event); } event = "message"; data = []; continue; }
          if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
      }
    } catch (error) { audit({ result: "telemetry_reconnect", errorCode: "OPENCODE_SSE_UNAVAILABLE" }); }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
let telemetryCollectorStarted = false;
function startTelemetryCollector() { if (!telemetryCollectorStarted) { telemetryCollectorStarted = true; void collectOpenCodeEvents(); } }
async function collectSessionToolEvents(sessionId) {
  if (!sessionId) return;
  try {
    const response = await fetch(`${serverUrl}/session/${encodeURIComponent(sessionId)}/message`, { headers: { authorization: `Basic ${Buffer.from(`${openCodeUsername}:${openCodePassword}`).toString("base64")}` } });
    if (!response.ok) throw new Error(`Session event lookup ${response.status}`);
    const messages = await response.json();
    for (const message of Array.isArray(messages) ? messages : []) {
      const info = message?.info && typeof message.info === "object" ? message.info : message;
      const parts = Array.isArray(message?.parts) ? message.parts : [];
      if (info.role === "assistant") {
        // Persist structured model-turn telemetry: one event per step-start..step-finish pair.
        const finishes = parts.filter((part) => part.type === "step-finish");
        const starts = parts.filter((part) => part.type === "step-start");
        const groups = finishes.length ? finishes.map((finish, index) => ({ finish, start: starts[index] || starts[starts.length - 1] || null })) : [];
        for (const [groupIndex, group] of groups.entries()) {
          const tokens = group.finish.tokens && typeof group.finish.tokens === "object" ? group.finish.tokens : info.tokens || {};
          const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
          eventFor(sessionId, {
            kind: "model_turn",
            eventType: "model_turn",
            messageId: info.id,
            turnIndex: null,
            stepIndexInMessage: groupIndex,
            timestamp: new Date(Number(group.start?.time?.start) || Number(info.time?.created)).toISOString(),
            durationMs: group.start?.time?.start && group.finish.time?.end ? Math.max(0, group.finish.time.end - group.start.time.start) : null,
            status: "success",
            toolName: null,
            toolSource: null,
            providerId: info.providerID ?? null,
            modelId: info.modelID ?? null,
            inputTokens: Number.isFinite(Number(tokens.input)) ? Number(tokens.input) : null,
            outputTokens: Number.isFinite(Number(tokens.output)) ? Number(tokens.output) + (Number(tokens.reasoning) || 0) : null,
            cacheReadTokens: Number.isFinite(Number(cache.read)) ? Number(cache.read) : null,
            cacheWriteTokens: Number.isFinite(Number(cache.write)) ? Number(cache.write) : null,
            contextWindowTokens: null,
            contextUtilizationPct: null,
            measurementSource: { inputTokens: "provider_reported", outputTokens: "provider_reported", cacheReadTokens: "provider_reported", cacheWriteTokens: "provider_reported", contextWindowTokens: "unavailable", contextUtilizationPct: "unavailable" },
          });
        }
      }
      for (const part of parts) {
        if (part?.type !== "tool" || typeof part.tool !== "string") continue;
        const state = part.state && typeof part.state === "object" ? part.state : {};
        const started = Number(state?.time?.start) || Number(message?.info?.time?.created) || null;
        const ended = Number(state?.time?.end) || Number(message?.info?.time?.completed) || started;
        const source = { type: part.type, tool: part.tool, title: state.title || "" };
        const kind = part.tool === "bash" && /test|--check/i.test(String(state.title || "")) ? "test" : classifyEventKind("tool", source);
        eventFor(sessionId, { kind, tool: part.tool, action: state.title || part.tool, operation: eventOperation(kind, source), timestamp: started ? new Date(started).toISOString() : undefined, durationMs: started && ended ? Math.max(0, ended - started) : null, status: state.status === "completed" ? "success" : state.status === "error" ? "error" : "started", retry: 0, errorCode: state.status === "error" ? "OPENCODE_TOOL_ERROR" : null });
      }
    }
  } catch (error) { audit({ runId: sessionId, result: "session_telemetry_unavailable", errorCode: "OPENCODE_SESSION_EVENTS_UNAVAILABLE" }); }
}

function skillCatalog() {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md"))).map((entry) => {
    const text = fs.readFileSync(path.join(skillsRoot, entry.name, "SKILL.md"), "utf8");
    const frontmatter = Object.fromEntries((/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || "").split(/\r?\n/).map((line) => line.split(/:\s*/, 2)).filter(([key]) => key));
    return { name: entry.name, version: frontmatter.version || "1.0.0", description: frontmatter.description || "", changeClass: frontmatter.change_class || "ctb", supportedModes: String(frontmatter.supported_modes || "").split(",").map((value) => value.trim()).filter(Boolean), path: path.join(skillsRoot, entry.name, "SKILL.md") };
  });
}

function exposeTool(tool) {
  const toolClass = classifyTool(tool.name);
  if (!toolClass) throw new Error(`CTB_TOOL_CLASSIFICATION_MISSING:${tool.name}`);
  const securitySchemes = [{ type: "oauth2", scopes: [requiredScope(toolClass)] }];
  const inputSchema = { ...(tool.inputSchema || { type: "object" }), properties: { ...(tool.inputSchema?.properties || {}) } };
  if (toolClass === TOOL_CLASSES.WRITE || toolClass === TOOL_CLASSES.PRIVILEGED_WRITE || toolClass === TOOL_CLASSES.ADMIN) {
    // Model entrypoints additionally serve read-only DIAGNOSE/PLAN inference (plan agent).
    const modelEntrypoint = MODEL_ENTRYPOINTS.has(tool.name);
    inputSchema.properties.ctb = {
      type: "object",
      description: modelEntrypoint
        ? "CTB envelope. mode DIAGNOSE or PLAN runs real read-only inference via the plan agent (no Paperclip, no registry writes). mode EXECUTE requires the full execution envelope: paperclipIssueId, changeIntent, scope, acceptanceCriteria and idempotencyKey."
        : "Required CTB execution envelope: mode EXECUTE, changeClass ctb, paperclipIssueId, changeIntent, scope, acceptanceCriteria and idempotencyKey.",
      properties: { mode: modelEntrypoint ? { enum: ["DIAGNOSE", "PLAN", "EXECUTE"] } : { const: "EXECUTE" }, changeClass: { const: "ctb" }, paperclipIssueId: { type: "string" }, changeIntent: { type: "string" }, scope: { type: "string" }, acceptanceCriteria: { type: "string" }, idempotencyKey: { type: "string" }, retry: { type: "boolean", description: "Required only to repeat a failed or reconciled execution with the same idempotency key." }, taskClass: { type: "string", description: "Request hint ONLY (telemetry). The authoritative task class is derived server-side from the validated Paperclip issue and cannot be extended by the client." }, currentStage: { type: "string", description: "Request hint ONLY (telemetry). The authoritative stage is derived server-side from the validated Paperclip issue." }, executionContext: { type: "object", description: "Optional. Correlate the run with an existing OpenCode session. Omit for opencode_run/opencode_ask — the gateway bootstraps a new session.", properties: { sessionId: { type: "string" } }, additionalProperties: false } },
      required: modelEntrypoint ? ["mode", "changeClass"] : ["mode", "changeClass", "paperclipIssueId", "changeIntent", "scope", "acceptanceCriteria", "idempotencyKey"],
    };
  }
  return { ...tool, title: tool.title || tool.name, description: `[${toolClass}] ${tool.description || ""}`, inputSchema, securitySchemes, _meta: { ...(tool._meta || {}), securitySchemes, kompas: { toolClass, changeClass: toolClass === TOOL_CLASSES.READ || toolClass === TOOL_CLASSES.SESSION_CONTROL ? null : "ctb" } } };
}

function ctbScopeError() { return Object.assign(new Error("CTB_ISSUE_SCOPE_MISMATCH"), { code: "CTB_ISSUE_SCOPE_MISMATCH" }); }
function issueCtbPolicy(issue) {
  const candidate = issue?.executionPolicy?.ctb || issue?.metadata?.ctb;
  if (!candidate || candidate.changeClass !== "ctb" || !Array.isArray(candidate.projectRoots) || !Array.isArray(candidate.changeIntents) || !Array.isArray(candidate.acceptanceCriteria)) return null;
  return candidate;
}
async function validatePaperclipIssue(ctb, directory) {
  const base = process.env.PAPERCLIP_API_URL;
  const token = process.env.PAPERCLIP_SERVICE_TOKEN;
  const expectedCompanyId = process.env.PAPERCLIP_COMPANY_ID || "";
  if (!base || !token) throw Object.assign(new Error("PAPERCLIP_AUTH_FAILED"), { code: "PAPERCLIP_AUTH_FAILED" });
  const response = await fetch(`${base.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(ctb.paperclipIssueId)}`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("PAPERCLIP_AUTH_FAILED"), { code: "PAPERCLIP_AUTH_FAILED" });
  if (response.status === 404) throw Object.assign(new Error("PAPERCLIP_ISSUE_NOT_FOUND"), { code: "PAPERCLIP_ISSUE_NOT_FOUND" });
  if (!response.ok) throw Object.assign(new Error("PAPERCLIP_ISSUE_NOT_FOUND"), { code: "PAPERCLIP_ISSUE_NOT_FOUND" });
  const issue = await response.json();
  if (expectedCompanyId && issue?.companyId !== expectedCompanyId) throw ctbScopeError();
  if (ctb.companyId && ctb.companyId !== issue?.companyId) throw ctbScopeError();
  if (!["todo", "in_progress"].includes(issue?.status) || issue?.workMode === "ask" || issue?.workMode === "planning") throw ctbScopeError();
  // Paperclip owns workspace scope. Do not infer authorization from prose fields.
  const detail = evaluateIssueCtbPolicyDetailed(issue, directory, ctb.changeIntent, ctb.acceptanceCriteria);
  if (detail.error) throw Object.assign(new Error(detail.error), { code: detail.error });
  const policy = issueCtbPolicy(issue);
  const issueRoot = issue.currentExecutionWorkspace.cwd;
  const decision = { companyId: issue.companyId, issueId: issue.id, lifecycle: issue.status, workspace: issueRoot, canonicalAuthorizedWorkspace: detail.canonicalWorkspaceRoot, canonicalRequestedDirectory: detail.canonicalDirectory, ctbPolicy: { changeClass: policy?.changeClass || "ctb", projectRoots: policy?.projectRoots || [issueRoot], changeIntent: ctb.changeIntent, acceptanceCriteria: ctb.acceptanceCriteria, source: detail.decisionSource }, issuedAt: new Date().toISOString(), policy: "ctb-v2", revision: CTB_POLICY_REVISION };
  return { issue, decision };
}

function idempotencyId(companyId, issueId, key) { return `${companyId}:${issueId}:${key}`; }
// Deterministic idempotency lookup across retries: one idempotency key = one logical
// execution whose attempts may span multiple run rows (one session per attempt).
// Preference order: running (replay) > completed (terminal success always wins over any
// earlier failed attempt) > failed/process_lost/interrupted (latest first). This makes
// "failed #1 -> retry #2 success -> request #3" return the successful #2 instead of
// surfacing a stale CTB_RETRY_REQUIRED.
function findIdempotentRun(companyId, issueId, key) {
  return selectIdempotentRun(Object.values(runs).filter((run) => matchesIdempotencyRun(run, companyId, issueId, key)));
}
function findIdempotentExecution(companyId, issueId, key) {
  return selectIdempotentRun(Object.values(executions).filter((execution) => matchesIdempotencyRun(execution, companyId, issueId, key)));
}
function executionById(executionId) { return typeof executionId === "string" && executions[executionId] ? executions[executionId] : null; }
function executionView(execution) {
  if (!execution) return null;
  const run = execution.runId ? runs[execution.runId] : null;
  return {
    ...execution,
    state: execution.status,
    sessionId: execution.sessionId || run?.runId || null,
    runId: execution.runId || run?.runId || null,
    summary: run ? { metrics: metricsFor(run), eventCount: (run.events || []).length } : null,
  };
}
function updateExecution(executionId, patch = {}) {
  const execution = executionById(executionId);
  if (!execution) return null;
  Object.assign(execution, patch);
  persistRuns();
  return execution;
}
function executionStatusFromRun(run) {
  if (!run) return null;
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "waiting_for_permission") return "waiting_for_permission";
  if (run.status === "aborted") return "aborted";
  // A gateway restart cannot prove that the underlying process survived. Expose this as
  // terminal failure with a retry contract instead of leaving a stale running execution.
  if (run.status === "process_lost") return "failed";
  return run.status;
}
// Crash/restart reconciliation: executionLocks are RAM-only while the registry is
// persistent, so any persisted `running` row observed at process start belongs to a
// process that no longer exists. Mark it process_lost (retryable via the normal
// retry contract) instead of pretending RUNNING forever.
function reconcileInterruptedRunsAtStartup() {
  const recovered = [];
  for (const run of Object.values(runs)) {
    if (!run || run.status !== "running") continue;
    if (activeCtbExecutions.has(run.runId)) continue; // defensive: never touch live executions
    finishRun(run.runId, "process_lost");
    runs[run.runId].errorCode = "CTB_PROCESS_LOST";
    recovered.push(run.runId);
  }
  const recoveredExecutions = [];
  for (const execution of Object.values(executions)) {
    if (!execution || !["running", "waiting_for_permission"].includes(execution.status)) continue;
    Object.assign(execution, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      reconciliation: { required: true, reason: "process_lost", detectedAt: new Date().toISOString() },
      errorCode: "CTB_PROCESS_LOST",
      errorMessage: "Gateway restarted before the execution settled; retry is required.",
      retryable: true,
    });
    recoveredExecutions.push(execution.executionId);
  }
  if (recovered.length || recoveredExecutions.length) { persistRuns(); audit({ result: "crash_recovery", processLostRuns: recovered, processLostExecutions: recoveredExecutions }); }
  return recovered;
}
function recordRun(sessionId, ctb, directory, actor, policyDecision, createdAt = new Date().toISOString(), ownerKey = null) {
  if (!sessionId || !ctb) return;
  if (!runs[sessionId]) runs[sessionId] = { runId: sessionId, executionId: ctb.executionId || null, companyId: policyDecision.companyId, paperclipIssueId: ctb.paperclipIssueId, changeClass: ctb.changeClass, mode: ctb.mode, changeIntent: ctb.changeIntent, acceptanceCriteria: ctb.acceptanceCriteria, idempotencyKey: ctb.idempotencyKey, directory, actor, ownerKey: ownerKey || String(actor || "*"), policyDecision, status: "running", createdAt, finishedAt: null, events: [], retries: 0 };
  else if (ctb.executionId && !runs[sessionId].executionId) runs[sessionId].executionId = ctb.executionId;
  if (ctb.executionId && executions[ctb.executionId]) updateExecution(ctb.executionId, { sessionId, runId: sessionId });
  const pending = pendingEvents.get(sessionId) || []; pendingEvents.delete(sessionId); for (const event of pending) eventFor(sessionId, event);
  persistRuns();
}
// Session ownership: knowing a sessionId grants NOTHING. Every mutating session
// operation (SESSION_CONTROL class and session-mutating writes) must correlate to a run
// owned by the authenticated principal+client pair; registry identity is authoritative
// and sessionId references found in output text never establish ownership.
function ownerKeyFor(token) { return `${String(token?.sub ?? "*")}|${String(token?.client_id ?? "*")}`; }
function assertSessionOwnership(sessionId, token) {
  if (!sessionId) return;
  const run = runs[sessionId];
  const execution = Object.values(executions).find((candidate) => candidate.sessionId === sessionId);
  const ownerRecord = run || execution;
  const errorCode = sessionOwnershipError(ownerRecord, ownerKeyFor(token), token?.sub);
  if (errorCode) {
    audit({ result: "session_ownership_denied", sessionId, expectedOwner: ownerRecord?.ownerKey || ownerRecord?.actor || null, principalId: token?.sub ?? null, clientId: token?.client_id ?? null, errorCode });
    throw Object.assign(new Error(errorCode), { code: errorCode, sessionId });
  }
}
function eventFor(sessionId, event) { if (!sessionId || !runs[sessionId]) return; const run = runs[sessionId]; if (run.status !== "running") return; run.events.push({ runId: sessionId, paperclipIssueId: run.paperclipIssueId, sequence: run.events.length + 1, timestamp: event.timestamp || new Date().toISOString(), errorCode: null, retry: 0, ...sanitize(event) }); run.events.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp))); run.events.forEach((item, index) => { item.sequence = index + 1; }); persistRuns(); }
function appendTelemetryEvent(sessionId, event) { if (!sessionId || !runs[sessionId] || !activeCtbExecutions.has(sessionId)) return; eventFor(sessionId, event); }
function flushPendingEvents(fromKey, toSessionId) { const pending = pendingEvents.get(fromKey) || []; pendingEvents.delete(fromKey); for (const event of pending) eventFor(toSessionId, event); }
function finishRun(sessionId, status) {
  if (!sessionId || !runs[sessionId]) return;
  const execution = executionById(runs[sessionId].executionId);
  if (execution?.status === "aborted" && status !== "aborted") status = "aborted";
  runs[sessionId].status = status;
  runs[sessionId].finishedAt = new Date().toISOString();
  if (execution && status === "process_lost") {
    Object.assign(execution, { status: "failed", finishedAt: runs[sessionId].finishedAt, reconciliation: { required: true, reason: "process_lost", detectedAt: new Date().toISOString() }, retryable: true, errorCode: "CTB_PROCESS_LOST", errorMessage: "Gateway restarted before the execution settled; retry is required." });
  } else if (execution && execution.status !== "aborted") {
    const executionStatus = executionStatusFromRun(runs[sessionId]);
    if (executionStatus) Object.assign(execution, { status: executionStatus, finishedAt: runs[sessionId].finishedAt, retryable: executionStatus === "failed" });
  }
  persistRuns();
}
function metricsFor(run) { const events = run.events || []; const toolEvents = events.filter((event) => ["tool", "mcp", "search", "file", "command", "test", "git"].includes(event.kind)); const fingerprints = new Set(); let duplicateCalls = 0; for (const event of toolEvents) { const fingerprint = `${event.kind}|${event.tool || event.action || ""}|${event.status || ""}`; if (fingerprints.has(fingerprint)) duplicateCalls += 1; else fingerprints.add(fingerprint); } const startedAt = Date.parse(run.createdAt || "") || 0; const elapsed = (event) => { const at = Date.parse(event.timestamp || "") || 0; return startedAt && at ? Math.max(0, at - startedAt) : null; }; const firstWrite = events.find((event) => event.kind === "file" && event.operation === "write"); const firstTest = events.find((event) => event.kind === "test"); const finishedAt = Date.parse(run.finishedAt || "") || startedAt; return { toolCalls: toolEvents.length, failedToolCalls: toolEvents.filter((event) => event.status === "error").length, retryCount: events.reduce((total, event) => total + (Number(event.retry) || 0), 0), duplicateCalls, searchCalls: events.filter((event) => event.kind === "search").length, fileReads: events.filter((event) => event.kind === "file" && event.operation === "read").length, fileWrites: events.filter((event) => event.kind === "file" && event.operation === "write").length, testCalls: events.filter((event) => event.kind === "test").length, mcpCalls: events.filter((event) => event.kind === "mcp").length, timeToFirstWriteMs: firstWrite ? elapsed(firstWrite) : null, timeToFirstTestMs: firstTest ? elapsed(firstTest) : null, durationMs: startedAt ? Math.max(0, finishedAt - startedAt) : 0 }; }

async function assertUpstreamSessionWorkspace(sessionId, directory) {
  let response;
  try {
    response = await fetch(`${serverUrl}/session/${encodeURIComponent(sessionId)}`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) });
  } catch {
    throw Object.assign(new Error("CTB_SESSION_WORKSPACE_UNVERIFIED"), { code: "CTB_SESSION_WORKSPACE_UNVERIFIED", failureStage: "session_workspace_lookup_transport", sessionId, requestedDirectory: canonicalPath(directory), observedDirectory: null });
  }
  if (!response.ok) throw Object.assign(new Error("CTB_SESSION_WORKSPACE_UNVERIFIED"), { code: "CTB_SESSION_WORKSPACE_UNVERIFIED", failureStage: "session_workspace_lookup_response", sessionId, requestedDirectory: canonicalPath(directory), observedDirectory: null, upstreamStatus: response.status });
  let session;
  try { session = await response.json(); }
  catch { throw Object.assign(new Error("CTB_SESSION_WORKSPACE_UNVERIFIED"), { code: "CTB_SESSION_WORKSPACE_UNVERIFIED", failureStage: "session_workspace_lookup_schema", sessionId, requestedDirectory: canonicalPath(directory), observedDirectory: null }); }
  const observedDirectory = typeof session?.directory === "string" ? session.directory : null;
  const expectedDirectory = canonicalPath(directory);
  if (!observedDirectory || canonicalPath(observedDirectory).toLowerCase() !== expectedDirectory.toLowerCase()) {
    throw Object.assign(new Error("CTB_SESSION_WORKSPACE_UNVERIFIED"), { code: "CTB_SESSION_WORKSPACE_UNVERIFIED", failureStage: "session_workspace_mismatch", sessionId, requestedDirectory: expectedDirectory, observedDirectory: observedDirectory ? canonicalPath(observedDirectory) : null });
  }
  return expectedDirectory;
}
async function createUpstreamSession(directory, title) {
  let response;
  try {
    response = await fetch(`${serverUrl}/session`, { method: "POST", headers: { ...openCodeHeaders, "content-type": "application/json", "x-opencode-directory": directory }, body: JSON.stringify({ title: String(title || "CTB execution").slice(0, 80) }) });
  } catch (error) {
    throw Object.assign(new Error("CTB_SESSION_CREATE_FAILED"), { code: "CTB_SESSION_CREATE_FAILED", failureStage: "session_create_transport", upstreamTool: "POST /session", causeCode: error?.code || null });
  }
  if (!response.ok) {
    const body = sanitize(String(await response.text()).slice(0, 500));
    throw Object.assign(new Error("CTB_SESSION_CREATE_FAILED"), { code: "CTB_SESSION_CREATE_FAILED", failureStage: "session_create_response", upstreamTool: "POST /session", upstreamStatus: response.status, upstreamBody: body });
  }
  let session;
  try { session = await response.json(); }
  catch { throw Object.assign(new Error("CTB_SESSION_CREATE_FAILED"), { code: "CTB_SESSION_CREATE_FAILED", failureStage: "session_create_schema", upstreamTool: "POST /session" }); }
  if (typeof session?.id !== "string" || !session.id) throw Object.assign(new Error("CTB_SESSION_CREATE_FAILED"), { code: "CTB_SESSION_CREATE_FAILED", failureStage: "session_create_schema", upstreamTool: "POST /session" });
  await assertUpstreamSessionWorkspace(session.id, directory);
  return session.id;
}
async function fetchSessionMessages(sessionId) {
  const response = await fetch(`${serverUrl}/session/${encodeURIComponent(sessionId)}/message`, { headers: openCodeHeaders });
  if (!response.ok) throw Object.assign(new Error("MESSAGE_LOOKUP_FAILED"), { code: "MESSAGE_LOOKUP_FAILED" });
  return response.json();
}
let modelLimitsCache = { fetchedAt: 0, limits: {} };
async function modelLimits() {
  if (Date.now() - modelLimitsCache.fetchedAt < 10 * 60 * 1000) return modelLimitsCache.limits;
  try {
    const response = await fetch(`${serverUrl}/config/providers`, { headers: openCodeHeaders });
    if (!response.ok) throw new Error(`providers ${response.status}`);
    const payload = await response.json();
    const limits = {};
    for (const provider of Array.isArray(payload?.providers) ? payload.providers : []) {
      for (const model of Object.values(provider.models || {})) {
        if (model?.id) limits[`${provider.id}/${model.id}`] = { context: Number(model.limit?.context) || null, output: Number(model.limit?.output) || null };
      }
    }
    modelLimitsCache = { fetchedAt: Date.now(), limits };
  } catch { modelLimitsCache = { fetchedAt: Date.now(), limits: {} }; }
  return modelLimitsCache.limits;
}
// Model registry mirror: lets the gateway prove whether the configured default/fallback models
// actually exist in the OpenCode provider registry, so config and registry stay consistent (P1).
let modelRegistryCache = { fetchedAt: 0, validRefs: new Set(), defaultPerProvider: {} };
let modelCatalogCache = { fetchedAt: 0, providers: [] };
async function providerCatalog() {
  if (Date.now() - modelCatalogCache.fetchedAt < 60 * 1000) return modelCatalogCache.providers;
  let response;
  try { response = await fetch(`${serverUrl}/config/providers`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) }); }
  catch { throw Object.assign(new Error("CTB_MODEL_REGISTRY_UNAVAILABLE"), { code: "CTB_MODEL_REGISTRY_UNAVAILABLE" }); }
  if (!response.ok) throw Object.assign(new Error("CTB_MODEL_REGISTRY_UNAVAILABLE"), { code: "CTB_MODEL_REGISTRY_UNAVAILABLE" });
  const payload = await response.json();
  const providers = (Array.isArray(payload?.providers) ? payload.providers : []).map((provider) => {
    const configured = Boolean(provider?.source || provider?.apiKey || provider?.oauth || provider?.configured === true);
    const models = Object.entries(provider?.models && typeof provider.models === "object" ? provider.models : {}).map(([modelKey, model]) => ({
      providerID: provider.id || null,
      modelID: model?.id || modelKey,
      name: model?.name || model?.id || modelKey,
      availability: { configured, available: configured || model?.status === "available" || model?.available === true },
      variants: model?.variants && typeof model.variants === "object" ? model.variants : {},
      reasoning: model?.reasoning ?? model?.capabilities?.reasoning ?? null,
      capabilities: model?.capabilities && typeof model.capabilities === "object" ? model.capabilities : {},
      limits: { context: Number(model?.limit?.context) || null, output: Number(model?.limit?.output) || null },
    }));
    return { providerID: provider.id || null, name: provider.name || provider.id || null, configured, models };
  });
  modelCatalogCache = { fetchedAt: Date.now(), providers };
  return providers;
}
function modelCatalogDefaults() {
  return { configuredDefault: `${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}`, configuredFallback: FALLBACK_MODEL ? `${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.modelID}` : null, registryDefault: modelRegistryCache.defaultPerProvider };
}
async function normalizedModels() {
  const providers = await providerCatalog();
  return { ...modelCatalogDefaults(), providers, models: providers.flatMap((provider) => provider.models) };
}
async function refreshModelRegistry() {
  try {
    const response = await fetch(`${serverUrl}/config/providers`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`providers ${response.status}`);
    const payload = await response.json();
    const validRefs = new Set();
    const defaultPerProvider = payload?.default && typeof payload.default === "object" ? payload.default : {};
    for (const provider of Array.isArray(payload?.providers) ? payload.providers : []) {
      const models = provider.models && typeof provider.models === "object" ? provider.models : {};
      for (const mid of Object.keys(models)) validRefs.add(`${provider.id}/${mid}`);
    }
    modelRegistryCache = { fetchedAt: Date.now(), validRefs, defaultPerProvider };
  } catch { /* keep last-known registry */ }
}
function effectiveDefaultModel() {
  // The configured default (env OPENCODE_MCP_DEFAULT_MODEL) is authoritative: the OpenCode
  // provider registry listing can be incomplete and omit valid aliases, so absence from the
  // enumerated listing does NOT mean the model is unusable. We surface the listing gap via
  // defaultModelInRegistry but never avoid using the operator-configured default.
  return DEFAULT_MODEL;
}
function defaultModelInRegistry() { return modelRegistryCache.validRefs.has(`${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}`); }
async function paperclipSignalsFor(run) {
  // Read-only, best-effort Paperclip checkpoint signal. Never blocks analytics.
  const base = process.env.PAPERCLIP_API_URL;
  const token = process.env.PAPERCLIP_SERVICE_TOKEN;
  if (!base || !token || !run.paperclipIssueId) return {};
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/api/issues/${encodeURIComponent(run.paperclipIssueId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return {};
    const issue = await response.json();
    return issue?.currentCheckpoint || issue?.checkpoint ? { checkpoint: true } : {};
  } catch { return {}; }
}
const runAnalyticsCache = new Map();
async function runAnalytics(run, { refresh = false } = {}) {
  const cached = runAnalyticsCache.get(run.runId);
  if (cached && !refresh && run.status !== "running") return cached;
  const [rawMessages, limits] = await Promise.all([fetchSessionMessages(run.runId), modelLimits()]);
  const paperclipSignals = run.status === "completed" ? {} : await paperclipSignalsFor(run);
  const analytics = buildRunAnalytics(run, rawMessages, { modelLimits: limits, taskBoundaryMs: Date.parse(run.createdAt || "") || null, paperclipSignals });
  runAnalyticsCache.set(run.runId, analytics);
  return analytics;
}

// Public model-facing surface: canonical, semantically non-redundant tool set for ChatGPT.
// The full upstream surface remains callable (de-promoted, admin/internal) and can be
// restored eagerly with OPENCODE_MCP_SURFACE=full.
const PUBLIC_TOOLSET = new Set([
  // READ / diagnosis
  "opencode_status", "opencode_context", "opencode_sessions_overview", "opencode_session_list",
  "opencode_session_get", "opencode_session_status", "opencode_session_todo", "opencode_session_diff",
  "opencode_conversation", "opencode_provider_models", "opencode_mcp_status", "opencode_vcs_info",
  // WRITE entrypoints
  "opencode_ask", "opencode_run", "opencode_reply",
  // SESSION_CONTROL (narrowed)
  "opencode_session_abort",
]);
const CUSTOM_PUBLIC_TOOLS = ["opencode_list_skills", "opencode_get_skill", "opencode_message_model_info", "opencode_mcp_effective_profile", "opencode_security_status", "opencode_run_inspect", "paperclipCompareRunMetrics", "paperclipAggregateRunMetrics", "opencode_execution_start", "opencode_execution_status", "opencode_execution_abort", "opencode_permission_list", "opencode_permission_resolve", "opencode_models_list", "opencode_model_info", "opencode_find_files", "opencode_workspace_tree", "opencode_inspect", "opencode_execution_get", "opencode_capability_request"];
// Control-plane / read-only diagnostic tools. Failures here must be reported as a DISTINCT
// error class (CTB_CONTROL_PLANE_UNAVAILABLE) and must never be conflated with inference
// failures (UPSTREAM_TOOL_ERROR / CTB_NATIVE_AGENTS_UNAVAILABLE). Reads never invoke a model,
// so a dead inference backend must not make the control plane undiagnosable.
const CONTROL_PLANE_TOOLS = new Set([
  "opencode_status", "opencode_context", "opencode_sessions_overview", "opencode_session_list",
  "opencode_session_get", "opencode_session_status", "opencode_session_todo", "opencode_session_diff",
  "opencode_conversation", "opencode_file_read", "opencode_file_status", "opencode_find_text",
  "opencode_find_symbol", "opencode_provider_models", "opencode_mcp_status", "opencode_vcs_info",
  "opencode_security_status", "opencode_message_model_info", "opencode_mcp_effective_profile",
  "opencode_run_inspect", "opencode_ctb_get_run", "opencode_ctb_get_events", "opencode_ctb_get_metrics",
  "opencode_execution_status", "opencode_execution_get", "opencode_execution_inspect", "opencode_permission_list", "opencode_models_list", "opencode_model_info", "opencode_find_files", "opencode_workspace_tree", "opencode_inspect", "opencode_capability_request",
  "paperclipGetRunMetrics", "paperclipGetRunEvents", "paperclipGetRunTokenUsage", "paperclipGetRunSteps",
  "paperclipGetRunContextBreakdown", "paperclipGetRunModelTurns", "paperclipCompareRunMetrics", "paperclipAggregateRunMetrics",
]);
function eagerSurfaceEnabled() { return String(process.env.OPENCODE_MCP_SURFACE || "").toLowerCase() === "full"; }
const EXECUTION_TERMINAL_STATES = new Set(["completed", "failed", "aborted"]);
const EXECUTION_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
function executionOwner(execution, token) {
  if (!execution) throw Object.assign(new Error("CTB_EXECUTION_NOT_FOUND"), { code: "CTB_EXECUTION_NOT_FOUND" });
  const errorCode = sessionOwnershipError(execution, ownerKeyFor(token), token?.sub);
  if (errorCode) throw Object.assign(new Error(errorCode), { code: errorCode });
  return execution;
}
async function upstreamJson(method, endpoint, directory, bodyValue) {
  const options = { method, headers: { ...openCodeHeaders, ...(directory ? { "x-opencode-directory": directory } : {}) } };
  if (bodyValue !== undefined) { options.headers["content-type"] = "application/json"; options.body = JSON.stringify(bodyValue); }
  let response;
  try { response = await fetch(`${serverUrl}${endpoint}`, { ...options, signal: AbortSignal.timeout(5000) }); }
  catch { throw Object.assign(new Error("CTB_CONTROL_PLANE_UNAVAILABLE"), { code: "CTB_CONTROL_PLANE_UNAVAILABLE" }); }
  if (!response.ok) throw Object.assign(new Error("CTB_CONTROL_PLANE_UNAVAILABLE"), { code: "CTB_CONTROL_PLANE_UNAVAILABLE", status: response.status });
   if (response.status === 204) return null;
   const text = await response.text();
   if (!text) return null;
   try { return JSON.parse(text); } catch { return { text }; }
}
async function pendingPermissions(directory) {
  const raw = await upstreamJson("GET", "/permission", directory);
  return Array.isArray(raw) ? raw : [];
}
function ownerForPermission(permission, token) {
  const sessionId = permission?.sessionID || permission?.sessionId;
  if (!sessionId) return false;
  assertSessionOwnership(sessionId, token);
  return true;
}
async function monitorExecution(executionId) {
  for (;;) {
    const execution = executionById(executionId);
    if (!execution || EXECUTION_TERMINAL_STATES.has(execution.status)) return;
    if (!execution.timedOut && Date.parse(execution.timeoutAt || "") <= Date.now()) {
      execution.timedOut = true;
      execution.errorCode = "CTB_EXECUTION_TIMEOUT";
      execution.errorMessage = "Execution exceeded its observation timeout; the underlying call remains active.";
      persistRuns();
    }
    if (execution.sessionId) {
      // A deleted upstream session cannot have a live underlying execution. Only an
      // explicit 404 terminalizes it; transient control-plane failures remain observable
      // without falsely failing a valid run.
      if (!execution.lastSessionLivenessCheckAt || Date.now() - Date.parse(execution.lastSessionLivenessCheckAt) >= 15_000) {
        execution.lastSessionLivenessCheckAt = new Date().toISOString();
        try {
          const session = await fetch(`${serverUrl}/session/${encodeURIComponent(execution.sessionId)}`, { headers: openCodeHeaders, signal: AbortSignal.timeout(5000) });
          if (session.status === 404) {
            finishRun(execution.runId || execution.sessionId, "process_lost");
            if (runs[execution.runId || execution.sessionId]) runs[execution.runId || execution.sessionId].errorCode = "CTB_PROCESS_LOST";
            persistRuns();
            return;
          }
        } catch { /* transient liveness probe failures must not fabricate process loss */ }
      }
      try {
        const matches = (await pendingPermissions(execution.directory)).filter((permission) => String(permission?.sessionID || permission?.sessionId || "") === execution.sessionId);
        const nextStatus = matches.length ? "waiting_for_permission" : (execution.permissionRequired ? "waiting_for_permission" : "running");
        if (execution.status !== nextStatus && !EXECUTION_TERMINAL_STATES.has(execution.status)) updateExecution(executionId, { status: nextStatus, permissionIds: matches.map((permission) => permission.id).filter(Boolean) });
      } catch { /* permission observation is best effort and never changes execution safety */ }
    }
    await new Promise((resolve) => { const timer = setTimeout(resolve, 1000); timer.unref?.(); });
  }
}
async function executionInspection(execution) {
  const run = execution.runId ? runs[execution.runId] : Object.values(runs).find((candidate) => candidate.executionId === execution.executionId);
  const result = { execution: executionView(execution), workspace: { requestedDirectory: execution.directory || null, canonicalWorkspace: execution.workspaceRoot || null, sessionWorkspace: execution.sessionWorkspace || null, verified: Boolean(execution.sessionWorkspace) }, authorization: run?.policyDecision?.ctbPolicy ? { source: run.policyDecision.ctbPolicy.source, companyId: run.policyDecision.companyId, issueId: run.policyDecision.issueId, lifecycle: run.policyDecision.lifecycle } : null, capabilities: execution.profile || null, transport: { kind: "direct_http", endpoint: "POST /session/:id/message" }, events: run?.events || [], tokens: null, steps: [], context: null, models: run?.model || null };
  if (!run) return result;
  try {
    const analytics = await runAnalytics(run, { refresh: true });
    result.tokens = { totals: { inputTokens: analytics.overhead.totalInputTokens, outputTokens: analytics.overhead.totalOutputTokens, cacheReadTokens: analytics.overhead.totalCacheReadTokens, cacheWriteTokens: analytics.overhead.totalCacheWriteTokens }, turns: analytics.turns };
    result.steps = analytics.steps;
    result.context = { overhead: analytics.overhead, perTurn: analytics.turns.map((turn) => ({ turnIndex: turn.turnIndex, messageId: turn.messageId, contextWindowTokens: turn.contextWindowTokens, contextUtilizationPct: turn.contextUtilizationPct, contextBreakdown: turn.contextBreakdown })) };
    result.models = analytics.turns.map((turn) => ({ providerId: turn.providerId, modelId: turn.modelId, agent: turn.agent, messageId: turn.messageId }));
  } catch { /* a running or unavailable upstream session still has a useful registry view */ }
  return result;
}
async function workspaceTree(directory, workspaceRoot, relativePath = ".", maxDepth = 2, limit = 200) {
  const root = validateIssueWorkspaceToolPathArguments({ directory, path: relativePath }, workspaceRoot, directory).path;
  maxDepth = Math.min(Math.max(Number(maxDepth) || 2, 0), 8);
  limit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const entries = [];
  const walk = (current, depth) => {
    if (entries.length >= limit || depth > maxDepth) return;
    let children;
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= limit) break;
      const childPath = path.join(current, child.name);
      let safePath;
      try { safePath = validateIssueWorkspaceToolPathArguments({ directory, path: childPath }, workspaceRoot, directory).path; } catch { continue; }
      const isDirectory = child.isDirectory() || child.isSymbolicLink() && (() => { try { return fs.statSync(safePath).isDirectory(); } catch { return false; } })();
      entries.push({ path: path.relative(root, safePath) || ".", name: child.name, type: isDirectory ? "directory" : "file", depth: depth + 1 });
      if (isDirectory) walk(safePath, depth + 1);
    }
  };
  walk(root, 0);
  return { root, maxDepth, limit, truncated: entries.length >= limit, entries };
}
async function waitForExecution(executionId, token, waitMs, pollMs) {
  const deadline = Date.now() + Math.min(Math.max(Number(waitMs) || 0, 0), 30_000);
  let execution = executionOwner(executionById(executionId), token);
  while (Date.now() < deadline && !EXECUTION_TERMINAL_STATES.has(execution.status)) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(pollMs) || 500, 100), 5000)));
    execution = executionOwner(executionById(executionId), token);
  }
  return execution;
}
function resetExecutionForAttempt(execution, run, ctb, attempt) {
  const now = new Date().toISOString();
  Object.assign(execution, {
    status: "running",
    finishedAt: null,
    timeoutAt: new Date(Date.now() + execution.timeoutMs).toISOString(),
    timedOut: false,
    retryable: false,
    permissionRequired: false,
    permissionIds: [],
    errorCode: null,
    errorMessage: null,
    reconciliation: null,
    attempt,
    ctb,
  });
  if (run) Object.assign(run, { status: "running", finishedAt: null, errorCode: null, errorMessage: null });
  execution.createdAt = execution.createdAt || now;
}

async function prepareModelExecution(name, args, token) {
  if (!hasScope(token, "opencode:ctb:execute")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:ctb:execute" });
  const contextError = ctbContextError(args);
  if (contextError) throw Object.assign(new Error(contextError.code), contextError);
  const ctb = args.ctb;
  const prompt = typeof args.prompt === "string" ? args.prompt : args.message;
  if (!prompt || !String(prompt).trim()) throw Object.assign(new Error("CTB_PROMPT_REQUIRED"), { code: "CTB_PROMPT_REQUIRED" });
  const forwardedInput = Object.fromEntries(Object.entries(args || {}).filter(([key]) => !["ctb", "timeoutMs", "capabilities"].includes(key)));
  const requestedForwarded = validateToolPathArguments(forwardedInput, allowedRoots, workspaceRoot);
  const authorization = await validatePaperclipIssue(ctb, requestedForwarded.directory);
  const forwarded = validateIssueWorkspaceToolPathArguments({ ...forwardedInput, directory: requestedForwarded.directory }, authorization.decision.canonicalAuthorizedWorkspace, requestedForwarded.directory);
  const key = idempotencyId(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
  const existing = findIdempotentExecution(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
  if (existing) {
    executionOwner(existing, token);
    if (["running", "waiting_for_permission", "completed"].includes(existing.status) && !existing.reconciliation?.required) return { execution: existing, replayed: true };
    if (ctb.retry !== true) throw Object.assign(new Error("CTB_RETRY_REQUIRED"), { code: "CTB_RETRY_REQUIRED", executionId: existing.executionId });
  }
  const existingRun = findIdempotentRun(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
  if (!existing && existingRun?.status === "completed") return { replayed: true, result: existingRun.result || toolResult({ executionId: existingRun.executionId || null, sessionId: existingRun.runId, state: "completed", replayed: true }, "Zwrócono istniejący wynik CTB.") };
  if (executionLocks.has(key)) return { replayed: true, lockExecutionId: executionLocks.get(key) };
  const trustedContext = trustedContextFromIssue(authorization.issue);
  const profile = effectiveProfileFor(token, trustedContext, authorization.issue?.identifier || null);
  const reconciled = reconcileProfileWithAgent(profile, "EXECUTE");
  // Verify the authoritative native-agent inventory before reserving an execution or
  // creating its session. Native mode never falls back to build silently.
  if (NATIVE_AGENTS_ENABLED) {
    const nativeAgents = await verifyNativeAgents();
    if (!nativeAgents.verified) throw Object.assign(new Error("CTB_NATIVE_AGENTS_UNAVAILABLE"), { code: "CTB_NATIVE_AGENTS_UNAVAILABLE", failureStage: "agent_preflight", missingAgents: [...nativeAgents.missingAgents] });
  }
  const resolvedAgent = selectCtbAgent("EXECUTE", profile);
  const requestedCapabilities = Array.isArray(args.capabilities) ? [...new Set(args.capabilities.filter((value) => typeof value === "string"))] : [];
  const deniedCapabilities = requestedCapabilities.filter((capability) => !reconciled.executableCapabilities.includes(capability));
  if (deniedCapabilities.length) throw Object.assign(new Error("CTB_CAPABILITY_DENIED"), { code: "CTB_CAPABILITY_DENIED", requestedCapabilities, allowedCapabilities: reconciled.executableCapabilities, deniedCapabilities, unenforceableCapabilities: reconciled.unenforceableCapabilities });
  const explicitSessionId = ctb.executionContext?.sessionId || forwarded.sessionId || forwarded.id || null;
  if (!explicitSessionId && !BOOTSTRAP_ENTRYPOINTS.has(name)) throw Object.assign(new Error("CTB_EXECUTION_SESSION_REQUIRED"), { code: "CTB_EXECUTION_SESSION_REQUIRED" });
  if (existing?.sessionId && explicitSessionId && existing.sessionId !== explicitSessionId) throw Object.assign(new Error("CTB_SESSION_ALREADY_CORRELATED"), { code: "CTB_SESSION_ALREADY_CORRELATED" });
  if (explicitSessionId && runs[explicitSessionId] && runs[explicitSessionId].idempotencyKey !== ctb.idempotencyKey && !existing) throw Object.assign(new Error("CTB_SESSION_ALREADY_CORRELATED"), { code: "CTB_SESSION_ALREADY_CORRELATED" });
  const executionId = existing?.executionId || `exec_${random(18)}`;
  // Reserve the idempotency key before the only possible session network call.
  executionLocks.set(key, executionId);
  const now = Date.now();
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || EXECUTION_DEFAULT_TIMEOUT_MS, 1000), 24 * 60 * 60 * 1000);
  let sessionId;
  try {
    sessionId = existing?.sessionId || explicitSessionId || await createUpstreamSession(forwarded.directory, args.title || ctb.changeIntent);
    const sessionWorkspace = await assertUpstreamSessionWorkspace(sessionId, forwarded.directory);
    assertSessionOwnership(sessionId, token);
    const executionCtb = { ...ctb, executionId, executionContext: { ...(ctb.executionContext || {}), sessionId } };
    const execution = existing || {
      executionId, sessionId, runId: null,
      companyId: authorization.issue.companyId, paperclipIssueId: ctb.paperclipIssueId, idempotencyKey: ctb.idempotencyKey,
      ownerKey: ownerKeyFor(token), ctb: executionCtb, directory: forwarded.directory, workspaceRoot: authorization.decision.canonicalAuthorizedWorkspace, sessionWorkspace,
      trustedContext, profile: { resolvedRole: profile.resolvedRole, agent: resolvedAgent, requestedCapabilities, executableCapabilities: reconciled.executableCapabilities },
      status: "running", createdAt: new Date(now).toISOString(), finishedAt: null,
      timeoutMs, timeoutAt: new Date(now + timeoutMs).toISOString(), timedOut: false, retryable: false, attempt: 0,
    };
    execution.timeoutMs = timeoutMs;
    execution.workspaceRoot = authorization.decision.canonicalAuthorizedWorkspace;
    execution.sessionWorkspace = sessionWorkspace;
    authorization.decision.sessionWorkspace = sessionWorkspace;
    resetExecutionForAttempt(execution, runs[sessionId] || null, executionCtb, (existing?.attempt || 0) + 1);
    executions[executionId] = execution;
    recordRun(sessionId, executionCtb, forwarded.directory, token.sub, authorization.decision, existing?.createdAt || new Date(now).toISOString(), ownerKeyFor(token));
    resetExecutionForAttempt(execution, runs[sessionId] || null, executionCtb, execution.attempt);
    persistRuns();
    activeCtbExecutions.set(sessionId, { createdAt: execution.createdAt, runId: sessionId });
    return { execution, key, name, prompt: String(prompt), forwarded, authorization, trustedContext, resolvedAgent, requestedCapabilities };
  } catch (error) {
    if (executionLocks.get(key) === executionId) executionLocks.delete(key);
    throw error;
  }
}
async function prepareReadOnlyModelExecution(name, args, token, intake) {
  const prompt = typeof args.prompt === "string" ? args.prompt : args.message;
  if (!prompt || !String(prompt).trim()) throw Object.assign(new Error("CTB_PROMPT_REQUIRED"), { code: "CTB_PROMPT_REQUIRED" });
  const forwarded = validateToolPathArguments(Object.fromEntries(Object.entries(args || {}).filter(([key]) => key !== "ctb")), allowedRoots, workspaceRoot);
  const profile = effectiveProfileFor(token);
  const resolvedAgent = selectCtbAgent("PLAN", profile);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || EXECUTION_DEFAULT_TIMEOUT_MS, 1000), 24 * 60 * 60 * 1000);
  const now = Date.now();
  const sessionId = await createUpstreamSession(forwarded.directory, args.title || `${intake.mode} OpenCode`);
  const sessionWorkspace = await assertUpstreamSessionWorkspace(sessionId, forwarded.directory);
  const execution = {
    executionId: `exec_${random(18)}`,
    sessionId,
    runId: null,
    ownerKey: ownerKeyFor(token),
    directory: forwarded.directory,
    workspaceRoot: forwarded.directory,
    sessionWorkspace,
    mode: intake.mode,
    readOnly: true,
    profile: { resolvedRole: profile.resolvedRole, agent: resolvedAgent, requestedCapabilities: [], executableCapabilities: [] },
    status: "running",
    createdAt: new Date(now).toISOString(),
    finishedAt: null,
    timeoutMs,
    timeoutAt: new Date(now + timeoutMs).toISOString(),
    timedOut: false,
    retryable: false,
    attempt: 1,
  };
  executions[execution.executionId] = execution;
  persistRuns();
  return { execution, name, prompt: String(prompt), forwarded, resolvedAgent };
}
async function settleModelExecution(context, token) {
  const { execution, key, name, prompt, forwarded, authorization, trustedContext, resolvedAgent } = context;
  const readOnly = execution.readOnly === true;
  const sessionId = execution.sessionId;
  const startedAt = Date.now();
  const telemetry = telemetryBase(token, { name, ctb: execution.ctb, directory: forwarded.directory, mode: execution.ctb?.mode || execution.mode, trustedContext });
  // One-shot entrypoints share the message endpoint after the gateway allocates
  // the authoritative session. The upstream run helper must not allocate another
  // session during the same logical execution or its fallback attempt.
  const transport = { kind: "direct_http", endpoint: "POST /session/:id/message", entrypoint: name };
  let modelArgs = { ...forwarded, sessionId, prompt, ctb: execution.ctb, ...(MODEL_ENTRYPOINTS.has(name) ? { agent: resolvedAgent } : {}) };
  if (MODEL_ENTRYPOINTS.has(name)) modelArgs = applyDefaultModel(modelArgs);
  try {
    if (execution.status === "aborted") throw executionAbortedError();
    const outcome = await callModelWithFallback(name, modelArgs, { ...telemetry, requestedModel: requestedModelFrom(modelArgs), transport }, { shouldContinue: () => execution.status !== "aborted" });
    if (execution.status === "aborted") throw executionAbortedError();
    if (!readOnly) {
      await collectSessionToolEvents(sessionId);
      eventFor(sessionId, { kind: "tool", tool: name, action: "model_invocation", transport, durationMs: Date.now() - startedAt, status: "success" });
    }
    const requestedModel = requestedModelFrom(modelArgs);
    const modelIdentity = summarizeModelIdentity(requestedModel, await lastAssistantModelInfo(sessionId), { fallbackUsed: outcome.fallbackUsed, fallbackReason: outcome.fallbackReason, attempts: outcome.attempts });
    if (execution.status === "aborted") throw executionAbortedError();
    if (!readOnly) finishRun(sessionId, "completed");
    modelIdentity.sessionId = sessionId;
    modelIdentity.agent = resolvedAgent;
    recordModelIdentity(sessionId, modelIdentity);
    if (!readOnly) runs[sessionId].model = modelIdentity;
    const response = correlatedModelResult(outcome.result, execution, false);
    updateExecution(execution.executionId, { sessionId, runId: readOnly ? null : sessionId, status: "completed", finishedAt: new Date().toISOString(), result: response, permissionRequired: false, retryable: false, errorCode: null, errorMessage: null });
    audit({ ...telemetry, paperclipIssueId: execution.paperclipIssueId, runId: sessionId, tool: name, transport, requestedModel, modelIdentity, resolvedAgent, result: "success", durationMs: Date.now() - startedAt });
    return response;
  } catch (error) {
    attachExecutionIdentity(error, execution);
    if (!readOnly) eventFor(sessionId, { kind: "error", tool: name, action: "model_invocation", transport, durationMs: Date.now() - startedAt, status: "error", errorCode: error.code || "UPSTREAM_ERROR", failureStage: error.failureStage || null });
    const aborted = execution.status === "aborted";
    const requiresPermission = !aborted && permissionError(error);
    const status = aborted ? "aborted" : requiresPermission ? "waiting_for_permission" : "failed";
    if (!readOnly) finishRun(sessionId, status);
    if (MODEL_ENTRYPOINTS.has(name)) recordModelIdentity(sessionId, summarizeModelIdentity(requestedModelFrom(modelArgs), { messageId: null, providerActual: null, modelActual: null }, { fallbackUsed: typeof error.fallbackUsed === "boolean" ? error.fallbackUsed : false, fallbackReason: error.fallbackReason ?? String(error.code || error.message || "UPSTREAM_ERROR").slice(0, 200), attempts: error.modelAttempts }));
    updateExecution(execution.executionId, { status, finishedAt: status === "waiting_for_permission" ? null : (execution.finishedAt || new Date().toISOString()), permissionRequired: requiresPermission, retryable: status === "failed", errorCode: aborted ? "CTB_EXECUTION_ABORTED" : requiresPermission ? "CTB_PERMISSION_REQUIRED" : error.code || "UPSTREAM_ERROR", errorMessage: aborted ? "Aborted by the execution owner." : String(error.message || error).slice(0, 500) });
    audit({ ...telemetry, paperclipIssueId: execution.paperclipIssueId, runId: sessionId, tool: name, transport, result: "error", errorCode: error.code || "UPSTREAM_ERROR", failureStage: error.failureStage || null, durationMs: Date.now() - startedAt });
    throw error;
  } finally {
    activeCtbExecutions.delete(sessionId);
    if (key && executionLocks.get(key) === execution.executionId) executionLocks.delete(key);
  }
}
async function runCanonicalModelExecution(name, args, token) {
  const context = await prepareModelExecution(name, args, token);
  if (context.replayed) {
    if (context.result) return correlatedModelResult(context.result, context.execution || { executionId: context.result?.structuredContent?.executionId || null, sessionId: context.result?.structuredContent?.sessionId || null, status: "completed" }, true);
    if (context.lockExecutionId) return toolResult({ executionId: context.lockExecutionId, state: "running", replayed: true }, "Istniejące wykonanie CTB jest aktywne.");
    if (context.execution.status === "completed" && context.execution.result) return correlatedModelResult(context.execution.result, context.execution, true);
    return toolResult(executionView(context.execution), "Istniejące wykonanie CTB.");
  }
  void monitorExecution(context.execution.executionId);
  return settleModelExecution(context, token);
}
async function startExecution(args, token) {
  const context = await prepareModelExecution("opencode_run", args, token);
  if (context.replayed) {
    if (context.result) return correlatedModelResult(context.result, context.execution || { executionId: context.result?.structuredContent?.executionId || null, sessionId: context.result?.structuredContent?.sessionId || null, status: "completed" }, true);
    if (context.lockExecutionId) return toolResult({ executionId: context.lockExecutionId, state: "running", replayed: true }, "Istniejące wykonanie CTB jest aktywne.");
    return toolResult({ ...executionView(context.execution), replayed: true }, "Istniejące wykonanie CTB.");
  }
  void monitorExecution(context.execution.executionId);
  void settleModelExecution(context, token).catch(() => {});
  const execution = context.execution;
  return toolResult({ executionId: execution.executionId, sessionId: execution.sessionId, state: execution.status, status: execution.status, replayed: false, attempt: execution.attempt, timeoutAt: execution.timeoutAt, capabilities: execution.profile }, "Uruchomiono asynchroniczne wykonanie CTB.");
}
async function customTool(name, args, token) {
  if (name === "opencode_execution_start") return startExecution(args, token);
  if (["opencode_execution_get", "opencode_execution_status", "opencode_execution_inspect", "opencode_inspect"].includes(name)) {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    let execution = executionOwner(executionById(args.executionId), token);
    if (name === "opencode_execution_status" && (args.wait === true || Number(args.waitMs) > 0)) execution = await waitForExecution(args.executionId, token, args.waitMs ?? 30_000, args.pollMs);
    const summaryOnly = ["opencode_execution_get", "opencode_execution_status"].includes(name);
    return toolResult(summaryOnly ? executionView(execution) : await executionInspection(execution), summaryOnly ? "Stan wykonania CTB." : "Zunifikowana inspekcja wykonania CTB.");
  }
  if (name === "opencode_execution_abort") {
    if (!hasScope(token, "opencode:session")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:session" });
    const execution = executionOwner(executionById(args.executionId), token);
    if (EXECUTION_TERMINAL_STATES.has(execution.status)) return toolResult(executionView(execution), "Wykonanie CTB jest już zakończone.");
    execution.status = "aborted"; execution.finishedAt = new Date().toISOString(); execution.errorCode = "CTB_EXECUTION_ABORTED"; execution.errorMessage = "Aborted by the execution owner.";
    finishRun(execution.runId || execution.sessionId, "aborted");
    let abortError = null;
    if (execution.sessionId) { try { await engine.start(); await engine.call("tools/call", { name: "opencode_session_abort", arguments: { id: execution.sessionId, directory: execution.directory } }); } catch (error) { abortError = error.code || "CTB_UPSTREAM_ABORT_FAILED"; } }
    return toolResult({ ...executionView(execution), abortError }, "Przerwano wykonanie CTB.");
  }
  if (name === "opencode_permission_list") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const requestedSession = args.sessionId || null;
    if (!requestedSession) throw Object.assign(new Error("CTB_EXECUTION_SESSION_REQUIRED"), { code: "CTB_EXECUTION_SESSION_REQUIRED" });
    assertSessionOwnership(requestedSession, token);
    const execution = executionOwner(Object.values(executions).find((candidate) => candidate.sessionId === requestedSession), token);
    const directory = validateIssueWorkspaceToolPathArguments({ directory: args.directory || execution.directory }, execution.workspaceRoot || execution.directory, execution.directory).directory;
    const permissions = (await pendingPermissions(directory)).filter((permission) => !requestedSession || String(permission?.sessionID || permission?.sessionId || "") === requestedSession).filter((permission) => {
      const sessionId = permission?.sessionID || permission?.sessionId;
       const ownerRecord = sessionId && (runs[sessionId] || Object.values(executions).find((execution) => execution.sessionId === sessionId));
       return sessionId && ownerRecord && !sessionOwnershipError(ownerRecord, ownerKeyFor(token), token?.sub);
    }).map((permission) => ({ id: permission.id || null, sessionId: permission.sessionID || permission.sessionId || null, permission: permission.permission || null, patterns: Array.isArray(permission.patterns) ? permission.patterns : [], tool: permission.tool || null, always: Array.isArray(permission.always) ? permission.always : [] }));
    return toolResult({ permissions, count: permissions.length }, "Oczekujące zgody OpenCode.");
  }
  if (name === "opencode_permission_resolve") {
    if (!hasScope(token, "opencode:ctb:execute")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:ctb:execute" });
    const contextError = ctbContextError(args);
    if (contextError) throw Object.assign(new Error(contextError.code), contextError);
    if (!["once", "always", "reject"].includes(args.reply)) throw Object.assign(new Error("CTB_PERMISSION_REPLY_INVALID"), { code: "CTB_PERMISSION_REPLY_INVALID" });
    assertSessionOwnership(args.sessionId, token);
    const requestedDirectory = validateToolPathArguments({ directory: args.directory }, allowedRoots, workspaceRoot).directory;
    const authorization = await validatePaperclipIssue(args.ctb, requestedDirectory);
    const directory = validateIssueWorkspaceToolPathArguments({ directory: requestedDirectory }, authorization.decision.canonicalAuthorizedWorkspace, requestedDirectory).directory;
    const permissions = await pendingPermissions(directory);
    const pending = permissions.find((permission) => String(permission?.id || "") === String(args.permissionId || "") && String(permission?.sessionID || permission?.sessionId || "") === String(args.sessionId));
    if (!pending) throw Object.assign(new Error("CTB_PERMISSION_NOT_FOUND"), { code: "CTB_PERMISSION_NOT_FOUND" });
    try { await upstreamJson("POST", `/permission/${encodeURIComponent(args.permissionId)}/reply`, directory, { reply: args.reply }); } catch { await upstreamJson("POST", `/session/${encodeURIComponent(args.sessionId)}/permissions/${encodeURIComponent(args.permissionId)}`, directory, { response: args.reply }); }
    const linked = Object.values(executions).find((execution) => execution.sessionId === args.sessionId && execution.status === "waiting_for_permission");
    if (linked) {
      const linkedRun = linked.runId ? runs[linked.runId] : runs[args.sessionId];
      if (args.reply === "reject") {
        updateExecution(linked.executionId, { status: "aborted", finishedAt: new Date().toISOString(), permissionRequired: false, errorCode: "CTB_PERMISSION_REJECTED" });
        finishRun(linked.runId || args.sessionId, "aborted");
      } else {
        if (activeCtbExecutions.has(args.sessionId)) {
          // The upstream message is still pending and will continue after the
          // permission response; keep both registry rows in sync.
          if (linkedRun) Object.assign(linkedRun, { status: "running", finishedAt: null, errorCode: null, errorMessage: null });
          updateExecution(linked.executionId, { status: "running", finishedAt: null, permissionRequired: false, errorCode: null, errorMessage: null });
        } else {
          // A settled request cannot be resumed by resolving its permission.
          // Make the retry contract explicit instead of exposing a dead RUNNING state.
          finishRun(linked.runId || args.sessionId, "failed");
          updateExecution(linked.executionId, { status: "failed", permissionRequired: false, retryable: true, errorCode: "CTB_PERMISSION_RESOLVED_RETRY_REQUIRED", errorMessage: "Permission resolved after the underlying request settled; retry with ctb.retry=true." });
        }
      }
    }
    return toolResult({ permissionId: args.permissionId, sessionId: args.sessionId, reply: args.reply, state: args.reply === "reject" ? "aborted" : "resolved" }, "Rozstrzygnięto zgodę OpenCode.");
  }
  if (name === "opencode_models_list") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const catalog = await normalizedModels();
    return toolResult({ ...catalog, models: args.providerID ? catalog.models.filter((model) => model.providerID === args.providerID) : catalog.models }, "Dostępne modele i warianty OpenCode.");
  }
  if (name === "opencode_model_info") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const catalog = await normalizedModels();
    const model = catalog.models.find((candidate) => candidate.providerID === args.providerID && candidate.modelID === args.modelID);
    if (!model) throw Object.assign(new Error("CTB_MODEL_NOT_FOUND"), { code: "CTB_MODEL_NOT_FOUND", providerID: args.providerID, modelID: args.modelID });
    return toolResult({ ...model, ...catalog }, "Informacje o modelu OpenCode.");
  }
  if (name === "opencode_find_files" || name === "opencode_workspace_tree") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const execution = executionOwner(executionById(args.executionId), token);
    const scopeRoot = execution.workspaceRoot || execution.directory;
    const forwarded = validateIssueWorkspaceToolPathArguments({ directory: args.directory || execution.directory, ...(name === "opencode_workspace_tree" ? { path: args.path || "." } : {}) }, scopeRoot, execution.directory);
    if (name === "opencode_find_files") {
       const base = args.searchDirectory ? validateIssueWorkspaceToolPathArguments({ directory: args.searchDirectory }, scopeRoot, execution.directory).directory : forwarded.directory;
       const query = new URLSearchParams({ query: String(args.query || ""), type: String(args.type || "file"), directory: base, limit: String(Math.min(Math.max(Number(args.limit) || 100, 1), 500)) });
       const raw = await upstreamJson("GET", `/find/file?${query}`, base);
       const values = Array.isArray(raw) ? raw : Array.isArray(raw?.files) ? raw.files : Array.isArray(raw?.results) ? raw.results : [];
       return toolResult({ directory: base, query: args.query, results: values.map((value) => typeof value === "string" ? { path: value } : { path: value?.path || value?.name || null, type: value?.type || args.type || "file" }) }, "Znalezione pliki i katalogi.");
     }
      const result = await workspaceTree(forwarded.directory, scopeRoot, args.path || ".", args.depth, args.limit);
     return toolResult({ directory: forwarded.directory, path: result.root, tree: result.entries, truncated: result.truncated, maxDepth: result.maxDepth, limit: result.limit }, "Drzewo workspace OpenCode.");
  }
  if (name === "opencode_capability_request") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const execution = args.executionId ? executionOwner(executionById(args.executionId), token) : null;
    const profile = effectiveProfileFor(token, execution?.trustedContext || {}, execution?.paperclipIssueId || null);
    const reconciled = reconcileProfileWithAgent(profile, "EXECUTE");
    const requested = Array.isArray(args.capabilities) ? args.capabilities.filter((capability) => typeof capability === "string") : [];
    const allowed = requested.filter((capability) => reconciled.executableCapabilities.includes(capability));
    const denied = requested.filter((capability) => !allowed.includes(capability));
    return toolResult({ policy: "server_authoritative", resolvedRole: profile.resolvedRole, profile, agent: reconciled.agent, executableCapabilities: reconciled.executableCapabilities, unenforceableCapabilities: reconciled.unenforceableCapabilities, requestedCapabilities: requested, allowedCapabilities: allowed, deniedCapabilities: denied, decision: denied.length ? "deny" : "allow", globalConfigMutation: false, source: execution ? "validated_execution_context" : "authenticated_principal" }, "Rozstrzygnięcie capability przez politykę serwera.");
  }
  return null;
}
async function callTool(name, args, token, options = {}) {
  const customResult = await customTool(name, args, token);
  if (customResult) return customResult;
  const requestedName = name;
  if (COMPATIBILITY_ALIASES[name]) {
    name = COMPATIBILITY_ALIASES[name];
    if (["opencode_get_run", "opencode_get_diff", "opencode_abort_run"].includes(requestedName)) args = { ...args, id: args.sessionId, sessionId: undefined };
  }
  if (name === "opencode_list_skills") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); return toolResult({ skills: skillCatalog().map(({ path: ignored, ...skill }) => skill) }, "DostÄ™pne skille CTB."); }
  if (name === "opencode_get_skill") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const skill = skillCatalog().find((item) => item.name === args.name); if (!skill) throw Object.assign(new Error("SKILL_NOT_FOUND"), { code: "SKILL_NOT_FOUND" }); return toolResult({ ...skill, contract: fs.readFileSync(skill.path, "utf8") }, "Kontrakt skilla CTB."); }
  if (name === "opencode_message_model_info") {
    // Read-only runtime verification of which provider/model actually served a session.
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    if (!args.sessionId) throw Object.assign(new Error("CTB_SESSION_REQUIRED"), { code: "CTB_SESSION_REQUIRED", missing: ["sessionId"] });
    const metaResponse = await fetch(`${serverUrl}/session/${encodeURIComponent(args.sessionId)}/message`, { headers: { authorization: `Basic ${Buffer.from(`${openCodeUsername}:${openCodePassword}`).toString("base64")}` } });
    if (!metaResponse.ok) throw Object.assign(new Error("MESSAGE_LOOKUP_FAILED"), { code: "MESSAGE_LOOKUP_FAILED" });
    const metaMessages = await metaResponse.json();
    // Gateway invocation record (requested/default model, fallback outcome) is authoritative
    // for the contract fields; runtime message metadata is authoritative for actual identity.
    const gatewayRecord = lookupModelRecord(args.sessionId);
    const entries = (Array.isArray(metaMessages) ? metaMessages : []).map((message) => {
      const info = message?.info && typeof message.info === "object" ? message.info : message;
      return { messageId: info.id ?? null, role: info.role ?? null, sessionId: args.sessionId, providerRequested: gatewayRecord?.providerRequested ?? null, modelRequested: gatewayRecord?.modelRequested ?? null, providerActual: info.providerID ?? null, modelActual: info.modelID ?? null, fallbackUsed: typeof gatewayRecord?.fallbackUsed === "boolean" ? gatewayRecord.fallbackUsed : null, fallbackReason: info.providerID || info.modelID ? (gatewayRecord?.fallbackReason ?? null) : "runtime did not report provider/model identity", attempts: gatewayRecord?.attempts ?? null, agent: info.agent ?? null, providerID: info.providerID ?? null, modelID: info.modelID ?? null };
    });
    return toolResult({ sessionId: args.sessionId, ...(gatewayRecord ? { gatewayInvocationRecord: { requestedModel: { providerRequested: gatewayRecord.providerRequested, modelRequested: gatewayRecord.modelRequested }, fallbackUsed: gatewayRecord.fallbackUsed, fallbackReason: gatewayRecord.fallbackReason } } : {}), messages: entries }, "Runtime model metadata for session messages.");
  }
  if (name === "opencode_mcp_status") {
    // Read-through with profile awareness: annotate the status with per-server
    // effectiveness for the caller's resolved role profile.
    const result = await engine.call("tools/call", { name, arguments: args });
    const profile = effectiveProfileFor(token);
    const eager = new Set(profile.eagerConnections || []);
    const isEffective = (entryName) => ["paperclip", "paperclip-local"].some((core) => entryName.includes(core)) || [...eager].some((entry) => entryName.includes(entry));
    try {
      const payload = result?.structuredContent;
      let serverNames = [];
      if (Array.isArray(payload?.mcp)) { result.structuredContent = { ...payload, mcp: payload.mcp.map((server) => ({ ...server, effectiveForCurrentProfile: isEffective(String(server.name || "").toLowerCase()) })) }; serverNames = payload.mcp.map((server) => String(server.name || "")); }
      else if (Array.isArray(payload)) { result.structuredContent = payload.map((server) => ({ ...server, effectiveForCurrentProfile: isEffective(String(server.name || "").toLowerCase()) })); serverNames = payload.map((server) => String(server.name || "")); }
      else if (Array.isArray(payload?.servers)) { result.structuredContent = { ...payload, servers: payload.servers.map((server) => ({ ...server, effectiveForCurrentProfile: isEffective(String(server.name || "").toLowerCase()) })) }; serverNames = payload.servers.map((server) => String(server.name || "")); }
      if (!serverNames.length && Array.isArray(result?.content)) {
        for (const part of result.content) {
          if (part?.type !== "text") continue;
          serverNames.push(...[...part.text.matchAll(/^\s*[-*]\s*([A-Za-z0-9_.-]+):/gm)].map((match) => match[1]));
        }
        if (serverNames.length) {
          const annotations = Object.fromEntries(serverNames.map((serverName) => [serverName, isEffective(serverName.toLowerCase())]));
          result.content.push({ type: "text", text: `[kompas] resolvedRole=${profile.resolvedRole} effectiveProfileSource=${profile.source} eager=[${[...eager].join(",")}] effectiveForCurrentProfile=${JSON.stringify(annotations)}` });
        }
      }
    } catch { /* passthrough on unexpected shape */ }
    return result;
  }
  if (name === "opencode_ctb_get_run" || name === "opencode_ctb_get_events" || name === "opencode_ctb_get_metrics") {
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const run = runs[args.runId]; if (!run) throw Object.assign(new Error("CTB_RUN_NOT_FOUND"), { code: "CTB_RUN_NOT_FOUND" });
    const events = run.events || [];
    const metrics = metricsFor(run);
    let analytics = null;
    try { analytics = await runAnalytics(run); } catch { analytics = null; }
    const enriched = analytics ? { modelTurnCount: analytics.metrics.modelTurnCount, invocationKind: analytics.invocationKind, totalInputTokens: analytics.overhead.totalInputTokens.value, totalOutputTokens: analytics.overhead.totalOutputTokens.value, avgContextUtilizationPct: analytics.metrics.avgContextUtilizationPct.value, timeToFirstUsefulActionMs: analytics.timings.timeToFirstUsefulActionMs.value } : {};
    return toolResult(name === "opencode_ctb_get_events" ? { runId: args.runId, events } : name === "opencode_ctb_get_metrics" ? { runId: args.runId, metrics: { ...metrics, ...enriched } } : { ...run, metrics: { ...metrics, ...enriched } }, "Telemetry CTB.");
  }
  if (name === "opencode_security_status") {
    // Read-only self-audit: machine-checkable security invariants, no secrets.
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const persistedRuns = Object.values(runs);
    return toolResult({
      revisions: { gateway: GATEWAY_REVISION, ctbPolicy: CTB_POLICY_REVISION, mcpRoleProfiles: roleProfilesDoc.revision },
      models: { default: `${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}`, fallback: FALLBACK_MODEL ? `${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.modelID}` : null, fallbackRetryLimit: 1 },
      nativeAgents: {
        required: REQUIRED_NATIVE_AGENTS,
        enabled: NATIVE_AGENTS_ENABLED,
        canonicalSource: "opencode_config_agent_block",
        configuredAgents: nativeAgentState.configuredAgents,
        foundAgents: nativeAgentState.foundAgents,
        missingAgents: nativeAgentState.missingAgents,
        verified: nativeAgentState.verified,
        enforcementMode: NATIVE_AGENTS_ENABLED ? (nativeAgentState.verified ? "native_enforced" : "fail_closed_unverified") : "builtin_plan_build",
        liveProbe: nativeAgentState.liveProbe,
        silentDowngradePossible: false,
      },
      capabilityPolicy: {
        shellGuard: "enabled",
        guardedBinaries: ["git", "gh", "wrangler", "playwright", "shadcn", "storybook"],
        launcherUnwrapping: ["cmd", "powershell", "pwsh", "npx", "pnpm", "npm", "yarn"],
        invariant: "effective granted capabilities == executable capabilities",
      },
      sessionOwnership: { enforced: true, ownerKeyContract: "sub|client_id", legacyRowsFallback: "actor sub equality", errorCode: "CTB_SESSION_OWNERSHIP_DENIED" },
      idempotency: { contract: "one key = one logical execution; success wins over earlier failed attempts", lookupPreference: ["running", "completed", "failed"] },
      crashRecovery: { startupReconciledProcessLostRuns: Array.isArray(startupProcessLostRuns) ? startupProcessLostRuns.length : 0, status: "process_lost retryable via retry contract" },
      oauth: { dcrSilentGrantBlocked: true, firstUseApprovalRequiredForNewClients: true, pkce: "S256 required", refreshRotationGraceMs: refreshGraceMs },
      registry: { runsTotal: persistedRuns.length, schemaVersion: savedRegistry?.version || 1 },
      publicToolCount: eagerSurfaceEnabled() ? null : PUBLIC_TOOLSET.size + CUSTOM_PUBLIC_TOOLS.length,
    }, "Self-audit bezpieczeństwa CTB.");
  }
  const RUN_ANALYTICS_TOOLS = new Set(["paperclipGetRunMetrics", "paperclipGetRunEvents", "paperclipGetRunTokenUsage", "paperclipGetRunSteps", "paperclipGetRunContextBreakdown", "paperclipGetRunModelTurns"]);
  if (name === "opencode_provider_models") {
    // READ-through that also surfaces the configured default/fallback contract so config and
    // the model registry become consistent and observable (P1: sync default model <-> registry).
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const result = await engine.call("tools/call", { name, arguments: args });
    try {
      const defaultRef = `${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}`;
      const eff = effectiveDefaultModel();
      const effectiveRef = `${eff.providerID}/${eff.modelID}`;
      const inRegistry = modelRegistryCache.validRefs.has(defaultRef);
      const fallbackRef = FALLBACK_MODEL ? `${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.modelID}` : null;
      // structuredContent from upstream is an array; named props on arrays are dropped by JSON
      // serialization, so surface the contract as an object AND append it to the human text.
      const note = `\n\n[kompas] configuredDefault=${defaultRef} effectiveDefault=${effectiveRef} defaultInRegistry=${inRegistry} fallback=${fallbackRef}`;
      if (Array.isArray(result?.content)) {
        result.content = result.content.map((p) => (p && p.type === "text" ? { ...p, text: (p.text || "") + note } : p));
      }
      result.structuredContent = {
        configuredDefaultModel: defaultRef,
        effectiveDefaultModel: effectiveRef,
        defaultModelInRegistry: inRegistry,
        configuredFallbackModel: fallbackRef,
        provider: args.providerId || null,
        raw: result.structuredContent,
      };
    } catch { /* passthrough on unexpected shape */ }
    return result;
  }
  if (name === "opencode_run_inspect") {
    // Consolidated read-only run inspector: one tool, explicit views (replaces the six
    // paperclipGetRun* getters on the public surface).
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const view = ["summary", "events", "tokens", "steps", "context", "models"].includes(args.view) ? args.view : "summary";
    return callTool(view === "summary" ? "paperclipGetRunMetrics" : view === "events" ? "paperclipGetRunEvents" : view === "tokens" ? "paperclipGetRunTokenUsage" : view === "steps" ? "paperclipGetRunSteps" : view === "context" ? "paperclipGetRunContextBreakdown" : "paperclipGetRunModelTurns", args, token);
  }
  if (RUN_ANALYTICS_TOOLS.has(name) || name === "paperclipCompareRunMetrics" || name === "paperclipAggregateRunMetrics") {
    // Read-only run analytics over OpenCode session/message metadata and the CTB correlation registry.
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const requireRuns = (ids) => ids.map((id) => { const run = runs[id]; if (!run) throw Object.assign(new Error("CTB_RUN_NOT_FOUND"), { code: "CTB_RUN_NOT_FOUND", runId: id }); return run; });
    if (RUN_ANALYTICS_TOOLS.has(name)) {
      if (!args.runId) throw Object.assign(new Error("CTB_RUN_REQUIRED"), { code: "CTB_RUN_REQUIRED", missing: ["runId"] });
      let analytics;
      try { analytics = await runAnalytics(requireRuns([args.runId])[0], { refresh: args.refresh === true }); }
      catch (error) {
        if (error.code === "MESSAGE_LOOKUP_FAILED") return toolResult({ runId: args.runId, supportedObservability: { tokenUsagePerTurn: { available: false, measurementSource: "unavailable", reason: "OpenCode session history unavailable for this run" } }, errorCode: "ANALYTICS_SOURCE_UNAVAILABLE" }, "Analiza niedostępna: brak historii sesji OpenCode dla tego runu.");
        throw error;
      }
      const payload = name === "paperclipGetRunMetrics"
        ? { runId: analytics.runId, status: analytics.status, createdAt: analytics.createdAt, finishedAt: analytics.finishedAt, invocationKind: analytics.invocationKind, invocationSignals: analytics.invocationSignals, providers: analytics.metrics.providers, metrics: analytics.metrics, timings: analytics.timings, overhead: analytics.overhead, ...supportedObservability(analytics.turns, analytics.timings, analytics.overhead) }
        : name === "paperclipGetRunEvents"
          ? { runId: analytics.runId, events: runs[args.runId].events || [], steps: analytics.steps }
          : name === "paperclipGetRunTokenUsage"
            ? { runId: analytics.runId, totals: { inputTokens: analytics.overhead.totalInputTokens, outputTokens: analytics.overhead.totalOutputTokens, cacheReadTokens: analytics.overhead.totalCacheReadTokens, cacheWriteTokens: analytics.overhead.totalCacheWriteTokens }, turns: analytics.turns.map((turn) => ({ messageId: turn.messageId, turnIndex: turn.turnIndex, providerId: turn.providerId, modelId: turn.modelId, agent: turn.agent, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, reasoningTokens: turn.reasoningTokens, cacheReadTokens: turn.cacheReadTokens, cacheWriteTokens: turn.cacheWriteTokens, totalTokens: turn.totalTokens })) }
            : name === "paperclipGetRunSteps"
              ? { runId: analytics.runId, stepCount: analytics.steps.length, steps: analytics.steps, timings: analytics.timings }
              : name === "paperclipGetRunContextBreakdown"
                ? { runId: analytics.runId, overhead: analytics.overhead, perTurn: analytics.turns.map((turn) => ({ turnIndex: turn.turnIndex, messageId: turn.messageId, contextWindowTokens: turn.contextWindowTokens, contextUtilizationPct: turn.contextUtilizationPct, contextBreakdown: turn.contextBreakdown })) }
                : { runId: analytics.runId, modelTurns: analytics.turns };
      return toolResult(payload, "Read-only analiza runu.");
    }
    if (name === "paperclipCompareRunMetrics") {
      const ids = Array.isArray(args.runIds) ? args.runIds : [];
      if (ids.length < 2) throw Object.assign(new Error("CTB_RUNS_REQUIRED"), { code: "CTB_RUNS_REQUIRED", missing: ["runIds[2+]"] });
      const list = [];
      for (const run of requireRuns(ids)) { try { list.push(await runAnalytics(run)); } catch { list.push(null); } }
      return toolResult({ comparison: compareRunMetrics(list.filter(Boolean)), unavailableRunIds: ids.filter((id, index) => !list[index]) }, "Porównanie runów.");
    }
    const selected = Array.isArray(args.runIds) && args.runIds.length
      ? requireRuns(args.runIds)
      : Object.values(runs).filter((run) => (!args.paperclipIssueId || run.paperclipIssueId === args.paperclipIssueId));
    const list = [];
    for (const run of selected.slice(0, 200)) { try { list.push(await runAnalytics(run)); } catch { /* skip runs without retrievable session history */ } }
    const groups = new Map();
    for (const item of list) {
      const keys = args.groupBy === "model" ? [...new Set(item.turns.map((turn) => `${turn.providerId}/${turn.modelId}`))] : [String(item.paperclipIssueId || "unassigned")];
      for (const key of keys) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    }
    return toolResult({
      groupBy: args.groupBy === "model" ? "model" : "issue",
      overall: aggregateRunAnalytics(list),
      groups: Object.fromEntries([...groups.entries()].map(([key, items]) => [key, aggregateRunAnalytics(items)])),
    }, "Agregacja metryk runów.");
  }
  if (name === "opencode_mcp_effective_profile") {
    // Read-only resolution of the effective MCP profile for the authenticated principal.
    // SINGLE RESOLUTION PATH: identical to real EXECUTE — server-authoritative inputs
    // only. Request-supplied taskClass/currentStage/projectKey are hints and can never
    // widen the profile; they are echoed back labeled ignored_untrusted for diagnostics.
    if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" });
    const profile = effectiveProfileFor(token);
    return toolResult({
      ...profile,
      revision: roleProfilesDoc.revision,
      requestedTaskClass: args.taskClass || null,
      requestedTaskClassSource: "ignored_untrusted",
      requestedCurrentStage: args.currentStage || null,
      requestedCurrentStageSource: "ignored_untrusted",
      requestedProjectKey: args.projectKey || null,
      resolutionInputs: {
        role: { value: profile.resolvedRole, source: "server" },
        taskClass: { value: null, source: "ignored_untrusted", note: "authoritative value arrives only from the validated Paperclip issue during EXECUTE" },
        currentStage: { value: null, source: "ignored_untrusted", note: "authoritative value arrives only from the validated Paperclip issue during EXECUTE" },
        projectKey: { source: "ignored_untrusted", note: "EXECUTE uses the server-verified issue.identifier only" },
      },
    }, "Efektywny profil MCP dla uwierzytelnionego principala.");
  }
  const upstreamTools = await engine.call("tools/list", {});
  const upstream = upstreamTools.tools.find((tool) => tool.name === name);
  if (!upstream) throw Object.assign(new Error("UNKNOWN_TOOL"), { code: "UNKNOWN_TOOL" });
  const toolClass = classifyTool(name);
  if (!toolClass) throw Object.assign(new Error("CTB_TOOL_CLASSIFICATION_MISSING"), { code: "CTB_TOOL_CLASSIFICATION_MISSING" });
  if (!hasScope(token, requiredScope(toolClass))) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: requiredScope(toolClass) });
  const intake = classifyIntake(args, toolClass, name);
  if (intake.handoffTo) return toolResult({ handoffTo: intake.handoffTo, mode: intake.mode, changeClass: intake.changeClass, errorCode: "CTB_REDIRECT" }, `HANDOFF_TO=${intake.handoffTo}`);
  if (intake.errorCode) throw Object.assign(new Error(intake.errorCode), intake, { code: intake.errorCode });
  // DIAGNOSE/PLAN model inference: real execution forced onto the read-only plan agent,
  // zero Paperclip authorization, zero CTB registry writes.
  if (intake.modelReadOnly) {
    const context = await prepareReadOnlyModelExecution(name, args, token, intake);
    const telemetry = telemetryBase(token, { name, ctb: args.ctb, directory: context.forwarded.directory, mode: intake.mode });
    audit({ ...telemetry, changeClass: "ctb", tool: requestedName, upstreamTool: name, requestedModel: requestedModelFrom(applyDefaultModel(context.forwarded)), executionId: context.execution.executionId, sessionId: context.execution.sessionId, resolvedAgent: context.resolvedAgent, result: "model_read_only_started" });
    try {
      return await settleModelExecution(context, token);
    } catch (error) {
      attachExecutionIdentity(error, context.execution);
      throw error;
    }
  }
  if (MODEL_ENTRYPOINTS.has(name)) return runCanonicalModelExecution(name, args, token);
  const contextError = toolClass === TOOL_CLASSES.WRITE || toolClass === TOOL_CLASSES.PRIVILEGED_WRITE || toolClass === TOOL_CLASSES.ADMIN ? ctbContextError(args) : null;
  if (contextError) throw Object.assign(new Error(contextError.code), contextError);
  const ctb = args.ctb;
  const forwarded = validateToolPathArguments(Object.fromEntries(Object.entries(args || {}).filter(([key]) => key !== "ctb")), allowedRoots, workspaceRoot);
  // Cross-run session isolation: mutating operations (SESSION_CONTROL and every
  // EXECUTE-class call referencing a correlated session) require ownership.
  if (toolClass !== TOOL_CLASSES.READ) assertSessionOwnership(ctb?.executionContext?.sessionId || forwarded.sessionId || forwarded.id || null, token);
  // Reads and plans are intentionally side-effect free in the CTB registry.
  if (toolClass === TOOL_CLASSES.READ || toolClass === TOOL_CLASSES.SESSION_CONTROL) return engine.call("tools/call", { name, arguments: forwarded });
  const explicitSessionId = ctb.executionContext?.sessionId || forwarded.sessionId || forwarded.id || null;
  if (!explicitSessionId && !BOOTSTRAP_ENTRYPOINTS.has(name)) throw Object.assign(new Error("CTB_EXECUTION_SESSION_REQUIRED"), { code: "CTB_EXECUTION_SESSION_REQUIRED" });
  const authorization = await validatePaperclipIssue(ctb, forwarded.directory);
  const key = idempotencyId(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
  const existing = findIdempotentRun(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
  const currentExecution = ctb.executionId ? executionById(ctb.executionId) : findIdempotentExecution(authorization.issue.companyId, ctb.paperclipIssueId, ctb.idempotencyKey);
   if (currentExecution && currentExecution.executionId !== ctb.executionId) {
    if (currentExecution.status === "failed" && ctb.retry !== true) throw Object.assign(new Error("CTB_RETRY_REQUIRED"), { code: "CTB_RETRY_REQUIRED", executionId: currentExecution.executionId });
    return toolResult(executionView(currentExecution), "IstniejÄ…ce wykonanie CTB.");
  }
  if (currentExecution?.status === "aborted") throw Object.assign(new Error("CTB_EXECUTION_ABORTED"), { code: "CTB_EXECUTION_ABORTED", executionId: currentExecution.executionId });
   const internalExecution = options.executionId && ctb.executionId === options.executionId && currentExecution?.executionId === options.executionId;
   if (!internalExecution && existing?.status === "running" && existing.executionId !== ctb.executionId) return toolResult({ runId: existing.runId, executionId: existing.executionId || null, status: "RUNNING", replayed: true }, "IstniejÄ…ce wykonanie CTB jest aktywne.");
   if (!internalExecution && existing?.status === "completed") return existing.result || toolResult({ runId: existing.runId, status: "COMPLETED", replayed: true }, "ZwrĂłcono istniejÄ…cy wynik CTB.");
   if (!internalExecution && existing?.status === "failed" && ctb.retry !== true) throw Object.assign(new Error("CTB_RETRY_REQUIRED"), { code: "CTB_RETRY_REQUIRED", runId: existing.runId });
   if (!internalExecution && executionLocks.has(key)) return toolResult({ runId: executionLocks.get(key), status: "RUNNING", replayed: true }, "IstniejÄ…ce wykonanie CTB jest aktywne.");
  if (explicitSessionId && runs[explicitSessionId] && runs[explicitSessionId].idempotencyKey !== ctb.idempotencyKey) throw Object.assign(new Error("CTB_SESSION_ALREADY_CORRELATED"), { code: "CTB_SESSION_ALREADY_CORRELATED" });
  const startedAt = Date.now();
  const telemetry = telemetryBase(token, { name, ctb, directory: forwarded.directory, mode: ctb?.mode, trustedContext: trustedContextFromIssue(authorization.issue) });
  let sessionId = explicitSessionId;
  const activeKey = sessionId || `bootstrap:${key}`;
  executionLocks.set(key, activeKey);
  activeCtbExecutions.set(activeKey, { createdAt: new Date(startedAt).toISOString(), runId: sessionId });
  if (sessionId) recordRun(sessionId, ctb, forwarded.directory, token.sub, authorization.decision, new Date(startedAt).toISOString(), ownerKeyFor(token));
  audit({ ...telemetry, paperclipIssueId: ctb?.paperclipIssueId || null, runId: sessionId || null, changeClass: ctb?.changeClass || null, tool: requestedName, upstreamTool: name, requestedModel: requestedModelFrom(MODEL_ENTRYPOINTS.has(name) ? applyDefaultModel(forwarded) : forwarded), authorizationSource: authorization.decision.ctbPolicy.source, result: "started" });
  let resolvedAgent = null;
  let forwardedForModel = null;
  try {
    if (!sessionId) {
      // Bootstrap: gateway owns session creation, so run identity stays authoritative.
      sessionId = await createUpstreamSession(forwarded.directory, forwarded.title || ctb.changeIntent);
      if (runs[sessionId] && runs[sessionId].idempotencyKey !== ctb.idempotencyKey) throw Object.assign(new Error("CTB_SESSION_ALREADY_CORRELATED"), { code: "CTB_SESSION_ALREADY_CORRELATED" });
      forwarded.sessionId = sessionId;
      // opencode_ask has no sessionId parameter; replying into the gateway-created session is equivalent.
      if (name === "opencode_ask") name = "opencode_reply";
      activeCtbExecutions.set(sessionId, { createdAt: new Date(startedAt).toISOString(), runId: sessionId });
      recordRun(sessionId, ctb, forwarded.directory, token.sub, authorization.decision, new Date(startedAt).toISOString(), ownerKeyFor(token));
    }
    if (ctb.executionId && executionById(ctb.executionId)?.status === "aborted") throw Object.assign(new Error("CTB_EXECUTION_ABORTED"), { code: "CTB_EXECUTION_ABORTED" });
    // Issue identifier (e.g. KOMAA-126) is the canonical override key; the raw
    // paperclipIssueId argument is often a UUID that cannot match overrides.
    // Server-authoritative context: taskClass/currentStage from the validated issue only.
    const trustedContext = trustedContextFromIssue(authorization.issue);
    const executionProfile = effectiveProfileFor(token, trustedContext, authorization.issue?.identifier || null);
    const reconciled = reconcileProfileWithAgent(executionProfile, "EXECUTE");
    resolvedAgent = selectCtbAgent("EXECUTE", executionProfile);
    // Shell capability guard: commands cannot recreate a capability the resolved profile
    // does not grant (git/wrangler/playwright/... through cmd/powershell/npx/pnpm/npm
    // launchers and inline interpreters). Server-side, based on the authoritative profile.
    if (typeof forwarded.command === "string" && forwarded.command.trim()) {
      assertShellCommandAllowed(reconciled.executableCapabilities, forwarded.command);
    }
    // Capability invariant enforcement: capabilities the selected native agent cannot
    // hard-enforce are denied at the gateway guard layer (never silently widened).
    if (reconciled.unenforceableCapabilities.length) {
      audit({ ...telemetry, paperclipIssueId: ctb?.paperclipIssueId || null, runId: sessionId || null, tool: requestedName, resolvedAgent, unenforceableCapabilities: reconciled.unenforceableCapabilities, result: "capability_unenforceable_denied" });
    }
    forwardedForModel = MODEL_ENTRYPOINTS.has(name) ? applyDefaultModel({ ...forwarded, ...(MODEL_ENTRYPOINTS.has(name) ? { agent: resolvedAgent } : {}) }) : forwarded;
    const modelOutcome = MODEL_ENTRYPOINTS.has(name)
      ? await callModelWithFallback(name, forwardedForModel, { ...telemetry, requestedModel: requestedModelFrom(forwardedForModel) })
      : { result: await engine.call("tools/call", { name, arguments: forwarded }), fallbackUsed: false, fallbackReason: null, attempts: null };
    const result = modelOutcome.result;
    await collectSessionToolEvents(sessionId);
    eventFor(sessionId, { kind: "tool", tool: name, action: requestedName, durationMs: Date.now() - startedAt, status: "success" });
    if (name !== "opencode_fire" && name !== "opencode_message_send_async") finishRun(sessionId, executionById(ctb.executionId)?.status === "aborted" ? "aborted" : "completed");
    runs[sessionId].result = result;
    // Model contract telemetry: requested before invocation, actual from runtime metadata.
    const requestedModel = requestedModelFrom(forwardedForModel);
    const modelIdentity = summarizeModelIdentity(requestedModel, await lastAssistantModelInfo(sessionId), { fallbackUsed: modelOutcome.fallbackUsed, fallbackReason: modelOutcome.fallbackReason, attempts: modelOutcome.attempts });
    if (modelOutcome.fallbackUsed) { modelIdentity.fallbackUsed = true; modelIdentity.fallbackReason = modelOutcome.fallbackReason; }
    modelIdentity.sessionId = sessionId;
    modelIdentity.agent = resolvedAgent;
    recordModelIdentity(sessionId, modelIdentity);
    runs[sessionId].model = modelIdentity;
    persistRuns();
    audit({ ...telemetry, paperclipIssueId: ctb?.paperclipIssueId || null, runId: sessionId, changeClass: ctb?.changeClass || null, tool: requestedName, upstreamTool: name, requestedModel, modelIdentity, resolvedAgent, authorizationSource: authorization.decision.ctbPolicy.source, result: "success", durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
     if (sessionId) {
       eventFor(sessionId, { kind: "error", tool: name, action: requestedName, durationMs: Date.now() - startedAt, status: "error", errorCode: error.code || "UPSTREAM_ERROR" });
       const linkedExecution = executionById(ctb.executionId);
       finishRun(sessionId, linkedExecution?.status === "aborted" ? "aborted" : internalExecution && permissionError(error) ? "waiting_for_permission" : "failed");
      // Model attempt trail survives total failure (primary + fallback both dead).
      if (MODEL_ENTRYPOINTS.has(name)) {
        recordModelIdentity(sessionId, summarizeModelIdentity(requestedModelFrom(forwardedForModel || {}), { messageId: null, providerActual: null, modelActual: null }, { fallbackUsed: typeof error.fallbackUsed === "boolean" ? error.fallbackUsed : false, fallbackReason: error.fallbackReason ?? String(error.code || error.message || "UPSTREAM_ERROR").slice(0, 200), attempts: error.modelAttempts }));
      }
      audit({ ...(telemetry || { principalId: token?.sub ?? null }), paperclipIssueId: ctb?.paperclipIssueId || null, runId: sessionId, changeClass: ctb?.changeClass || null, tool: requestedName, upstreamTool: name, resolvedAgent: typeof resolvedAgent === "string" ? resolvedAgent : null, result: "error", errorCode: error.code || "UPSTREAM_ERROR", durationMs: Date.now() - startedAt });
    } else {
      audit({ ...(telemetry || { principalId: token?.sub ?? null }), paperclipIssueId: ctb?.paperclipIssueId || null, changeClass: ctb?.changeClass || null, tool: requestedName, upstreamTool: name, directory: forwarded?.directory ?? null, result: "error", errorCode: error.code || "UPSTREAM_ERROR" });
    }
    throw error;
  } finally {
    activeCtbExecutions.delete(activeKey);
    if (sessionId && sessionId !== activeKey) activeCtbExecutions.delete(sessionId);
     if (!options.preserveExecutionLock && (executionLocks.get(key) === activeKey || executionLocks.get(key) === ctb.executionId)) executionLocks.delete(key);
  }
}

function customToolDefinitions() {
  const readSecurity = [{ type: "oauth2", scopes: ["opencode:read"] }];
  const sessionSecurity = [{ type: "oauth2", scopes: ["opencode:session"] }];
  const executeSecurity = [{ type: "oauth2", scopes: ["opencode:ctb:execute"] }];
  const ctbSchema = { type: "object", required: ["mode", "changeClass", "paperclipIssueId", "changeIntent", "scope", "acceptanceCriteria", "idempotencyKey"], properties: { mode: { const: "EXECUTE" }, changeClass: { const: "ctb" }, paperclipIssueId: { type: "string" }, changeIntent: { type: "string" }, scope: { type: "string" }, acceptanceCriteria: { type: "string" }, idempotencyKey: { type: "string" }, retry: { type: "boolean" }, executionContext: { type: "object", properties: { sessionId: { type: "string" } }, additionalProperties: false } }, additionalProperties: true };
  const definition = (name, title, description, properties, required, security = readSecurity, toolClass = security === readSecurity ? "READ" : "WRITE") => ({ name, title, description: `[${toolClass}] ${description}`, inputSchema: { type: "object", properties, required, additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: toolClass === "READ" }, securitySchemes: security, _meta: { kompas: { toolClass, changeClass: toolClass === "READ" || toolClass === "SESSION_CONTROL" ? null : "ctb" } } });
  return [
    definition("opencode_list_skills", "Skille CTB", "Lista kontraktów skilli CTB.", {}, []),
    definition("opencode_get_skill", "Kontrakt skilla CTB", "Zwraca kontrakt wskazanego skilla CTB.", { name: { type: "string" } }, ["name"]),
    definition("opencode_message_model_info", "Model metadata sesji", "Read-only metadata provider/model dla sesji OpenCode.", { sessionId: { type: "string" } }, ["sessionId"]),
    definition("opencode_security_status", "Stan bezpieczeństwa", "Read-only self-audit polityki CTB, OAuth, ownership i registry.", {}, []),
    definition("opencode_mcp_effective_profile", "Efektywny profil MCP", "Read-only profil MCP resolved server-side dla authenticated principal.", { taskClass: { type: "string" }, currentStage: { type: "string" }, projectKey: { type: "string" } }, []),
    definition("opencode_run_inspect", "Inspekcja runu CTB", "Read-only inspekcja runu: summary, events, tokens, steps, context albo models.", { runId: { type: "string" }, view: { enum: ["summary", "events", "tokens", "steps", "context", "models"] }, refresh: { type: "boolean" } }, ["runId"]),
    definition("paperclipCompareRunMetrics", "Porównanie runów", "Read-only porównanie metryk runów CTB.", { runIds: { type: "array", items: { type: "string" } } }, ["runIds"]),
    definition("paperclipAggregateRunMetrics", "Agregacja runów", "Read-only agregacja metryk runów CTB.", { runIds: { type: "array", items: { type: "string" } }, paperclipIssueId: { type: "string" }, groupBy: { enum: ["issue", "model"] } }, []),
      definition("opencode_execution_start", "Start wykonania CTB", "Uruchamia asynchroniczne exactly-once wykonanie i zwraca executionId oraz sessionId.", { prompt: { type: "string" }, directory: { type: "string" }, title: { type: "string" }, providerID: { type: "string" }, modelID: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000 }, capabilities: { type: "array", items: { type: "string" } }, ctb: ctbSchema }, ["prompt", "ctb"], executeSecurity, "WRITE"),
      definition("opencode_execution_get", "Pobierz wykonanie CTB", "Pobiera trwały stan wykonania do bezpiecznego pollingu.", { executionId: { type: "string" } }, ["executionId"]),
      definition("opencode_execution_status", "Status wykonania CTB", "Pobiera status wykonania; wait/poll pozwala obserwować zakończenie bez ponownego uruchomienia.", { executionId: { type: "string" }, wait: { type: "boolean" }, waitMs: { type: "integer", minimum: 0, maximum: 30000 }, pollMs: { type: "integer", minimum: 100, maximum: 5000 } }, ["executionId"]),
      definition("opencode_inspect", "Inspekcja wykonania CTB", "Zwraca status execution oraz skorelowane eventy, tokeny, kroki, kontekst i modele.", { executionId: { type: "string" } }, ["executionId"]),
     definition("opencode_execution_abort", "Przerwij wykonanie CTB", "Przerywa wykonanie przez sesję OpenCode.", { executionId: { type: "string" } }, ["executionId"], sessionSecurity, "SESSION_CONTROL"),
    definition("opencode_permission_list", "Oczekujące zgody", "Lista zgód OpenCode ograniczona do zweryfikowanej sesji execution należącej do authenticated principal.", { directory: { type: "string" }, sessionId: { type: "string" } }, ["sessionId"]),
     definition("opencode_permission_resolve", "Rozstrzygnij zgodę", "Akceptuje albo odrzuca konkretną zgodę po korelacji sesji i walidacji Paperclip.", { sessionId: { type: "string" }, permissionId: { type: "string" }, reply: { enum: ["once", "always", "reject"] }, directory: { type: "string" }, ctb: ctbSchema }, ["sessionId", "permissionId", "reply", "ctb"], executeSecurity, "PRIVILEGED_WRITE"),
    definition("opencode_models_list", "Lista modeli", "Znormalizowana lista providerów, dostępności, wariantów, reasoning i limitów.", { providerID: { type: "string" } }, []),
    definition("opencode_model_info", "Informacje o modelu", "Zwraca dane modelu albo jawny CTB_MODEL_NOT_FOUND.", { providerID: { type: "string" }, modelID: { type: "string" } }, ["providerID", "modelID"]),
    definition("opencode_find_files", "Znajdź pliki", "Znajduje pliki i katalogi wyłącznie w workspace wskazanego execution.", { executionId: { type: "string" }, query: { type: "string" }, type: { enum: ["file", "directory"] }, searchDirectory: { type: "string" }, limit: { type: "integer" }, directory: { type: "string" } }, ["executionId", "query"]),
     definition("opencode_workspace_tree", "Drzewo workspace", "Pobiera strukturę plików wyłącznie w workspace wskazanego execution.", { executionId: { type: "string" }, path: { type: "string" }, directory: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 8 }, limit: { type: "integer", minimum: 1, maximum: 500 } }, ["executionId"]),
  ];
}

async function handleMcp(req, res) {
  let message; try { message = JSON.parse(await body(req)); } catch { return sendJson(res, 400, rpcError(null, -32700, "NieprawidĹ‚owy JSON-RPC.")); }
  const token = verify(tokenFromRequest(req)); if (!token || token.iss !== issuer || token.aud !== resourceUrl() || token.exp * 1000 <= Date.now()) return mcpUnauthorized(res, message?.id ?? null);
  const sessionId = String(req.headers["mcp-session-id"] || ""); const currentSessionId = sessionId && sessions.has(sessionId) ? sessionId : random(16); const headers = sessionId && sessions.has(sessionId) ? {} : { "mcp-session-id": currentSessionId }; sessions.set(currentSessionId, { updatedAt: Date.now() });
  const method = message.method; const id = message.id;
    if (method === "initialize") { await engine.start(); startTelemetryCollector(); void verifyNativeAgents(); void refreshModelRegistry(); return sendJson(res, 200, rpcResult(id, { protocolVersion: message.params?.protocolVersion || "2025-03-26", capabilities: { tools: { listChanged: false }, resources: { subscribe: false }, prompts: { listChanged: false }, extensions: { "io.modelcontextprotocol/skills": {} } }, serverInfo: { name: "kompas-opencode-ctb", version: "1.2.0" }, instructions: "OpenCode is the CTB execution engine. DIAGNOSE and PLAN are read-only. Every write requires ctb.mode EXECUTE, ctb.changeClass ctb, a valid Paperclip issue, declared scope, acceptance criteria and idempotency key." }), headers); }
  if (method === "notifications/initialized" || String(method || "").startsWith("notifications/")) return sendJson(res, 202, {}, headers);
   if (method === "ping") return sendJson(res, 200, rpcResult(id, {}), headers);
   if (method === "tools/list") {
     try {
       await engine.start(); void verifyNativeAgents();
       const upstream = await engine.call("tools/list", {});
       const visibleTools = eagerSurfaceEnabled() ? upstream.tools : upstream.tools.filter((tool) => PUBLIC_TOOLSET.has(tool.name));
       return sendJson(res, 200, rpcResult(id, { tools: [...visibleTools.map(exposeTool), ...customToolDefinitions()] }), headers);
     } catch (error) {
        return sendJson(res, 200, rpcResult(id, { isError: true, structuredContent: errorDetails(error, true), content: [{ type: "text", text: error.message || "CTB control plane unavailable." }] }), headers);
     }
   }
   try {
    if (method === "skills/list") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const skills = skillCatalog().map(({ path: ignored, ...skill }) => ({ ...skill, uri: `skill://ctb/${skill.name}`, digest: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(skillCatalog().find((item) => item.name === skill.name).path)).digest("hex")}` })); return sendJson(res, 200, rpcResult(id, { skills }), headers); }
    if (method === "skills/get") { if (!hasScope(token, "opencode:read")) throw Object.assign(new Error("INSUFFICIENT_SCOPE"), { code: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }); const skill = skillCatalog().find((item) => item.name === message.params?.name); if (!skill) return sendJson(res, 200, rpcError(id, -32002, "SKILL_NOT_FOUND"), headers); const contract = fs.readFileSync(skill.path, "utf8"); return sendJson(res, 200, rpcResult(id, { name: skill.name, version: skill.version, description: skill.description, uri: `skill://ctb/${skill.name}`, digest: `sha256:${crypto.createHash("sha256").update(contract).digest("hex")}`, content: contract }), headers); }
    if (method === "tools/list") { await engine.start(); void verifyNativeAgents(); const upstream = await engine.call("tools/list", {}); const visibleTools = eagerSurfaceEnabled() ? upstream.tools : upstream.tools.filter((tool) => PUBLIC_TOOLSET.has(tool.name));const tools = visibleTools.map(exposeTool); tools.push({ name: "opencode_list_skills", title: "Skille CTB", description: "Lista kontraktĂłw skilli CTB.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }, { name: "opencode_get_skill", title: "Kontrakt skilla CTB", description: "Zwraca peĹ‚ny kontrakt wskazanego skilla CTB.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }, { name: "opencode_message_model_info", title: "Model metadata sesji", description: "[READ] Read-only: zwraca providerRequested/modelRequested/providerActual/modelActual/fallback dla wiadomosci wskazanej sesji OpenCode.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }], _meta: { kompas: { toolClass: "READ", changeClass: null } } }, { name: "opencode_run_inspect", title: "Inspekcja runu CTB", description: "Read-only: zunifikowana inspekcja runu — view=summary|events|tokens|steps|context|models.", inputSchema: { type: "object", properties: { runId: { type: "string" }, view: { enum: ["summary", "events", "tokens", "steps", "context", "models"] }, refresh: { type: "boolean" } }, required: ["runId"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }], _meta: { kompas: { toolClass: "READ", changeClass: null } } }, ...[{ name: "paperclipCompareRunMetrics", description: "Read-only: porównanie co najmniej dwóch runów, w tym który zużył więcej context overhead.", inputSchema: { type: "object", properties: { runIds: { type: "array", items: { type: "string" } } }, required: ["runIds"], additionalProperties: false } }, { name: "paperclipAggregateRunMetrics", description: "Read-only: agregaty metryk dla issue/modelu (p50/p95, first-pass success rate, retries).", inputSchema: { type: "object", properties: { runIds: { type: "array", items: { type: "string" } }, paperclipIssueId: { type: "string" }, groupBy: { enum: ["issue", "model"] } }, additionalProperties: false } }].map((tool) => ({ ...tool, title: tool.name, inputSchema: tool.inputSchema || { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false }, outputSchema: { type: "object" }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }))); tools.push({ name: "opencode_mcp_effective_profile", title: "Efektywny profil MCP", description: "Read-only: efektywny profil połączeń MCP (rola, taskClass, stage, eager/deferred) rozwijany z uwierzytelnionego principala.", inputSchema: { type: "object", properties: { taskClass: { type: "string" }, currentStage: { type: "string" }, projectKey: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }, { name: "opencode_security_status", title: "Status bezpieczeństwa CTB", description: "Read-only self-audit: revisiony polityk, native-agent enforcement, capability invariant, crash-recovery, limity fallbacku. Bez sekretów.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, securitySchemes: [{ type: "oauth2", scopes: ["opencode:read"] }] }); return sendJson(res, 200, rpcResult(id, { tools }), headers); }
    if (method === "tools/call") return sendJson(res, 200, rpcResult(id, await callTool(message.params?.name, message.params?.arguments || {}, token)), headers);
    if (["resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get"].includes(method)) { if (!hasScope(token, "opencode:read")) return sendJson(res, 200, rpcResult(id, { isError: true, structuredContent: { errorCode: "INSUFFICIENT_SCOPE", requiredScope: "opencode:read" }, content: [{ type: "text", text: "INSUFFICIENT_SCOPE" }] }), headers); await engine.start(); return sendJson(res, 200, rpcResult(id, await engine.call(method, message.params || {})), headers); }
    return sendJson(res, 400, rpcError(id ?? null, -32601, "Nieznana metoda MCP."), headers);
  } catch (error) {
    // Control-plane / read-only diagnostics must fail with a DISTINCT code from inference
    // failures, so a dead model backend never makes the control plane undiagnosable (P0 #2).
    const toolName = message?.params?.name;
    const isControlPlane = toolName && CONTROL_PLANE_TOOLS.has(toolName);
    const code = error.code || (isControlPlane ? "CTB_CONTROL_PLANE_UNAVAILABLE" : "CTB_GATEWAY_ERROR");
    return sendJson(res, 200, rpcResult(id, { isError: true, structuredContent: { ...errorDetails(error, isControlPlane), errorCode: code }, content: [{ type: "text", text: error.message || "CTB gateway error." }] }), headers);
  }
}

function escape(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function loginPage(query, error = "") {
  const fields = ["client_id", "redirect_uri", "response_type", "scope", "state", "resource", "code_challenge", "code_challenge_method"].map((name) => `<input type="hidden" name="${name}" value="${escape(query.get(name))}">`).join("");
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Autoryzacja OpenCode CTB</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:8vh auto;padding:1.5rem;color:#162313}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin-top:1rem;font-weight:600}input{padding:.7rem;margin-top:.35rem}button{margin-top:1.5rem;padding:.8rem;background:#162313;color:#fff;border:0;border-radius:.4rem;font-weight:700}.error{color:#a5221c}</style><h1>PoĹ‚Ä…cz OpenCode CTB</h1>${error ? `<p class="error">${escape(error)}</p>` : ""}<form method="post" action="/oauth/authorize">${fields}<label>Login<input name="username" autocomplete="username" required></label><label>HasĹ‚o<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Autoryzuj</button></form></html>`;
}
function authorizationError(res, query, error, description) { const redirectUri = query.get("redirect_uri"); if (allowedRedirect(redirectUri)) { const destination = new URL(redirectUri); destination.searchParams.set("error", error); destination.searchParams.set("error_description", description); destination.searchParams.set("iss", issuer); if (query.get("state")) destination.searchParams.set("state", query.get("state")); res.writeHead(302, { location: destination.toString(), "cache-control": "no-store" }); return res.end(); } return sendJson(res, 400, { error, error_description: description, iss: issuer }); }
function issueAccessToken(clientId, scope) { const now = Date.now(); return sign({ iss: issuer, sub: operatorUsername, aud: resourceUrl(), client_id: clientId, scope, iat: Math.floor(now / 1000), exp: Math.floor((now + accessTtlMs) / 1000), jti: random(12) }); }
function completeAuthorization(res, { clientId, redirectUri, scope, codeChallenge, state }) {
  const code = random(36);
  codes.set(code, { clientId, redirectUri, scope, codeChallenge, expiresAt: Date.now() + codeTtlMs });
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("iss", issuer);
  if (state) destination.searchParams.set("state", state);
  audit({ result: "oauth_authorize_success", clientId, redirectHost: destination.host, scope });
  audit({ result: "oauth_callback_redirect", clientId, redirectHost: destination.host });
  res.writeHead(302, { location: destination.toString(), "cache-control": "no-store" });
  res.end();
}
async function handleAuthorize(req, res, url) {
  const q = url.searchParams;
  const form = req.method === "POST" ? new URLSearchParams(await body(req)) : new URLSearchParams();
  const param = (name) => form.get(name) || q.get(name) || "";
  const clientId = param("client_id");
  const redirectUri = param("redirect_uri");
  const state = param("state");
  const scope = param("scope");
  const codeChallenge = param("code_challenge");
  const codeChallengeMethod = param("code_challenge_method") || "S256";
  const resource = param("resource");
  const client = clients[clientId];
  const fail = (error, description) => authorizationError(res, new URLSearchParams({ redirect_uri: redirectUri, state, client_id: clientId }), error, description);
  if (!client || !allowedRedirect(redirectUri) || !client.redirect_uris.includes(redirectUri)) return fail("unauthorized_client", "Unknown OAuth client or redirect URI.");
  if (param("response_type") !== "code" || codeChallengeMethod !== "S256" || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) return fail("invalid_request", "PKCE S256 is required.");
  if ((resource || resourceUrl()) !== resourceUrl()) return fail("invalid_target", "Unknown resource.");
  const grantedScope = normalizedScope(scope);
  if (req.method === "GET") {
    // Persistent browser session replaces the password prompt ONLY for clients the
    // operator has explicitly approved (first-use approval, stored server-side).
    // A freshly dynamic-registered client never gets a silent grant from an existing
    // login session — it must complete one interactive POST authorization first.
    const session = validOauthSession(req);
    if (session && client.approvedAt) return completeAuthorization(res, { clientId, redirectUri, scope: grantedScope, codeChallenge, state });
    return sendHtml(res, 200, loginPage(q));
  }
  const ip = String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "unknown");
  if (!secureEqual(form.get("username"), operatorUsername) || !secureEqual(form.get("password"), operatorPassword)) {
    audit({ result: "oauth_authorize_failed", clientId, redirectHost: new URL(redirectUri).host, errorCode: "OAUTH_INVALID_CREDENTIALS" });
    const count = (attempts.get(ip) || 0) + 1;
    attempts.set(ip, count);
    return count >= 10 ? sendJson(res, 429, { error: "too_many_attempts" }) : sendHtml(res, 401, loginPage(q, "Niepoprawny login lub hasĹ‚o."));
  }
  attempts.delete(ip);
  // Successful interactive operator login doubles as explicit client consent/binding.
  if (!client.approvedAt) { client.approvedAt = new Date().toISOString(); writeJson(clientsFile, clients); audit({ result: "oauth_client_approved", clientId }); }
  issueBrowserSession(res, operatorUsername);
  completeAuthorization(res, { clientId, redirectUri, scope: grantedScope, codeChallenge, state });
}
async function handleToken(req, res) {
  const form = new URLSearchParams(await body(req));
  const grantType = form.get("grant_type") || "";
  const requestedClientId = form.get("client_id") || "";
  audit({ result: "oauth_token_requested", grantType, clientId: requestedClientId || null });
  if (grantType === "authorization_code") {
    const code = String(form.get("code") || "");
    const record = codes.get(code);
    if (!record || record.expiresAt < Date.now()) {
      audit({ result: "oauth_token_failed", errorCode: "INVALID_AUTHORIZATION_CODE", clientId: requestedClientId || null });
      return sendJson(res, 400, { error: "invalid_grant", error_description: "Invalid or expired authorization code" });
    }
    const clientId = requestedClientId || record.clientId;
    const redirectUri = form.get("redirect_uri") || "";
    const resource = form.get("resource") || resourceUrl();
    if (clientId !== record.clientId || (redirectUri && redirectUri !== record.redirectUri) || resource !== resourceUrl()) {
      audit({ result: "oauth_token_failed", errorCode: "AUTHORIZATION_BINDING_MISMATCH", clientId });
      return sendJson(res, 400, { error: "invalid_grant", error_description: "Authorization code binding mismatch" });
    }
    const verifier = String(form.get("code_verifier") || "");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    if (!verifier || !secureEqual(challenge, record.codeChallenge)) {
      audit({ result: "oauth_token_failed", errorCode: "PKCE_VERIFICATION_FAILED", clientId });
      return sendJson(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
    }
    codes.delete(code);
    const refresh = random(40);
    refreshTokens[refresh] = { clientId, scope: record.scope, expiresAt: Date.now() + refreshTtlMs };
    writeJson(refreshFile, refreshTokens);
    audit({ result: "oauth_token_issued", clientId, scope: record.scope });
    return sendJson(res, 200, { access_token: issueAccessToken(clientId, record.scope), refresh_token: refresh, token_type: "Bearer", expires_in: Math.floor(accessTtlMs / 1000), scope: record.scope }, { "cache-control": "no-store", pragma: "no-cache" });
  }
  if (grantType === "refresh_token") {
    const presented = String(form.get("refresh_token") || "");
    const now = Date.now();
    const record = refreshTokens[presented];
    for (const [key, value] of Object.entries(refreshTokens)) { if (value?.rotatedAt && now - Date.parse(value.rotatedAt) > refreshGraceMs) delete refreshTokens[key]; }
    if (!record || record.expiresAt < now || (requestedClientId && record.clientId !== requestedClientId)) {
      writeJson(refreshFile, refreshTokens);
      audit({ result: "oauth_refresh_rejected", clientId: requestedClientId || null });
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    // Race-safe rotation: replays of a just-rotated token return the same replacement within the grace window.
    if (record.rotatedAt) {
      const withinGrace = now - Date.parse(record.rotatedAt) <= refreshGraceMs && record.replacement && refreshTokens[record.replacement];
      delete refreshTokens[presented];
      writeJson(refreshFile, refreshTokens);
      if (!withinGrace) {
        audit({ result: "oauth_refresh_rejected", clientId: requestedClientId || record.clientId || null });
        return sendJson(res, 400, { error: "invalid_grant" });
      }
      audit({ result: "oauth_refresh_replayed", clientId: record.clientId });
      return sendJson(res, 200, { access_token: issueAccessToken(record.clientId, record.scope), refresh_token: record.replacement, token_type: "Bearer", expires_in: Math.floor(accessTtlMs / 1000), scope: record.scope }, { "cache-control": "no-store", pragma: "no-cache" });
    }
    const next = random(40);
    record.rotatedAt = new Date(now).toISOString();
    record.replacement = next;
    refreshTokens[next] = { clientId: record.clientId, scope: record.scope, expiresAt: now + refreshTtlMs };
    writeJson(refreshFile, refreshTokens);
    audit({ result: "oauth_refresh_rotated", clientId: record.clientId });
    return sendJson(res, 200, { access_token: issueAccessToken(record.clientId, record.scope), refresh_token: next, token_type: "Bearer", expires_in: Math.floor(accessTtlMs / 1000), scope: record.scope }, { "cache-control": "no-store", pragma: "no-cache" });
  }
  return sendJson(res, 400, { error: "unsupported_grant_type" });
}

const server = http.createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); try { if (url.pathname === "/health" && req.method === "GET") { await verifyNativeAgents(); await refreshModelRegistry(); return sendJson(res, 200, { ok: true, engine: "AlaeddineMessadi/opencode-mcp@1.11.0", policy: "ctb", revision: CTB_POLICY_REVISION, revisions: { gateway: GATEWAY_REVISION, ctbPolicy: CTB_POLICY_REVISION, mcpRoleProfiles: roleProfilesDoc.revision }, issuer, allowedRoots, models: { default: `${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}`, fallback: FALLBACK_MODEL ? `${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.modelID}` : null, fallbackRetryLimit: 1, defaultModelInRegistry: defaultModelInRegistry() }, nativeAgents: { required: REQUIRED_NATIVE_AGENTS, enabled: NATIVE_AGENTS_ENABLED, canonicalSource: "opencode_config_agent_block", configuredAgents: nativeAgentState.configuredAgents, verified: nativeAgentState.verified, foundAgents: nativeAgentState.foundAgents, missingAgents: nativeAgentState.missingAgents, enforcementMode: NATIVE_AGENTS_ENABLED ? (nativeAgentState.verified ? "native_enforced" : "fail_closed_unverified") : "builtin_plan_build", liveProbe: nativeAgentState.liveProbe, silentDowngradePossible: false }, capabilityPolicyRevision: `${CTB_POLICY_REVISION}+shell-guard-1`, profileResolutionMode: "server_authoritative", registrySchemaVersion: savedRegistry?.version || 1, publicToolCount: eagerSurfaceEnabled() ? null : PUBLIC_TOOLSET.size + CUSTOM_PUBLIC_TOOLS.length, crashRecovery: { startupProcessLostRuns: Array.isArray(startupProcessLostRuns) ? startupProcessLostRuns.length : 0 } }); } if (url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") return sendJson(res, 200, { resource: resourceUrl(), authorization_servers: [issuer], scopes_supported: [...validScopes], resource_documentation: `${issuer}/health` }, { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" }); if ((url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") && req.method === "GET") return sendJson(res, 200, { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [...validScopes], authorization_response_iss_parameter_supported: true }, { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" }); if (url.pathname === "/oauth/register" && req.method === "POST") { const registration = JSON.parse(await body(req)); const redirectUris = Array.isArray(registration.redirect_uris) ? registration.redirect_uris : []; if (!redirectUris.length || !redirectUris.every(allowedRedirect)) return sendJson(res, 400, { error: "invalid_redirect_uri" }); const clientId = `dcr_${random(18)}`; clients[clientId] = { client_id: clientId, client_name: String(registration.client_name || "MCP client"), redirect_uris: redirectUris, token_endpoint_auth_method: "none", approvedAt: null, created_at: new Date().toISOString() }; writeJson(clientsFile, clients); return sendJson(res, 201, { ...clients[clientId], client_id: clientId, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }); } if (url.pathname === "/oauth/authorize" && ["GET", "POST"].includes(req.method || "")) return handleAuthorize(req, res, url); if (url.pathname === "/oauth/logout" && req.method === "POST") { const revoked = revokeOauthSession(req); audit({ result: "oauth_logout", revoked }); return sendJson(res, 200, { ok: true }, { "set-cookie": `${sessionCookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }); } if (url.pathname === "/oauth/token" && req.method === "POST") return handleToken(req, res); if (url.pathname === "/mcp" && req.method === "POST") return handleMcp(req, res); return sendJson(res, 404, { error: "Not found" }); } catch (error) { console.error("[opencode-ctb] request failed", error instanceof Error ? error.message : error); return sendJson(res, 500, { error: "Internal server error" }); } });
server.listen(port, "127.0.0.1", () => console.log(`[opencode-ctb] listening on http://127.0.0.1:${port}/mcp`));
