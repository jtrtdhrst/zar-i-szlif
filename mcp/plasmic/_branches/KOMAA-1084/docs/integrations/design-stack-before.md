# design-stack — before (Etap 0, 2026-09-14)

Stan przed wdrożeniem warstwy integracyjnej Paperclip/OpenCode/OpenDesign/Plasmic/v0/GitHub.
Bez sekretów — tylko nazwy, wersje, lokalizacje, porty, procesy.

## Diagram (przed)

```text
Paperclip ──adapter opencode_local──▶ OpenCode ──MCP──▶ open-design ──▶ OD daemon :7456
   │                                     │──MCP──▶ github (api.githubcopilot.com)
   │                                     │──MCP──▶ cloudflare, langfuse, paperclip
   │
   │   Plasmic (self-host, ZERO projektów, 1 user) — brak połączenia z OpenCode
   │   v0 — brak połączenia z OpenCode
   │   aplikacja docelowa / repo — BRAK (nie znaleziono na VPS)
```

## Wersje

- opencode 1.18.17, node v24.18.1, npm 11.12.1, Docker 29.5.3, Compose v5.1.4
- OpenDesign daemon 0.22.1 (image `ghcr.io/nexu-io/od:latest`), MCP server 0.2.0
- Plasmic self-host upstream `9890e0caab4162e8d0626a0ab2458098b6706089`
  (obrazy `plasmic-wab:…-patched1`, `plasmic-studio:…`), postgres:15
- Paperclip image `local/paperclip:2026.831.3-boardfix`
- Supabase stack w `/opt/supabase-project` (envoy :8000, studio, meta, pooler :5432/:6543;
  `supabase-storage` i `realtime` w pętli Restarting w chwili audytu)

## Config locations

- OpenCode: `/root/.config/opencode/opencode.jsonc` (global, `permission: allow`)
- Adapter Paperclip: `/paperclip/.config/opencode/opencode.jsonc` w kontenerze `paperclip`
  (tylko LSP + pluginy, brak MCP — adapter dziedziczy/wstrzykuje własne)
- Paperclip MCP patch: `docker exec -i paperclip node …/mcp-patch/src/stdio.ts`
- OpenDesign: `/root/open-design` (git clone upstream), env `/root/open-design/deploy/.env`
- Plasmic: `/opt/plasmic-prod/docker-compose.prod.yml` + `.env`
  (klucze: `PLASMIC_WAB_IMAGE`, `PLASMIC_HOST`, `PLASMIC_DB_PASSWORD`, `PLASMIC_SESSION_SECRET`)
- Supabase: `/opt/supabase-project`
- Tunnel Cloudflare: kontener `paperclip-mcp-tunnel` (zdalna konfiguracja)

## MCP (OpenCode, przed)

| nazwa | typ | cel |
|---|---|---|
| github | remote | `https://api.githubcopilot.com/mcp/` (PAT w pliku) |
| cloudflare | remote | `https://mcp.cloudflare.com/mcp` |
| langfuse | remote | `http://langfuse:3000/api/public/mcp` |
| paperclip | local | `docker exec -i paperclip …/stdio.ts` |
| open-design | local | `docker exec -i -e OD_DATA_DIR open-design …/cli.js mcp --daemon-url http://127.0.0.1:7456` |

Pluginy: `@slkiser/opencode-quota@4.8.0`, `opencode-lazy-loader@1.0.4`,
`openslimedit@1.0.4`, `opencode-queue@0.11.0`, `@tarquinen/opencode-dcp@3.1.15`,
`@dietrichgebert/ponytail@4.9.0`, `@opencode-ai/plugin@1.18.17`.

Brak: `plasmic`, `v0`, `open-design-remote`.

## Porty / procesy / kontenery

- `open-design`: 127.0.0.1:7456→7456, healthy, ~187 MiB/384 MiB; UI + API za tunelem
  `https://opendesign.kompaszbiorek.pl` (Basic `open-design`/token)
- Plasmic: wab :3004 (wewn., healthy, ~400 MiB/5 GiB), studio :8080 (wewn., nginx,
  proxy `/api/`→wab), db postgres:15; publicznie `https://plasmic.kompaszbiorek.pl`
  (`HOST=https://plasmic.kompaszbiorek.pl`). Watchery/dev-serwery: BRAK (OK).
- `opencode` (dev, 127.0.0.1:4096), `paperclip` (:3100/:3101, restartował się w audycie),
  supabase-*, langfuse-*, mautic-*, builder-mcp :8762, mcp-qdrant, mantic-mcp.
- Sieci: `plasmic_default`, `open-design_default`, `paperclip-net`, `supabase_default`, …

## OpenDesign — faktyczny stan danych

- MCP `open-design` 0.2.0: 22 tools (list_projects, get_project, get_file, list_files,
  search_files, get_artifact, create_artifact, write_file, delete_file, create_project,
  delete_project, start_run, get_run, cancel_run, list_agents, list_skills, list_plugins,
  brief x2, vela login x2, get_active_context).
- **Brak** narzędzi `read_design_tokens` / `read_components` — daemon REST ma pełne
  `/api/design-systems/*` (lista, get, files, file, revisions, token-contract rebuild).
- `list_projects` → `{"projects": []}` (puste projekty generatywne), ale dane istnieją:
  `design-systems/` (7 szt.: kompas-zbiorek*, product* — z `design-tokens.json`,
  `components.manifest.json`, `tokens.css`), `brands/`, `kompas-brand.json`.
- Wniosek: bridge czyta design-systems przez daemon REST (autoryzowany), nie przez MCP.

## Plasmic — faktyczny stan

- DB `wab`: 63 tabele; `project` = 0 wierszy, 1 user (`milosz.spyrka@gmail.com`),
  2 workspaces; `project.projectApiToken` istnieje (loader API per projekt).
- WAB API zweryfikowane w źródle (`/platform/wab/src/wab/server/AppServer.ts`):
  `POST /api/v1/auth/login` (sesja cookie), `GET/POST /api/v1/projects`,
  `GET /api/v1/projects/:projectBranchId` (pełny bundle rewizji),
  `POST /api/v1/projects/:projectBranchId/revisions/:revision` (zapis rewizji),
  `PUT /api/v1/projects/:projectId`, `DELETE`, branches CRUD, clone,
  loader `/api/v1/loader/code|html|repr-v2|repr-v3/*` (token projektowy).
- **Brak** `PLASMIC_AI_TOOLS` jako gotowego produktu — operacje elementowe Studio to
  read-modify-write całego bundle po stronie klienta; adapter robi to samo
  (re-read + lock + dry-run + hashe).
- Brak Chrome/CDP na VPS i brak potrzeby: adapter używa WAB REST, nie przeglądarki.

## v0 / GitHub / aplikacja

- v0 MCP: oficjalny endpoint `https://v0.app/api/mcp` (Streamable HTTP, OAuth —
  bez klucza API w configu). Niepodpięty.
- GitHub MCP: podpięty (Copilot MCP, PAT w pliku). Brak repo aplikacji na VPS;
  brak dowodu powiązania repo↔v0/Vercel — do uzupełnienia przez operatora.
- Aplikacja docelowa / deployment: NIE ZNALEZIONO na VPS (do zadeklarowania:
  repo URL, Vercel project, Plasmic host route).

## Zasoby (przed)

- RAM 22.9 G (użyte 8.2 G, wolne 5.5 G, dostępne 13.9 G); dysk 70% (135.5/192.9 G).
- Najcięższe: `opencode` ~1.1 GiB, langfuse-web/worker/clickhouse ~0.7–0.8 GiB każdy,
  plasmic-wab ~0.4 GiB. Watcherów dev (pnpm dev/plasmic watch/vite/turbo): brak.

## Dependency map (przed)

```text
OpenCode → open-design MCP → OD daemon → /app/.od (design-systems, brands)
OpenCode → github MCP → api.githubcopilot.com
Paperclip → adapter opencode_local → OpenCode (LSP ts/html/css, permission allow)
Tunnel → opendesign.*, plasmic.*, paperclip.*, supabase.*, langfuse.*, mautic.*
Plasmic studio → wab :3004 → plasmic-db :5432
```

## Ograniczenia wykryte (wejście do implementacji)

1. OD MCP nie czyta design-systems → bridge przez daemon REST (klucze: token z `.env`).
2. Plasmic: 0 projektów; zapis wymaga sesji użytkownika (email/hasło jako sekrety
   operatora) — adapter wspiera też tryb read-only bez sekretów.
3. v0 wymaga interaktywnego OAuth w kliencie MCP (`opencode mcp auth v0`).
4. Brak repo aplikacji — E2E kończy się na PR do repo wskazanego przez operatora;
   Plasmic host route weryfikowalna po wskazaniu aplikacji.
