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
# in any package.json at this commit. The config also resolves process/browser,
# buffer, path and raw-loader without declaring them (they only exist deep in
# pnpm's store). The studio bundle additionally needs the sub/react-web-bundle/
# live-frame/canvas-packages builds plus the sass-generated canvas styles, which
# upstream's `pnpm setup-all` produces on a dev machine but no Dockerfile runs.
# Install the missing packages outside the pnpm workspace so the frozen lockfile
# (and the missing @plasmic-shared/hosting link) stays untouched, then run the
# missing builds here. Verified 2026-10-25 against a throwaway container.
RUN mkdir -p /opt/studio-extra \
    && cd /opt/studio-extra \
    && npm init -y >/dev/null \
    && npm install --no-package-lock --no-audit --no-fund html-webpack-plugin@5.6.3 process@0.11.10 buffer@6.0.3 path@0.12.7 raw-loader@4.0.2 \
    && cp -a /opt/studio-extra/node_modules/. /platform/node_modules/

RUN pnpm build-css

RUN cd /platform/sub && pnpm install --prefer-offline && pnpm build
RUN cd /platform/react-web-bundle && pnpm install --prefer-offline && pnpm build
RUN cd /platform/live-frame && pnpm install --prefer-offline && pnpm build
RUN cd /platform && pnpm --filter canvas-packages build
RUN cp /platform/loader-html-hydrate/build/* /platform/wab/public/static/js/

# PUBLIC_URL/STATIC_URL control the absolute asset origin baked into index.html.
ARG PUBLIC_URL=https://plasmic.kompaszbiorek.pl
ENV PUBLIC_URL=$PUBLIC_URL \
    STATIC_URL=$PUBLIC_URL \
    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=4096
# Telemetry keys are REQUIRED_VAR/OPTIONAL_VAR at build time but have no
# self-host value; bake in disabled placeholders so the bundle never phones
# home. Client code already guards each usage (stripe.ts warns, sentry skips).
RUN POSTHOG_API_KEY=phc_disabled POSTHOG_HOST=https://posthog.invalid POSTHOG_REVERSE_PROXY_HOST=posthog.invalid SENTRY_DSN=https://selfhosted.invalid/1 SENTRY_ORG_ID=selfhosted SENTRY_PROJECT_ID=selfhosted STRIPE_PUBLISHABLE_KEY=pk_test_selfhosted pnpm build

FROM nginx:1.27-alpine
COPY studio/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /platform/wab/build /usr/share/nginx/html
EXPOSE 8080
