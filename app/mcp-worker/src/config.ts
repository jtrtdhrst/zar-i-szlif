/** Cloudflare product origin and host validation; no trusted user-supplied Host redirects. */
export function canonicalOrigin(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("MCP_PUBLIC_ORIGIN is required");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("MCP_PUBLIC_ORIGIN must be a valid HTTPS origin"); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error("MCP_PUBLIC_ORIGIN must be an HTTPS origin without path/query/credentials/port");
  }
  if (url.origin !== raw.replace(/\/$/, "")) throw new Error("MCP_PUBLIC_ORIGIN must be canonical");
  return url.origin;
}

export function requestHostAllowed(url: string, expectedOrigin: string): boolean {
  try {
    const incoming = new URL(url);
    return incoming.protocol === "https:" && incoming.host === new URL(expectedOrigin).host;
  } catch {
    return false;
  }
}
