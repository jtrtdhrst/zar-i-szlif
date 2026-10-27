# `mcp/` — MCP servers as deployable services

**Stan wdrożenia 27.10.2026:** `comfyui-mcp` działa przez Coolify i dedykowany Cloudflare Tunnel (produkcja: `/health`, `initialize`, `tools/list` = 200). `penpot-mcp` został wycofany; aplikacja Penpot UI pozostała bez zmian. Pozostałe Workery MCP pozostają aktywne do bezstratnej migracji sekretów, OAuth i sesji. Nie oznaczaj całej migracji jako ukończonej.


Every MCP server that this stack runs has its **full source** in this folder, so it
can be built and deployed from GitHub (Coolify / Cloudflare) exactly like the
containers that run in production today.

| Usługa | Folder | Katalog budowania (Coolify) | Transport / port | Upstream |
|---|---|---|---|---|
| Mantic MCP | `mantic/` | `/mcp/mantic` | stdio + HTTP bridge `:8090` | `Cbrown35/mantic-MCP` (inspiration) |
| Qdrant MCP | `qdrant/` | `/mcp/qdrant` | stdio / streamable-http `:8000` | `allfunc/mcp-qdrant`, `qdrant/mcp-server-qdrant` |
| Plasmic MCP | `plasmic/` | `/mcp/plasmic` | HTTP `:8091` / `:8092` | snapshot of `ops/design-stack` |
| Supabase MCP | `supabase/` | `/mcp/supabase` | streamable-http `:3100` | `HenkDz/selfhosted-supabase-mcp` (MIT) |
| Ubuntu MCP | `ubuntu/` | `/mcp/ubuntu` | streamable-http `:8765` | `bvisible/mcp-ssh-manager` (npm) |
| Paperclip MCP | `paperclip/` | `/mcp/paperclip` | streamable-http `:3101` | Paperclip core: `paperclipai/paperclip` (image, **not vendored**) |
| ComfyUI MCP | `comfyui/` | `/mcp/comfyui` | HTTP `:8188` (UI) / `:9100` (MCP) | `comfyui-mcp@0.52.206` (npm) + ComfyUI `0.42.1` (CPU) |

The product MCP (`app/mcp-worker`, Cloudflare Worker) stays in `app/mcp-worker/`.
## Publiczne endpointy MCP — Coolify i pozostałe Cloudflare Workers

Większość pozostałych MCP nadal korzysta z **Cloudflare Workers** (`*.zariszlif.pl`). Deploymenty
w repo są dwa:

- `mcp/worker-edge/` — 7 pozostałych konfiguracji Worker na **jednej wspólnej krawędzi**: jeden `package.json`,
  jeden `src/index.ts`, a każda usługa ma własny plik konfiguracji
  `wrangler.<usługa>.jsonc` (nazwa skryptu, domena, `UPSTREAM_URL`). Dodanie usługi =
  jeden plik konfiguracji i jedna linia w `src/index.ts` nie jest potrzebna.
- `mcp/mantic/worker/` — natywny Worker (Mautic API, KV na refresh token).

Deploye robi **Cloudflare Workers Builds** podpięte do repo (root directory
`mcp/worker-edge`, deploy `npx wrangler deploy --config wrangler.<usługa>.jsonc`;
dla mantic: root `mcp/mantic/worker`, `npx wrangler deploy`). Bez GitHub Actions
i bez crona — szczegóły w `docs/mcp-services.md`.

⚠️ W `src/index.ts` krawędzi **nie dodawaj named exportów** — Cloudflare traktuje
`export function` jako entrypoint RPC i przestaje dispatchować HTTP (objaw: 522 na
wszystkich hostach). Zostaje wyłącznie `export default createEdgeWorker()`.

| Publiczny endpoint | Worker | Typ | Silnik |
|---|---|---|---|
| `https://mantic-mcp.zariszlif.pl/mcp` | `mantic-mcp` | **natywny Worker** (te same narzędzia co stdio; protokół MCP pisany ręcznie, bez SDK/axios — bundle 68 KiB) | Mautic API po HTTPS |
| `https://qdrant-mcp.zariszlif.pl/mcp` | `qdrant-mcp` | krawędź Worker | `mcp-qdrant` (Docker) przez `qdrant-engine.zariszlif.pl` |
| `https://supabase-mcp.zariszlif.pl/mcp` | `supabase-mcp` | krawędź Worker | `supabase-mcp` (Docker) przez `supabase-engine.zariszlif.pl` |
| `https://ubuntu-mcp.zariszlif.pl/mcp` | `ubuntu-mcp` | krawędź Worker | `ubuntu-mcp-bridge` (Docker) przez `ubuntu-engine.zariszlif.pl` |
| `https://plasmic-mcp.zariszlif.pl/mcp` | `plasmic-mcp` | krawędź Worker | `plasmic-mcp` (Docker) przez `plasmic-engine.zariszlif.pl` |
| `https://paperclip-mcp.zariszlif.pl/mcp` | `paperclip-mcp` | krawędź Worker (weryfikacja po stronie silnika) | Paperclip (Docker) przez `paperclip-engine.zariszlif.pl` |
| `https://mcp-comfy.kompaszbiorek.pl/mcp` | **Coolify MCP edge** | `comfyui-mcp` przez dedykowany Tunnel (nie Worker) |
| `https://emailens-mcp.zariszlif.pl/mcp` | `emailens-mcp` | krawędź Worker | `emailens-mcp-bridge` (Docker) przez `emailens-engine.zariszlif.pl` |
| `https://langfuse-mcp.zariszlif.pl/api/public/mcp` | `langfuse-mcp` | krawędź Worker | `langfuse-basic-shim` (Python, contract gateway) przez `langfuse-engine.zariszlif.pl` |

**Krawędź** (`mcp/worker-edge/`) to Worker, który sprawdza Bearer token i przekazuje
JSON-RPC do silnika (przez Cloudflare Tunnel) — używana tam, gdzie silnika **nie da się
uruchomić w runtime Workers**: Python (qdrant, langfuse), TCP/Postgres (supabase),
surowe SSH (ubuntu), pluginy/websockety (penpot, plasmic, paperclip, emailens).
Wystawia też `GET /health` (200, bez tokena) dla watchdogów; jej implementacja działa również jako kontener Coolify dla ComfyUI.

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

## Mautic MCP — autoryzacja

`client_credentials` jest odrzucany przez API Mautica (401 „API authorization
denied”), a panel oferuje tylko klienty OAuth 2 → Worker `mantic-mcp` używa flow
`authorization_code` → `refresh_token` (redirect
`https://mantic-mcp.zariszlif.pl/oauth/callback`, token w KV). Dopóki autoryzacja
nie zostanie kliknięta, `tools/list` działa, a wywołania narzędzi zwracają
`Mautic authentication failed`. Instrukcja: `docs/mcp-services.md`.
