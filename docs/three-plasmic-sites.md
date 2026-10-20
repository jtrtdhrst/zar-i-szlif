# Three independently editable Plasmic projects for Żar i Szlif

## Decision and domain ownership

| Self-hosted Plasmic Studio project | Public hostname | Scope | Runtime owner |
| --- | --- | --- | --- |
| `Żar i Szlif — Website` | `https://zariszlif.pl/` (and optional `www` redirect) | Public brand, value proposition, features, signup CTA, contact/legal | Marketing/web frontend |
| `Żar i Szlif — MCP Connect` | `https://mcp.zariszlif.pl/` and `/docs` | Public AI integration, how-to, trust/privacy, FAQ | Dedicated MCP landing frontend |
| `Żar i Szlif — App` | `https://panel.zariszlif.pl/` | Authenticated application, camp, tasks, team/profile/settings | Product frontend |

All three are SEPARATE **Plasmic Studio project IDs**, not just three pages in the same Plasmic project. They may share one repository, packages, design tokens, types and Supabase data contracts. Never share admin credentials or deployment bindings across origins.

## Critical MCP routing contract

The existing dedicated Cloudflare Worker `zar-i-szlif-mcp` owns the custom domain `mcp.zariszlif.pl` and `/mcp`. Its auth/provider must retain full ownership of:
- `/mcp`, streamable HTTP and authorized JSON-RPC tools/call.
- `/authorize`, `/callback`, `/token`, `/register`.
- `/.well-known/*` authorization server and protected resource metadata.
- `/health` operational diagnostics.

Only **GET /** and **GET /docs** should serve public human-readable HTML. The Worker now has a CSP-protected, dependency-free fallback site on those exact paths. Once the separate Plasmic MCP Connect project is created and tested, production can optionally serve its exported/public assets via a **strict route allowlist** or signed deployment behind the same Worker; **never** install an unrestricted reverse-proxy catch-all that steals /mcp or OAuth paths. Do not point an independent Cloudflare Pages custom domain at `mcp.zariszlif.pl` while the Worker owns that host. No Cloudflare Access in front of user-facing OAuth.

## Studio project creation

Current first-party Plasmic MCP supports 17 tools for projects/pages/components but DOES NOT expose `create_project`. The 3 Studio projects must be created through an authorized self-hosted Plasmic Studio user flow (or a separately reviewed, supported API operation), not by claiming that `plasmic_create_page` created a project.

1. Create three separately named Studio projects under the intended Plasmic team/workspace.
2. Save and verify three **different**, real project IDs, their owner/team and editable root pages; do not reuse the existing smoke project ID `ew9Zg1DsRBmoU5D99kLXHZ` as three new projects.
3. Provision least-privilege publishing scopes and map Plasmic codegen/loader outputs to the respective deploy target; do not expose Plasmic team tokens in the browser.
4. Use the same brand tokens: typography, colors, fox/crow story motif, accessible responsive components. Content and CTAs in Polish.
5. Keep the existing product backend OAuth/Supabase membership and the dedicated product MCP server untouched by marketing changes.
6. Work in isolated issue branches, exact-SHA CI and reviewer-controlled promotion. No direct production redeploy or credential asks as a substitute for evidence.

## Definition of Done

- Plasmic Studio displays THREE different real project IDs, with human-verified editor links and a real editable page in each (create → save → readback → edit → readback).
- Website and panel are independently deployable and use correct domains/SSOT; marketing pages cannot call privileged panel APIs.
- `GET https://mcp.zariszlif.pl/` and `/docs` render public Polish instructions (desktop, mobile, keyboard) with the correct endpoint.
- `POST /mcp` unauthenticated stays denied, authenticated initialize / tools/list / tools/call work, DCR allowlist and OAuth discovery unchanged; no cross-origin token leak.
- Non-GET root requests, /authorize, /callback, /token, /register, /.well-known/* and /health are not intercepted by landing routing.
- Independent UI QA at 390px/1440px and independent CTO review of exact SHA, negative auth tests, deployment rollback and live readback.
- Only after all gates pass: GitHub PR merged, domain routing/deployment readback confirmed. Do NOT conflate PR creation with production deployment.
