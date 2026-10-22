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

## Provenance

Extracted from the running containers `paperclip-mcp-gateway` /
`paperclip-mcp-gateway-pub` (image `local/paperclip-opencode-runtime:1.18.32-mcpfix-20261013`,
Paperclip build `v2026.1012.0-0-gbba6a45f0`).
