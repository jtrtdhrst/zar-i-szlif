FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY libs/contracts/package.json ./libs/contracts/
COPY libs/od-client/package.json ./libs/od-client/
COPY libs/plasmic-client/package.json ./libs/plasmic-client/
COPY libs/mcp-server/package.json ./libs/mcp-server/
COPY services/plasmic-mcp/package.json ./services/plasmic-mcp/
COPY services/opendesign-bridge-mcp/package.json ./services/opendesign-bridge-mcp/
COPY design-sync/package.json ./design-sync/
COPY workflows/package.json ./workflows/
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY libs ./libs
COPY services ./services
COPY design-sync ./design-sync
COPY workflows ./workflows
# non-root (Etap 16/23: dedykowany user, read-only fs w compose)
RUN adduser -D -u 10001 mcp && chown -R mcp:mcp /app
USER mcp
EXPOSE 8091 8092
