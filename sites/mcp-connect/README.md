# Żar i Szlif — MCP Connect public site

This folder owns the separate public connection/help landing for `https://mcp.zariszlif.pl/` and `/docs`, not the product MCP service.

- **Git publishing lane:** `product/www` alongside `sites/www/**`; keep a separate self-hosted Plasmic Studio MCP Connect project, project ID, editor and build output.
- **Existing unmerged source:** `content/marketing/landing-zar-i-szlif-mcp-connect.html` in PR #67 (`KOMAA-1175`), and route-fallback changes in PR #68 (`KOMAA-1178`) and draft #64. Preserve those commits/reviews; migrate only after path ownership and review are settled.
- **Critical routing:** Existing product MCP Cloudflare Worker retains `/mcp`, `/authorize`, `/callback`, `/token`, `/register`, `/.well-known/*`, `/health`. Only human-facing GET `/` and GET `/docs` may expose public landing assets via strict allowlisting, without changing OAuth discovery or JSON-RPC. The Worker source remains owned by MCP Engineer at `app/mcp-worker/**` on established Git flow, NOT by this website folder.
- **Release gate:** page render at narrow/wide viewport and keyboard accessibility, deny-by-default unauthenticated MCP writes, independent CTO OAuth route tests, exact SHA and live readback before deployment.
