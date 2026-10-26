#!/bin/sh
# KOMAA-1415: stage immutable plugin runtime trees into a persistent directory.
#
# The gateway image carries the built plugin packages under
# /opt/paperclip-mcp/plugin-runtime. /paperclip is a volume shared with the
# Paperclip container, so copying there makes the artifacts survive a cold
# recreate. Idempotent: a package is replaced only when its MANIFEST.json
# (per-file sha256) differs. Directories we do not manage are never touched.
#
# Usage: stage.sh <src-root> <dst-root>
stage_plugin_runtime() {
  src="$1"
  dst="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  for pkg in "$src"/*; do
    [ -d "$pkg" ] || continue
    [ -f "$pkg/MANIFEST.json" ] || continue
    name=$(basename "$pkg")
    if cmp -s "$pkg/MANIFEST.json" "$dst/$name/MANIFEST.json" 2>/dev/null; then
      continue
    fi
    rm -rf "$dst/$name"
    cp -a "$pkg" "$dst/$name"
    echo "plugin-runtime: staged $name"
  done
}

if [ "${0##*/}" = "stage.sh" ]; then
  stage_plugin_runtime "${1:?usage: stage.sh <src-root> <dst-root>}" "${2:?usage: stage.sh <src-root> <dst-root>}"
fi
