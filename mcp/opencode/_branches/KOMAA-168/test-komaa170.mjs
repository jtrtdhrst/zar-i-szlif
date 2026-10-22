import assert from "node:assert/strict";
import { classifyTool, MODEL_ENTRYPOINTS, TOOL_CLASSES, CTB_POLICY_REVISION, isFallbackSuppressed, isProviderModelFailure, parseModelRef } from "./ctb-policy.mjs";
import { classifySessionContinuation, assertSessionAffinity, detectUpstreamMessageError, classifyProviderError, reconcileExecutionResult, assertProjectionConsistent } from "./opencode-lifecycle.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`KOMAA-170 ${name}: PASS`);
}

// --- Root cause A: surface sync (classifyTool must not throw for current upstream) ---
check("classifyTool-session_prompt-is-write-model-entrypoint", () => {
  assert.equal(classifyTool("opencode_session_prompt"), TOOL_CLASSES.WRITE);
  assert.ok(MODEL_ENTRYPOINTS.has("opencode_session_prompt"));
});

// Simulates the gateway's tools/list exposure: every currently-shipped upstream tool must
// classify (exposeTool throws CTB_TOOL_CLASSIFICATION_MISSING when classifyTool returns null).
const CURRENT_UPSTREAM_SURFACE = [
  "opencode_session_prompt", "opencode_session_create", "opencode_session_get", "opencode_session_list",
  "opencode_session_abort", "opencode_session_fork", "opencode_session_update", "opencode_session_delete",
  "opencode_session_init", "opencode_session_children", "opencode_session_status", "opencode_session_todo",
  "opencode_session_diff", "opencode_session_search", "opencode_session_summarize", "opencode_session_revert",
  "opencode_session_unrevert", "opencode_session_share", "opencode_session_unshare", "opencode_session_permission",
  "opencode_run", "opencode_ask", "opencode_reply", "opencode_fire", "opencode_message_send",
  "opencode_message_send_async", "opencode_shell_execute", "opencode_execution_start", "opencode_execution_abort",
  "opencode_execution_get", "opencode_execution_status", "opencode_execution_inspect",
  "opencode_agent_list", "opencode_agent_prompt", "opencode_agent_start", "opencode_agent_get",
  "opencode_config_get", "opencode_config_providers", "opencode_config_update", "opencode_config_set",
  "opencode_model_list", "opencode_model_get", "opencode_models_list", "opencode_model_info",
  "opencode_provider_list", "opencode_provider_models", "opencode_provider_auth_methods", "opencode_provider_test",
  "opencode_provider_oauth_authorize", "opencode_provider_oauth_callback",
  "opencode_skill_list", "opencode_skill_get", "opencode_file_list", "opencode_file_read", "opencode_file_status",
  "opencode_find_file", "opencode_find_text", "opencode_find_symbol", "opencode_find_files",
  "opencode_tool_list", "opencode_tool_ids", "opencode_message_list", "opencode_message_get", "opencode_message_model_info",
  "opencode_command_list", "opencode_command_execute", "opencode_permission_list", "opencode_permission_resolve",
  "opencode_mcp_status", "opencode_mcp_add", "opencode_status", "opencode_health", "opencode_context",
  "opencode_conversation", "opencode_sessions_overview", "opencode_setup", "opencode_check", "opencode_wait",
  "opencode_review_changes", "opencode_vcs_info", "opencode_lsp_status", "opencode_formatter_status",
  "opencode_project_list", "opencode_project_current", "opencode_project_init", "opencode_log",
  "opencode_auth_set", "opencode_instance_dispose", "opencode_events_poll", "opencode_path_get",
  "opencode_inspect", "opencode_workspace_tree", "opencode_capability_request",
];
check("tools-list-surface-no-classification-missing", () => {
  const unclassified = CURRENT_UPSTREAM_SURFACE.filter((name) => classifyTool(name) === null);
  assert.deepEqual(unclassified, [], `tools/list would throw CTB_TOOL_CLASSIFICATION_MISSING for: ${unclassified.join(", ")}`);
});

check("classifyTool-known-upstream-families-classified", () => {
  // New upstream surface families must classify instead of throwing.
  assert.equal(classifyTool("opencode_session_create"), TOOL_CLASSES.WRITE);
  assert.equal(classifyTool("opencode_skill_list"), TOOL_CLASSES.READ);
  assert.equal(classifyTool("opencode_skill_get"), TOOL_CLASSES.READ);
  assert.equal(classifyTool("opencode_model_list"), TOOL_CLASSES.READ);
  assert.equal(classifyTool("opencode_model_get"), TOOL_CLASSES.READ);
  assert.equal(classifyTool("opencode_agent_prompt"), TOOL_CLASSES.WRITE);
  assert.equal(classifyTool("opencode_config_set"), TOOL_CLASSES.ADMIN);
  assert.equal(classifyTool("opencode_session_init"), TOOL_CLASSES.PRIVILEGED_WRITE);
  assert.equal(classifyTool("opencode_session_get"), TOOL_CLASSES.READ);
});

check("classifyTool-foreign-tool-fail-closed", () => {
  // A tool from another MCP server must NOT be auto-classified (CTB unknown-tool invariant).
  assert.equal(classifyTool("github_create_pull_request"), null);
  assert.equal(classifyTool("not_opencode_at_all"), null);
  assert.equal(classifyTool(""), null);
});

check("policy-revision-bumped", () => {
  assert.equal(CTB_POLICY_REVISION, "ctb-policy-7");
});

// --- Root cause 2: model truthfulness (explicit bad model must not silently fall back) ---
check("isFallbackSuppressed-explicit-model", () => {
  const badRef = parseModelRef("opencode/nemotron-3.5-lightning-free");
  const failure = Object.assign(new Error("provider opencode model nemotron-3.5-lightning-free not found"), { code: "PROVIDER_MODEL_NOT_FOUND", providerID: badRef.providerID, modelID: badRef.modelID });
  assert.equal(isFallbackSuppressed({ explicitModel: true, fallbackModel: parseModelRef("opencode/mimo-v2.5-free"), failure }), true, "explicit model must suppress fallback (fail truthfully)");
  // Non-explicit eligible failure may fall back.
  assert.equal(isFallbackSuppressed({ explicitModel: false, fallbackModel: parseModelRef("opencode/mimo-v2.5-free"), failure }), false, "default model failure is fallback-eligible");
  // Structural non-provider error never consumes the fallback.
  const ctbErr = Object.assign(new Error("CTB_NATIVE_AGENTS_UNAVAILABLE"), { code: "CTB_NATIVE_AGENTS_UNAVAILABLE" });
  assert.equal(isFallbackSuppressed({ explicitModel: false, fallbackModel: parseModelRef("opencode/mimo-v2.5-free"), failure: ctbErr }), true, "non-provider error suppresses fallback");
});

check("isProviderModelFailure-detects-bad-model", () => {
  assert.ok(isProviderModelFailure(Object.assign(new Error("model nemotron-3.5-lightning-free not found"), { code: "PROVIDER_MODEL_NOT_FOUND" })));
  assert.equal(isProviderModelFailure(Object.assign(new Error("CTB_NATIVE_AGENTS_UNAVAILABLE"), { code: "CTB_NATIVE_AGENTS_UNAVAILABLE" })), false);
});

check("classifyProviderError-bad-model-code", () => {
  const e = classifyProviderError("provider opencode model nemotron-3.5-lightning-free not found", "primary_message_result");
  assert.equal(e.errorCode, "PROVIDER_MODEL_NOT_FOUND");
});

// --- Root cause 1: reply affinity guards (fail closed, never bootstrap replacement) ---
check("classifySessionContinuation-404-fail-closed", () => {
  const verdict = classifySessionContinuation({ sessionId: "ses_missing", httpStatus: 404 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "SESSION_NOT_FOUND");
  const transport = classifySessionContinuation({ sessionId: "ses_x", transportError: "ECONNREFUSED" });
  assert.equal(transport.code, "SESSION_CONTINUATION_FAILED");
});

check("assertSessionAffinity-rejects-replacement", () => {
  const mismatch = assertSessionAffinity({ requested: "ses_A", actual: "ses_B" });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "SESSION_AFFINITY_MISMATCH");
  assert.equal(assertSessionAffinity({ requested: "ses_A", actual: "ses_A" }).ok, true);
});

// --- Root cause 3: consistent execution projections (one source of truth) ---
check("projection-contradiction-detected", () => {
  const reconciled = reconcileExecutionResult({ structuredContent: { state: "running", status: "running" } }, { status: "completed" });
  assert.equal(reconciled.structuredContent.state, "completed");
  assert.equal(reconciled.structuredContent.status, "completed");
  assert.throws(() => assertProjectionConsistent({ state: "completed", status: "completed", structuredContent: { state: "running", status: "running" } }), (e) => e.code === "PROJECTION_CONTRADICTION");
});

check("detectUpstreamMessageError-terminal", () => {
  const msg = { info: { error: { message: "model nemotron-3.5-lightning-free not found" } } };
  assert.ok(detectUpstreamMessageError(msg));
  assert.equal(detectUpstreamMessageError({ info: { role: "assistant", parts: [{ type: "text", text: "ok" }] } }), null);
});

console.log(`KOMAA-170 REGRESSIONS: ${passed}/${passed} PASS`);
process.exit(0);
