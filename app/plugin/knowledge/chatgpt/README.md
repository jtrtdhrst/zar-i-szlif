# ChatGPT MCP — knowledge retrieval from Qdrant (Żar i Szlif)

This is a **feature of the existing product MCP app**, not another service, application, or connector.

## Real request path

```text
ChatGPT (same installed Żar i Szlif MCP app)
  → POST https://mcp-kompas.kompaszbiorek.pl/mcp
  → Cloudflare Worker OAuthProvider (same authorization + tokens)
  → app/cloudflare-worker/src/mcp.ts [resolveCanonicalScope(ctx.props)]
  → app/plugin/server.ts [existing MCP tools]
     → search_knowledge / get_knowledge_source
     → search / fetch (Company Knowledge compatibility)
  → app/plugin/knowledge/mcp-tools.ts
  → app/plugin/knowledge/retrieval.ts [Qdrant prefilter + postfilter ACL]
  → app/plugin/knowledge/qdrant.ts
  → Qdrant collection kompas-knowledge-v1
```

**There is no separate user-mcp executable.** The earlier `app/plugin/user-mcp/` prototype was removed: it incorrectly duplicated the OAuth/MCP boundary. Keep the existing UI, widget, OAuth grant and tool names stable for already-connected ChatGPT users.

### What the user can do in the existing ChatGPT app

Ask about activity planning, published instructions/help, onboarding and legal material. ChatGPT calls `search_knowledge` or `search`, receives matching text, score and source attribution, and can call `get_knowledge_source` or `fetch` to expand source material. The tool is read-only and must never return another user's data or internal Paperclip agent memory.

### Qdrant product configuration

The existing Cloudflare Worker `app/cloudflare-worker/src/mcp.ts` reads **backend-only**:
- `QDRANT_URL` — HTTPS origin of authorized product Qdrant cluster
- `QDRANT_API_KEY` — secret with restricted access to the product collection
- `AI` — configured Worker AI binding to `@cf/baai/bge-m3` (1024 dimensions)
- `MCP_PUBLIC_ORIGIN` — existing canonical product MCP origin, unchanged.

The collection contract comes from `../schema.ts`: `kompas-knowledge-v1`, tenant `kompas-zbiorek`, content source allowlist, visibility `global` / `user` / `workspace`, source attribution and Qdrant payload indexes. The separate MCP Qdrant Hybrid server for Paperclip uses a DIFFERENT collection `long_term_memory` and a DIFFERENT embedding model. **Never point this app at it or reuse its collection/key**.

Qdrant stores searchable derived chunks, not application system-of-record records. Supabase/Postgres remains the application SSOT. Membership in a team must come from trusted application data, not client-provided filters; note current OAuth grant can return an empty team list until application membership resolution is integrated, so team-restricted results remain unavailable rather than exposing cross-team content. User identity comes from the verified OAuthProvider grant.

### Indexing/refresh

Ingestion is distinct from ChatGPT read calls. Existing pipeline `app/plugin/knowledge/pipeline.ts` provides `syncDocument`, `syncCorpus` and `deleteSource`, and `app/plugin/knowledge/sources.ts` loads allowed public content (help/legal/marketing/onboarding). The ingestion executor must run with write credentials in a controlled backend job, perform collection/schema/index preflight and report counts. ChatGPT tool execution remains **read-only** and uses a separately scoped Qdrant credential. Do not put Qdrant key or source text in client config.

### Acceptance

1. Build/typecheck + Worker MCP integration tests. `initialize -> tools/list -> tools/call` on **the same Worker handler** with mock Qdrant; test source fetch, cross-user isolation and absence of client-scope overrides.
2. Verify Qdrant collection exists, dimensions/index schema match, and allowed source count > 0. An empty result must remain `[]`, not invented content.
3. Real OAuth/ChatGPT connection (existing connected app): verify metadata and auth, call `search_knowledge` and `get_knowledge_source` with a real user; record sources/IDs, ensure no leak to a second user/team. A mock test is not real live evidence.
4. CTO independent review of fixed SHA; staging deploy and live readback; no automatic production release from documentation/unit tests.

No second connector registration, new subdomain, new token hashing, extra public endpoint or Paperclip Core modification.
