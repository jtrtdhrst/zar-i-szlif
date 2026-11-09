---
title: Żar i Szlif — Product MCP on Cloudflare Workers (runbook v1)
type: concept
tags: [mcp, cloudflare, oauth, qdrant, github, supabase, operations, runbook, verified-state]
updated: 2026-10-20
status: PRODUCTION_DEPLOYED_FAIL_CLOSED (candidate 4f4fc7e) / OAUTH_PENDING_BOARD / FULL_RUNBOOK
owner: MCP Engineer
reviewer: CTO
---

## Capability clarification — 2026-11-07 (does not rewrite historical deployment evidence)

The **four read-only tools documented here describe the verified 2026-10-20 Worker artifact**, not an MCP protocol limitation, product CRUD policy or current 2026-11-07 runtime verification. The *target* product MCP can expose typed write/delete tools when securely implemented; the free-to-instructor app/API CRUD path must not require a paid ChatGPT plan. Whether ChatGPT Free can invoke the customer's external custom MCP write plugin remains **UNTESTED**, not assumed allowed or impossible. Authoritative policy: [Product MCP CRUD, client eligibility and free-user access](wiki/concepts/product-mcp-crud-and-chatgpt-client-eligibility-20261107.md).

## SOURCE PATH CORRECTION — 2026-10-22

For new agent tasks consult `wiki/concepts/product-app-website-mcp-routing-20261022.md` before using this dated operational record. Actual Git `main` entrypoint is `app/mcp-worker/src/index.ts`, with shared knowledge imports from `app/plugin/knowledge/**` and OAuth/Google identity imports from `app/cloudflare-worker/src/**`. The product-local `./knowledge/**` and `./oauth/**` variants belong to the pending `fix/mcp-worker-self-contained-20261021` candidate, NOT proven merged/deployed. A public MCP Connect landing is currently only a placeholder README at `product/www:sites/mcp-connect/**`; Worker GET `/` is plain text when configured. The release observations and missing credentials below describe their original audit date, **not automatically the current runtime state**. Verify provider artifact + public authenticated tools before claiming LIVE_VERIFIED.

title: Żar i Szlif — Product MCP on Cloudflare Workers (runbook v1)
type: concept
tags: [mcp, cloudflare, oauth, qdrant, github, supabase, operations, runbook, verified-state]
updated: 2026-10-20
status: PRODUCTION_DEPLOYED_FAIL_CLOSED (candidate 4f4fc7e) / OAUTH_PENDING_BOARD
owner: MCP Engineer
reviewer: CTO
---

# Żar i Szlif — Product MCP on Cloudflare Workers: architecture, verified state and runbook (2026-10-20)

> **Truth labels.** This page separates three states and never collapses them:
> **SOURCE_VERIFIED** (code and CI at an exact SHA) → **DEPLOYED** (artifact live on the edge, exact-SHA readable
> back from Cloudflare) → **LIVE_VERIFIED** (authenticated end-to-end acceptance passed).
> Today: SOURCE_VERIFIED **yes**, DEPLOYED **yes (fail-closed)**, LIVE_VERIFIED **no** — the dedicated Google OAuth
> client does not exist yet (board action). A deployed-but-fail-closed Worker is **not** a working product: every
> path answers `503 MCP authentication configuration missing`.
> This page records only facts that were read back from the authoritative provider. No secret value appears here.

---

## 0. Executive summary — what exists right now

| Layer | State |
| --- | --- |
| Product MCP Worker | `zar-i-szlif-mcp` exists in the Cloudflare account, **live on `mcp.zariszlif.pl`** with a valid edge certificate |
| Deployed code | exact SHA `4f4fc7e31c7303d2e44d366c746963f89469bef3` (PR #52 head), readable from the version annotation |
| Public behaviour | **fail-closed**: every path → `503` (no Google OAuth client bound yet); no legacy branding, no legacy route, no secret material in any response |
| Cloudflare Builds | fully configured (repo connection, worker build config, production trigger, build variable) but **cannot run**: the build token cannot authenticate the runner |
| OAuth client | **missing** — no Google connector, no `gcloud`, no service account, no authenticated Google session in this environment |
| Knowledge backend | credentials bound (`QDRANT_URL`, `QDRANT_API_KEY`); collection `kompas-knowledge-v1`, `@cf/baai/bge-m3`, 1024 dims; **Worker→Qdrant egress unproven** |
| Supabase | product integration **does not exist yet** (no client library, no migrations, DB tier not running in this environment) |
| Independent review | CTO **architecture accepted**; candidate acceptance + merge + release-policy decision **pending** |

Three things unblock a working product, none of them doable by an agent:

1. a dedicated Google OAuth **Web application** client for `zariszlif.pl` with redirect URI `https://mcp.zariszlif.pl/callback`;
2. a new Cloudflare API token registered as a **build token** (the current one cannot authenticate the build runner);
3. a **collection-scoped** Qdrant key (the currently bound key is cluster-wide and was pasted in a thread).

Plus three CTO decisions: release-gate policy for `app/mcp-worker/**`, acceptance of the candidate release, merge of PR #52.

---

## 1. What the product is

- **Product:** Żar i Szlif — a product whose knowledge lives in a Qdrant collection and whose users sign in with Google.
- **Product surface:** an **MCP server** exposed over HTTP (Streamable HTTP, stateless) at `https://mcp.zariszlif.pl/mcp`,
  consumed by MCP clients (ChatGPT connector, Claude connector, MCP Inspector, any OAuth-aware client).
- **Authorization model:** the Worker is an **OAuth 2.1 authorization server** (authorization code + PKCE) and a
  **Google OAuth client** at the same time. Google authenticates the human; the Worker issues the MCP access token.
- **Tool manifest (exactly four, all read-only):**
  `search_knowledge`, `get_knowledge_source`, `search`, `fetch`.
  The manifest deliberately contains **no** product-mutation tools, **no** legacy panel routes and **no**
  administrative surface.
- **Data access rule:** the retrieval scope is derived **only** from the server-verified OAuth grant
  (Google `sub` + server-derived `workspaceIds`). Client-supplied tenant/team/user arguments are rejected
  fail-closed (`assertNoClientScope`).

---

## 2. System topology and hard boundaries

Four different systems are visible in this environment. Conflating them is the single most expensive mistake
available here.

| System | What it is | In this release? |
| --- | --- | --- |
| `app/mcp-worker/` → Cloudflare Worker `zar-i-szlif-mcp` | the product's customer-facing MCP (this release) | **YES** — the only thing deployed |
| `app/cloudflare-worker/` → legacy Workers (`panel-kompaszbiorek`, `kompas-zbiorek`, …) | historical Kompas product Worker and panel, routes on `kompaszbiorek.pl` | **NO** — must not be overwritten, redirected or reconfigured |
| Paperclip / OpenCode MCP gateway (`paperclip-mcp-gateway`, `paperclip-mcp-quicktunnel`, `paperclip-3101-fwd`) | internal execution infrastructure owned by the Harness Agent | **NO** — different system, different credentials, different transport |
| `mcp-qdrant` (`mcp-qdrant-hybrid` image) | separate hybrid Qdrant MCP service used inside the Paperclip network | **NO** — it uses the *same Qdrant Cloud cluster* but a **different collection** (`long_term_memory`) |

**Identity chain (the contract that must never be faked):**

```
Google `sub` (stable, never email)
   └─> OAuth grant (server-side, OAUTH_KV)
        ├─> payload.user_id  in Qdrant  == the RAW `sub` (no prefix)
        └─> payload.workspace_id in Qdrant == the Supabase TEAM id (Supabase = SSOT)
```

`app/cloudflare-worker/src/identity.ts` is the single place where `userId` is produced, so isolation has exactly
one code path. `canonicalUserId()` throws when the grant has no verified `sub` → no Qdrant query instead of an
empty/shared scope.

---

## 3. GitHub repository — state, lineage and gates

- **Repository:** `miloszspyrka-code/zar-i-szlif` (private), production branch `main`.
- **Baseline at the start of the deployment run:** `main` = `a8b251bb452bd7440d116c9716e892d1bf578230`
  ("feat: deployable Żar i Szlif product MCP Worker") — the merge commit of PR #51.
- **`main` tip now:** `b3282da1a7d83bbfe460b41419345541b5a377ce` ("Merge pull request #58 from miloszspyrka-code/chore/remove-vercel").
  The 9 commits in between (Vercel removal, Coolify frontend) **do not touch `app/mcp-worker/`**.
- **PR #51** "feat: dedicated Żar i Szlif Cloudflare MCP Worker" — **merged**; introduced `app/mcp-worker/`.
- **PR #52** "fix(mcp-worker): brand Google, minimalne zakresy i działający pipeline deployu" — **open**,
  head `4f4fc7e31c7303d2e44d366c746963f89469bef3`, base `main` (was `a8b251b`), branch `KOMAA-1003`.
- **CI at `4f4fc7e`** — all green:
  - `Product MCP Worker CI` run #4 → success (`/actions/runs/39448320185`)
  - `CI` run #138 → success (`/actions/runs/39448320156`)
  - Vercel preview → success (combined status `state=success`)
  - Note: `GET /commits/{sha}/check-runs` returns **403** for the available PAT; `GET /actions/runs?head_sha=…`
    and `GET /commits/{sha}/status` work and are the readable evidence.
- **Branch protection:** `main` is **not** protected (`protected: false`).
- **Identity guard** `scripts/assert-git-identity.mjs`: commits must carry a canonical *human* identity
  (role-only accounts such as `Engineer <engineer@paperclip.local>` are rejected). Enforced by `.githooks/pre-commit`,
  `.githooks/pre-push` and `.github/workflows/ci.yml`. The canonical identity in use is
  `miloszspyrka-code <[REDACTED_PRIVATE_EMAIL]>`; `node scripts/assert-git-identity.mjs --check-config` → PASS.
- **Release gate** `scripts/release-targets.mjs`: classifies changed paths into release targets and **fails closed**
  on any unclassified path. **Verified gap:** `app/mcp-worker/**` has no rule on `main` (`b3282da1`), therefore every
  change under that directory is refused:

  ```
  $ node scripts/release-targets.mjs --base origin/main --head HEAD
  [release-gate] changed paths: 1
  [release-gate]   app/mcp-worker/src/__probe.ts
  [release-gate] targets: none (non-release only)
  [release-gate] AMBIGUOUS release target — failing closed.
  Unclassified paths: app/mcp-worker/src/__probe.ts
  Classify them in scripts/release-targets.mjs (RELEASE_RULES / NON_RELEASE_RULES).
  Refusing to push code whose release target is unknown.
  exit 2
  ```

  Consequence: `scripts/**` is **release policy** and belongs to the CTO/release owner; agents must not patch it to
  unblock a push. A minimal, CTO-approved shape would be one classification rule plus one owning gate, e.g.
  `{ re: /^app\/mcp-worker\//, targets: ["product-mcp"] }` with `product-mcp` → `npm run validate:code` + the
  `app/mcp-worker` build/dry-run.
- **Release provenance** `scripts/assert-release-provenance.mjs`: production delivery must consume **one exact
  GitHub SHA on `origin/main`**. The deployed SHA `4f4fc7e` is therefore not yet on `main` — merging PR #52 is a
  provenance requirement, not a formality.

---

## 4. Cloudflare account, zone and Worker

| Item | Verified value |
| --- | --- |
| Account | `c056821a7ee2aabdcf0a6dc447490184` ("[REDACTED_PRIVATE_EMAIL]'s Account") |
| Zone | `zariszlif.pl` → `58a1e9854df07369e6c9a65ee4aef9ac`, status **active**, NS `eloise`/`lennon.ns.cloudflare.com` |
| Worker | `zar-i-szlif-mcp` |
| Compatibility date | `2026-10-20` |
| `workers_dev` | disabled (public access only through the custom domain) |
| Observability | enabled on the Worker |
| Active deployment | `94fb721c-3508-4dda-a763-62fabefdaaeb` → version `da40b5e5f0464a279bb34641bfb40ac5` |
| Active version annotation | `zar-i-szlif-mcp @ 4f4fc7e31c7303d2e44d366c746963f89469bef3` |
| Worker etag | `577e5f410e20fe8c4e6975a9` |

**Version history (immutable, ordered — this is also the rollback menu):**

| Version id | Annotation |
| --- | --- |
| `da40b5e5f0464a279bb34641bfb40ac5` | `zar-i-szlif-mcp @ 4f4fc7e…` (active) |
| `99ba5218…` | `zar-i-szlif-mcp @ 4f4fc7e…` |
| `724bac9d…` | `zar-i-szlif-mcp @ 4f4fc7e…` |
| `296d84d1…` | bootstrap placeholder (no annotation) |
| `7193042077da41ae83c2cedb7a3c0fc1` | `zar-i-szlif-mcp @ a8b251bb…` (previous baseline — **rollback target**) |
| `2733dbcc…` | `zar-i-szlif-mcp @ a8b251bb…` |
| `90d6dabfd92440bebea3bf93076b676e` | bootstrap placeholder (no annotation) |

---

## 5. Custom domain, DNS and TLS

| Item | Verified value |
| --- | --- |
| Custom domain | `mcp.zariszlif.pl` → service `zar-i-szlif-mcp` |
| Domain id | `97b0154e2867d8a8e4a397fa9acb4a756f2ece8e` |
| Zone | `zariszlif.pl` (`58a1e9854df07369e6c9a65ee4aef9ac`) |
| Certificate | `07931cce-62f4-40a7-a420-864bfb981065`, `enabled: true` |
| DNS | resolves to Cloudflare edge (`2606:4700:3030::ac43:8115`, `2606:4700:3031::6815:268`) |
| TLS | valid, `CN=zariszlif.pl`, issuer Google Trust Services `WE1`, valid 2026-10-20 → 2027-01-18 |
| Previews | disabled for this Worker |

**Edge behaviour on foreign hosts (verified):** `Host: evil.example.com` → **403** from the edge; `Host: zariszlif.pl`
→ **530 / 1016** (no Worker route for the apex). Inside the Worker, `requestHostAllowed()` returns **400** for a
foreign host that does reach it. Isolation is therefore enforced twice: at the edge and in the Worker.

**Do not touch:** `polityka.prywatnosci.zariszlif.pl` and `warunki.korzystania.zariszlif.pl` (both serve the
`zariszlif-prawne` Worker and are the legal pages referenced by the OAuth consent screen), and any
`kompaszbiorek.pl` route.

---

## 6. Workers KV — dedicated namespace

| Namespace | id | Bound to | Use |
| --- | --- | --- | --- |
| `zar-i-szlif-oauth` | `5b3fa9202590427c915d67a959496da3` | `zar-i-szlif-mcp` (`OAUTH_KV`) | OAuth grant/state storage for the product MCP |
| `OAUTH_KV` (legacy) | `2a0acb7d28e249a989ca9ca8ffeca24e` | `panel-kompaszbiorek` | legacy panel — **never reuse** |

The namespace id is also exported to the build as a **build variable** `MCP_OAUTH_KV_ID` (readback in both
`production_settings.environment_variables` and the trigger's environment variables). `scripts/deploy.mjs` refuses
to deploy without it (`/^[0-9a-f]{32}$/i`, exit code 2, message "DEPLOY BLOCKED").

---

## 7. Workers Builds (Cloudflare Git integration)

| Item | Verified value |
| --- | --- |
| Repo connection | `b1c9800a-04d1-45c5-8e14-5b2ccec23044` → github / `miloszspyrka-code` / repo id `1331908275` (`zar-i-szlif`) |
| Provider account id | `233741877` (GitHub user `miloszspyrka-code`) |
| Worker build config | `script_tag=zar-i-szlif-mcp`, branch `main`, `auto_build_enabled=true`, `previews_enabled=false` |
| Production settings | root `/app/mcp-worker`, build `npm run build`, deploy `npm run deploy`, path includes `*`, excludes `[]`, caching on |
| Trigger | `03737330-5413-4ceb-bf61-15e593301da6`, name `zar-i-szlif-mcp`, branch includes `["main"]` |
| Build variable | `MCP_OAUTH_KV_ID` = `5b3fa9202590427c915d67a959496da3` (`is_secret:false`) |
| Build token | `04f8f240-48d4-40fd-810d-475729a6c9ef` ("Workers Builds - 2026-08-13 13:50", owner type `user`) → underlying Cloudflare API token `078f5bff453f1dce88a852a2b9164411` |

**Independent confirmation of the configuration** (Cloudflare's own repo analyser):
`GET /accounts/{id}/builds/repos/github/233741877/1331908275/config_autofill?branch=main&root_directory=/app/mcp-worker`
→ `config_file=app/mcp-worker/wrangler.jsonc`, `default_worker_name=zar-i-szlif-mcp`, `package_manager=npm`,
`scripts.build=npm ci --prefix ../.. --ignore-scripts && npm run validate`.
This endpoint reads the repository, which also proves the **GitHub App integration still has read access** to the
repository.

### 7.1 Why the pipeline cannot run (verified root cause)

Three builds were started (two by `commit_hash`, one by `branch=main`); all fail **at initialization, before any
clone**:

| Build | Trigger | Outcome |
| --- | --- | --- |
| `66fbf28b-b8db-4b74-9665-670bbb23e0f7` | `commit_hash=a8b251b…` | `Build initialization failed: unable to verify Worker` → `Build failed to initialize and was timed out` (status `stopped`, outcome `terminated`) |
| `931474a5-edfa-4e07-a82f-f431848ba24c` | `commit_hash=a8b251b…` | same, terminal after ~5 min |
| `e5a79234-52eb-4ad9-82b2-0d91c16f870f` | `branch=main` | same |

Root cause: the build runner authenticates to the Cloudflare API with the build token's underlying API token
(`078f5bff…`), which can no longer verify the Worker. The token's effective permissions are **not readable**
(`GET /user/tokens/{id}` → 403, `GET /accounts/{id}/tokens/{id}` → 403 — no `API Tokens Read`), and the Cloudflare
MCP connection **cannot create a replacement**: `POST /accounts/{id}/tokens` → 403
`Unauthorized to access requested resource … No OAuth scope covers this endpoint … Account API Tokens Write`.
The OAuth scope set of the connection contains no API-token scope at all.

**Therefore repairing the pipeline is an account-owner (dashboard) action:** create an API token with
`Workers Scripts:Edit` + `Workers KV Storage:Edit` + `Workers Routes:Edit` (zone `zariszlif.pl`), register it in
Worker → Settings → Builds → Build Configuration → API Token (or hand over the token secret so it can be registered
through `POST /accounts/{id}/builds/tokens`).

**Do not** replace the token with an account-wide one — a narrower Worker/zone scope suffices.

### 7.2 The path that was actually used (sanctioned fallback)

Because the pipeline cannot bootstrap, the production release used the **secret-preserving version upload** through
the native Cloudflare MCP script-upload API — the same artifact, bindings and config wrangler would produce
(directive H3). The 1 MB bundle never passes through the agent context: the shell reads it from disk and sends one
JSON-RPC `execute` call whose JS body carries the multipart payload
(`cloudflare.request({method:"PUT", path:"/accounts/{id}/workers/scripts/<name>", rawBody:true, contentType:"multipart/form-data; boundary=…", body:"…"})`).

Two details that cost time and must not be re-learned:

- the multipart **part** for the module must be `Content-Type: application/javascript+module`
  (`application/javascript` is parsed as a service-worker script and fails with `Unexpected token 'export'`);
- the MCP `execute` tool takes an **async arrow function** (`async () => { return await cloudflare.request(…); }`),
  not a statement list.

### 7.3 Build-token hygiene

`POST /accounts/{id}/builds/tokens` **does not validate** the secret or the token id (both a valid token id with a
dummy secret and a non-existent token id are accepted) — it is a record, and the runner uses the stored secret.
Never leave probe build tokens behind; delete them after use.

---

## 8. Runtime configuration

### 8.1 Bindings (read back from the Worker)

| Binding | Type | Value |
| --- | --- | --- |
| `OAUTH_KV` | `kv_namespace` | `5b3fa9202590427c915d67a959496da3` (dedicated) |
| `AI` | `ai` | Workers AI binding |
| `MCP_PUBLIC_ORIGIN` | `plain_text` | `https://mcp.zariszlif.pl` |
| `MCP_ALLOWED_REDIRECT_URIS` | `plain_text` | `https://chatgpt.com/connector/oauth/,https://chatgpt.com/connector_platform_oauth_redirect,https://claude.ai/api/mcp/auth_callback` |
| `COOKIE_ENCRYPTION_KEY` | `secret_text` | set (32-byte, CSPRNG-generated) — value never read back |
| `QDRANT_URL` | `secret_text` | set — value never read back |
| `QDRANT_API_KEY` | `secret_text` | set — value never read back |
| `GOOGLE_CLIENT_ID` | `secret_text` | **MISSING** — board action |
| `GOOGLE_CLIENT_SECRET` | `secret_text` | **MISSING** — board action |

The three secrets **survive** a script upload (read back after the candidate upload) — a version upload does not
drop `secret_text` bindings.

### 8.2 `MCP_ALLOWED_REDIRECT_URIS` semantics (`app/cloudflare-worker/src/dcr.ts`)

- format: comma- or newline-separated; **entry without trailing slash = exact path match**, **entry with trailing slash = prefix match**; the host must match exactly (`startsWith` on raw strings is deliberately avoided, so `https://chatgpt.com.evil.example` cannot slip in);
- **loopback** `http://localhost|127.0.0.1|[::1]|::1` is always allowed (MCP Inspector);
- anything else must be `https:` and on the allowlist — otherwise DCR is rejected with
  `invalid_redirect_uri` (HTTP 400);
- the ChatGPT entry `https://chatgpt.com/connector/oauth/` is a **prefix** because ChatGPT registers with
  `https://chatgpt.com/connector/oauth/{callback_id}` and the library does not implement RFC 9207
  (`authorization_response_iss_parameter_supported`);
- an empty/unset allowlist allows **loopback only** (fail-closed).

### 8.3 Required secrets and how to set them

`scripts/deploy.mjs` and the Worker runtime expect: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`COOKIE_ENCRYPTION_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`. Set them as Worker secrets
(`PATCH /accounts/{id}/workers/scripts/<name>/secrets-bulk`, content type `application/merge-patch+json`,
body `{"secrets":{"NAME":{"type":"secret_text","text":"…"}}}`). One bulk call = one new version.
**Never** place a secret in `wrangler.jsonc`, GitHub, wiki, issue comments, logs or chat.

---

## 9. OAuth 2.1 / MCP authorization flow

### 9.1 Endpoints

| Path | Purpose |
| --- | --- |
| `/mcp` | MCP transport (POST, Streamable HTTP, stateless) |
| `/.well-known/oauth-authorization-server` | AS metadata (issuer, endpoints, PKCE methods) |
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | protected-resource metadata (resource, authorization servers, scopes) |
| `/authorize` | consent (GET renders the dialog, POST accepts it) |
| `/register` | dynamic client registration (RFC 7591), allowlist-validated |
| `/token` | token endpoint (authorization code + PKCE) |
| `/callback` | Google callback (`GET`) |
| `/health` | liveness (`GET`) — currently behind the configuration guard |

### 9.2 Scopes

- AS scopes: `knowledge.read` (read-only knowledge) and `offline_access` (refresh).
- Google scopes requested by the product: **`openid email profile` only** — no Drive, no Calendar.
  The legacy panel needs `https://www.googleapis.com/auth/drive.file` for its Google Picker, so the scope list is
  **overridable per client** (`createGoogleAuthHandler({ googleScopes })`); the product passes the minimal list and
  the panel keeps its default.
- Optional Calendar integration must use a **separate, user-initiated** flow with the narrowest sufficient scope
  (e.g. `https://www.googleapis.com/auth/calendar.app.created`) and only for users who enabled the feature.

### 9.3 Security properties (implemented and tested)

| Property | Where |
| --- | --- |
| Authorization code + PKCE (S256) | shared Google handler, reused audited implementation |
| CSRF token on the consent POST | `generateCSRFProtection` / `validateCSRFToken` |
| Exact redirect-URI validation on DCR | `dcrRedirectUriError` + `clientRegistrationCallback` |
| State binding + session binding cookie | `createOAuthState` / `bindStateToSession` |
| Host/origin validation | `requestHostAllowed` + `canonicalOrigin` (HTTPS, no path/query/credentials/port) |
| Grant validated before any DB call | `resolveCanonicalScope` → `canonicalUserId` throws without a verified `sub` |
| No secrets in responses | Worker returns fixed strings; secret values are never echoed |
| Fail-closed on missing configuration | `503 MCP authentication configuration missing` |
| Consent branding / scopes | `createGoogleAuthHandler({ serverInfo, googleScopes })` |

### 9.4 Google OAuth client — exactly what has to exist

| Field | Value |
| --- | --- |
| Type | **Web application** |
| Authorized redirect URI | `https://mcp.zariszlif.pl/callback` (exact) |
| Authorized domain | `zariszlif.pl` (no `https://`) |
| Consent screen | External; homepage `https://zariszlif.pl`, privacy `https://polityka.prywatnosci.zariszlif.pl`, terms `https://warunki.korzystania.zariszlif.pl`, contact e-mail |
| Scopes | `openid`, `email`, `profile` |
| Domain verification | already present — TXT `google-site-verification=cV8U6MipiH5F6OwRpKb5aleXmjUQSEqguPJVgQdxOfI` on the zone |
| Not usable | the legacy panel's Google clients (their authorized redirect URIs exclude `mcp.zariszlif.pl`, so Google's redirect check would fail, and reusing them would widen their blast radius) |

---

## 10. MCP transport and tool contract

| Tool | Purpose | Input | Notes |
| --- | --- | --- | --- |
| `search_knowledge` | semantic search over the authorised collection | `query` (1–500), `topK` (1–20), `minScore` (0–1), `sourceIds?` | returns `results` with `source_id`, `chunk_id`, `text`, score |
| `get_knowledge_source` | fetch the source of a hit | `source_id`, `document_id`, `limit?` (1–50) | provenance-preserving |
| `search` | ChatGPT Company Knowledge-shaped search | same as `search_knowledge` | returns document handles |
| `fetch` | fetch a document by handle | `id` | handle validated + access re-checked |

- All four are annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
- Transport: stateless Streamable HTTP (`WebStandardStreamableHTTPServerTransport`, `sessionIdGenerator: undefined`).
- Each tool call re-derives the scope from the verified grant; a failure to resolve the scope yields
  `401 Unauthorized MCP grant` **before** any backend call.
- Client-supplied scope keys are rejected: `FORBIDDEN_CLIENT_KEYS = ["tenant","userId","user_id","workspaceIds","workspace_id","workspaces"]`.

---

## 11. Knowledge / RAG contract (Qdrant)

| Item | Value |
| --- | --- |
| Collection | `kompas-knowledge-v1` |
| Tenant | `kompas-zbiorek` |
| Embedding model | `@cf/baai/bge-m3` (Workers AI binding `AI`) |
| Vector size | **1024** (Cosine) — **verified live**: Workers AI run returned a 1024-element vector |
| Qdrant endpoint | `https://3c398f47-8921-4930-8ee4-9f3fd881f587.eu-central-1-0.aws.cloud.qdrant.io` (cluster `3c398f47-…`, eu-central-1, AWS, v1.19.0, free tier) |
| Credentials | scoped key bound as `QDRANT_API_KEY`; **cluster-wide (`access:"m"`) and pasted in a thread → rotation requested** |
| Payload index | 7 payload indexes (tenant, visibility, user_id, workspace_id, source_id, document_id, …) |

**Visibility rules (single implementation, `app/plugin/knowledge/schema.ts` + `mcp-tools.ts`):**

```
tenant        must equal "kompas-zbiorek"
visibility=global      → allowed
visibility=user        → payload.user_id === auth.userId   (raw Google sub)
visibility=workspace   → payload.workspace_id ∈ auth.workspaceIds   (server-derived)
```

**Ingestion rules** (`app/plugin/knowledge/pipeline.ts`): `user_id` / `workspace_id` are written from the document
metadata (`doc.userId`, `doc.workspaceId`) and are `null` for `global`. **Team content therefore does not exist in
the collection until ingestion is given a `workspace_id` that equals the Supabase team id.**

### 11.1 Open risk — Qdrant egress (verified, unresolved)

The cluster endpoint refuses TLS **from this host** and **from Cloudflare's Browser Rendering network**
(`SSL: unexpected eof while reading`, `ERR_CONNECTION_CLOSED`, Browser Rendering `5006: Network connection closed`),
while other AWS endpoints from the same host work (`ec2`, `s3`, `sts`, `elb` → reachable) and the same cluster
answered normally from the Paperclip container on 2026-10-19. The block is therefore **new and endpoint-side**
(consistent with an IP-reputation block on the cluster).

- **Worker → Qdrant reachability is still unproven.** It will be settled by the first authenticated
  `search_knowledge` call.
- Approved fallback if it is refused: a **Cloudflare Tunnel** with a token to the authorised Qdrant service.
  Never expose Qdrant unauthenticated; require TLS, least-privilege credentials, explicit collection scope and
  no keys in logs.

---

## 12. Supabase — current state and what "user data" requires

### 12.1 Verified state (2026-10-20)

| Item | Finding |
| --- | --- |
| Supabase containers in this environment | `supabase-mcp`, `supabase-studio`, `supabase-meta`, `supabase-edge-functions`, `supabase-envoy` — **no Postgres, no GoTrue, no PostgREST** |
| API reachability | gateway answers `401` without a key, but with the service-role key: **`503 no healthy upstream`** on `/rest/v1/*` and `/auth/v1/health` |
| Database host | `DATABASE_URL=postgresql://…@db:5432/postgres`; `db` does **not resolve** in the container network |
| Client library in the repo | **none** (no `@supabase/supabase-js` in root or `app` workspace) |
| Migrations | `supabase/` contains only `README.md` — "The current V0 panel has no database migration yet; do not commit credentials here." |
| Env var names in code | **none** (`SUPABASE_*` does not appear in the codebase) |
| Workspace membership in the OAuth grant | **never populated** → `visibility:"workspace"` documents are unreachable (fail-closed) |
| Current product stance | `app/mcp-worker/src/knowledge-scope.ts` (MCP Engineer, candidate `b37c0e6`) states the limitation explicitly instead of pretending team knowledge exists |

**Conclusion: there is no product Supabase integration today.** Two capabilities must be separated:

1. **authorization** — deciding which teams' knowledge a user may read (needs a membership source);
2. **domain data access** — tools that read the user's own product data (profile, history, tasks). The manifest is
   deliberately knowledge-only; adding domain tools is a product/CTO scope decision, not a deployment detail.

### 12.2 What is required to enable it

1. **Live data tier**: Postgres + GoTrue + PostgREST for the product Supabase, or a hosted `*.supabase.co` project
   (no trace of one exists in the repo or environment today).
2. **Migration in `supabase/`** (canonical location) implementing the identity contract:
   - `auth.users` (Google provider) → `sub` in `providers->'google'->>'sub'`;
   - `profiles(user_id, google_sub UNIQUE)` — `sub` → product user;
   - `teams(id)` and `team_members(user_id, team_id, role)` — **`teams.id` must equal `payload.workspace_id`**;
   - `visibility:"user"` rows keep `payload.user_id` = the raw `sub`.
3. **HTTPS endpoint reachable from Cloudflare**: the local stack is Docker-internal (`http://kong:8000`) and a
   Worker cannot reach it → Cloudflare Tunnel (token) or a hosted project. Do not expose an anonymous PostgREST.
4. **Worker credentials**: prefer a **narrow RPC** (e.g. `get_workspaces_for_google_sub(p_sub text)`) with
   `SUPABASE_ANON_KEY` + RLS over a `SERVICE_ROLE_KEY` (the latter is a wide blast radius inside the Worker).
5. **Code**: resolve membership server-side from Supabase for the verified `sub` and feed `workspaceIds` into the
   retrieval scope; today the grant carries only `sub`. Ingestion must also write `workspace_id`.
   → a PR under `app/mcp-worker/**`, which is **blocked by the release-gate gap** until the CTO classifies the path.
6. **Consistency warning**: if `user_id`/`workspace_id` in Qdrant do not match the ids produced by Supabase and by
   ingestion, search returns **zero results without an error** — a silent emptiness, not a failure. Establish the id
   contract before ingesting anything.

---

## 13. Deploy procedures (reproducible)

### 13.1 Current path — version upload through the native Cloudflare MCP

Preconditions: bundle built from the exact SHA, `MCP_OAUTH_KV_ID` known, secrets already bound.

```bash
# 1. build the artifact from the exact SHA
cd app/mcp-worker
npm ci --prefix ../.. --ignore-scripts && npm ci --prefix . --ignore-scripts
npm run validate                                     # typecheck + vitest
npx --no-install wrangler deploy --dry-run --config .wrangler.deploy.jsonc --outdir /tmp/wbundle
# 2. upload through the MCP (the 1 MB bundle never enters the agent context)
#    metadata: main_module=index.js, bindings[OAUTH_KV(kv_namespace), AI(ai),
#    MCP_PUBLIC_ORIGIN(plain_text), MCP_ALLOWED_REDIRECT_URIS(plain_text)],
#    compatibility_date=2026-10-20, usage_model=standard, observability{enabled:true},
#    annotations{"workers/message":"zar-i-szlif-mcp @ <SHA>"}
#    multipart part: name="index.js"; filename="index.js"; Content-Type: application/javascript+module
#    → PUT /accounts/{account}/workers/scripts/zar-i-szlif-mcp  (rawBody, multipart/form-data; boundary=…)
# 3. read back: deployment id, etag, version annotation, bindings
```

### 13.2 Intended path — Cloudflare Builds (after the build-token repair)

1. Account owner creates the API token (Worker/zone scope only) and selects it in
   Worker → Settings → Builds → Build Configuration → API Token.
2. Verify with a manual build for the exact SHA:
   `POST /accounts/{account}/builds/triggers/03737330-5413-4ceb-bf61-15e593301da6/builds`
   body `{"commit_hash":"<sha>"}` (or `{"branch":"main"}`).
3. Follow the build to a terminal state: `GET /accounts/{account}/builds/builds/{build_uuid}` plus
   `GET /accounts/{account}/builds/builds/{build_uuid}/logs`.
4. The pipeline runs `npm run build` then `npm run deploy` in `/app/mcp-worker`; the deploy script writes the
   ignored, mode-0600 `.wrangler.deploy.jsonc` with `kv_namespaces:[{binding:"OAUTH_KV",id:<KV id>}]` and runs
   `npx --no-install wrangler deploy --config .wrangler.deploy.jsonc`.
5. `main` pushes then auto-build (`auto_build_enabled=true`).

**Build-time requirement (defect D1, fixed in `4f4fc7e`):** the build must install the Worker's own dev
dependencies, because the root workspace list is `["app"]` and does not include `app/mcp-worker` — without
`npm ci --prefix .` there is no `wrangler` and `npx --no-install wrangler deploy` cannot run.

### 13.3 Rollback

```bash
# redeploy the previous version of this Worker only
POST /accounts/{account}/workers/scripts/zar-i-szlif-mcp/deployments
body {"strategy":"percentage","versions":[{"percentage":100,"version_id":"7193042077da41ae83c2cedb7a3c0fc1"}]}
```
`71930420…` is the `a8b251b` baseline; full version list in §4. If the Worker must disappear entirely, delete the
Worker **and** its custom domain. **Never** roll back `panel-kompaszbiorek`, `zariszlif-prawne`, the Paperclip MCP
gateway, the Qdrant collection `long_term_memory` or any `kompaszbiorek.pl` route.

### 13.4 Things that must never happen

- deploying the repository root or `app/cloudflare-worker/` as the product MCP;
- reusing the legacy `OAUTH_KV` namespace or the legacy Google OAuth client;
- attaching the custom domain of the legacy panel;
- shipping secrets in `wrangler.jsonc`, Git, wiki, issues, logs or chat;
- exposing Qdrant unauthenticated;
- editing `scripts/release-targets.mjs` to unblock a push (release policy = CTO);
- creating a second Google OAuth client for the same purpose.

---

## 14. Live acceptance procedure (run when the Google client lands)

1. **Set the credentials:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` as Worker secrets (bulk patch, one version).
2. **Readback:** `GET /accounts/{id}/workers/scripts/zar-i-szlif-mcp/settings` → five secret bindings present.
3. **Health/routing:** `GET https://mcp.zariszlif.pl/health` → `200 {"ok":true,"name":"Żar i Szlif MCP"}`.
4. **OAuth discovery:** `GET /.well-known/oauth-authorization-server` → `issuer=https://mcp.zariszlif.pl`,
   `authorization_endpoint`, `token_endpoint`, `registration_endpoint` on the same origin,
   `code_challenge_methods_supported` contains `S256`; `GET /.well-known/oauth-protected-resource/mcp` →
   `resource=https://mcp.zariszlif.pl/mcp`, `authorization_servers=[https://mcp.zariszlif.pl]`.
5. **DCR allowlist (negative):** `POST /register` with `redirect_uris:["https://evil.example.com/cb"]` → **400**
   `invalid_redirect_uri`; with an allowlisted ChatGPT URI → **201** and a `client_id`.
6. **Consent:** `GET /authorize?client_id=…&response_type=code&redirect_uri=…&code_challenge=…&code_challenge_method=S256`
   → 200, body contains `Żar i Szlif`, does **not** contain `Kompas Zbiórek`, contains no `googleapis.com/auth` scope.
7. **Full Google login:** consent → Google → authorised test user → callback → access token → refresh.
8. **MCP transport:** `initialize` → `tools/list` → exactly the four tools; `tools/call search_knowledge` returns
   hits with `source_id`/`chunk_id`/`text`.
9. **Negative suite:** no token → 401; expired token → 401; invalid signature → 401; wrong issuer/audience → 401;
   missing PKCE verifier → 400; invalid state → 400; unknown redirect URI → 400; foreign `Host` → 400/403;
   forged `user_id`/`workspace_id` in tool args → rejected; cross-user/cross-team search → no hits.
10. **Client acceptance:** connect ChatGPT (connector redirect `https://chatgpt.com/connector/oauth/…`) and Claude
    (`https://claude.ai/api/mcp/auth_callback`) — note that the two clients do **not** share redirect URIs; each needs
    its own approved entry in `MCP_ALLOWED_REDIRECT_URIS`.

---

## 15. Verification log (what was read back, and how)

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 1 | Zone `zariszlif.pl` active, NS delegated | Cloudflare MCP | active; `eloise`/`lennon.ns.cloudflare.com` |
| 2 | Dedicated KV namespace created | `POST /accounts/{id}/storage/kv/namespaces` | `zar-i-szlif-oauth` = `5b3fa920…` |
| 3 | Legacy namespace not reused | namespace list readback | legacy `OAUTH_KV` = `2a0acb7d…` (belongs to `panel-kompaszbiorek`) |
| 4 | Repo connection | `PUT /builds/repos/connections` | `b1c9800a…` → repo id `1331908275` |
| 5 | Repo reachable by Cloudflare's Git integration | `GET /builds/repos/…/config_autofill` | `app/mcp-worker/wrangler.jsonc`, worker `zar-i-szlif-mcp` |
| 6 | Worker build config + trigger + build variable | readback of all three | as in §7 |
| 7 | Builds pipeline | 3 builds | **fail closed at init** — `unable to verify Worker` |
| 8 | Build-token repair path | `POST /accounts/{id}/tokens`, `GET /user/tokens/{id}` | 403 `Account API Tokens Write` / 403 `API Tokens Read` |
| 9 | Worker created + real artifact deployed | MCP script upload | deployment `94fb721c…` → version `da40b5e5…`, annotation = exact SHA |
| 10 | Custom domain + certificate | `PUT /accounts/{id}/workers/domains` | domain `97b0154e…`, cert `07931cce…`, enabled |
| 11 | DNS + TLS | `getent hosts`, `openssl s_client` | edge IPs; valid cert 2026-10-20 → 2027-01-18 |
| 12 | Live fail-closed behaviour | 14 probes (`/`, `/health`, `/mcp`, `/authorize`, `/callback`, `/register`, `/token`, 2× `/.well-known/oauth-*`, `/panel`, `/ui`, `/preview`, `/api/skills`, `/api/activities`) | all `503 MCP authentication configuration missing`; no legacy brand/route; no secret material |
| 13 | Host isolation | raw TLS request with spoofed `Host` | edge 403 / 530; Worker 400 |
| 14 | Bindings after upload | `GET …/settings` | `OAUTH_KV`, `AI`, 2 vars, 3 secrets present; 3 secrets survived the upload |
| 15 | Workers AI embedding | `POST /accounts/{id}/ai/run` `{"model":"@cf/baai/bge-m3","input":{"text":[…]}}` | **1024** dimensions |
| 16 | CI at the deployed SHA | GitHub Actions API | both workflows success |
| 17 | Local build/typecheck/tests | `npm run build` in `app/mcp-worker` | typecheck OK, vitest **12/12** (9 config + 3 consent-contract) |
| 18 | Repo-wide gate | `npm run validate:code` | 32 (`node --test`) + 31 (vitest) tests, exit 0 |
| 19 | Dependency audit | `npm audit` (root and `app/mcp-worker`) | **0 vulnerabilities** (was 7, incl. 1 critical `proxy-addr`) |
| 20 | Worker bundle content | wrangler dry-run bundle scan | no `express` / `proxy-addr` / `qs` / `ip-address` / `fast-uri` code in the artifact |
| 21 | Release-gate gap | `node scripts/release-targets.mjs` on `main` | `app/mcp-worker/**` unclassified → **exit 2** |
| 22 | Qdrant endpoint from this host | `curl` / `openssl s_client` | TLS closed by the endpoint; other AWS endpoints fine |
| 23 | Qdrant endpoint from Cloudflare's network | Browser Rendering `content` | `5006: Network connection closed` |
| 24 | Qdrant credentials | board interaction `76eb6858…` on KOMAA-408 | endpoint + scoped-cluster key recovered; key is cluster-wide (`access:"m"`) → rotation requested |
| 25 | Supabase tier | container + API probes | gateway up, **no healthy upstream**, `db` does not resolve, no migrations, no client library |
| 26 | Google console reachability | browser navigation to `console.cloudflare.com`→`accounts.google.com` | redirects to sign-in → no authenticated session |

---

## 16. Observability

- Worker observability is **enabled** (`observability.enabled = true` in the upload metadata).
- What to watch: build/deploy failures, OAuth authentication failures, invalid MCP requests, tool-invocation failures,
  Qdrant connectivity/timeout errors, embedding failures, unexpected authorization denials, latency.
- **Never log**: OAuth authorization codes, access/refresh tokens, `GOOGLE_CLIENT_SECRET`, `QDRANT_API_KEY`,
  `COOKIE_ENCRYPTION_KEY`, raw sensitive user data, or the Google `sub` of a real user in a shared channel.
- Failure loop: `signal → classify (service/contract) → narrow logs → exact cause → reversible repair → test the
  affected path → verify live readback → record evidence`.
- Use the existing Paperclip task/document mechanisms; do not create a competing dispatcher.

---

## 17. Open blockers — owner, required permission, next action

| # | Blocker | Owner | Required permission / artifact | Next action |
| --- | --- | --- | --- | --- |
| 1 | Google OAuth Web client for `zariszlif.pl` (+ id/secret) | **Board (human)** | Google Cloud Console access | create client (redirect `https://mcp.zariszlif.pl/callback`, domain `zariszlif.pl`, scopes `openid email profile`), deliver id/secret → bind as secrets → run §14 |
| 2 | Cloudflare build token cannot authenticate the runner | **Board (account owner)** | Cloudflare dashboard | create API token (Workers Scripts/KV/Routes edit, zone `zariszlif.pl`) → select in Build Configuration → re-run a build for the exact SHA |
| 3 | Qdrant key is cluster-wide and was pasted in a thread | **Board / cluster owner** | Qdrant Cloud console | rotate; issue a `kompas-knowledge-v1`-scoped key → swap binding → verify scoped retrieval |
| 4 | `app/mcp-worker/**` unclassified in the release gate | **CTO (release policy)** | decision + one rule + one gate | classify `app/mcp-worker/**` as `product-mcp`; then transport the newer candidate (`b37c0e6`, currently local-only) and repeat the deployment readback |
| 5 | Acceptance of the candidate release | **CTO** | independent review verdict | review comments `a0ea122f…`, `585860ff…`, `5b81e2ce…` and the issue document `deployment-evidence` |
| 6 | Merge of PR #52 | **CTO** | merge approval | merge with a merge commit so the delivered SHA is on `origin/main` (provenance) |
| 7 | Worker → Qdrant reachability unproven | **Operator + CTO** | first authenticated `search_knowledge` | verify; if refused → Cloudflare Tunnel to the authorised service |
| 8 | Product Supabase integration absent | **Product/CTO + Board** | migrations, live data tier, HTTPS endpoint, scoped credentials | see §12.2; PR under `app/mcp-worker/**` after blocker 4 |

**Board interactions (Paperclip, issue KOMAA-1003):** `03789916-e039-4ade-92c6-ab7832ff0c6b` — one consolidated
request covering #1, #2 and #3 (earlier per-item interactions `f6e525df…`, `aa2525eb…`, `9ab2c812…` expired
unanswered). **Issue disposition:** `in_review`, review stage participant = board user, CTO reviewer runs active;
`deployment-evidence` document revision 5 and this page carry the evidence.

---

## 18. Symptom → diagnosis → owner

| Symptom | Likely cause | Owner |
| --- | --- | --- |
| Every path returns `503 MCP authentication configuration missing` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (or `OAUTH_KV`/cookie key) not bound | Board (#1) → operator binds |
| `Build initialization failed: unable to verify Worker` | build token cannot authenticate | Board (#2) |
| `DEPLOY BLOCKED: configure MCP_OAUTH_KV_ID…` | build variable missing/invalid | operator: set `MCP_OAUTH_KV_ID` on the trigger |
| `npm error npx canceled due to missing packages … wrangler@…` | build did not install the Worker's own devDependencies (fixed in `4f4fc7e`) | operator: keep `npm ci --prefix .` in the build script |
| `Unclassified paths: app/mcp-worker/…` / gate exit 2 | release policy gap | CTO (#4) |
| `Knowledge backend unavailable: QDRANT_URL and Workers AI must both be configured` | `QDRANT_URL` or `AI` binding missing | operator: bind |
| Qdrant TLS `unexpected eof` / `ERR_CONNECTION_CLOSED` | endpoint refuses this source IP | operator: wait/rotate/tunnel (§11.1) |
| `search_knowledge` returns nothing although the user is a team member | `workspace_id` in Qdrant ≠ Supabase team id, or the grant carries no `workspaceIds` | operator + product (§12.2) |
| `invalid_redirect_uri` from `/register` | the client's redirect URI is not on `MCP_ALLOWED_REDIRECT_URIS` | operator: extend the allowlist (host-exact) |
| Consent shows „Kompas Zbiórek" | the legacy brand default was used | operator: pass `serverInfo` (product worker does) |
| Legacy panel routes answering on `mcp.zariszlif.pl` | wrong Worker routed | operator: check the custom domain binding |
| `403` on a legitimate client | edge host mismatch / wrong `MCP_PUBLIC_ORIGIN` | operator: check DNS + var |

---

## 19. Identifier reference

| Kind | Identifier |
| --- | --- |
| Cloudflare account | `c056821a7ee2aabdcf0a6dc447490184` |
| Zone `zariszlif.pl` | `58a1e9854df07369e6c9a65ee4aef9ac` |
| Worker | `zar-i-szlif-mcp` |
| Dedicated KV namespace | `zar-i-szlif-oauth` = `5b3fa9202590427c915d67a959496da3` |
| Legacy KV (do not reuse) | `OAUTH_KV` = `2a0acb7d28e249a989ca9ca8ffeca24e` |
| Builds trigger | `03737330-5413-4ceb-bf61-15e593301da6` |
| Builds repo connection | `b1c9800a-04d1-45c5-8e14-5b2ccec23044` |
| Builds build token | `04f8f240-48d4-40fd-810d-475729a6c9ef` → API token `078f5bff453f1dce88a852a2b9164411` |
| Custom domain id / cert | `97b0154e2867d8a8e4a397fa9acb4a756f2ece8e` / `07931cce-62f4-40a7-a420-864bfb981065` |
| Active deployment / version | `94fb721c-3508-4dda-a763-62fabefdaaeb` / `da40b5e5f0464a279bb34641bfb40ac5` |
| Rollback version | `7193042077da41ae83c2cedb7a3c0fc1` (`a8b251b`) |
| Deployed SHA | `4f4fc7e31c7303d2e44d366c746963f89469bef3` (PR #52 head) |
| `main` tip | `b3282da1a7d83bbfe460b41419345541b5a377ce` |
| Baseline SHA (PR #51 merge) | `a8b251bb452bd7440d116c9716e892d1bf578230` |
| GitHub repo / owner id / repo id | `miloszspyrka-code/zar-i-szlif` / `233741877` / `1331908275` |
| Qdrant cluster / collection | `3c398f47-8921-4930-8ee4-9f3fd881f587` / `kompas-knowledge-v1` |
| Paperclip issue / document | KOMAA-1003 (`c204c7c3-caa7-49aa-9226-586eae1bc01f`) / `deployment-evidence` |
| Board interaction (open) | `03789916-e039-4ade-92c6-ab7832ff0c6b` |
| CTO verdicts | `ccad5273-2190-4759-81d2-4c239814f4a4` (15:30Z, architecture), `3f1661a6-9255-4cbb-ab2d-e1159faf7e46` (16:01Z, itemised) |

---

## 20. Change log

| Date | Change | By |
| --- | --- | --- |
| 2026-08-12 | repository created | — |
| 2026-08-13 | Cloudflare Git integration + build token created (owner action) | account owner |
| 2026-10-20 | PR #51 merged — dedicated `app/mcp-worker` Worker | MCP Engineer |
| 2026-10-20 | CTO accepted the dedicated-Worker architecture (`ccad5273`), itemised verdict `3f1661a6` | CTO |
| 2026-10-20 | PR #52 opened (`4f4fc7e`): D1 build pipeline, D2 brand, D3 scopes, D5 Claude DCR callback, D6 audit → 0 | operator |
| 2026-10-20 | dedicated KV created; Builds configured; candidate deployed fail-closed at `mcp.zariszlif.pl`; docs and issue evidence written | operator |

---

# Appendix A — earlier revision content preserved verbatim

> The sections below are kept byte-identical from the earlier revision of this page (they carry the
> product contract, the MCP Engineer self-repair cycle, the release/rollback boundary, the v69 branch
> freshness rules and the planned privacy/PII gate). Where they overlap with the runbook above, the
> runbook carries the newer verified state.

## Canonical topology and hard boundary

- Repository: `https://github.com/miloszspyrka-code/zar-i-szlif`, branch `main`.
- **Dedicated product MCP Worker root:** `app/mcp-worker/`; exact Worker entry: `app/mcp-worker/src/index.ts`, config: `app/mcp-worker/wrangler.jsonc`, deploy script: `app/mcp-worker/scripts/deploy.mjs`, tests: `app/mcp-worker/src/config.test.ts`, in-repo README.
- **Shared retrieval source (single implementation):** `app/plugin/knowledge/` (Qdrant, embedding, filtering, source attribution). The product Worker imports this code. Avoid duplicating Qdrant clients, business rules, filters or authorization logic.
- **Legacy product Worker:** `app/cloudflare-worker/` with older `kompaszbiorek.pl` routes. It **must not** be overwritten, silently redirected or reconfigured by product-MCP work.
- **Paperclip/OpenCode administration MCP:** entirely different system. Harness Agent owns its gateway, bridge, supervisor, runtime, credentials projection and host operations. Do not conflate it with user-facing product MCP.
- **Separate hybrid MCP Qdrant service:** `wiki/entities/mcp-qdrant-hybrid.md`, a Python service used in the Paperclip network; it is NOT the product Worker, not the same collection, and not an interchangeable database.
- **Supabase/Postgres is product domain SSOT** (users, teams, memberships/roles, application state). Qdrant is a derived retrieval index; no Cloudflare D1 domain SSOT. Data entitlements must derive from authoritative verified identity/roles, not arbitrary MCP arguments.
- **Deployment infrastructure:** product MCP runs on **Cloudflare Workers**, not Coolify. Cloudflare custom domain / DNS / edge TLS provides ingress; Coolify/VPS may host backend services but must not be advertised as the Worker runtime. A Cloudflare Worker cannot query an internal Docker-only Qdrant URL without intentionally configured secure connectivity.

## Cloudflare Git configuration — exact input

| Cloudflare field | Value |
| --- | --- |
| GitHub repository | `miloszspyrka-code/zar-i-szlif` |
| Production branch | `main` |
| Root directory | **`app/mcp-worker`** |
| Worker name | `zar-i-szlif-mcp` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (not raw `wrangler deploy`) |
| Preview builds | OFF until isolated preview OAuth/DNS and secret policy exists |
| Protect with Cloudflare Access | OFF for the public MCP/OAuth protocol endpoints; application-layer OAuth still MANDATORY |
| Canonical production MCP URL | `https://mcp.zariszlif.pl/mcp` — **domain + TLS + artifact LIVE**, endpoint answers `503` until the Google OAuth client is bound (see status above) |
| Google web OAuth callback | `https://mcp.zariszlif.pl/callback` |
| OAuth resource | `https://mcp.zariszlif.pl/mcp` |

`npm run deploy` requires `MCP_OAUTH_KV_ID` at deploy-script invocation time (32-hex Cloudflare Workers KV namespace ID). It synthesizes an ignored `.wrangler.deploy.jsonc`, binding `OAUTH_KV` to the dedicated namespace; without an ID it fails closed. Do NOT reuse the legacy namespace. Verify Cloudflare Git project actually exports this value to the deploy command; an env variable visible only to the Worker runtime is not sufficient.

Bindings: Workers AI `AI` in Wrangler (matching existing BGE-M3 embeddings) + dedicated `OAUTH_KV`.

Worker runtime secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`; keep **values** only in authorized Cloudflare/Paperclip secret bindings, never in Git/Wiki/issues/CI logs. Note: separate product OAuth client credentials created in Paperclip (product-MCP Client ID/Secret and product-Panel Client ID/Secret) are NOT automatically the upstream `GOOGLE_CLIENT_ID/SECRET`. Identify issuer, audience, redirect and grant flow explicitly before binding; do not swap unrelated OAuth clients.

Config non-secrets: `MCP_PUBLIC_ORIGIN=https://mcp.zariszlif.pl`, `MCP_ALLOWED_REDIRECT_URIS` for exact allowed ChatGPT redirects. In Cloudflare, activate the `zariszlif.pl` zone, configure the Worker custom domain only when ownership is verified, and add the Google callback in the correct OAuth app. Never repoint `mcp.kompaszbiorek.pl`, `mcp-kompas.kompaszbiorek.pl` or the panel routes.

## Product contract and known open problems

Current new Worker registers exactly four **read-only** product knowledge tools: `search_knowledge`, `get_knowledge_source`, `search`, `fetch`. HTTP MCP transport: stateless Streamable HTTP at `/mcp`. Uses OAuthProvider authorization-code/PKCE with Google OIDC; server-side verified `googleSub` and `workspaceIds` scope retrieval, never trust tool arguments for user/tenant/team selectors. Qdrant collection currently referenced by canonical library: `kompas-knowledge-v1`, `bge-m3`, 1024 dimensions. Never change embedding model or schema against this collection without a governed reindex/alias migration and regression tests.

Known release gaps to repair and prove before customer rollout:
1. The Google login/consent handler is **reused from the legacy Worker**; branding/text may still reference Kompas Zbiórek. Isolate and rebrand product auth without weakening CSRF, PKCE, DCR or redirect validation.
2. Verify upstream provider subject → real Supabase product user identity mapping; authorization for team/workspace entitlements must be server-derived. Existing code does not prove production-ready team-scoped grants. Cross-user/team leakage testing is mandatory.
3. Verify collection contents and provenance are relevant to Żar i Szlif, not just legacy Kompas documents. Test ingested source allowlist, citations, visibility and readback.
4. Verify DNS, Cloudflare bindings, secure Qdrant HTTPS connectivity, Google OAuth callback, token refresh and real ChatGPT connector login.
5. Confirm deploy invocation working directory, dependency install/build path (shared `app/plugin`), and KV ID injection in the actual Cloudflare Git integration, not just local/CI.
6. **Security follow-up:** current product `src/index.ts` reuses legacy auth handler but limits exposed paths; inspect per-tool scope semantics and authorization metadata for consistency. Do not claim privacy based solely on `tools/list` or mocked retrieval.
7. Review dependency security audit findings and remove/mitigate reachable high/critical issues before production sign-off; CI PASS is not a dependency security acceptance.

## MCP Engineer cycle: self-repair without recurring dead blockers

**Start** from the assigned canonical product issue, last candidate SHA / latest review delta and this page only when Cloudflare/product MCP is in scope. Do not scan entire board. Default one coherent issue, not a pseudo-DAG.

1. **Domain fit & effective access:** Product MCP/RAG code, user OAuth integration, Qdrant/retrieval = MCP Engineer. Paperclip/OpenCode MCP gateway, agent tool registration/grants, broken workspace, model/runtime, host/Docker and CI/Git access projection = Harness. Cloudflare production release/security architecture approvals = CTO. Use `GetAgentEffectiveTools` / `VerifyAgentTool` in the **actual agent issue/runtime**, then an authorized harmless probe. Denial once -> exact fingerprint + responsible Harness owner; no bypass via curl/SSH/new tokens.
2. **Fresh source preflight:** Use current issue workspace `PAPERCLIP_WORKSPACE_CWD`; `git status`, remote, branch/head and base `origin/main`. **Repository must be zar-i-szlif, never historic kompas-zbiorek**. If workspace is stale/wrong, stop product writes, route to Harness root; do not patch the wrong checkout.
3. **Precise repro:** Capture failing `/health`, discovery, DCR, `/mcp` unauthorized status, authorized handshake, tools/list or a single scoped tools/call as relevant; log endpoint path, status, redacted correlation ID, source SHA, config key PRESENCE (not values) and an actionable failure fingerprint. For network/Qdrant classify DNS/TLS/routing vs auth vs collection vs embedding vs filter before modifying code.
4. **Root-cause and smallest reversible patch:** Fix product code/contract in `app/mcp-worker/**` and/or shared `app/plugin/knowledge/**`, never Paperclip Core nor existing legacy Worker unless an explicitly approved cross-target change. Avoid gratuitous refactors or copying a second search implementation. Record `DOC_IMPACT=YES` for public endpoint, OAuth, tool schema, scopes, RAG/index changes.
5. **RED → GREEN → regressions:** Reproduce at least one failing test before edit, then typecheck, Vitest, Wrangler dry-run and the relevant existing product tests; for auth add 401/403, forged/mismatched audience, invalid PKCE/state/redirect, prohibited object keys, malicious tool parameters, cross-user/team, unsupported source IDs, and missing backend (fail closed). For retrieval validate bge-m3 vector size, source attribution, no leakage and real Qdrant contract. Compare exact candidate SHA and unchanged legacy service.
6. **Independent live acceptance:** In isolated staging on an authorized lane, exercise discovery → auth → MCP initialize → tools/list → tools/call → refresh → invalid-token denial and cross-identity probes with non-sensitive test users. Verify public URL, content/citations, Qdrant real retrieval and no privileged admin tools. A health 200, mock-only PASS or Wrangler dry-run does **not** imply LIVE_VERIFIED.
7. **Evidence and handoff:** Record candidate branch+SHA, verified commands/results, negative tests, deployment/bindings matrix, redacted observations, DOC_IMPACT, remaining gaps and rollback target. MCP Engineer may make fixes and local candidate commits autonomously; under current role policy it **must not push, merge, deploy production, self-approve or alter secret permissions**. CTO owns independent acceptance/release; COO wakes eligible dependents once after accepted completion.
8. **If blocked:** Stop repeated attempts on the same unchanged failure fingerprint. Runtime/tool/credential projection fault → Harness on existing canonical root (e.g. KOMAA-1005 for wrong repo mapping), product contract fault → MCP Engineer fixes locally, release permission/architecture → CTO. Keep the original product issue with its owner; use existing review/hold/decision mechanics, not fabricated dependencies, duplicate issues or human-only placeholders. After proved causal change, recheck eligibility and resume once.

### Target-specific diagnostic map

| Symptom | Likely layer | First verification / owner |
| --- | --- | --- |
| Cloudflare cannot select `app/mcp-worker` | Git branch/root/integration freshness | Verify merged `main` path, GitHub install, Cloudflare Root directory; Cloudflare config owner/CTO |
| Build fails `Cannot find module ...plugin/knowledge` | Monorepo build context and dependency path | Check root install, `package.json`, Wrangler bundler on exact SHA; MCP Engineer |
| `MCP_OAUTH_KV_ID` missing / invalid | Deployment configuration | Verify dedicated namespace + env present in deploy process; CTO/authorized Cloudflare operator |
| 404 on `/mcp`, domain or callback | Custom-domain route/DNS/issuer mismatch | Check Cloudflare zone, Wrangler `routes`, callback and canonical origin; MCP Engineer diagnoses, CTO release |
| Unauthenticated MCP returns 200 | OAuth boundary vulnerability | Stop release; MCP Engineer fixes and adds negative regression |
| DCR unsafe redirect allowed / PKCE bypass | Authorization-server vulnerability | Stop release; MCP Engineer fixes; CTO security review |
| Authenticated `tools/list` shows wrong/legacy tools | Wrong Worker route or bundle | Compare live Worker/version and exact four-tool manifest; MCP Engineer / CTO deployment |
| Qdrant request fails from Cloudflare | Egress/TLS/private Docker URL / key | Prove allowed HTTPS route then collection/filter/embedding; Harness only if Paperclip platform tool failure; infrastructure owner for network/secret |
| Valid user sees another team's docs | Identity/membership/RAG filter fault | Fail release; MCP Engineer fixes with Supabase-backed entitlements; CTO security review |
| Internal Paperclip MCP tool missing/403 | NOT product MCP | Harness Agent, exact original-agent tool probe; no product Worker changes |

### Release/rollback boundary

Only the authorized CTO/release owner deploys production after independent PASS and explicit secrets/DNS preflight. Pin exact GitHub SHA + Worker version/digest, verify production OAuth discovery, authenticated round-trip, Qdrant and cross-user negative tests. On regression rollback **only `zar-i-szlif-mcp`** to the last verified version, verify readback, keep legacy `panel-kompaszbiorek` untouched, and add evidence to canonical issue. Failed deploy does not close the issue. Risky architecture/auth/data ownership changes require CTO decision before merge/release.

See: [[wiki/sources/integracje-mcp]], [[wiki/agents/mcp-engineer/AGENTS]], [[wiki/concepts/language-and-content-policy]]; GitHub source `app/mcp-worker/README.md`.

## v69 — branch freshness, code ownership and hard-gate acceptance (2026-10-20)
**Live finding:** product MCP source `app/mcp-worker/` is present on `origin/main` as of merged SHA `a8b251bb452bd7440d116c9716e892d1bf578230`. Historical issue KOMAA-1003 workspace branch `KOMAA-1003` HEAD `13d9b6a9c2031add04cd66414b3f3885abe5d435` is ahead 2/behind 1 and does NOT have `app/mcp-worker/` in its checked-out HEAD. It IS attached to the correct GitHub repository. Therefore this is a stale unmerged candidate, not a missing source folder, and must be reconciled in the same worktree without destructive reset or branch replacement. Keep its prior security fixes and reviewer evidence; CTO records how current dedicated Worker supersedes old single-worker KOMAA-1003 text before any product edits.

**Ownership matrix:** product Worker+OAuth tool protocol `app/mcp-worker/**`, single shared retrieval implementation `app/plugin/knowledge/**` and their specifically affected tests/docs/CI -> MCP Engineer; legacy `app/cloudflare-worker/**` -> separate product owner/explicit CTO exception; Paperclip MCP gateway/runtime/project workspaces -> Harness; separate `mcp-qdrant-hybrid` repository -> specifically scoped MCP service issue, not implicit extension of product Worker; internal Plasmic design-stack MCP -> tooling ownership, NOT customer-facing product MCP. CTO reviews and deploys only after independent evidence.

**Pre-edit/source admission:** issue/project must resolve `miloszspyrka-code/zar-i-szlif`; inspect remote, HEAD and origin/main before any branch mutation. Existing issue branch `KOMAA-NNN` must be reused; no new branch on run/retry/review. Approve the explicit path set before write, then re-check diff paths after local commits. Never edit a legacy Worker simply because a stale local branch lacks the current Worker directory. Tool/CI-level path denial and negative E2E must be proven before calling this rule technically enforced; wiki/skilled prompts are soft guards. Use native Paperclip workspace and independent review mechanisms; do not skip authorization.

## Privacy / PII release gate (planned 2026-10-20)

**MANDATORY:** User email addresses and first/last names must never reach the customer-facing MCP/ChatGPT/Claude response or prompt context. Application-owned Supabase identity fields require authenticated application-layer encryption using external key management, while managed Supabase Auth `auth.users.email` remains a restricted exception necessary for login. Product MCP must have **no ability to decrypt, select or project identity PII**. All knowledge snippets, OAuth claims, nested tool outputs, errors, Qdrant metadata, tracing and logs are in scope. Backend-enforced allowlisted PII-free DTOs and real negative tests are required; prompt-only masking is insufficient. This is **PLANNED, NOT IMPLEMENTED**, and blocks privacy release acceptance.

Canonical policy: [[wiki/concepts/product-mcp-supabase-pii-privacy]]; delivery root: [KOMAA-1108](https://paperclip.kompaszbiorek.pl/KOMAA/issues/KOMAA-1108). See native P1→P2→P3→P4→P5 DAG for technical owners, independent CTO security acceptance and production release evidence.
