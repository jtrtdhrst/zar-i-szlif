FROM node:24-bookworm-slim
WORKDIR /app
COPY server.mjs test/router-mode.mjs ./
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.mjs"]
