# Self-hosted deployment of the static frontend (Coolify).
#
# Stage 1 builds the static frontend artifact (`npm --prefix app run build` ->
# `app/web/dist`), stage 2 serves that artifact with nginx. The
# runtime container is a plain static site: no API, OAuth or MCP runtime lives
# here — those stay on the Cloudflare Worker.
#
# Node 24 mirrors .github/workflows/ci.yml.

FROM node:24-bookworm-slim AS build

WORKDIR /app

# The whole tree is copied before install: `npm ci` runs the root `prepare`
# script (scripts/install-git-hooks.mjs), which must exist in the context.
COPY . .

# Dev dependencies are required: the app build also type-checks app/plugin.
RUN npm ci --include=dev

# Fail a production deploy before replacing the healthy container unless
# the full product build/test contract succeeds. No Worker is deployed here.
RUN npm run lint && npm run typecheck && npm test

# Produces app/web/dist (index.html + kompas-logo.png).
RUN npm --prefix app run build

FROM nginx:alpine AS runtime

COPY --from=build /app/app/web/dist /usr/share/nginx/html
COPY ops/coolify/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Source-path webhook deployment test: 2026-11-02, no runtime behavior change.

# No-op Coolify GitHub webhook deployment canary — 2026-11-03.
