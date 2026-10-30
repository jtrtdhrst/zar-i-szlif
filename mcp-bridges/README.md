# mcp-bridges

Sanitized HTTP bridges used by the Paperclip MCP connectors. No credentials are stored in this repository.

## Services

- `emailens-mcp` — Streamable HTTP facade for `@emailens/mcp` (port 3100).
- `mantic-mcp` — Streamable HTTP facade for the Mautic MCP server (port 8090).
- `ubuntu-mcp` — authenticated Streamable HTTP bridge to `mcp-ssh-manager` (port 8765).

## Deploy

`docker-compose.yml` expects an external Docker network named `coolify` and these runtime variables:

- `EMAILENS_BRIDGE_TOKEN`
- `MANTIC_BRIDGE_TOKEN` (optional; empty disables bearer auth)
- `MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET`, `MAUTIC_TOKEN_ENDPOINT`
- `SSH_SERVER_UBUNTU_*` (defaults target the harness host)

The Ubuntu bridge mounts `/home/opencode/server/config/ubuntu-mcp` read-only at `/bridge-config`; that host directory must contain `bridge-bearer-token`, `harness-ops`, and `known_hosts`. It is deliberately not part of this repository.

```sh
docker compose up -d --build
```
