# Żar i Szlif — separate Cloudflare product MCP

This is the **canonical source directory for the customer-facing Żar i Szlif product MCP**. It owns the MCP HTTP server, Google OAuth consent/callback, Qdrant retrieval, ingestion helpers, schemas, tests and Cloudflare deployment config. It does not publish the separate Plasmic/Paperclip MCP servers or legacy `app/cloudflare-worker/` panel.

## Cloudflare Git integration

Repository: `miloszspyrka-code/zar-i-szlif`

- Root directory: **`app/mcp-worker`**
- Production branch: `main`
- Worker: `zar-i-szlif-mcp`
- Build command: **`npm run build`**
- Deploy command: **`npm run deploy`**
- Public MCP endpoint (only after successful deployment): **`https://mcp.zariszlif.pl/mcp`**
- Disable preview builds initially. Do not put Cloudflare Access in front of ChatGPT OAuth endpoints.

The build installs existing monorepo **npm dependencies** from the root, but the Worker **source code** imports only within `app/mcp-worker/src/**`. Local copies of the audited OAuth and knowledge modules live under `src/oauth/**` and `src/knowledge/**`; `npm run verify:root` rejects imports escaping the configured Cloudflare Root directory. The legacy `app/plugin/knowledge/**` and `app/cloudflare-worker/**` remain temporarily for other consumers, not as product Worker imports. No runtime writes to those projects.

## Required before first deployment

1. Delegate `zariszlif.pl` DNS to Cloudflare and verify the zone is active.
2. Create a **new** Cloudflare Workers KV namespace for this product's OAuth tokens (do not use the old namespace). Set **`MCP_OAUTH_KV_ID`** to its 32-character ID in the Cloudflare Git deploy/build environment variables. `npm run deploy` injects it into an ignored temporary Wrangler config and fails safely if absent. KV namespace ID is not a secret.
3. Add secrets to the **new Worker**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`. Keep them out of GitHub.
4. Configure a Google Cloud OAuth web application with callback **`https://mcp.zariszlif.pl/callback`**. Existing Google OAuth credentials can only be reused if this callback is explicitly registered and their scopes/app branding are approved.
5. Wrangler config already contains the dedicated Workers AI binding `AI` and a production custom domain route. Ensure this Cloudflare account has Workers AI and zone permissions.
6. Confirm reachability to Qdrant from the public Cloudflare Worker over **HTTPS** with scoped credentials. Cloudflare cannot directly call a Docker-only/private VPS service. Provision a secure public ingress or equivalent private connectivity.
7. Run the complete authenticated login and MCP smoke test before registering in ChatGPT.

## Tooling and security

OAuth 2.1 authorization code flow + PKCE/CSRF (reused audited implementation), DCR allowlist, separate OAuth KV, strict host/origin validation, only authorized tools: `search_knowledge`, `get_knowledge_source`, `search`, `fetch`. User/team scope is derived from verified OAuth grants, not tool arguments. Qdrant retrieval and embeddings are owned under `src/knowledge/**` (initially imported losslessly from the previous implementation). Supabase remains the application's source of truth.

**Known transitional limitation:** sign-in and consent HTML currently reuse the legacy Google handler, so some text still says “Kompas Zbiórek”. The authorization handler's legacy panel/catalog endpoints are denied by this product Worker; rebrand consent pages in a separately tested auth migration before inviting end users. The Qdrant collection and indexed source content also remain legacy until synchronized for Żar i Szlif, and cross-team entitlements are not claimed to be implemented.

Do NOT switch `MCP_PUBLIC_ORIGIN` to a different host without also updating DNS, Google OAuth callback, DCR and the Cloudflare zone. Never deploy this product using `wrangler.panel.jsonc`.

## Smoke checklist

- `GET /health` -> 200
- `POST /mcp` without token -> 401 + WWW-Authenticate
- OAuth discovery advertises `https://mcp.zariszlif.pl/mcp`
- DCR refuses unknown redirect URIs; Google callback finishes login
- Authenticated `tools/list` has four knowledge tools, no legacy UI and no Paperclip admin tools
- Authenticated `search_knowledge` performs scoped Qdrant retrieval; wrong-user/team data never returned
- Rollback uses Cloudflare Workers versions; legacy Worker never redeployed for this target.

## MCP Engineer mandatory publishing rule

All **new product MCP implementation** — handlers, auth, tools, schemas, Qdrant/RAG, validation, migrations specific to this service and tests — MUST be committed under `app/mcp-worker/**` on the original issue branch/worktree and submitted through a PR into the existing `main` release flow. No new code in `app/plugin/knowledge/**`, legacy `app/cloudflare-worker/**`, or the public website folders. A separate domain-owner issue/PR is required for a real cross-component contract change; the MCP Engineer must not silently edit unrelated packages.

The copied legacy modules MUST NOT be deleted while the legacy plugin or panel still imports them; their removal is a later, separately reviewed compatibility migration. A migration PR is not a production deployment; live OAuth, authenticated tools/list and negative tenant-scope tests remain release gates.
