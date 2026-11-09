# Żar i Szlif — Product OAuth clients and credential ownership

Updated: 2026-10-20. Status: secret registry metadata updated; runtime binding and OAuth registration/flow not yet verified.

## Architecture decision

There are **two distinct OAuth client registrations** for the product. Do not merge their IDs, reuse one client's secret for the other, or create a second product MCP server. Separate client identity does not require duplicating the product MCP backend.

| Client | Credential kind | Paperclip secret key | Secret ID | Accountable domain owner |
| --- | --- | --- | --- | --- |
| Existing ChatGPT product MCP integration | Client ID | `oauth-client-for-product-mcp-client-id` | `9af6dded-cb37-4bae-9365-3da65964a79c` | MCP Engineer (`1a9eba12-8a05-4a58-ac99-17d1bc80ed62`) |
| Existing ChatGPT product MCP integration | Client Secret | `oauth-client-for-product-mcp-client-secret` | `3fa725f6-fd41-4d02-8715-9aca6df8ef44` | MCP Engineer |
| Product Panel | Client ID | `oauth-client-for-product-panel-client-id` | `48e7cada-268f-491a-82ec-5ae209a300ed` | Engineer (`3fe90c23-8386-40d5-b0a8-52d8c40f812e`) |
| Product Panel | Client Secret | `oauth-client-for-product-panel-client-secret` | `54089de5-b4e1-438e-91df-e713a5736bc4` | Engineer |

**Review/release:** CTO (`ff703eba-3c3d-46f0-b265-df0db1101a19`) independently validates client registration, security policy and deployment.

## Strict hostname separation (Board decision, 2026-10-20)

These two OAuth credential pairs are dedicated to **different product subdomains**, not merely to two vaguely named product features. This is a binding and registration policy, not proof of deployed OAuth configuration.

| Dedicated hostname | OAuth client | Existing Paperclip secret catalog keys | Permitted production consumer |
| --- | --- | --- | --- |
| `https://panel.zariszlif.pl` | Product Panel | `oauth-client-for-product-panel-client-id` + `oauth-client-for-product-panel-client-secret` | Only the panel's own OAuth authorization flow, with the secret restricted to a confidential server/BFF (never browser code) if the provider flow genuinely requires one |
| `https://mcp.zariszlif.pl` | Product MCP | `oauth-client-for-product-mcp-client-id` + `oauth-client-for-product-mcp-client-secret` | Only the existing customer-facing `zar-i-szlif-mcp` Cloudflare Worker and its Google OAuth integration |

**Hard requirements:**
- Register **separate Google OAuth Web application client IDs** for the two deployments. Do NOT use either Client ID or Client Secret on the other hostname, in a shared frontend bundle, in a legacy `kompaszbiorek.pl` Worker, or as global env injected into agents.
- **MCP Google redirect URI:** exactly `https://mcp.zariszlif.pl/callback`; OAuth resource endpoint `https://mcp.zariszlif.pl/mcp`. Use only `openid`, `email`, `profile` for the current MCP Google sign-in; any expansion requires independent authorization.
- **Panel redirect URI:** derive and verify the exact callback path from the deployed panel's authentication code and registered IdP settings before changing the Google OAuth registration. Do NOT assume the MCP `/callback` path is correct for the panel. For browser-only login, use Authorization Code + PKCE without exposing a client secret.
- The Google OAuth consent screen's authorized registrable domain is `zariszlif.pl` (without scheme); precise JavaScript origins/redirect URLs are **hostname- and client-specific**. Keep panel/MCP origin and redirect allowlists separate.
- Do not conflate catalog presence with actual Cloudflare Worker or panel runtime bindings. Require **per-hostname authenticated OAuth flow + wrong-client/wrong-redirect negative tests** and exact-SHA readback before marking either integration `LIVE_VERIFIED`.
- Preserve all four existing secret record IDs, technical keys, versions and values; this decision changes only intended ownership and metadata, not credentials.

## Credential binding and security boundary

- These are **two pairs**, not four OAuth clients. IDs identify a registered client; Client Secret values are confidential credentials.
- Paperclip's `Organization` scope means **storage** in the company secret registry, not deployment into Cloudflare, not exposure to a Worker, not agent access, and not actual OAuth registration.
- Secret values must never enter source control, chat, reports, wiki, browser JavaScript, public environment variables, returned MCP tool content, or logs. Store in controlled **server-side runtime secret bindings** only after identifying the actual confidential OAuth consumer.
- A browser-only panel is a **public OAuth client** and should use Authorization Code + PKCE; its registered Client Secret must **not** be injected into the browser. If the panel uses a confidential backend/BFF, only that server-side component may consume the secret.
- For MCP, verify the actual OAuth architecture: existing Cloudflare Worker / OAuthProvider / ChatGPT flow; determine if a confidential client secret is genuinely necessary, or whether ChatGPT is the OAuth client and the MCP Worker is only a protected resource server. Do not bind credentials to the MCP Engineer's Paperclip agent solely to make the reference counter nonzero.
- Never inject OAuth secrets into all agents via a project-wide environment. Any Paperclip `secret_ref` agent binding exposes the resolved value to the executing agent.
- Keep both existing secret record IDs and technical keys stable; change metadata without rotating. Rotate only on an explicit credential lifecycle event or exposure.
- Production activation requires verified issuer, redirect URI, scopes, audience, token handling, PKCE/DCR behavior, least-privilege runtime binding, staging negative tests, CTO acceptance and readback.

## Current rollout evidence

On 2026-10-20 four records were active, each v1, each with `referenceCount=0`. Metadata `name` and `description` were updated in place using the Paperclip Secrets API; no value was fetched, overwritten, or rotated. Runtime injection, IdP registration, and public OAuth end-to-end flow remain **UNVERIFIED**, and must not be represented as complete.

## Existing delivery link

Product MCP: [KOMAA-1003](https://paperclip.kompaszbiorek.pl/KOMAA/issues/KOMAA-1003) — existing MCP/ChatGPT product integration, independent CTO review. Panel integration: Engineer owns the application/authentication integration, and CTO the security review. Reuse the existing relevant product delivery issue where its acceptance explicitly covers OAuth before extending scope; avoid creating a duplicate or changing unrelated signup/email work.
