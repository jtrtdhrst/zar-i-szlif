# `mcp/` — MCP servers as deployable services

Every MCP server that this stack runs has its **full source** in this folder, so it
can be built and deployed from GitHub (Coolify / Cloudflare) exactly like the
containers that run in production today.

| Usługa | Folder | Katalog budowania (Coolify) | Transport / port | Upstream |
|---|---|---|---|---|
| Mantic MCP | `mantic/` | `/mcp/mantic` | stdio + HTTP bridge `:8090` | `Cbrown35/mantic-MCP` (inspiration) |
| Qdrant MCP | `qdrant/` | `/mcp/qdrant` | stdio / streamable-http `:8000` | `allfunc/mcp-qdrant`, `qdrant/mcp-server-qdrant` |
| Penpot MCP | `penpot/` | `/mcp/penpot` (`headless/`, `router/`) | HTTP `:3000` / `:3001` | `penpotapp/mcp:2.18.3` (image), `tvolodi/penpot-mcp` (headless fork) |
| Plasmic MCP | `plasmic/` | `/mcp/plasmic` | HTTP `:8091` / `:8092` | snapshot of `ops/design-stack` |
| Supabase MCP | `supabase/` | `/mcp/supabase` | streamable-http `:3100` | `HenkDz/selfhosted-supabase-mcp` (MIT) |
| Ubuntu MCP | `ubuntu/` | `/mcp/ubuntu` | streamable-http `:8765` | `bvisible/mcp-ssh-manager` (npm) |
| Paperclip MCP | `paperclip/` | `/mcp/paperclip` | streamable-http `:3101` | Paperclip core: `paperclipai/paperclip` (image, **not vendored**) |

The product MCP (`app/mcp-worker`, Cloudflare Worker) stays in `app/mcp-worker/`.

## Publiczne endpointy (Cloudflare)

Każdy MCP jest wystawiony przez **Cloudflare Tunnel** (`0fa7a5f6-70c6-495a-b6a7-7e9c6e3e9285`,
strefa `zariszlif.pl`). DNS: CNAME `<nazwa>-mcp.zariszlif.pl` →
`0fa7a5f6-70c6-495a-b6a7-7e9c6e3e9285.cfargotunnel.com` (proxied). Ingress w tunelu:
`<nazwa>-mcp.zariszlif.pl` → `http://<usługa>:<port>`.

| Publiczny endpoint | Usługa | Auth |
|---|---|---|
| `https://mantic-mcp.zariszlif.pl/mcp` | Mantic HTTP bridge | `Authorization: Bearer` (BRIDGE_TOKEN) |
| `https://qdrant-mcp.zariszlif.pl/mcp` | Qdrant hybrid | `Authorization: Bearer` (QDRANT_MCP_TOKEN) |
| `https://penpot-mcp.zariszlif.pl/mcp/stream` | Penpot native MCP | `?userToken=<token>` |
| `https://plasmic-mcp.zariszlif.pl/mcp` | Plasmic MCP | `Authorization: Bearer` (MCP_AUTH_TOKEN) |
| `https://supabase-mcp.zariszlif.pl/mcp` | Supabase MCP | `Authorization: Bearer` (JWT) |
| `https://ubuntu-mcp.zariszlif.pl/mcp` | Ubuntu operations | `Authorization: Bearer` (bridge token) |
| `https://paperclip-mcp.zariszlif.pl/mcp` | Paperclip MCP (core) | Bearer / OAuth 2.1 |
| `https://emailens-mcp.zariszlif.pl/mcp` | Emailens MCP bridge | `Authorization: Bearer` (bridge token) |

**Każdy publiczny endpoint ma własną autoryzację** — Qdrant wymaga
`QDRANT_MCP_TOKEN` (dodał tę bramkę ten folder), Mantic wymaga `BRIDGE_TOKEN`,
Penpot tokenu w query, reszta tokenu Bearer. Nie wystawiaj usługi bez tokenu.

## Rules for this folder

1. **Secrets never enter the repo.** Every service has an `.env.example`; real values
   live in the deployment (Coolify env vars / mounted secret files).
2. **One folder = one deployable unit.** The folder root holds the Dockerfile (or a
   `docker-compose.yml` for multi-service stacks), so the Coolify build directory is
   the folder itself.
3. **Same behaviour as the running container.** The Dockerfiles reproduce the
   production images (same base images, same entrypoints, same ports, same
   non-root users where the production image uses them).

## Local verification

```bash
cd mcp/<service>
docker build -t <name>:local .          # or: docker compose up -d --build
curl -s http://127.0.0.1:<port>/mcp     # JSON-RPC initialize
```
