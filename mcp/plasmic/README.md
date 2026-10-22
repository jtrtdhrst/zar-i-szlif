# Plasmic MCP

Two MCP servers in one image (the `command` selects the server):

| Service | Command | Port | Purpose |
|---|---|---|---|
| `plasmic-mcp` | `node services/plasmic-mcp/server.ts` | 8091 | Plasmic API: projects, components, pages, HTML import |
| `opendesign-bridge-mcp` | `node services/opendesign-bridge-mcp/server.ts` | 8092 | OpenDesign bridge (brand assets, design sync) |

- `services/plasmic-mcp/` — the Plasmic MCP server (server.ts, tools.ts, templates).
- `libs/` — shared libraries (`mcp-server`, `plasmic-client`, `od-client`, `contracts`).
- `workflows/`, `design-sync/` — auxiliary services shipped in the same image.

## Build

```bash
docker build -t plasmic-mcp:local .
docker run --rm -p 8091:8091 --env-file .env plasmic-mcp:local
```

## Coolify

Build directory `/mcp/plasmic`, Dockerfile `Dockerfile`. The image is non-root
(user `mcp`, uid 10001), exposes 8091/8092 and expects `PLASMIC_STATE_DIR` to be a
writable volume.

## Provenance

Snapshot of `ops/design-stack/` in this repo — that path stays the CI build source
(`Dockerfile.mcp`, `docker-compose.mcp.yml`); this folder is the standalone,
Coolify-ready copy of the same tree.
