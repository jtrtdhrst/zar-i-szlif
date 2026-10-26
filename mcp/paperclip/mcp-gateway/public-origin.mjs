/**
 * Per-request public origin resolution for the Paperclip MCP edge.
 *
 * One gateway serves several public hostnames (the canonical
 * `paperclip-mcp.kompaszbiorek.pl` and the legacy/alias
 * `paperclip-mcp.zariszlif.pl`). OAuth discovery must be self-consistent per
 * host: a client that starts at one origin cannot be handed metadata whose
 * `issuer`/`resource` point at a different origin without failing RFC 8414 /
 * RFC 9728 validation.
 *
 * The statically configured `MCP_PUBLIC_BASE_URL` used to win unconditionally,
 * so every alias advertised the canonical origin. The resolver below honours a
 * trusted forwarding header from the edge Worker, but only for an explicit
 * allowlist of origins; anything else falls back to the canonical origin. That
 * keeps host-header poisoning from rewriting OAuth metadata.
 *
 * Pure module: no I/O, no environment access outside the factory.
 */

/** Normalise a URL-like value to its origin, or "" when unusable. */
export function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value.trim()).origin;
  } catch {
    return "";
  }
}

function firstHeaderValue(value) {
  return typeof value === "string" ? value.split(",")[0].trim() : "";
}

function isLocalHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/**
 * @param {object} options
 * @param {string} [options.publicBaseUrl] canonical origin (MCP_PUBLIC_BASE_URL)
 * @param {string|string[]} [options.publicOrigins] additional allowed origins
 * @returns {{ publicOrigins: Set<string>, resolve: (req: object) => string }}
 */
export function createOriginResolver({ publicBaseUrl = "", publicOrigins = [] } = {}) {
  const canonical = normalizeOrigin(publicBaseUrl);
  const configured = Array.isArray(publicOrigins)
    ? publicOrigins
    : String(publicOrigins).split(",");
  const allowed = new Set(
    [canonical, ...configured.map(normalizeOrigin)].filter(Boolean),
  );

  function resolve(req) {
    const headers = (req && req.headers) || {};
    const forwardedHost = firstHeaderValue(headers["x-forwarded-host"]);
    const host = forwardedHost || firstHeaderValue(headers.host);
    if (!host) return canonical;
    const forwardedProto = firstHeaderValue(headers["x-forwarded-proto"]);
    const proto = forwardedProto || (isLocalHost(host) ? "http" : "https");
    const origin = normalizeOrigin(`${proto}://${host}`);
    if (!origin) return canonical;
    // No allowlist configured: preserve the historical behaviour (derive from
    // the request). With an allowlist, never trust an unlisted host.
    if (allowed.size === 0) return origin;
    if (allowed.has(origin)) return origin;
    return canonical || origin;
  }

  return { publicOrigins: allowed, resolve };
}
