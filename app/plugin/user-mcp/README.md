# Żar i Szlif — User MCP / Qdrant knowledge adapter

This folder is the **user-facing product integration**. The existing product MCP entrypoint is `app/plugin/index.ts` and its tool registry is `app/plugin/server.ts`. Existing retrieval and Qdrant REST client stay canonical under `app/plugin/knowledge/`. This module adds a deployable integration boundary, **not a second RAG implementation**.

## Architecture

```text
ChatGPT / product client
  -> product OAuth resource server (validate access token + team memberships)
  -> MCP Streamable HTTP (app/plugin/server.ts)
  -> user-mcp/runtime.ts (verified per-request identity, read-only)
  -> knowledge/mcp-tools.ts + knowledge/retrieval.ts (mandatory tenant/ACL/source filters)
  -> knowledge/qdrant.ts
  -> Qdrant collection: kompas-knowledge-v1
```

**Never connect user traffic to** `long_term_memory`, the Paperclip agent-memory collection (FastEmbed/BM25). The product collection has **1024-dimensional `@cf/baai/bge-m3` vectors** and tenant `kompas-zbiorek`; the agent collection has a different embedding schema. Do not mix the vectors, sources or service tokens.

## Configuration

Configure these on the backend/Worker only (never GitHub, UI bundles or client-exposed `VITE_*` vars):

- `QDRANT_URL`: Qdrant HTTPS origin (no path/query).
- `QDRANT_API_KEY`: restricted product-collection read key.
- Workers AI binding `AI` running `@cf/baai/bge-m3`.
- `verifyAccessToken`: **mandatory trusted verifier**, using existing product OAuth, validating issuer, audience, expiry, signature, revocation as supported; resolve actual team membership from trusted product data. This is a server callback, NOT an HTTP header supplied by a browser.

Example integration in the *trusted* auth handler (illustrative; not deployed by this PR):

```ts
const runtime = createUserMcpRuntime({
  qdrantUrl: env.QDRANT_URL,
  qdrantApiKey: env.QDRANT_API_KEY,
  ai: env.AI,
  readBundle: () => loadExistingBundle(),
  verifyAccessToken: (bearer) => existingOAuthVerifierAndTeamLookup(bearer),
  securityIssuer: env.OAUTH_ISSUER,
});
const mcp = await runtime.createServer(request.headers.get("authorization"));
// Connect mcp to the product's existing Streamable HTTP transport.
// Never pass a bearer header directly to knowledge props without validation.
```

If the auth resource server cannot provide a verified user and workspace set, **reject** the request. Do not use `bearerSubject()` from the local prototype as production identity; hashing an unverified token is not authentication. Do not enable lexical embeddings against the product bge-m3 index. The current `app/plugin/index.ts` Node prototype and the separate Cloudflare Worker still require a verified integration handoff before production user traffic is enabled.

## User-facing read tools

The canonical registry in `app/plugin/server.ts` already offers `search_knowledge`, `get_knowledge_source` and `search`/`fetch` (Company Knowledge compatibility). The adapter reuses them: scope is server derived, source attribution is retained, no user-supplied tenant/workspace override, no Qdrant management endpoints.

### Required acceptance before production

1. `cd app && npm run typecheck && npm run test:user-mcp && npm run test:contract` PASS.
2. Real OAuth: missing/invalid/expired token returns 401; different user/team receives no private results.
3. Qdrant: private collection access only with restricted backend key; test a real indexed document, source fetch, missing results and 503/error behavior without leaking secrets.
4. Verify indexes, embedding dimension (1024), source allowlist, ingestion and no access to internal `long_term_memory`.
5. End-to-end `initialize -> tools/list -> tools/call` through the actual public MCP transport, with source attributions.
6. CTO independent review of **exact candidate SHA**, then controlled staging deploy and public readback. No self-merge or production flip based only on unit tests.

This branch adds the source integration boundary; **it does not claim that credentials, product OAuth callback, ingestion or production deployment have been configured**.
