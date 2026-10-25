# plasmic-production

Self-hosted Plasmic (Studio + WAB + codegen) deployed from this repository.
Everything the deployment needs is in this repo; `platform/` is a vendored copy of
[`plasmicapp/plasmic`](https://github.com/plasmicapp/plasmic) at
`85b861115687fde8e7970a9f270660aecb62b38e` with a single local change.

## What runs

| Service | Image | Port | Purpose |
|---|---|---|---|
| `plasmic-db` | `postgres:15` | 5432 | WAB database |
| `plasmic-wab` | built from `platform/wab/Dockerfile` | 3004 | API + auth + publish |
| `plasmic-codegen` | same image, `codegen-backend.ts` | 3005 | `/api/v1/code/*`, `/api/v1/loader/*` |
| `plasmic-studio` | `studio.Dockerfile` (nginx) | 8080 | Studio UI + reverse proxy |

The only source change against upstream is `githubClientId` / `githubAppName` in
`platform/wab/src/wab/shared/devflags.ts` (our GitHub App). The GitHub App private
key is **not** in the image: `plasmic-wab` writes it from
`PLASMIC_GITHUB_SECRETS_B64` at container start.

`platform/shared/.keep` exists because the pinned upstream commit predates
`platform/shared/`, while `platform/wab/Dockerfile` copies that directory.

## Local run

```bash
cp .env.example .env   # fill in every value
docker compose up -d --build
curl -s http://127.0.0.1:8080/api/v1/app-config
```

First build takes ~30–60 minutes (pnpm install + `make` + rsbuild Studio bundle).

## Coolify

- Resource type: Application (`plasmic`, project `Plasmic`), Git repository
  `miloszspyrka-code/zar-i-szlif`, branch `deploy/plasmic-selfhost-20261025`
  (later: `main`).
- Build pack: Docker Compose, base directory `/plasmic`, compose
  `docker-compose.yml`.
- Domain: `plasmic-studio` service on port 8080 (`plasmic.kompaszbiorek.pl`,
  plus staging `plasmic-next.kompaszbiorek.pl`).
- Environment: every key from `.env.example`. `ADMIN_EMAILS` must be JSON
  (e.g. `["admin@example.com"]`) — a bare `[a@b.c]` crash-loops WAB in
  `parseConfigFromEnv`.
- Persistent volume: `plasmic_pgdata` (database).
- Resource sizing: first build needs ~4 GB RAM and ~20 GB free disk
  (pnpm store + parallel builders); the host otherwise sits at ~90% disk,
  so watch headroom before rebuilding.

## Build cache (learned 2026-10-25)

- `studio.Dockerfile` pins an explicit `PNPM_STORE_DIR=/pnpm/store` with a
  BuildKit cache mount on every `pnpm fetch/install`, plus an npm cache mount
  for the `/opt/studio-extra` workaround. A lockfile change refetches only
  missing packages; an empty/pruned cache degrades into a full refetch.
- Never run `docker builder prune -af` on the host to "make room": it wipes
  the layer cache and forces a from-scratch rebuild that needs the ~20 GB
  you were trying to free. Prefer Coolify's Docker Cleanup with a disk-usage
  threshold, which keeps recent layers.
- Env-only changes (e.g. `ADMIN_EMAILS`, `HOST`) need no rebuild: the images
  are fine, only the containers need recreating. Coolify's redeploy rebuilds
  anyway (fast when cache is hot); if disk is too tight for even a cached
  rebuild, recreate `plasmic-wab`/`plasmic-codegen` manually from
  `docker inspect` output with the fixed env instead.

## Data migration from the old instance

```bash
# old host, user docker
docker exec plasmic-plasmic-db-1 pg_dump -U wab -d wab --no-owner --no-privileges > wab.sql
# new instance (container name from `docker ps`)
docker exec -i <new-db-container> psql -U wab -d wab < wab.sql
```

## License

`platform/` is AGPL-3.0 (`LICENSE.platform.md`); everything outside `platform/`
is MIT (`LICENSE.md`). Running this as a public network service means offering
the corresponding source (including local modifications) to its users.
