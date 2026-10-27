# Paperclip MCP

MCP layer of the Paperclip control plane: the Streamable HTTP gateway that exposes
the Paperclip MCP server (tools, issues, agents, projects, workspaces) to Paperclip
itself, to Claude Web custom connectors (OAuth 2.1), and to any MCP client.

```
client ──Bearer / OAuth──▶ gateway.mjs :3101/mcp ──▶ /paperclip/mcp-patch/src/* ──▶ Paperclip API :3100
```

| Path | What it is |
|---|---|
| `mcp-gateway/gateway.mjs` | HTTP + OAuth gateway (JSON-RPC → Paperclip MCP server) |
| `mcp-gateway/principal.mjs` | principal resolution (agent / board key) |
| `src/` | the MCP server sources (`index.ts`, `tools.ts`, `execution-broker.ts`, `host-ops.ts`, …) — the patched Paperclip MCP package |

**Paperclip core is not vendored.** The API/UI/scheduler/OAuth/migrations stay in the
upstream image `ghcr.io/paperclipai/paperclip`; only the MCP layer above is owned by
this folder (and it is the only part allowed to be patched).

## Build

```bash
# upstream Paperclip release as base
docker build -t paperclip-mcp-gateway:local .

# the deployed runtime as base (adds /app/paperclip-public-mcp/plugin-skills,
# which the gateway lists as MCP skills — without it the gateway aborts at boot)
docker build --build-arg PAPERCLIP_BASE=local/paperclip-opencode-runtime:1.18.32-mcpfix-20261013 \
  -t paperclip-mcp-gateway:local .
```

```bash
docker run --rm -p 3101:3101 \
  -e PAPERCLIP_API_URL=http://paperclip:3100/api \
  -e PAPERCLIP_COMPANY_ID=<company-uuid> \
  -e MCP_PUBLIC_BASE_URL=https://paperclip-mcp.example.pl \
  -v "$PWD/state:/paperclip" \
  paperclip-mcp-gateway:local
```

`/paperclip` must be a writable volume: the gateway persists `oauth-store.json`,
`url-tokens.json` and the OAuth client registry there. The image carries the code
in `/opt/paperclip-mcp` and materializes it into `/paperclip` on start (the volume
would otherwise shadow it).

`PAPERCLIP_COMPANY_ID` is mandatory — the gateway exits at boot without a valid UUID.

## Endpoints

- `POST /mcp` — MCP Streamable HTTP (Bearer `pcp_…` API key or OAuth access token).
- `GET /health` — gateway health.
- `GET /.well-known/oauth-authorization-server` — OAuth 2.1 metadata for custom connectors.

## Coolify

Build directory `/mcp/paperclip`, Dockerfile `Dockerfile`, port `3101`, and a volume
on `/paperclip`. The Paperclip core API (`3100`) is a separate service (upstream
image) — the gateway talks to it over `PAPERCLIP_API_URL`.

## Branch validation and deployment (one path)

Use one branch per change. Create it from the current `main`, push it, open a
pull request into `main` and require successful GitHub `Infrastructure CI`
and `Paperclip MCP source and gateway tests` for that **exact head SHA**
before review and merge. Keep the independent code review where required.
A successful PR or a running agent is not production delivery.

The only automatic deployment owner is the existing self-hosted Coolify GitHub
App integration for `miloszspyrka-code/zar-i-szlif`, production application
`paperclip-mcp` (UUID `fs9rik9axzl1ubbimekvqs03`), tracking **main only**,
with automatic deployment enabled. Build from `/mcp/paperclip/Dockerfile`
(base directory `/mcp/paperclip`, Dockerfile location `/Dockerfile`,
HTTP port 3101). Keep the `/paperclip` persistent volume and reach Paperclip
Core through `PAPERCLIP_API_URL`. Do not auto-deploy feature branches, copy
production credentials to PR previews, or build another duplicate MCP stack.

Do **not** deploy via an additional GitHub Actions -> Coolify token workflow.
Code CI runs in GitHub; build, container lifecycle, deployment history and
rollback run directly in Coolify. After merging, verify the deployment record
matches the merged `main` SHA, inspect the actual running container image,
exercise live MCP `initialize` / `tools/list` (authenticated and denied cases)
and OAuth clients/refresh flow. `GET /health` alone is not readiness evidence:
the crypto import regression previously returned 200 health while MCP requests
crashed. Validate `/__release/identity` and compare to the actual Coolify
runtime identity; do not confuse the pinned upstream Paperclip Core SHA with
the separate MCP overlay commit.

Cloudflare is only DNS, TLS, edge protection and optionally a transport
tunnel: **no Paperclip MCP OAuth, routing, health-response or proxy logic in a
Worker** after the safe cutover. Preserve the public MCP hostname and OAuth
issuer, migrate existing OAuth clients and refresh tokens into the Coolify
persistent volume without logging secrets, verify tunnel reachability and
authenticated traffic, and retain a tested rollback before disabling the old
Worker/gateway/supervisor. Never delete a live Worker route, tunnel or
persistent OAuth state ahead of the proven cutover. An exposed tunnel token
must be rotated through a staged connector replacement to avoid collateral
downtime on unrelated hostnames.

## Provenance

Extracted from the running containers `paperclip-mcp-gateway` /
`paperclip-mcp-gateway-pub` (image `local/paperclip-opencode-runtime:1.18.32-mcpfix-20261013`,
Paperclip build `v2026.1012.0-0-gbba6a45f0`).


