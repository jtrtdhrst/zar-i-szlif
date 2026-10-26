// Gateway-only resolution of the PRESENTED principal. Fail closed on permanent
// denials; retry at most once for transient upstream/network failures. The
// original bearer token and optional caller-owned runId are never substituted.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchAgentMe(token, runId, { apiUrl, fetchImpl = fetch, wait = sleep } = {}) {
  if (typeof token !== "string" || !token.trim() || typeof apiUrl !== "string" || !apiUrl) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (runId) headers["X-Paperclip-Run-Id"] = runId;
  const endpoint = new URL("agents/me", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    let transient = false;
    try {
      const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(8000) });
      // A credential/run denial MUST NOT be retried under another principal.
      if (response.status === 401 || response.status === 403) return null;
      if (response.ok) {
        const agent = await response.json();
        return UUID.test(agent?.id ?? "") ? { id: agent.id, companyId: agent.companyId } : null;
      }
      transient = response.status === 429 || response.status >= 500;
      if (!transient) return null;
    } catch {
      // Network errors, timeouts and transient malformed 5xx responses fail
      // closed after one bounded retry. No token or error body is logged.
      transient = true;
    }
    if (!transient || attempt === 1) return null;
    await wait(500);
  }
  return null;
}
