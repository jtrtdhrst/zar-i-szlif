# Serwery MCP — wdrożenie, synchronizacja i odzyskiwanie

**Stan wdrożenia 27.10.2026:** `comfyui-mcp` działa przez Coolify i dedykowany Cloudflare Tunnel (produkcja: `/health`, `initialize`, `tools/list` = 200). `penpot-mcp` został wycofany; aplikacja Penpot UI pozostała bez zmian. Pozostałe Workery MCP pozostają aktywne do bezstratnej migracji sekretów, OAuth i sesji. Nie oznaczaj całej migracji jako ukończonej.


Pozostałe MCP (poza ComfyUI i wycofanym Penpot MCP) są nadal wystawione jako **Cloudflare Workers** (`*.zariszlif.pl`); trwa etapowa migracja na Coolify.
Kod i konfiguracje w repo:

- `mcp/worker-edge/` — 7 pozostających Workerów proxy na wspólnej krawędzi; jedna instalacja zależności,
  jeden `src/index.ts`, a każda usługa ma **własny plik konfiguracji**
  `wrangler.<usługa>.jsonc` (nazwa, domena, `UPSTREAM_URL`).
- `mcp/mantic/worker/` — natywny Worker (Mautic API, KV na refresh token).

Deploymenty robi **Cloudflare Workers Builds** podpięte do tego repo (bez
GitHub Actions i bez crona). Repozytorium jest jedynym źródłem prawdy.

## Mapa usług

| Endpoint | Worker | Katalog / konfiguracja | Silnik |
|---|---|---|---|
| `mantic-mcp.zariszlif.pl/mcp` | `mantic-mcp` | `mcp/mantic/worker` | Mautic API (natywny Worker + KV) |
| `qdrant-mcp.zariszlif.pl/mcp` | `qdrant-mcp` | `mcp/worker-edge/wrangler.qdrant.jsonc` | `mcp-qdrant` (Docker) |
| `supabase-mcp.zariszlif.pl/mcp` | `supabase-mcp` | `mcp/worker-edge/wrangler.supabase.jsonc` | `supabase-mcp` (Docker) |
| `ubuntu-mcp.zariszlif.pl/mcp` | `ubuntu-mcp` | `mcp/worker-edge/wrangler.ubuntu.jsonc` | `ubuntu-mcp-bridge` (Docker) |
| `plasmic-mcp.zariszlif.pl/mcp` | `plasmic-mcp` | `mcp/worker-edge/wrangler.plasmic.jsonc` | `plasmic-mcp` (Docker) |
| `paperclip-mcp.zariszlif.pl/mcp` | `paperclip-mcp` | `mcp/worker-edge/wrangler.paperclip.jsonc` | Paperclip (Docker, auth po stronie silnika) |
| `emailens-mcp.zariszlif.pl/mcp` | `emailens-mcp` | `mcp/worker-edge/wrangler.emailens.jsonc` | `emailens-mcp-bridge` (Docker) |
| `langfuse-mcp.zariszlif.pl/api/public/mcp` | `langfuse-mcp` | `mcp/worker-edge/wrangler.langfuse.jsonc` | `langfuse-basic-shim` (Python, Docker) |
| `mcp-comfy.kompaszbiorek.pl/mcp` | **Coolify, bez Cloudflare Worker** | `mcp/worker-edge/Dockerfile.coolify` | `comfyui-mcp` (Docker, Caddy origin `comfy-engine.zariszlif.pl`) |

Silniki (Docker) są za krawędzią Workerów pod hostami `*-engine.zariszlif.pl`
(Cloudflare Tunnel). Workers nie uruchomią Pythona / TCP / SSH — dlatego te
usługi mają warstwę Worker + silnik.

## Synchronizacja repo → Cloudflare (Workers Builds)

Dla **każdego pozostałego** Workera: Workers & Pages → Worker → **Settings → Builds →
Connect to repository** i ustaw:

| Pole | `*-mcp` (7 usług) | `mantic-mcp` |
|---|---|---|
| Repository | `miloszspyrka-code/zar-i-szlif` | to samo |
| Production branch | `main` | `main` |
| Root directory | `mcp/worker-edge` | `mcp/mantic/worker` |
| Build command | `npm ci` | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy --config wrangler.<usługa>.jsonc` | `npx wrangler deploy` |

`<usługa>` to `comfyui`, `emailens`, `langfuse`, `paperclip`, `penpot`, `plasmic`,
`qdrant`, `supabase` albo `ubuntu` (kolumna „Katalog / konfiguracja” wyżej).

Sekrety runtime (`MCP_AUTH_TOKEN`, `UPSTREAM_TOKEN`, `MAUTIC_*`) są w
**Settings → Variables and Secrets** i nie znikają przy zmianie root directory.
Cloudflare nie pozwala ich odczytać — przy rotacji ustawia się nową wartość po
obu stronach (Worker + Paperclip).

Ręczny deploy awaryjny (z tokenem CF w `CLOUDFLARE_API_TOKEN`):

```bash
cd mcp/worker-edge && npm ci
npx wrangler deploy --config wrangler.qdrant.jsonc
```

## Zdrowie i testy

- Każdy pozostający proxy Worker ma `GET /health` → `{"ok":true,"upstream":"<host>","auth":true}`
  bez tokena (mantic: `405`, bo nie ma tej ścieżki).
- `node scripts/check-mcp-endpoints.mjs` — czy 9 endpointów odpowiada.
- `node scripts/test-mcp-tools.mjs` — pełny test: `initialize` → `tools/list` →
  jedno wywołanie narzędzia; tokeny z `MCP_TOKEN_< USŁUGA>`.

## Odzyskiwanie po awarii

| Objaw | Akcja |
|---|---|
| endpoint nie odpowiada | Cloudflare → Worker → Deployments → redeploy ostatniej wersji; lokalnie: `npx wrangler deploy --config wrangler.<usługa>.jsonc` |
| **522 / 523 na domenie Workera** | sprawdź, czy `src/index.ts` ma **tylko** `export default` — named export funkcji jest brany jako entrypoint RPC i HTTP przestaje działać (objaw: 522 na wszystkich hostach danej krawędzi) |
| zły token na Workera | Cloudflare → Worker → Settings → Variables and Secrets → podmień → Deploy |
| Paperclip: `health: error` | „Health check” przy połączeniu; przy 401 sprawdź token w sekretach Workera |
| silnik (Docker) nie wstaje | `docker ps -a` → `docker start <nazwa>`; kod silnika jest w `mcp/<usługa>/` |

## Mautic MCP — autoryzacja (OAuth 2, flow authorization_code + refresh token)

Panel Mautica oferuje wyłącznie klienty **OAuth 2** (Name + Redirect URL), a grant
`client_credentials` jest przez API odrzucany (`401 API authorization denied`).
Dlatego `mantic-mcp` używa flow `authorization_code` → `refresh_token`:

1. Mautic → **Ustawienia → API Credentials → New**: nazwa `mantic-mcp`,
   **Redirect URL** = `https://mantic-mcp.zariszlif.pl/oauth/callback` → Create.
2. Client ID + Client Secret → sekrety Workera `mantic-mcp`
   (`MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET`).
3. Otwórz w przeglądarce zalogowanej do Mautica:

   `https://mautic.kompaszbiorek.pl/api/oauth/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=https%3A%2F%2Fmantic-mcp.zariszlif.pl%2Foauth%2Fcallback`

   → zatwierdź. Worker wymienia kod na `refresh_token` i zapisuje go w KV
   (`MAUTIC_TOKENS`, namespace `mantic-mcp-worker`), potem odświeża token sam.

Sprawdzenie: `node scripts/test-mcp-tools.mjs` (z `MCP_TOKEN_MANTIC`) lub wywołanie
`list_campaigns`. Gdy KV jest puste, narzędzia zwracają
`Mautic authentication failed` — powtórz krok 3 (link wygasa po ~10 min).
