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
cp -f /opt/paperclip-mcp/mcp-gateway/gateway.mjs /opt/paperclip-mcp/mcp-gateway/principal.mjs /opt/paperclip-mcp/mcp-gateway/public-origin.mjs /opt/paperclip-mcp/mcp-gateway/identity-retry.mjs /paperclip/mcp-gateway/ 2>/dev/null || true
cp -rf /opt/paperclip-mcp/src/. /paperclip/mcp-patch/src/ 2>/dev/null || true
# The patched MCP sources import bare specifiers (zod, @modelcontextprotocol/sdk);
# they resolve through the Paperclip MCP package installed in the image.
ln -sfn /app/packages/mcp-server/node_modules /paperclip/mcp-patch/node_modules

# KOMAA-1415: bundled-plugin runtime (manifest/worker/UI dist).
#
# The upstream image ships plugin sources but not their git-ignored dist, so
# every boot activated them as status=error ("no longer exposes a Paperclip
# manifest") and the wiki worker answered 502. The artifacts are built ONCE at
# image build time and staged here into the persistent /paperclip volume, which
# survives a cold recreate.
. /opt/paperclip-mcp/plugin-runtime-builder/stage.sh
stage_plugin_runtime /opt/paperclip-mcp/plugin-runtime /paperclip/plugin-runtime

# Upstream docker-entrypoint probes the whole home for a single non-node file
# and then runs a recursive chown. The code/plugin copies above are created by
# root, so own them here first; otherwise every boot pays a full-volume chown.
chown -R node:node /paperclip/mcp-gateway /paperclip/mcp-patch /paperclip/plugin-runtime 2>/dev/null || true

exec /usr/local/bin/docker-entrypoint.sh "$@"
