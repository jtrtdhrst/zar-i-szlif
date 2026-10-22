# Penpot MCP

Three cooperating MCP servers for self-hosted Penpot:

| Service | Source | Transport | Notes |
|---|---|---|---|
| `penpot-native` | image `penpotapp/mcp:2.18.3` (upstream Penpot release) | Streamable HTTP `:4401/mcp` | official multi-user server; the token is passed per request (`?userToken=`) |
| `penpot-headless` | `headless/` (build) | HTTP `:3000/mcp` | project/file/content management over the Penpot RPC API — no browser, no plugin session |
| `penpot-router` | `router/` (build) | HTTP `:3001/mcp` | one facade in front of both: native first, headless fallback |

## Build & run

```bash
docker compose up -d --build
curl -s http://127.0.0.1:3001/mcp   # JSON-RPC initialize
```

## Secrets (files, not env vars)

| File | Consumer | Meaning |
|---|---|---|
| `secrets/access-token` | `penpot-headless` | Penpot user access token (`PENPOT_ACCESS_TOKEN_FILE`) |
| `secrets/mcp-token` | `penpot-headless`, `penpot-router` | MCP auth token (`PENPOT_MCP_AUTH_TOKEN_FILE`, `MCP_TOKEN_FILE`) — the headless server refuses to start in HTTP mode without it |

## Coolify

- `penpot-headless` → build directory `/mcp/penpot/headless`, Dockerfile `Dockerfile`.
- `penpot-router` → build directory `/mcp/penpot/router`, Dockerfile `Dockerfile`.
- `penpot-native` → no build, use the upstream image `penpotapp/mcp:2.18.3`.

## Provenance

- `headless/` — fork of `tvolodi/penpot-mcp` (branch `headless-pipeline-20261019`,
  upstream `main`) with the integrity/exporter pipeline used in production.
  Upstream: <https://github.com/tvolodi/penpot-mcp> (MIT).
- `router/` — locally written hybrid stream router (no upstream).
