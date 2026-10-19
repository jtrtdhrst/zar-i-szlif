/**
 * User-facing MCP -> product Qdrant knowledge.
 *
 * Only a trusted OAuth resource server may supply verifyAccessToken. Do not
 * use bearer presence, a hash of an opaque token, or caller-provided user IDs.
 * No credentials or user content are logged by this adapter.
 */
import { createPluginServer } from "../server.js";
import { workersAiEmbed } from "../knowledge/embeddings.js";
import { QdrantClient } from "../knowledge/qdrant.js";
import { COLLECTION_NAME } from "../knowledge/schema.js";
import { searchKnowledge, getKnowledgeSource } from "../knowledge/mcp-tools.js";
import type { PluginDeps } from "../server.js";

export interface VerifiedUser {
  /** Stable, verified subject from the product's OAuth issuer. */
  userId: string;
  /** Server-validated team memberships, never request arguments. */
  workspaceIds: string[];
}

export interface UserMcpConfig {
  qdrantUrl: string;
  qdrantApiKey: string;
  /** The same embedding model/dimension used to index kompas-knowledge-v1. */
  ai: { run(model: string, input: { text: string[] }): Promise<{ data: number[][] }> };
  /** Implement using the EXISTING OAuth resource server and membership lookup. */
  verifyAccessToken: (token: string) => Promise<VerifiedUser | null>;
  readBundle: PluginDeps["readBundle"];
  securityIssuer?: string;
  securityScopes?: readonly string[];
  /** Injectable only for isolated tests; never send an untrusted fetch here. */
  fetchFn?: typeof fetch;
  /** Local development without TLS, not permitted for deployed environments. */
  allowInsecureLoopback?: boolean;
}

export class UserMcpUnauthorized extends Error {
  readonly status = 401;
  constructor() {
    super("unauthorized");
    this.name = "UserMcpUnauthorized";
  }
}

function validateQdrantUrl(raw: string, allowInsecureLoopback = false): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid QDRANT_URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowInsecureLoopback && loopback && url.protocol === "http:")) {
    throw new Error("QDRANT_URL must use HTTPS (loopback exception is development-only)");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("QDRANT_URL must be an origin with no credentials, path or query");
  }
  return url.origin;
}

function readBearer(header: string | null | undefined): string {
  const match = /^Bearer\\s+([^\\s]+)$/i.exec((header ?? "").trim());
  if (!match) throw new UserMcpUnauthorized();
  return match[1];
}

function normalizeVerifiedPrincipal(value: VerifiedUser | null): VerifiedUser {
  if (!value || typeof value.userId !== "string" || !value.userId.trim() ||
      value.userId.length > 256 || !Array.isArray(value.workspaceIds) ||
      value.workspaceIds.some(id => typeof id !== "string" || !id.trim() || id.length > 256)) {
    throw new UserMcpUnauthorized();
  }
  return { userId: value.userId, workspaceIds: [...new Set(value.workspaceIds)] };
}

/**
 * Construct once per trusted server runtime; createServer is called once
 * per authenticated MCP request. Search/fetch share the existing scoped,
 * source-attributed product retrieval and never touch Paperclip long_term_memory.
 */
export function createUserMcpRuntime(config: UserMcpConfig) {
  const origin = validateQdrantUrl(config.qdrantUrl, config.allowInsecureLoopback);
  if (!config.qdrantApiKey?.trim()) throw new Error("QDRANT_API_KEY required");
  if (typeof config.verifyAccessToken !== "function") throw new Error("OAuth verifier required");
  if (!config.ai || typeof config.ai.run !== "function") throw new Error("Workers AI binding required");
  const client = new QdrantClient({
    baseUrl: origin,
    apiKey: config.qdrantApiKey,
    collection: COLLECTION_NAME,
    fetchFn: config.fetchFn,
  });
  const embed = workersAiEmbed(config.ai);

  async function authenticate(authorization: string | null | undefined) {
    const principal = normalizeVerifiedPrincipal(await config.verifyAccessToken(readBearer(authorization)));
    return { googleSub: principal.userId, workspaceIds: principal.workspaceIds };
  }

  return {
    collection: COLLECTION_NAME,
    /** Integrate with the existing MCP transport AFTER OAuth verification. */
    async createServer(authorization: string | null | undefined) {
      const props = await authenticate(authorization);
      return createPluginServer({
        readBundle: config.readBundle,
        knowledge: { client, embed, props },
        securityIssuer: config.securityIssuer,
        securityScopes: config.securityScopes,
      });
    },
    /** Read-only backend adapters, for protocol and tenancy smoke tests. */
    async search(authorization: string | null | undefined, args: unknown) {
      const props = await authenticate(authorization);
      return searchKnowledge(client, embed, props, args);
    },
    async getSource(authorization: string | null | undefined, args: unknown) {
      const props = await authenticate(authorization);
      return getKnowledgeSource(client, props, args);
    },
  };
}
