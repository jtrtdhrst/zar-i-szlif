#!/bin/sh
# Paperclip MCP gateway entrypoint.
#
# The gateway code is baked into the image (/opt/paperclip-mcp) and materialized
# into /paperclip at start, because /paperclip is a mounted volume in production
# (shared with the Paperclip container) and would otherwise shadow the image.
# State files in /paperclip/mcp-gateway (oauth-store.json, url-tokens.json) are
# NOT touched — only the code is refreshed.
set -e

mkdir -p /paperclip/mcp-gateway /paperclip/mcp-patch/src
cp -f /opt/paperclip-mcp/mcp-gateway/gateway.mjs /opt/paperclip-mcp/mcp-gateway/principal.mjs /paperclip/mcp-gateway/ 2>/dev/null || true
cp -rf /opt/paperclip-mcp/src/. /paperclip/mcp-patch/src/ 2>/dev/null || true
# The patched MCP sources import bare specifiers (zod, @modelcontextprotocol/sdk);
# they resolve through the Paperclip MCP package installed in the image.
ln -sfn /app/packages/mcp-server/node_modules /paperclip/mcp-patch/node_modules

exec /usr/local/bin/docker-entrypoint.sh "$@"
