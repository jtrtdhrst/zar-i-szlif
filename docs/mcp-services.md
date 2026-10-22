# Serwery MCP — wdrożenie, synchronizacja i odzyskiwanie

Wszystkie MCP tego repo są wystawione jako **Cloudflare Workers** (`*.zariszlif.pl`).
Deploymenty w repo są dwa: `mcp/worker-edge/` (8 usług, jedna wspólna krawędź, każda
usługa jako `wrangler deploy --env <usługa>`) i `mcp/mantic/worker/` (natywny Worker).
Repozytorium jest jedynym źródłem prawdy: push do `main` = build + deploy.

## Mapa usług

| Endpoint | Worker | Deployment | Silnik |
|---|---|---|---|
| `mantic-mcp.zariszlif.pl/mcp` | `mantic-mcp` | `/mcp/mantic/worker` | Mautic API (natywny Worker + KV) |
| `qdrant-mcp.zariszlif.pl/mcp` | `qdrant-mcp` | `/mcp/worker-edge` env `qdrant` | `mcp-qdrant` (Docker) |
| `supabase-mcp.zariszlif.pl/mcp` | `supabase-mcp` | `/mcp/worker-edge` env `supabase` | `supabase-mcp` (Docker) |
| `ubuntu-mcp.zariszlif.pl/mcp` | `ubuntu-mcp` | `/mcp/worker-edge` env `ubuntu` | `ubuntu-mcp-bridge` (Docker) |
| `penpot-mcp.zariszlif.pl/mcp/stream` | `penpot-mcp` | `/mcp/worker-edge` env `penpot` | Penpot (Docker) |
| `plasmic-mcp.zariszlif.pl/mcp` | `plasmic-mcp` | `/mcp/worker-edge` env `plasmic` | `plasmic-mcp` (Docker) |
| `paperclip-mcp.zariszlif.pl/mcp` | `paperclip-mcp` | `/mcp/worker-edge` env `paperclip` | Paperclip (Docker, auth po stronie silnika) |
| `emailens-mcp.zariszlif.pl/mcp` | `emailens-mcp` | `/mcp/worker-edge` env `emailens` | `emailens-mcp-bridge` (Docker) |
| `langfuse-mcp.zariszlif.pl/api/public/mcp` | `langfuse-mcp` | `/mcp/worker-edge` env `langfuse` | `langfuse-basic-shim` (Python, Docker) |

Silniki (Docker) są za krawędzią Workerów pod hostami `*-engine.zariszlif.pl`
(Cloudflare Tunnel). Workers nie uruchomią Pythona / TCP / SSH — dlatego te
usługi mają warstwę Worker + silnik.

## Synchronizacja repo → Cloudflare

**A) GitHub Actions (działa od razu, źródło prawdy = repo)**

`.github/workflows/mcp-workers.yml`: przy pushu na `main` buduje i wdraża wszystkie
workery (`wrangler deploy`, token CF ze środowiska `Production`). To jest obecny
mechanizm — repo → produkcja bez udziału człowieka.

**B) Panel Cloudflare (Workers Builds — natywna integracja git)**

Workers & Pages → Worker → **Settings → Builds → Connect to repository**:

| Pole | Wartość |
|---|---|
| Repository | `miloszspyrka-code/zar-i-szlif` (GitHub App ma już dostęp ✓) |
| Production branch | `main` |
| Root directory | `/mcp/<usługa>/worker` (tabela wyżej) |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

Sekrety runtime są w **Settings → Variables and Secrets** i nie znikają przy
zmianie root directory. Nie kasuj ich (wartości są też w vaultcie Paperclipa —
poza sekretami `MCP_AUTH_TOKEN` workerów edge, które trzymamy tylko w CF).

## Watchdog (samonaprawa)

`.github/workflows/mcp-health.yml` — co 15 minut:

1. `node scripts/check-mcp-endpoints.mjs` → sprawdza, czy wszystkie 9 endpointów
   odpowiada (401 = żyje i pilnuje tokena, 200 = odpowiada);
2. przy błędzie → **automatyczny redeploy** wszystkich workerów i ponowna
   weryfikacja.

Pełną funkcjonalność (token + `tools/list`) sprawdzają health-checky połączeń
w Paperclipie (9 połączeń, status `ok`).

## Odzyskiwanie po awarii

| Objaw | Akcja |
|---|---|
| endpoint nie odpowiada | `workflow MCP Health` redeployuje automatycznie; ręcznie: `cd mcp/worker-edge && npm ci && npx wrangler deploy --env <usługa>` (albo `cd mcp/mantic/worker && npx wrangler deploy`) |
| zły token na Workera | Cloudflare → Worker → Settings → Variables and Secrets → podmień → Deploy |
| Paperclip: `health: error` | przycisk „Health check" przy połączeniu; przy 401 sprawdź token w sekretach Workera |
| silnik (Docker) nie wstaje | `docker ps -a` → kontener zatrzymany → `docker start <nazwa>`; kod silnika jest w `mcp/<usługa>/` |

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
