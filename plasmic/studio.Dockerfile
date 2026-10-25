# syntax=docker/dockerfile:1
#
# Static Studio bundle for the self-hosted Plasmic instance.
# Build context is the repository root (it needs ./platform and ./studio).
# The WAB backend image is built separately from ./platform (upstream Dockerfile).

FROM node:24.16.0-alpine AS builder

# Same build prerequisites as platform/wab/Dockerfile (native addons, peg parsers,
# codegen sandbox) plus git: wab's rsbuild config calls `git rev-parse HEAD`.
RUN apk add --no-cache make~=4 bubblewrap~=0.12 python3 build-base bash g++ gcc libc-dev git

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /platform

COPY platform/package.json platform/pnpm-workspace.yaml platform/pnpm-lock.yaml ./
COPY platform/patches/ ./patches/
RUN pnpm fetch

COPY platform/ ./
RUN pnpm install --frozen-lockfile --prefer-offline

RUN pnpm --filter "loader-bundle-env..." --filter "@plasmicapp/loader-html-hydrate..." build

WORKDIR /platform/wab
RUN mkdir -p src/wab/gen && make

# git init is only here so getCommitHash() resolves; the hash is cosmetic.
RUN git init -q \
    && git -c user.email=ci@plasmic.local -c user.name=ci commit --allow-empty -qm build

# rsbuild.config.ts imports html-webpack-plugin, but upstream does not declare it
# in any package.json at this commit. Install it outside the pnpm workspace so the
# frozen lockfile (and the missing @plasmic-shared/hosting link) stays untouched.
RUN mkdir -p /opt/studio-extra \
    && cd /opt/studio-extra \
    && npm init -y >/dev/null \
    && npm install --no-package-lock --no-audit --no-fund html-webpack-plugin@5.6.3 \
    && cp -a /opt/studio-extra/node_modules/. /platform/node_modules/

# PUBLIC_URL/STATIC_URL control the absolute asset origin baked into index.html.
ARG PUBLIC_URL=https://plasmic.kompaszbiorek.pl
ENV PUBLIC_URL=$PUBLIC_URL \
    STATIC_URL=$PUBLIC_URL \
    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

FROM nginx:1.27-alpine
COPY studio/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /platform/wab/build /usr/share/nginx/html
EXPOSE 8080
