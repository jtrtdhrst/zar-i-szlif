# Qdrant MCP (hybrid dense + sparse)

MCP server over a Qdrant collection: full CRUD, semantic search and hybrid (dense +
BM25 sparse) retrieval. Embeddings are computed locally by FastEmbed on CPU — no
OpenAI key needed.

- `server/server.py` — the MCP server (MCP SDK v2 `MCPServer`).
- `server/Dockerfile` — bakes the FastEmbed models into the image, so the container
  starts without downloading models.
- `docker-compose.yml` — Qdrant + the MCP server for a local/self-hosted setup.

## Build

```bash
docker build -t mcp-qdrant-hybrid:local server/
```

## Run

```bash
# against an existing Qdrant cluster
docker run --rm -p 8000:8000 --env-file .env mcp-qdrant-hybrid:local

# or the bundled stack (qdrant + mcp server)
docker compose up -d
```

`MCP_TRANSPORT=streamable-http` exposes the MCP endpoint on `:8000/mcp`; `stdio` keeps
the server on stdio for `docker run --rm -i` clients.

## Env

See `.env.example`. `QDRANT_URL` and `COLLECTION_NAME` are the required ones.

## Provenance

Source of the running container `mcp-qdrant-hybrid:latest` on the production host.
Related upstream projects: `allfunc/mcp-qdrant`, `qdrant/mcp-server-qdrant` — the
deployed server here is the hybrid variant, this folder is its source of truth.
