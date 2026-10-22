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
## Publiczne endpointy — Cloudflare Workers

Każdy MCP jest wystawiony jako **Cloudflare Worker** (`*.zariszlif.pl`), a kod workera
leży w tym repo w katalogu usługi (`mcp/<usługa>/worker/`) — to on jest źródłem
wdrażanym przez CI (`.github/workflows/mcp-workers.yml`: build + `wrangler deploy`
tokenem CF ze środowiska `Production`).

| Publiczny endpoint | Worker | Typ | Silnik |
|---|---|---|---|
| `https://mantic-mcp.zariszlif.pl/mcp` | `mantic-mcp` | **natywny Worker** (te same narzędzia co stdio; protokół MCP pisany ręcznie, bez SDK/axios — bundle 68 KiB) | Mautic API po HTTPS |
| `https://qdrant-mcp.zariszlif.pl/mcp` | `qdrant-mcp` | krawędź Worker | `mcp-qdrant` (Docker) przez `qdrant-engine.zariszlif.pl` |
| `https://supabase-mcp.zariszlif.pl/mcp` | `supabase-mcp` | krawędź Worker | `supabase-mcp` (Docker) przez `supabase-engine.zariszlif.pl` |
| `https://ubuntu-mcp.zariszlif.pl/mcp` | `ubuntu-mcp` | krawędź Worker | `ubuntu-mcp-bridge` (Docker) przez `ubuntu-engine.zariszlif.pl` |
| `https://penpot-mcp.zariszlif.pl/mcp/stream` | `penpot-mcp` | krawędź Worker | Penpot (Docker) przez `penpot-engine.zariszlif.pl` |
| `https://plasmic-mcp.zariszlif.pl/mcp` | `plasmic-mcp` | krawędź Worker | `plasmic-mcp` (Docker) przez `plasmic-engine.zariszlif.pl` |
| `https://paperclip-mcp.zariszlif.pl/mcp` | `paperclip-mcp` | krawędź Worker (weryfikacja po stronie silnika) | Paperclip (Docker) przez `paperclip-engine.zariszlif.pl` |
| `https://emailens-mcp.zariszlif.pl/mcp` | `emailens-mcp` | krawędź Worker | `emailens-mcp-bridge` (Docker) przez `emailens-engine.zariszlif.pl` |
| `https://langfuse-mcp.zariszlif.pl/api/public/mcp` | `langfuse-mcp` | krawędź Worker | `langfuse-basic-shim` (Python, contract gateway) przez `langfuse-engine.zariszlif.pl` |

**Krawędź** (`mcp/worker-edge/`) to Worker, który sprawdza Bearer token i przekazuje
JSON-RPC do silnika (przez Cloudflare Tunnel) — używana tam, gdzie silnika **nie da się
uruchomić w runtime Workers**: Python (qdrant), TCP/Postgres (supabase), surowe SSH
(ubuntu), istniejące obrazy Dockera (penpot, plasmic, paperclip, emailens), Python (langfuse).

Dla `mantic` Worker jest natywny (`mcp/mantic/worker/src/index.ts`): te same moduły
narzędzi co wersja stdio, transport MCP Streamable HTTP (Web Standard) — dlatego
kontenery `mantic-mcp` / `mantic-mcp-http` zostały wyłączone i usunięte.

Każdy publiczny endpoint ma własną autoryzację (Bearer / token w query).

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

## Znany problem (nie z Workerów)

**Mautic API: `POST /api/oauth/token` → 401 „API authorization denied"** — klient
OAuth `mantic-mcp` istnieje w bazie Mautica (grant `client_credentials` ✓,
`api_oauth2 => true` w configu ✓), ale token nie jest wydawany. Dlatego `tools/list`
działa, a wywołania narzędzi (kontakty, kampanie) zwracają błąd autoryzacji.
Naprawa po stronie Mautica (konfiguracja API/OAuth), nie Workerów.
