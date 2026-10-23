# Static build of the Plasmic-generated Next.js app in this directory.
FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN npm i -g pnpm@9.10.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM nginx:alpine AS runtime

COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
