# Ubuntu operations MCP (`ubuntu-mcp-bridge`)

Authenticated Streamable HTTP MCP in front of
[`mcp-ssh-manager`](https://github.com/bvisible/mcp-ssh-manager) (stdio) → SSH → the
managed Ubuntu host.

```
client ──Bearer──▶ POST /mcp (bridge, :8765) ──stdio──▶ mcp-ssh-manager ──SSH──▶ host
                     └─ audit JSONL (redacted)
```

- `server.mjs` — the bridge (stateless HTTP, one serialized stdio child, redaction +
  JSONL audit, `GET /healthz`).
- `Dockerfile` — Node 24 image that installs `mcp-ssh-manager@3.8.6` from npm and
  verifies the pinned version at build time.
- `bootstrap-harness-ops.sh` — run ON THE HOST: creates the `harness-ops` user,
  authorizes the SSH key, grants NOPASSWD sudo (idempotent).

## Build

```bash
docker build -t ubuntu-mcp-bridge:local .
```

## Run

```bash
docker run --rm -p 8765:8765 \
  --env-file .env \
  -v "$PWD/secrets/bridge-bearer-token:/bridge-config/bridge-bearer-token:ro" \
  -v "$PWD/secrets/harness-ops:/bridge-config/harness-ops:ro" \
  -v "$PWD/secrets/known_hosts:/bridge-config/known_hosts:ro" \
  -v "$PWD/audit:/audit" \
  ubuntu-mcp-bridge:local
```

Secrets are files, not env vars: `bridge-bearer-token` (Bearer for `/mcp`),
`harness-ops` (SSH private key), `known_hosts` (SSH host keys).

## Coolify

Build directory `/mcp/ubuntu`, Dockerfile `Dockerfile`, port `8765`. Mount the three
secret files and an audit volume.

## Provenance

Source of the running container `local/ubuntu-mcp-bridge:3.8.6` on the production
host. The MCP implementation itself is the upstream npm package
`mcp-ssh-manager@3.8.6` (`bvisible/mcp-ssh-manager`, MIT), installed by the
Dockerfile.
