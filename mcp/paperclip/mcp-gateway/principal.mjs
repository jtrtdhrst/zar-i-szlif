/**
 * Per-caller principal resolution for the Paperclip MCP edge.
 *
 * Root cause addressed (KOMAA-850 / cross-agent token reuse):
 * the public `/mcp` route injected the gateway's OWN service credentials
 * (server agent key + server board key + a fixed agent id) into EVERY
 * caller-authenticated session. Two different agents connecting to the same
 * public endpoint therefore executed under one shared identity, and every
 * issue-scoped write silently escalated to board authority.
 *
 * Resolution order (first match wins):
 *   1. service token  -> the gateway's own key (OAuth default flow). Service
 *                         principal, unchanged behaviour, explicitly labelled.
 *   2. board key      -> board principal, bound to the CALLER's own key.
 *   3. agent key      -> agent principal bound to the CALLER's own agent id and
 *                         key. Board authority only when the caller presents
 *                         its own board key.
 *   4. otherwise      -> fail closed.
 *
 * Invariant: a caller-authenticated session never receives a server-owned
 * credential it did not present itself, unless the caller IS the service
 * principal.
 *
 * No network access here: all I/O is injected so the rules stay unit-testable.
 */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const PRINCIPAL_KIND = {
  SERVICE: "service",
  BOARD: "board",
  AGENT: "agent",
};

/** Trim a credential-like header value; anything else becomes "". */
export function normalizeCredential(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Extract the run id bound to a JWT credential.
 * Returns null for non-JWT credentials (e.g. pcp_agent_ keys) and for
 * JWTs without a run_id claim.
 */
export function jwtRunId(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.run_id === "string" ? payload.run_id : null;
  } catch {
    return null;
  }
}

/**
 * Decide which run id (if any) may be attached to a caller session.
 * Returns { ok: true, runId } or { ok: false, reason }.
 *
 * A presented run id must be a UUID and must equal the run_id claim of the
 * caller's own credential. A run id together with a board credential is
 * ambiguous (two authorities for one session) and is rejected.
 */
export function resolveRunBinding(rawRunId, token, hasBoardCredential) {
  const runId = normalizeCredential(rawRunId);
  if (!runId) return { ok: true, runId: null };
  if (!UUID_RE.test(runId)) return { ok: false, reason: "invalid_run_id" };
  if (hasBoardCredential) return { ok: false, reason: "ambiguous_credential_scope" };
  if (jwtRunId(token) !== runId) return { ok: false, reason: "run_id_not_bound_to_credential" };
  return { ok: true, runId };
}

/**
 * Resolve the effective principal for one MCP caller.
 *
 * @param {object} deps
 * @param {string[]} deps.serviceTokens   credentials owned by the gateway itself
 * @param {string|null} deps.serviceAgentKey
 * @param {string|null} deps.serviceBoardKey
 * @param {string|null} deps.serviceAgentId
 * @param {string} deps.companyId
 * @param {(key:string)=>Promise<boolean>} deps.authenticateBoard
 * @param {(key:string)=>Promise<{id:string,companyId:string}|null>} deps.fetchAgentMe
 * @param {object} input
 * @param {string} input.token            effective caller credential
 * @param {string} [input.rawBoardToken]  caller-presented board credential
 * @param {string} [input.rawRunId]       caller-presented run id
 * @returns {Promise<object>} principal descriptor (never contains secrets)
 */
export async function resolvePrincipal(deps, input) {
  const {
    serviceTokens = [],
    serviceAgentKey = null,
    serviceBoardKey = null,
    serviceAgentId = null,
    companyId,
    authenticateBoard,
    fetchAgentMe,
  } = deps;
  const token = normalizeCredential(input?.token);
  if (!token) return { ok: false, reason: "no_credential" };

  const presentedBoard = normalizeCredential(input?.rawBoardToken);
  const isService = serviceTokens.some((candidate) => candidate && candidate === token);
  const suppliedRunId = normalizeCredential(input?.rawRunId);
  if (suppliedRunId && (presentedBoard || isService)) {
    return { ok: false, reason: "ambiguous_credential_scope" };
  }

  // Board authentication wins over any overlapping service token label.
  // A legitimately presented owner Board key must always receive Board scope.
  let boardAuthenticated = false;
  try {
    boardAuthenticated = Boolean(await authenticateBoard(token));
  } catch {
    boardAuthenticated = false;
  }
  if (boardAuthenticated) {
    if (suppliedRunId) return { ok: false, reason: "ambiguous_credential_scope" };
    return {
      ok: true,
      kind: PRINCIPAL_KIND.BOARD,
      agentId: null,
      runId: null,
      agentApiKey: null,
      boardApiKey: token,
      source: "caller",
    };
  }


  if (isService) {
    // A service-key OAuth grant is an agent/service principal, NEVER an owner.
    // Most importantly, do not project the gateway's server board key into an
    // arbitrary client session. An explicit, validated caller-presented board
    // credential remains the only opt-in way to add board authority.
    let explicitBoard = null;
    if (presentedBoard) {
      let valid = false;
      try { valid = Boolean(await authenticateBoard(presentedBoard)); } catch { valid = false; }
      if (!valid) return { ok: false, reason: "invalid_board_credential" };
      explicitBoard = presentedBoard;
    }
    return {
      ok: true,
      kind: PRINCIPAL_KIND.SERVICE,
      agentId: serviceAgentId,
      runId: null,
      agentApiKey: serviceAgentKey,
      boardApiKey: explicitBoard,
      source: "service",
    };
  }

  let boardApiKey = null;
  if (presentedBoard) {
    let valid = false;
    try {
      valid = Boolean(await authenticateBoard(presentedBoard));
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: "invalid_board_credential" };
    boardApiKey = presentedBoard;
  }

  const run = resolveRunBinding(input?.rawRunId, token, Boolean(presentedBoard));
  if (!run.ok) return { ok: false, reason: run.reason };

  let agent = null;
  try {
    agent = await fetchAgentMe(token, run.runId);
  } catch {
    agent = null;
  }
  if (!agent || !UUID_RE.test(agent.id || "") || agent.companyId !== companyId) {
    return { ok: false, reason: "unresolved_identity" };
  }

  return {
    ok: true,
    kind: PRINCIPAL_KIND.AGENT,
    agentId: agent.id,
    runId: run.runId,
    agentApiKey: token,
    boardApiKey,
    source: "caller",
  };
}

/** Secret-free projection of a principal, safe to return to a client or log. */
export function describePrincipal(principal) {
  if (!principal) return { resolved: false };
  if (!principal.ok) return { resolved: false, reason: principal.reason };
  return {
    resolved: true,
    kind: principal.kind,
    agentId: principal.agentId || null,
    runId: principal.runId || null,
    boardAuthorized: Boolean(principal.boardApiKey),
    credentialSource: principal.source,
  };
}

/**
 * Fail-closed validation for owner OAuth grants. A caller must supply
 * a Board credential that belongs to the current company; server
 * credentials do not confer permissions on the caller.
 */
export async function isVerifiedOwnerBoardGrant(token, validateBoard) {
  if (typeof token !== "string" || !token.trim()) return false;
  try {
    return Boolean(await validateBoard(token.trim()));
  } catch {
    return false;
  }
}
