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

# Upstream 2026.1012.0 root entrypoint scans and may recursively chown the
# entire shared home, delaying a public gateway by minutes after any recreate.
# Remap the runtime user as upstream would, but enter upstream already as node;
# its unprivileged fast path does not walk or chown the shared Paperclip volume.
if [ "$(id -u)" -eq 0 ]; then
  PUID="${USER_UID:-1000}"
  PGID="${USER_GID:-1000}"
  if [ "$(id -u node)" -ne "$PUID" ]; then
    usermod -o -u "$PUID" node
  fi
  if [ "$(id -g node)" -ne "$PGID" ]; then
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
  fi
  # Gateway-owned directories only. Never recurse into Paperclip Core data.
  chown node:node /paperclip
  chown -R node:node /paperclip/mcp-gateway /paperclip/mcp-patch /paperclip/plugin-runtime
  exec gosu node /usr/local/bin/docker-entrypoint.sh "$@"
fi

# Restricted/runAsNonRoot deployments continue through upstream directly.
exec /usr/local/bin/docker-entrypoint.sh "$@"
