# Żar i Szlif — Website

This folder owns the public marketing website at `https://zariszlif.pl/` (optional `www` redirect), not the authenticated application.

- **Git publishing lane:** `product/www` only. Product application and product MCP keep their pre-existing branches/PRs and `main` base.
- **Code ownership:** marketing/frontend team and Designer. A separately editable, self-hosted Plasmic Studio Website project is required; a Git folder is not proof of project provisioning.
- **Existing unmerged source:** `content/marketing/landing-zar-i-szlif-website.html` in pre-existing PR #65 (`KOMAA-1174`). Preserve its branch, changes, review and commit; migrate it here via reviewed path-scoped PR, never drop/reset historical work.
- **Publishing contract:** Website publishes only its public site assets; never modify or deploy `app/web/**`, `app/cloudflare-worker/**`, `app/mcp-worker/**`, OAuth or private Supabase.
- **Release gate:** independent screenshot/responsive/a11y QA and CTO acceptance of exact SHA; cross-lane promotion into `main` only under existing deploy control. No direct production deployment from the presence of this folder.
