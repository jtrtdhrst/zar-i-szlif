#!/usr/bin/env bash
# Exercise the REAL v3.12 validate() using the host DB fixtures from v1.0.20.
set -euo pipefail
WATCHER="${1:-/opt/sup/watcher.sh}"
BASE="${2:-/opt/sup/candidate-test/auth-matrix.test.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed '/^CANARY=/,$d' "$BASE" > "$TMP/setup.sh"
source "$TMP/setup.sh"
TARGET=paperclip-mcp-gateway
SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ARTIFACT_DIGEST=sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104
mkreq() {
  python3 -c 'import json,sys; op,agent,issue,run,opr,path,target,sha,digest=sys.argv[1:10];print(json.dumps({"v":"1","operation":op,"agentId":agent,"issueId":issue,"runId":run,"operatorRunId":opr,"path":path,"target":target,"sourceSha":sha,"artifactDigest":digest}))' "$@" "$TARGET" "$SOURCE_SHA" "$ARTIFACT_DIGEST"
}
case_ "valid issue-bound approved gateway release" OK mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
ARTIFACT_DIGEST=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
case_ "unapproved artifact digest denied" "gateway release artifact digest not approved" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
ARTIFACT_DIGEST=sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104
TARGET=paperclip-db
case_ "foreign release target denied" "gateway release target not allowlisted" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
TARGET=paperclip-mcp-gateway; SOURCE_SHA=bad
case_ "short SHA denied" "gateway release requires full sourceSha" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FIX_RUN_ROW="running|$FOREIGN|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "foreign agent run denied" "runId mismatch agent/company" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
FIX_RUN_ROW="running|$AGENT|$COMPANY|$OTHER_IID|$OTHER_IID|$OTHER_IID|$OTHER_IID|2099-01-01T00:00:00Z"
case_ "other issue run denied" "runId not bound to this issue" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
FIX_RUN_ROW="succeeded|$AGENT|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "finished run denied" "runId not live" mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
echo "GATEWAY_RELEASE_AUTH_MATRIX PASS=$PASSED FAIL=$FAILED"
test "$FAILED" -eq 0
