# Mantic MCP (Mautic 7)

MCP server for Mautic 7 marketing automation (Columba Edition): campaigns, contacts,
segments, emails, forms, projects and business tools over Mautic v1 (FOSRestBundle)
and v2 (API Platform) endpoints.

Two images, one source tree:

| Image | Dockerfile | Transport | Purpose |
|---|---|---|---|
| `mantic-mcp` | `Dockerfile` | MCP stdio | CLI / agent clients (`docker run --rm -i`) |
| `mantic-mcp-http` | `Dockerfile.http` | MCP Streamable HTTP | Paperclip "connect with a link", remote clients (port `8090`) |

The HTTP image is self-contained (it builds the stdio server and the bridge in one
image) so each service can be built independently by Coolify.

## Build

```bash
docker build -t mantic-mcp:local .            # stdio
docker build -f Dockerfile.http -t mantic-mcp-http:local .
```

## Run

```bash
# stdio
docker run --rm -i --env-file .env mantic-mcp:local

# HTTP bridge
docker run --rm -p 8090:8090 --env-file .env mantic-mcp-http:local
curl -s http://127.0.0.1:8090/mcp   # JSON-RPC initialize
```

## Env

See `.env.example`. `MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET`,
`MAUTIC_TOKEN_ENDPOINT` are all required; the process exits immediately when any is
missing.

## Provenance

Source of the running container (`mantic-mcp:latest` / `mantic-mcp-http:latest` on the
production host). Upstream inspiration: `Cbrown35/mantic-MCP`. The copy in this folder
is the deployed source of truth — upstream changes are applied here first.

## Worker (Cloudflare)

`worker/` = ten sam MCP jako Cloudflare Worker (`mantic-mcp.zariszlif.pl`):

- protokół MCP (JSON-RPC) obsłużony **ręcznie** — bez `@modelcontextprotocol/sdk`
  i bez `axios` (klient Mautic na `fetch`, `worker/src/mautic-client.ts`);
- bundle **68 KiB** (gzip 10 KiB) zamiast 1245 KiB z SDK + axios;
- narzędzia te same co w stdio (`src/tools/**`), błędy MCP przez `src/errors.ts`
  (bez zoda w bundlu) — serwer stdio tłumaczy je na SDK-owy `McpError`;
- deploy: `.github/workflows/mcp-workers.yml` (push do repo = build + `wrangler deploy`).

Konfiguracja Workera: `MAUTIC_BASE_URL`, `MAUTIC_TOKEN_ENDPOINT` (vars) +
`MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET`, `MCP_AUTH_TOKEN` (sekrety).
