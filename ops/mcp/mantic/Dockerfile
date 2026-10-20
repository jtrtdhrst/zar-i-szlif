# Vendor image for the patched Mantic MCP server (KOMAA-1102).
#
# Build from this directory:
#   docker build -t mantic-mcp:komaa-1102 .
#   docker image inspect mantic-mcp:komaa-1102 --format '{{index .RepoDigests 0}}'
#
# Base image is pinned by digest so the build is reproducible.
# The upstream service speaks MCP over stdio; the HTTP wrapper that fronts it
# on the host (image `mantic-mcp-http:latest`) is host-owned packaging and is
# NOT reproduced here — see README.md ("Deployment").

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

WORKDIR /app

# Dependency layer first. The lockfile is the pristine upstream lockfile
# (unmodified), so the dependency graph is reproducible.
COPY package.json package-lock.json ./
# --include=dev: typescript is a devDependency and is needed for the build.
# --ignore-scripts: the upstream `prepare` script would run `npm run build`
# before src/ exists.
RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENTRYPOINT ["node", "build/index.js"]
