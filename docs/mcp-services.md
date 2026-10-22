# Serwery MCP — wdrożenie, synchronizacja i odzyskiwanie

Wszystkie MCP tego repo są wystawione jako **Cloudflare Workers** (`*.zariszlif.pl`),
a kod workera leży w `mcp/<usługa>/worker/`. Repozytorium jest jedynym źródłem
prawdy: push do `main` = build + deploy.

## Mapa usług

| Endpoint | Worker | Root directory (build) | Silnik |
|---|---|---|---|
| `mantic-mcp.zariszlif.pl/mcp` | `mantic-mcp` | `/mcp/mantic/worker` | Mautic API (natywny Worker) |
| `qdrant-mcp.zariszlif.pl/mcp` | `qdrant-mcp` | `/mcp/qdrant/worker` | `mcp-qdrant` (Docker) |
| `supabase-mcp.zariszlif.pl/mcp` | `supabase-mcp` | `/mcp/supabase/worker` | `supabase-mcp` (Docker) |
| `ubuntu-mcp.zariszlif.pl/mcp` | `ubuntu-mcp` | `/mcp/ubuntu/worker` | `ubuntu-mcp-bridge` (Docker) |
| `penpot-mcp.zariszlif.pl/mcp/stream` | `penpot-mcp` | `/mcp/penpot/worker` | Penpot (Docker) |
| `plasmic-mcp.zariszlif.pl/mcp` | `plasmic-mcp` | `/mcp/plasmic/worker` | `plasmic-mcp` (Docker) |
| `paperclip-mcp.zariszlif.pl/mcp` | `paperclip-mcp` | `/mcp/paperclip/worker` | Paperclip (Docker) |
| `emailens-mcp.zariszlif.pl/mcp` | `emailens-mcp` | `/mcp/emailens/worker` | `emailens-mcp-bridge` (Docker) |
| `langfuse-mcp.zariszlif.pl/api/public/mcp` | `langfuse-mcp` | `/mcp/langfuse/worker` | `langfuse-basic-shim` (Python, Docker) |

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
| endpoint nie odpowiada | `workflow MCP Health` redeployuje automatycznie; ręcznie: `cd mcp/<usługa>/worker && npm ci && npx wrangler deploy` |
| zły token na Workera | Cloudflare → Worker → Settings → Variables and Secrets → podmień → Deploy |
| Paperclip: `health: error` | przycisk „Health check" przy połączeniu; przy 401 sprawdź token w sekretach Workera |
| silnik (Docker) nie wstaje | `docker ps -a` → kontener zatrzymany → `docker start <nazwa>`; kod silnika jest w `mcp/<usługa>/` |

## Mautic MCP — dokończenie konfiguracji (po stronie Mautica)

Kod MCP jest poprawny (OAuth2 `client_credentials`), ale Mautic odmawia wydania
tokenu (`401 API authorization denied`) — dzieje się tak dla każdego klienta
OAuth2 w tej instancji (sprawdzone na świeżo utworzonym kliencie).

1. Mautic → **Ustawienia → API Credentials → New** → nazwa `mantic-mcp` →
   grant type **client_credentials** → Create.
2. Skopiuj **Client ID** i **Client Secret**.
3. Cloudflare → Worker `mantic-mcp` → Settings → Variables and Secrets →
   `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET` → Deploy.

Od tej chwili wszystkie 68 narzędzi Mautica (kontakty, kampanie, segmenty,
e-maile, formularze) wykonują się przez API.
