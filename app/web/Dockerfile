# syntax=docker/dockerfile:1.7
# Owned build context: app/web/ (NEVER repository /).
# Explicit shared inputs: --build-context registry=./registry --build-context config=./ops/coolify
# Production promotion remains gated; do not deploy raw PR commits.
FROM node:24-bookworm-slim AS web-build
WORKDIR /workspace/app
COPY . ./web
COPY --from=registry / /workspace/registry/
RUN node web/scripts/build-static.mjs && test -s web/dist/index.html

FROM nginx:alpine AS runtime
COPY --from=web-build /workspace/app/web/dist/ /usr/share/nginx/html/
COPY --from=config /nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=config /40-release-provenance.sh /docker-entrypoint.d/40-release-provenance.sh
RUN chmod +x /docker-entrypoint.d/40-release-provenance.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/healthz | grep -qx ok || exit 1
