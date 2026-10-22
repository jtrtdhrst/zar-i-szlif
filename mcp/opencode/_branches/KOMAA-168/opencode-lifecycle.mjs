// OpenCode MCP canonical lifecycle + upstream terminal-outcome normalization layer.
//
// This module is intentionally backend-independent: it must never import the missing
// upstream engine entrypoint, so it can be unit-tested in isolation. Every public
// execution projection (ask/run/reply/execution_get/execution_status/inspect/replay)
// MUST route its finalized snapshot through this module so that:
//   - a single source of truth (execution.status) drives every projection, and
//   - contradictory nested structuredContent lifecycle fields are reconciled or rejected.
//
// INVARIANT (KOMAA-168 B): it must be impossible for top-level execution
// state/status to be completed/failed while nested structuredContent says running.

export const EXECUTION_TERMINAL_STATES = new Set(["completed", "failed", "aborted"]);
export const EXECUTION_NONTERMINAL_STATES = new Set(["running", "waiting_for_permission"]);

// Structural evidence that an upstream OpenCode message is a terminal model/provider
// failure rather than an ordinary assistant turn. Detection MUST be structural — never
// keyword-scan ordinary model text that merely contains the word "error" (KOMAA-168 A).
const PROVIDER_MODEL_NOT_FOUND_PATTERN = /provider[^.\n]*(not found|unknown|unsupported|invalid|unauthorized|does not exist)|model[^.\n]*(not found|unknown|unsupported|invalid|does not exist)|no (such|allowed) (provider|model)/i;

export function isTerminalExecutionState(state) {
  return EXECUTION_TERMINAL_STATES.has(state);
}

// Detect a terminal upstream model/provider failure from the already-parsed OpenCode
// message object (or null when the message is an ordinary assistant turn).
//
// Evidence, in priority order (KOMAA-168 A):
//   1. explicit backend terminal error embedded under message.info.error
//   2. message.info.error / message.error present
//   3. error-shaped payload (status: "error", isError: true, or parts carrying errors)
// Returns a normalized terminal error descriptor, or null when the message is benign.
export function detectUpstreamMessageError(message) {
  if (!message || typeof message !== "object") return null;
  const info = message.info && typeof message.info === "object" ? message.info : message;

  // 1+2. Explicit backend terminal error object.
  const embedded = message?.error || info?.error;
  if (embedded) {
    const detail = typeof embedded === "string" ? embedded : JSON.stringify(sanitizeErrorPayload(embedded));
    return classifyProviderError(detail, "message_info_error");
  }

  // 3a. Status field signaling error on the message/info envelope.
  if (info?.status === "error" || message?.status === "error") {
    return { stage: "message_status_error", errorCode: "UPSTREAM_MODEL_ERROR", errorMessage: "Upstream model message reported terminal error status.", retryable: false };
  }

  // 3b. Error-shaped parts (e.g. { type: "error", ... }).
  const parts = Array.isArray(message?.parts) ? message.parts : (Array.isArray(info?.parts) ? info.parts : []);
  const errorPart = parts.find((part) => part && typeof part === "object" && (part.type === "error" || (part.error && typeof part.error === "object")));
  if (errorPart) {
    const detail = errorPart.error ? JSON.stringify(sanitizeErrorPayload(errorPart.error)) : String(errorPart.text || errorPart.message || "upstream error part");
    return classifyProviderError(detail, "message_part_error");
  }

  // 3c. A structured payload where the whole content is an error object.
  if (message?.isError === true && (!parts.length || parts.every((part) => !part || part.type !== "text" || !String(part.text || "").trim()))) {
    return { stage: "message_is_error", errorCode: "UPSTREAM_MODEL_ERROR", errorMessage: "Upstream returned an error-shaped message with no assistant content.", retryable: false };
  }

  return null;
}

function sanitizeErrorPayload(value, depth = 0) {
  if (depth > 4 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeErrorPayload(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [key, sanitizeErrorPayload(item, depth + 1)]));
}

// Map a raw error detail string to a deterministic errorCode + retryable classification.
// Kept narrow so it does NOT accidentally broaden fallback eligibility: only genuine
// provider/model-not-found phrases produce a fallback-eligible code.
export function classifyProviderError(detail, stage) {
  const text = String(detail || "");
  if (PROVIDER_MODEL_NOT_FOUND_PATTERN.test(text) || /\b404\b|returned 404|not found|no such (provider|model)/i.test(text)) {
    return { stage: stage || "provider_error", errorCode: "PROVIDER_MODEL_NOT_FOUND", errorMessage: `Provider/model not routable: ${text.slice(0, 280)}`, retryable: true };
  }
  if (/rate[ ._-]?limit|quota|too many requests|\b429\b/i.test(text)) {
    return { stage: stage || "provider_error", errorCode: "UPSTREAM_PROVIDER_RATE_LIMITED", errorMessage: text.slice(0, 280), retryable: true };
  }
  if (/unauthorized|authentication|api[ ._-]?key|permission/i.test(text)) {
    return { stage: stage || "provider_error", errorCode: "UPSTREAM_AUTH_ERROR", errorMessage: `Provider authentication/authorization failed: ${text.slice(0, 200)}`, retryable: false };
  }
  return { stage: stage || "provider_error", errorCode: "UPSTREAM_MODEL_ERROR", errorMessage: `Upstream model returned a terminal error: ${text.slice(0, 280)}`, retryable: false };
}

// Normalize an HTTP response from the upstream message endpoint into the canonical shape.
// Returns { ok: true, message } or { ok: false, error }.
export function normalizeUpstreamMessageResponse({ httpStatus, responseText }) {
  if (httpStatus != null && httpStatus >= 400) {
    const detail = String(responseText || "").slice(0, 280);
    if (httpStatus === 404 || /not found|unknown (provider|model)|no such/i.test(detail)) {
      return { ok: false, error: { stage: "http", errorCode: "PROVIDER_MODEL_NOT_FOUND", errorMessage: `Upstream returned ${httpStatus}: ${detail}`, retryable: true } };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { ok: false, error: { stage: "http", errorCode: "UPSTREAM_AUTH_ERROR", errorMessage: `Upstream returned ${httpStatus}: ${detail}`, retryable: false } };
    }
    if (httpStatus === 429) {
      return { ok: false, error: { stage: "http", errorCode: "UPSTREAM_PROVIDER_RATE_LIMITED", errorMessage: `Upstream returned ${httpStatus}: ${detail}`, retryable: true } };
    }
    return { ok: false, error: { stage: "http", errorCode: "UPSTREAM_REQUEST_ERROR", errorMessage: `Upstream returned ${httpStatus}: ${detail}`, retryable: httpStatus >= 500 } };
  }
  let message = null;
  try { message = responseText ? JSON.parse(responseText) : null; } catch { message = null; }
  if (!message) {
    return { ok: false, error: { stage: "schema", errorCode: "UPSTREAM_INVALID_RESPONSE", errorMessage: "Upstream returned a non-JSON message payload.", retryable: false } };
  }
  const detected = detectUpstreamMessageError(message);
  if (detected) return { ok: false, error: detected };
  return { ok: true, message };
}

// Convert a normalized terminal error descriptor into a thrown-style Error carrying the
// canonical fields used by the gateway (code/message/failureStage/retryable).
export function normalizedErrorToError(error, extra = {}) {
  const err = new Error(error.errorMessage || error.errorCode || "UPSTREAM_MODEL_ERROR");
  err.code = error.errorCode || "UPSTREAM_MODEL_ERROR";
  err.failureStage = error.stage || "message_result";
  err.retryable = Boolean(error.retryable);
  err.upstreamErrorPayload = error.upstreamErrorPayload || null;
  Object.assign(err, extra);
  return err;
}

// Reconcile a finalized execution's result payload so nested structuredContent lifecycle
// fields agree with the single source of truth (execution.status). For terminal states,
// nested state/status MUST equal the terminal state; for non-terminal states they are
// left as-is (the execution is still in flight). Returns the reconciled result.
export function reconcileExecutionResult(result, execution) {
  if (!result || typeof result !== "object") return result;
  const top = execution?.status;
  if (!top) return result;
  const base = { ...result };
  if (base.structuredContent && typeof base.structuredContent === "object") {
    const sc = { ...base.structuredContent };
    if (EXECUTION_TERMINAL_STATES.has(top)) {
      if ("state" in sc) sc.state = top;
      if ("status" in sc) sc.status = top;
    }
    base.structuredContent = sc;
  }
  return base;
}

// Hard invariant guard (KOMAA-168 B): a public execution view must never contradict
// itself. Throws PROJECTION_CONTRADICTION when a terminal top-level state is paired with
// a nested running/completed contradiction. Returns the (already-reconciled) view.
export function assertProjectionConsistent(view) {
  if (!view || typeof view !== "object") return view;
  const top = view.state ?? view.status;
  const sc = view.structuredContent;
  if (EXECUTION_TERMINAL_STATES.has(top) && sc && typeof sc === "object") {
    const nested = sc.state ?? sc.status;
    if (nested && nested !== top) {
      throw Object.assign(new Error("PROJECTION_CONTRADICTION"), { code: "PROJECTION_CONTRADICTION", top, nested });
    }
  }
  return view;
}

// Build the canonical finalized execution result from an already-finalized execution.
// Single source of truth = execution.status. Never publish a contradictory snapshot.
export function canonicalExecutionResult(execution, rawResult) {
  const reconciled = reconcileExecutionResult(rawResult, execution);
  return assertProjectionConsistent({ state: execution.status, status: execution.status, structuredContent: reconciled?.structuredContent || null });
}

// Workspace tree builder (pure, filesystem-injected). The gateway supplies `readDir`,
// `join` and `relative` backed by node `fs`/`path`; tests supply in-memory fakes.
// depth = max number of descendant levels below the requested root (root itself is level 0,
// so depth=1 yields only immediate children). truncated means the result hit the explicit
// limit bound (NOT ordinary traversal bookkeeping, KOMAA-168 G).
// readDir(current) -> Array<{ name, isDirectory():boolean, isSymbolicLink():boolean }>
export function buildWorkspaceTree({ root, readDir, join, relative, maxDepth = 2, limit = 200 }) {
  const entries = [];
  const walk = (current, depth) => {
    if (depth >= maxDepth) return;
    if (entries.length >= limit) return;
    let children;
    try { children = readDir(current).slice().sort((left, right) => left.name.localeCompare(right.name)); } catch { return; }
    for (const child of children) {
      if (entries.length >= limit) break;
      const childPath = join(current, child.name);
      const dir = child.isDirectory() || (child.isSymbolicLink() && (() => { try { return child.isDirectory && child.isDirectory(); } catch { return false; } })());
      entries.push({ path: relative(root, childPath) || ".", name: child.name, type: dir ? "directory" : "file", depth: depth + 1 });
      if (dir) walk(childPath, depth + 1);
    }
  };
  walk(root, 0);
  return { root, maxDepth, limit, truncated: entries.length >= limit, entries };
}

// Model availability semantics (KOMAA-168 F): separate catalog/config presence from live
// routability. `available` reflects catalog/config presence only; live health is NEVER
// inferred without an explicit probe. routabilityKnown/liveHealth make the gap explicit.
// Produces the SAME nested `availability` shape used by the gateway's providerCatalog.
export function normalizeModelAvailability(providers) {
  return (Array.isArray(providers) ? providers : []).map((provider) => {
    const configured = Boolean(provider?.configured);
    const models = Array.isArray(provider?.models) ? provider.models.map((model) => {
      const catalogAvailable = configured || Boolean(model?.available) || model?.status === "available";
      return {
        ...model,
        availability: { configured, catalogAvailable, available: catalogAvailable, routabilityKnown: false, liveHealth: null, lastProbeAt: null },
      };
    }) : [];
    return { ...provider, configured, models };
  });
}

// opencode_provider_models contract (KOMAA-168 F/6): return the ACTUAL provider model list
// for the requested provider, honoring limit/pagination. No default/fallback metadata
// masquerading as the requested models.
export function buildProviderModels(providers, providerId, limit) {
  const list = Array.isArray(providers) ? providers : [];
  const match = providerId ? list.find((provider) => provider?.providerID === providerId || provider?.id === providerId || provider?.name === providerId) : list[0];
  const models = match?.models && Array.isArray(match.models) ? match.models : [];
  const sliced = Number.isFinite(Number(limit)) && Number(limit) > 0 ? models.slice(0, Number(limit)) : models;
  return {
    providerId: providerId || match?.providerID || match?.id || null,
    providerName: match?.name || null,
    truncated: Number.isFinite(Number(limit)) && Number(limit) > 0 && models.length > Number(limit),
    total: models.length,
    returned: sliced.length,
    models: sliced,
  };
}

// Reply/continue session affinity (KOMAA-168 C). Pure classification of an upstream
// session-lookup outcome into a deterministic, non-success code. This function NEVER
// contacts the network and NEVER bootstraps a replacement session — it only turns an
// already-observed lookup result into the canonical failure descriptor the gateway throws.
//   - transportError present -> SESSION_CONTINUATION_FAILED (cannot reach upstream)
//   - httpStatus === 404      -> SESSION_NOT_FOUND (explicitly no replacement)
//   - httpStatus >= 400       -> SESSION_CONTINUATION_FAILED
//   - otherwise               -> ok
export function classifySessionContinuation({ sessionId, httpStatus, transportError }) {
  if (transportError != null) {
    return { ok: false, code: "SESSION_CONTINUATION_FAILED", errorMessage: `Cannot reach upstream session ${sessionId}: ${String(transportError)}`, failureStage: "session_lookup_transport" };
  }
  if (httpStatus === 404) {
    return { ok: false, code: "SESSION_NOT_FOUND", errorMessage: `Requested session ${sessionId} does not exist upstream and must not be silently replaced.` };
  }
  if (httpStatus != null && httpStatus >= 400) {
    return { ok: false, code: "SESSION_CONTINUATION_FAILED", errorMessage: `Upstream rejected continuation of session ${sessionId} with status ${httpStatus}.`, upstreamStatus: httpStatus };
  }
  return { ok: true, code: null, errorMessage: null };
}

// Reply/continue affinity reconciliation (KOMAA-168 C). When the caller requested a specific
// session, the session actually used MUST be that exact session. If a bootstrap/replacement
// produced a different id, this returns SESSION_AFFINITY_MISMATCH so the gateway fails closed
// instead of appending the turn to the wrong (new) conversation. Pure + backend-independent.
export function assertSessionAffinity({ requested, actual }) {
  if (requested && actual && requested !== actual) {
    return { ok: false, code: "SESSION_AFFINITY_MISMATCH", errorMessage: `Requested session ${requested} but execution used ${actual}; refusing to continue a replacement session.`, requested, actual };
  }
  return { ok: true, code: null, errorMessage: null };
}

// Nonterminal timeout/pending payload (KOMAA-168 D). A client-side maxDuration expiry is NOT
// an execution failure: the underlying call stays live; the caller receives a stable
// executionId/sessionId and poll guidance. Testable without the backend.
export function pendingTimeoutPayload(executionId, sessionId, timeoutMs) {
  return {
    executionId,
    sessionId,
    state: "running",
    status: "running",
    pending: true,
    timeoutMs,
    retryable: true,
    guidance: "Execution still in progress. Poll opencode_execution_status/opencode_execution_get with the same executionId — do not re-issue the request as a new execution.",
  };
}
