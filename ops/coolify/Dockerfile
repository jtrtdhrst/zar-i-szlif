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

# Runtime readiness regression (KOMAA-1558). Serve the built artifact with the
# exact committed nginx config and drive it over real HTTP before the image is
# produced. CI builds this stage, so a route/content-type/redirect drift fails
# the build instead of shipping silently.
#
# KOMAA-1565: the Coolify build environment shares the host network, where
# port 80 is already bound, so the old build-time `nginx` (listen 80) failed.
# The runtime image keeps :80; only this throwaway build instance listens on
# an isolated loopback port. The committed config is rewritten exactly once,
# and the guard below fails the build if any enabled nginx config still
# listens on :80.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /usr/share/nginx/html \
    && cp -a app/web/dist/. /usr/share/nginx/html/ \
    && sed 's/listen 80;/listen 127.0.0.1:18763;/' ops/coolify/nginx.conf > /etc/nginx/conf.d/healthz.conf \
    && test "$(grep -c 'listen 127.0.0.1:18763;' /etc/nginx/conf.d/healthz.conf)" -eq 1 \
    && test "$(grep -c 'listen 80;' /etc/nginx/conf.d/healthz.conf)" -eq 0 \
    && ! grep -rqsE 'listen[[:space:]]+80([[:space:]]|;)' /etc/nginx/conf.d /etc/nginx/sites-enabled \
    && nginx -t \
    && nginx \
    && node scripts/coolify-healthz-smoke.mjs http://127.0.0.1:18763/ \
    && nginx -s quit

FROM nginx:alpine AS runtime

COPY --from=build /app/app/web/dist /usr/share/nginx/html
COPY ops/coolify/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Source-path webhook deployment test: 2026-11-02, no runtime behavior change.

# No-op Coolify GitHub webhook deployment canary — 2026-11-03.
