# Paperclip MCP gateway — the MCP layer only.
#
# The Paperclip core (API/UI/scheduler/OAuth/migrations) is NOT vendored here: it
# ships as the upstream image and must not be modified. This image = upstream
# Paperclip + the MCP gateway and the patched MCP server sources from this repo.
#
# Base image:
#   ghcr.io/paperclipai/paperclip:<tag>            — upstream release (public)
#   local/paperclip-opencode-runtime:<tag>         — the deployed runtime, if needed
#     for other locally customized runtime assets. The four optional MCP skills
#     are packaged from this directory for the standard upstream base image:
#       docker build --build-arg PAPERCLIP_BASE=local/paperclip-opencode-runtime:1.18.32-mcpfix-20261013 .
ARG PAPERCLIP_BASE=ghcr.io/paperclipai/paperclip:2026.1012.0
FROM ${PAPERCLIP_BASE}

WORKDIR /app

COPY mcp-gateway /opt/paperclip-mcp/mcp-gateway
COPY src /opt/paperclip-mcp/src
COPY plugin-skills /app/paperclip-public-mcp/plugin-skills
COPY plugin-runtime /opt/paperclip-mcp/plugin-runtime-builder
COPY entrypoint.sh /usr/local/bin/paperclip-mcp-entrypoint.sh

# KOMAA-1415: bundled plugin dist is git-ignored upstream and therefore absent
# from the image, which made llm-wiki / workspace-diff / file-browser fail
# activation ("no longer exposes a Paperclip manifest") on every boot. Build it
# once, here, from the base image's own plugin sources; the entrypoint then
# stages the immutable tree into the persistent /paperclip volume.
RUN node /opt/paperclip-mcp/plugin-runtime-builder/build.mjs /app /opt/paperclip-mcp/plugin-runtime
RUN chmod +x /usr/local/bin/paperclip-mcp-entrypoint.sh

ENV PAPERCLIP_HOME=/paperclip \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3101

EXPOSE 3100 3101

HEALTHCHECK --interval=30s --timeout=5s --start-period=2m --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3101/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

# The gateway is a TypeScript-aware Node process: tsx loader + the .ts sources
# under /paperclip/mcp-patch/src (materialized from the image by the entrypoint,
# because /paperclip is a mounted volume in production).
ENTRYPOINT ["/usr/local/bin/paperclip-mcp-entrypoint.sh"]
CMD ["node", "--import", "/app/server/node_modules/tsx/dist/loader.mjs", "/paperclip/mcp-gateway/gateway.mjs"]
