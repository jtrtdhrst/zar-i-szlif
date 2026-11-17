# syntax=docker/dockerfile:1
# Mascot Factory render service — the executable deployment target.
#
# This is deliberately a SEPARATE image from ops/coolify/Dockerfile: that one
# ships the static panel with nginx, and it must keep doing exactly that. This
# image ships the render service (`scripts/mascot-factory-service.mjs`) plus the
# runner it wraps. It needs no package manager and no third-party dependency —
# both files use Node's standard library only — so the image contains nothing
# that could drift from a lockfile.
#
# Build context: repository root. Coolify: Base Directory `/`, Dockerfile
# Location `/ops/mascot-worker/Dockerfile`.
#
# Deployment contract (private network only, no public route, no unauthenticated
# access) and the exact controller steps: ops/mascot-worker/README.md.

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MASCOT_FACTORY_OUT_DIR=/var/lib/mascot-factory/out \
    MASCOT_FACTORY_REFERENCES=/etc/mascot-factory/references \
    MASCOT_FACTORY_REFERENCE_PINS=/app/ops/mascot-worker/reference-pins.json

RUN groupadd --system --gid 10001 mascot \
    && useradd --system --uid 10001 --gid mascot --home-dir /app --no-create-home --shell /usr/sbin/nologin mascot

COPY scripts/mascot-factory.mjs scripts/mascot-factory-service.mjs ./scripts/
COPY ops/mascot-worker/reference-pins.json ./ops/mascot-worker/reference-pins.json

# Artifact and cost-ledger volumes must be writable by the runtime user and
# must survive a container replace, otherwise the daily render budget resets.
RUN mkdir -p /var/lib/mascot-factory/out /etc/mascot-factory/references \
    && chown -R 10001:10001 /var/lib/mascot-factory

USER 10001:10001
EXPOSE 8080

# Liveness only. SOURCE_COMMIT and MASCOT_FACTORY_API_TOKEN are required at
# startup, so a container that cannot serve authenticated renders never reports
# healthy. Readiness (pins, references, budget) is /readyz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{if(j.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "scripts/mascot-factory-service.mjs"]
