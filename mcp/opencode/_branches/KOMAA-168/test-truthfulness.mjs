// KOMAA-168 regression suite — deterministic, backend-independent.
// Covers the canonical lifecycle/error-normalization layer (opencode-lifecycle.mjs) so the
// truthfulness, one-canonical-state, model-discovery and workspace-tree defects are pinned
// without requiring a live OpenCode backend (which is absent in this workspace).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CTB_POLICY_REVISION } from "./ctb-policy.mjs";
import { detectUpstreamMessageError, normalizeUpstreamMessageResponse, normalizedErrorToError, reconcileExecutionResult, assertProjectionConsistent, buildWorkspaceTree, normalizeModelAvailability, buildProviderModels, pendingTimeoutPayload, classifySessionContinuation, assertSessionAffinity, EXECUTION_TERMINAL_STATES } from "./opencode-lifecycle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function ok(condition, label) {
  if (!condition) { console.error(`FAIL: ${label}`); failed += 1; process.exitCode = 1; }
  else { passed += 1; console.log(`PASS ${passed}: ${label}`); }
}

// ============ A. TERMINAL TRUTHFULNESS — provider/model failure is NEVER success ============
// HTTP transport failure (404 class) normalizes to a deterministic terminal error.
{
  const r = normalizeUpstreamMessageResponse({ httpStatus: 404, responseText: '{"error":"model not found: opencode/nemotron-3.5-lightning-free"}' });
  ok(r.ok === false && r.error.errorCode === "PROVIDER_MODEL_NOT_FOUND" && r.error.retryable === true, "HTTP 404 model -> PROVIDER_MODEL_NOT_FOUND (retryable, not success)");
}
{
  const r = normalizeUpstreamMessageResponse({ httpStatus: 500, responseText: "internal error" });
  ok(r.ok === false && r.error.errorCode === "UPSTREAM_REQUEST_ERROR" && r.error.retryable === true, "HTTP 500 -> UPSTREAM_REQUEST_ERROR (retryable, not success)");
}
{
  const r = normalizeUpstreamMessageResponse({ httpStatus: 200, responseText: JSON.stringify({ info: { role: "assistant", error: { message: "provider opencode returned 404 for model mimo-v2.5-free" } }, parts: [] }) });
  ok(r.ok === false && r.error.errorCode === "PROVIDER_MODEL_NOT_FOUND", "2xx with message.info.error -> terminal PROVIDER_MODEL_NOT_FOUND (not success content)");
}
{
  const r = normalizeUpstreamMessageResponse({ httpStatus: 200, responseText: JSON.stringify({ info: { role: "assistant" }, parts: [{ type: "text", text: "Here is your answer." }] }) });
  ok(r.ok === true, "2xx ordinary assistant message -> ok (no false positive)");
}

// message.info.error detection (structural, not keyword).
{
  const msg = { info: { role: "assistant", error: { message: "model not found: opencode/nemotron-3.5-lightning-free" } }, parts: [{ type: "text", text: "{}" }] };
  const err = detectUpstreamMessageError(msg);
  ok(err && err.errorCode === "PROVIDER_MODEL_NOT_FOUND", "detectUpstreamMessageError: message.info.error -> PROVIDER_MODEL_NOT_FOUND");
}
{
  // Ordinary model text containing the word "error" must NOT be treated as failure.
  const msg = { info: { role: "assistant" }, parts: [{ type: "text", text: "Your config had an error, but I fixed it like this..." }] };
  ok(detectUpstreamMessageError(msg) === null, "text containing 'error' is NOT a failure (no keyword false positive)");
}
{
  // error-shaped part.
  const msg = { info: { role: "assistant" }, parts: [{ type: "error", error: { message: "rate limit exceeded" } }] };
  ok(detectUpstreamMessageError(msg)?.errorCode === "UPSTREAM_PROVIDER_RATE_LIMITED", "error-shaped part -> rate-limited classification");
}

// normalizedErrorToError preserves deterministic code.
{
  const e = normalizedErrorToError({ errorCode: "PROVIDER_MODEL_NOT_FOUND", errorMessage: "x", retryable: true, stage: "message_info_error" });
  ok(e.code === "PROVIDER_MODEL_NOT_FOUND" && e.retryable === true, "normalizedErrorToError carries deterministic code + retryable");
}

// ============ B. ONE CANONICAL EXECUTION STATE ============
{
  const execution = { executionId: "e1", sessionId: "s1", status: "completed" };
  const result = { structuredContent: { executionId: "e1", sessionId: "s1", state: "running", status: "running", content: "x" }, content: [{ type: "text", text: "x" }] };
  const reconciled = reconcileExecutionResult(result, execution);
  ok(reconciled.structuredContent.state === "completed" && reconciled.structuredContent.status === "completed", "completed projection: nested running reconciled to completed (no contradiction)");
}
{
  const execution = { executionId: "e1", sessionId: "s1", status: "failed" };
  const reconciled = reconcileExecutionResult({ structuredContent: { state: "running", status: "running" } }, execution);
  ok(reconciled.structuredContent.state === "failed" && reconciled.structuredContent.status === "failed", "failed projection: nested running reconciled to failed (no running/completed contradiction)");
}
{
  let threw = false;
  try { assertProjectionConsistent({ state: "completed", status: "completed", structuredContent: { state: "running", status: "running" } }); } catch { threw = true; }
  ok(threw, "assertProjectionConsistent rejects a terminal top-level + nested running contradiction");
}
{
  let threw = false;
  try { assertProjectionConsistent({ state: "failed", status: "failed", structuredContent: { state: "completed", status: "completed" } }); } catch { threw = true; }
  ok(threw, "assertProjectionConsistent rejects failed top-level + nested completed contradiction");
}
{
  // Non-terminal top-level state is allowed to carry running nested lifecycle fields.
  ok(assertProjectionConsistent({ state: "running", status: "running", structuredContent: { state: "running", status: "running" } }) !== null, "running projection with nested running is consistent");
}

// ============ D. SYNCHRONOUS TIMEOUT -> nonterminal pending contract ============
{
  const payload = pendingTimeoutPayload("exec_1", "sess_1", 30000);
  ok(payload.state === "running" && payload.status === "running" && payload.pending === true && payload.retryable === true && typeof payload.guidance === "string" && payload.guidance.length > 0, "pending timeout payload is nonterminal with stable ids + poll guidance (no false completion)");
}

// ============ F. MODEL DISCOVERY SEMANTICS ============
{
  const providers = normalizeModelAvailability([
    { providerID: "opencode", name: "opencode", configured: true, models: [{ modelID: "hy3-free", name: "hy3-free", available: true }] },
    { providerID: "opencode", name: "opencode", configured: true, models: [{ modelID: "mimo-v2.5-free", name: "mimo", status: "available" }] },
    { providerID: "ghost", name: "ghost", configured: false, models: [{ modelID: "x", name: "x" }] },
  ]);
  const flat = providers.flatMap((p) => p.models);
  ok(flat.every((m) => m.availability.routabilityKnown === false && m.availability.liveHealth === null), "no model claims live routability without an explicit probe");
  ok(flat.find((m) => m.modelID === "hy3-free").availability.available === true, "configured model -> available true (catalog presence)");
  ok(flat.find((m) => m.modelID === "x").availability.available === false, "unconfigured, unprobed model -> available false (not falsely inferable)");
  ok(flat.every((m) => "catalogAvailable" in m.availability && "configured" in m.availability), "explicit catalog/config fields present (compatible separation)");
}

// ============ F/6. PROVIDER MODELS returns ACTUAL list + honors limit ============
{
  const providers = [
    { providerID: "p1", name: "p1", configured: true, models: [{ modelID: "a" }, { modelID: "b" }, { modelID: "c" }, { modelID: "d" }, { modelID: "e" }] },
    { providerID: "p2", name: "p2", configured: true, models: [{ modelID: "z" }] },
  ];
  const list = buildProviderModels(providers, "p1", 2);
  ok(list.providerId === "p1" && list.returned === 2 && list.total === 5 && list.truncated === true, "provider_models: returns p1 actual list, honors limit=2, truncated flag set");
  ok(list.models.every((m) => m.modelID === "a" || m.modelID === "b"), "provider_models: only the requested provider's models returned (no p2/default leakage)");
  const unlimited = buildProviderModels(providers, "p1");
  ok(unlimited.returned === 5 && unlimited.truncated === false, "provider_models: no limit returns full provider list");
}

// ============ G. WORKSPACE TREE depth boundary ============
// In-memory virtual filesystem so the depth contract is exercised without real disk I/O.
{
  const tree = {
    "root": ["a", "b"],
    "root/a": ["a1", "a2"],
    "root/a/a1": ["a1x"],
    "root/b": [],
  };
  const readDir = (p) => (tree[p] || []).map((name) => ({ name, isDirectory: () => tree[`${p}/${name}`] !== undefined, isSymbolicLink: () => false }));
  const join = (a, b) => `${a}/${b}`;
  const relative = (root, abs) => abs.slice(root.length + 1);
  const d1 = buildWorkspaceTree({ root: "root", readDir, join, relative, maxDepth: 1, limit: 200 });
  ok(d1.entries.every((e) => e.depth === 1) && d1.entries.length === 2 && !d1.entries.some((e) => e.name === "a1"), "depth=1 -> only immediate children (no grandchildren)");
  const d2 = buildWorkspaceTree({ root: "root", readDir, join, relative, maxDepth: 2, limit: 200 });
  ok(d2.entries.some((e) => e.name === "a1") && !d2.entries.some((e) => e.name === "a1x"), "depth=2 -> grandchildren included, depth 3 excluded");
  const dLimit = buildWorkspaceTree({ root: "root", readDir, join, relative, maxDepth: 8, limit: 1 });
  ok(dLimit.truncated === true && dLimit.entries.length === 1, "limit=1 -> truncated true (explicit bound, not traversal bookkeeping)");
}

// sanity: terminal-state set is stable
ok(EXECUTION_TERMINAL_STATES.has("completed") && EXECUTION_TERMINAL_STATES.has("failed") && EXECUTION_TERMINAL_STATES.has("aborted"), "terminal state set includes completed/failed/aborted");

// ============ C. REPLY SESSION AFFINITY — requested session must be honored ============
// reply(nonexistentSession) -> deterministic SESSION_NOT_FOUND, never a silent bootstrap.
{
  const v = classifySessionContinuation({ sessionId: "sess-missing", httpStatus: 404 });
  ok(v.ok === false && v.code === "SESSION_NOT_FOUND", "reply(nonexistentSession) -> SESSION_NOT_FOUND (no new session bootstrap)");
}
// Transport failure reaching the upstream session lookup -> SESSION_CONTINUATION_FAILED.
{
  const v = classifySessionContinuation({ sessionId: "sess-x", transportError: "ECONNREFUSED" });
  ok(v.ok === false && v.code === "SESSION_CONTINUATION_FAILED" && v.failureStage === "session_lookup_transport", "reply transport failure -> SESSION_CONTINUATION_FAILED");
}
// Upstream rejects continuation with a hard status -> explicit failure (not success).
{
  const v = classifySessionContinuation({ sessionId: "sess-x", httpStatus: 500 });
  ok(v.ok === false && v.code === "SESSION_CONTINUATION_FAILED" && v.upstreamStatus === 500, "reply upstream 500 -> SESSION_CONTINUATION_FAILED (not completed)");
}
// A reachable, existing session -> ok (continuation proceeds).
{
  const v = classifySessionContinuation({ sessionId: "sess-ok", httpStatus: 200 });
  ok(v.ok === true && v.code === null, "reply(existingReachableSession) -> ok (continuation proceeds)");
}
// Affinity mismatch: bootstrap produced a DIFFERENT id than requested -> fail closed.
{
  const v = assertSessionAffinity({ requested: "sess-requested", actual: "sess-bootstrapped" });
  ok(v.ok === false && v.code === "SESSION_AFFINITY_MISMATCH" && v.requested === "sess-requested" && v.actual === "sess-bootstrapped", "reply replacement session -> SESSION_AFFINITY_MISMATCH (no wrong-conversation append)");
}
// Affinity match: requested === actual -> ok (original session keeps the turn).
{
  const v = assertSessionAffinity({ requested: "sess-requested", actual: "sess-requested" });
  ok(v.ok === true && v.code === null, "reply(existingSession) -> affinity ok (same session receives turn)");
}
// No requested session (fresh ask/run) -> affinity is a no-op (ok).
{
  const v = assertSessionAffinity({ requested: null, actual: "sess-new" });
  ok(v.ok === true, "reply without explicit session -> affinity no-op for fresh bootstrapped session");
}

// ============ H. LIVE-SMOKE HARNESS MUST SOURCE POLICY REVISION FROM CANONICAL CONSTANT ============
// Guards against KOMAA-168 harness drift: live-smoke.mjs must assert /health revision against the
// canonical CTB_POLICY_REVISION (ctb-policy.mjs) rather than a duplicated stale literal, otherwise a
// policy bump silently false-fails the whole acceptance matrix before it runs.
{
  const smokeSrc = fs.readFileSync(path.join(here, "live-smoke.mjs"), "utf8");
  const importsCanonical = /import\s*\{?\s*CTB_POLICY_REVISION\s*\}?\s*from\s*["']\.\/ctb-policy\.mjs["']/.test(smokeSrc);
  ok(importsCanonical, "live-smoke.mjs imports CTB_POLICY_REVISION from canonical ./ctb-policy.mjs (no duplicated literal)");

  const healthAssertLine = smokeSrc.split(/\r?\n/).find((line) => /assert\.equal\(\s*health\.revision/.test(line));
  ok(!!healthAssertLine, "live-smoke.mjs asserts health.revision");
  ok(!!healthAssertLine && /CTB_POLICY_REVISION/.test(healthAssertLine), "live-smoke.mjs health.revision assertion references CTB_POLICY_REVISION (not a stale hardcoded literal)");
  ok(!!healthAssertLine && !/["']ctb-policy-\d+["']/.test(healthAssertLine), "live-smoke.mjs health.revision assertion contains no duplicated ctb-policy-N literal");

  ok(/^ctb-policy-\d+$/.test(CTB_POLICY_REVISION), "canonical CTB_POLICY_REVISION is a well-formed ctb-policy-N revision (single source of truth)");
}

console.log(failed ? `\nTRUTHFULNESS SUITE FAILED (${passed} passed, ${failed} failed)` : `\nALL TRUTHFULNESS TESTS PASS (${passed} passed)`);
