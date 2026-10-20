# Self-hosted deployment of the static frontend (Coolify).
#
# Stage 1 builds exactly what the Vercel target builds (`npm --prefix app run
# build` -> `app/web/dist`), stage 2 serves that artifact with nginx. The
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

# Produces app/web/dist (index.html + kompas-logo.png).
RUN npm --prefix app run build

FROM nginx:alpine AS runtime

COPY --from=build /app/app/web/dist /usr/share/nginx/html
COPY ops/coolify/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
