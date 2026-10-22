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

`QDRANT_MCP_TOKEN` switches on the bearer gate for the HTTP transport (401 without
it). Set it for every publicly reachable deployment — the public endpoint
`https://qdrant-mcp.zariszlif.pl/mcp` is protected by exactly this token.

If Qdrant itself is unreachable at start-up, the server now stays up (the MCP
endpoint still answers `tools/list`) and the data tools fail with a readable
"Qdrant is not reachable" error instead of the container dying.

## Local stack (this host)

Qdrant działa lokalnie na VPS (konkretna instancja chmurowa nieosiągalna z hosta —
TLS reset na połączeniu). Uruchomienie:

```bash
docker volume create qdrant_data
docker run -d --name qdrant --network paperclip-net --restart unless-stopped \
  -v qdrant_data:/qdrant/storage \
  -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 qdrant/qdrant:latest

# MCP wskazany na lokalny Qdrant (kolekcja long_term_memory tworzy się sama)
docker run -d --name mcp-qdrant --network paperclip-net --restart unless-stopped \
  --env-file qdrant.env repo/mcp-qdrant:latest
```

`qdrant.env`: `QDRANT_URL=http://qdrant:6333`, `QDRANT_API_KEY=` (puste dla
lokalnego), `COLLECTION_NAME=long_term_memory`, `MCP_TRANSPORT=streamable-http`,
`QDRANT_MCP_TOKEN=<token>`.

Dane z chmury **nie są migrowane** (klaster nieosiągalny) — kolekcja startuje
pusta.

## Provenance

Source of the running container `mcp-qdrant-hybrid:latest` on the production host.
Related upstream projects: `allfunc/mcp-qdrant`, `qdrant/mcp-server-qdrant` — the
deployed server here is the hybrid variant, this folder is its source of truth.
