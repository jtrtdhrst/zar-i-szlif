# Supabase MCP (self-hosted)

MCP server for a **self-hosted** Supabase instance: 50+ database management tools
(schemas, tables, migrations, SQL execution, extensions, types, functions, policies,
roles) over PostgREST/Kong and direct Postgres.

- Source: `src/` (TypeScript), built with `bun run build` → `dist/index.js`.
- `Dockerfile` — bun runtime, non-root user `mcp`, healthcheck on `:3100/health`.

## Build

```bash
docker build -t selfhosted-supabase-mcp:local .
docker run --rm -p 3100:3100 --env-file .env selfhosted-supabase-mcp:local
```

The server speaks MCP Streamable HTTP on `:3100/mcp` (transport `http`).

## Deploy

`docker-compose.yml` expects the Supabase stack to be up and to publish the
`supabase_default` network (`docker compose` from the Supabase repo). The MCP server
reaches PostgREST/Kong through `SUPABASE_URL` and Postgres through `DATABASE_URL`.

## Provenance

Upstream: <https://github.com/HenkDz/selfhosted-supabase-mcp> (MIT, `main`,
package version 1.2.0). The `Dockerfile` in this folder reproduces the deployed
`selfhosted-supabase-mcp:latest` image (upstream ships a Node/smithery Dockerfile
instead).
