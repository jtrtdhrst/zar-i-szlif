# Self-hosted Supabase MCP — same image recipe as the running container
# `selfhosted-supabase-mcp:latest` (bun runtime, non-root user `mcp`,
# healthcheck on :3100).
FROM oven/bun:1.1.45-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY src ./src
RUN bun run build

FROM oven/bun:1.1.45-alpine
RUN addgroup -S mcp && adduser -S -G mcp mcp
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER mcp
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3100/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "dist/index.js"]
