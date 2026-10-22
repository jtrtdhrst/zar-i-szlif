# Langfuse MCP (contract gateway)

Warstwa MCP przed Langfuse: **contract gateway** (shim) — walidacja argumentów
z katalogu upstream, jednolity format wyników `{ok, tool, data, meta, warnings}`,
redakcja sekretów, profile uprawnień (`read-only` / `operator-write` / `full`),
14 narzędzi gateway (drzewo trace'a, ścieżka krytyczna, anomalie, opisy metryk).
Klucz projektu Langfuse jest wstrzykiwany po stronie serwera — klient nie podaje
kredencjalu upstreamu.

## Kod w tym folderze

| Ścieżka | Co |
|---|---|
| `shim.py` | serwer MCP (proxy JSON-RPC przed upstream Langfuse) |
| `mcp_gateway/` | pakiet gateway: `catalog`, `validation`, `normalize`, `profiles`, `registry`, `diagnostics`, `upstream`, `analytics`, `traces`, `observations`, `experiments`, `llm_connections` |
| `catalog/langfuse-mcp-catalog.json` | katalog narzędzi upstream (85 narzędzi) |
| `Dockerfile` | obraz silnika (`langfuse-basic-shim:4`) |
| `worker/` | Cloudflare Worker — publiczny endpoint `langfuse-mcp.zariszlif.pl` |

## Build & run (silnik)

```bash
docker build -t langfuse-basic-shim:4 .
docker run -d --name langfuse-basic-shim --network paperclip-net --restart unless-stopped \
  --env-file shim.env langfuse-basic-shim:4
# shim.env: LANGFUSE_MCP_BASIC, LANGFUSE_MCP_PUBLIC_URL, LANGFUSE_MCP_CATALOG, LANGFUSE_MCP_MODEL_PROVIDERS
```

## Worker (publiczny endpoint)

`worker/` = krawędź (`mcp/worker-edge/`): sprawdza Bearer token i przekazuje JSON-RPC
do silnika (`langfuse-engine.zariszlif.pl` → tunnel → `langfuse-basic-shim:8080`).
Ścieżka `/api/public/mcp` jest przenoszona do upstreamu bez zmian.

Sekret Workera: `MCP_AUTH_TOKEN` (Bearer wymagany od klienta).

## Dwie poprawki w stosunku do wersji hostowanej

1. **Nagłówki do upstreamu są filtrowane** (allowlista: content-type, accept,
   mcp-session-id, profil). Przenoszenie nagłówków klienta (Host, Origin, cf-\*)
   powodowało, że Langfuse odrzucał żądanie („Access forbidden") — publiczny
   endpoint shim nigdy nie działał, stąd archiwizowane połączenie w Paperclipie.
2. **Wstrzykiwany klucz ma pierwszeństwo**: token klienta (Bearer MCP) nie jest
   kredencjalem Langfuse — przekazanie go jako `Basic` dawało „Authentication failed".

## Uwagi

Silnik jest w Pythonie — Workers nie uruchomią Pythona, więc publiczny endpoint to
Worker, a silnik zostaje w Dockerze (jak qdrant/supabase/ubuntu).
