FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/test ./test
COPY tokens.json ./tokens.json
ENV MCP_TRANSPORT=http \
    MCP_HTTP_PORT=3000 \
    PENPOT_BASE_URL=http://penpot-frontend:8080 \
    PENPOT_ACCESS_TOKEN_FILE=/run/secrets/access-token \
    PENPOT_MCP_AUTH_TOKEN_FILE=/run/secrets/mcp-token \
    PENPOT_TOKENS_PATH=/app/tokens.json
EXPOSE 3000
CMD ["node", "dist/server.js"]
