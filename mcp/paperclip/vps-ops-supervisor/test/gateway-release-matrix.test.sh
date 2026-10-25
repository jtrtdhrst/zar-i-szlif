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
mkreq() {
  python3 -c 'import json,sys; op,agent,issue,run,opr,path,target,sha=sys.argv[1:9];print(json.dumps({"v":"1","operation":op,"agentId":agent,"issueId":issue,"runId":run,"operatorRunId":opr,"path":path,"target":target,"sourceSha":sha}))' "$@" "$TARGET" "$SOURCE_SHA"
}
case_ "valid issue-bound gateway release" OK mcp.gateway.release "$AGENT" "$IID" "$RUN" "" ""
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
