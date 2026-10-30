FROM node:24-trixie-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bridge.mjs ./
ENV PORT=3100 \
    MCP_PATH=/mcp \
    IDLE_SECONDS=600 \
    EMAILENS_ENTRY=/app/node_modules/@emailens/mcp/dist/index.js
EXPOSE 3100
CMD ["node", "/app/bridge.mjs"]
