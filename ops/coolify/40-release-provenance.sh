#!/bin/sh
# Executed by the official nginx Docker entrypoint before nginx starts.
# Runtime SOURCE_COMMIT is provided by Coolify for Git-backed applications.
# Report canonical repository identity, never a hard-coded source branch:
# the approved deploy ref can be ci-approved while main points elsewhere.
set -eu

sha="${SOURCE_COMMIT:-}"
if [ "${#sha}" -ne 40 ] || ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "release provenance unavailable: expected an exact 40-hex SOURCE_COMMIT" >&2
  exit 1
fi

printf '{"commit":"%s","source":"jtrtdhrst/zar-i-szlif"}\n' "$sha" > /usr/share/nginx/html/__release.json
test -s /usr/share/nginx/html/__release.json
