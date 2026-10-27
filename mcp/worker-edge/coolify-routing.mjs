// Production Cloudflare Worker replacement: host-isolated routing with fail-closed credentials.
// The engine URLs remain unchanged during cutover; only the edge execution moves to Coolify.
export const SERVICES = Object.freeze({
  "paperclip-mcp.zariszlif.pl": { id: "paperclip", upstream: "https://paperclip-engine.zariszlif.pl/mcp", oauth: true },
  "qdrant-mcp.zariszlif.pl": { id: "qdrant", upstream: "https://qdrant-engine.zariszlif.pl/mcp", auth: true, upstreamAuth: true },
  "supabase-mcp.zariszlif.pl": { id: "supabase", upstream: "https://supabase-engine.zariszlif.pl/mcp", auth: true, upstreamAuth: true },
  "ubuntu-mcp.zariszlif.pl": { id: "ubuntu", upstream: "https://ubuntu-engine.zariszlif.pl/mcp", auth: true, upstreamAuth: true },
  "plasmic-mcp.zariszlif.pl": { id: "plasmic", upstream: "https://plasmic-engine.zariszlif.pl/mcp", auth: true, upstreamAuth: true },
  "emailens-mcp.zariszlif.pl": { id: "emailens", upstream: "https://emailens-engine.zariszlif.pl/mcp", auth: true, upstreamAuth: true },
  "langfuse-mcp.zariszlif.pl": { id: "langfuse", upstream: "https://langfuse-engine.zariszlif.pl/api/public/mcp", auth: true },
  "mcp-comfy.kompaszbiorek.pl": { id: "comfyui", upstream: "https://comfy-engine.zariszlif.pl/mcp" }
});
const STAGE_HOST = "mcp-edge-stage.zariszlif.pl";
// Dedicated per-service Coolify apps are reached via their own Coolify URL,
// whose Host is not a production service hostname. EDGE_SERVICE_ID pins the
// service explicitly; unknown IDs fail closed. When unset, production Host
// routing below applies unchanged.
const SERVICE_BY_ID = Object.freeze(Object.fromEntries(Object.values(SERVICES).map(r => [r.id, r])));
export function resolveService(host, env = process.env) {
  const pinned = String(env.EDGE_SERVICE_ID || "").toLowerCase().trim();
  if (pinned && !SERVICE_BY_ID[pinned]) return { error: "unknown_host" };
  const hostname = String(host || "").toLowerCase().split(":")[0].replace(/\.$/, "");
  // Staging can only exercise Paperclip; it cannot unlock other services without their secrets.
  const record = pinned ? SERVICE_BY_ID[pinned]
    : (env.EDGE_STAGE_SERVICE === "paperclip" && hostname === STAGE_HOST)
      ? SERVICES["paperclip-mcp.zariszlif.pl"] : SERVICES[hostname];
  if (!record) return { error: "unknown_host" };
  const tag = record.id.toUpperCase();
  const auth = env["MCP_AUTH_TOKEN_" + tag] || "";
  const upstreamToken = env["UPSTREAM_TOKEN_" + tag] || "";
  // Never expose an unauthenticated endpoint when the old Worker required a token.
  if ((record.auth && !auth) || (record.upstreamAuth && !upstreamToken)) {
    return { error: "credentials_not_provisioned", id: record.id };
  }
  // Do not permit a secret in a Paperclip identity-preserving OAuth proxy.
  if (record.oauth && (auth || upstreamToken)) return { error: "paperclip_shared_secret_forbidden" };
  return { id: record.id, config: {
    UPSTREAM_URL: record.oauth && env.PAPERCLIP_ENGINE_URL ? env.PAPERCLIP_ENGINE_URL : record.upstream,
    MCP_AUTH_TOKEN: auth || undefined,
    UPSTREAM_TOKEN: upstreamToken || undefined,
    PAPERCLIP_AUTH_PROXY: record.oauth ? "1" : undefined
  } };
}
