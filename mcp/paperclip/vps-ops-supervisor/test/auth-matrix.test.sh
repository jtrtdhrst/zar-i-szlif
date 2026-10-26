#!/usr/bin/env bash
set -euo pipefail
CAND="${1:-/opt/sup/watcher.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
F="$TMP/functions.sh"
grep -E '^[A-Z_][A-Z_0-9]*=' "$CAND" > "$F"
for fn in check_opr check_live_run canon_op validate file_path_ok; do
  sed -n "/^$fn() {/,/^}/p" "$CAND" >> "$F"
done
grep -E '^(in_list|jget)\(\)' "$CAND" >> "$F"
# shellcheck disable=SC1090
source "$F"

AGENT=11111111-1111-4111-8111-111111111111
FOREIGN=44444444-4444-4444-8444-444444444444
IID=22222222-2222-4222-8222-222222222222
OTHER_IID=33333333-3333-4333-8333-333333333333
OPR=55555555-5555-4555-8555-555555555555
RUN=66666666-6666-4666-8666-666666666666
COMPANY=9894e3c2-3317-46ca-8c72-7a442a76a78e
FIX_ISSUE_ROW="$IID|in_progress|$AGENT|$COMPANY"
FIX_RUN_ROW="running|$AGENT|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
FIX_OPR_ROW="operator|$AGENT|$COMPANY|operator"
FIX_OPR_EXPIRES=2099-01-01T00:00:00Z

# Stub only the host DB boundary; production validation functions run unchanged.
db1() {
  local sql="$1" id
  id="$(printf '%s' "$sql" | sed -n "s/.*WHERE id='\([^']*\)'.*/\1/p")"
  case "$sql" in
    *"context_snapshot->>'issueId'"*) printf '%s\n' "$FIX_RUN_ROW" ;;
    *"context_snapshot->>'expiresAt'"*) printf '%s\n' "$FIX_OPR_EXPIRES" ;;
    *"FROM issues"*) printf '%s\n' "$FIX_ISSUE_ROW" ;;
    *"FROM heartbeat_runs"*) if [ "$id" = "$OPR" ]; then printf '%s\n' "$FIX_OPR_ROW"; else printf '%s\n' "$FIX_RUN_ROW"; fi ;;
    *"FROM agents WHERE id="*) printf '1\n' ;;
    *) printf '\n' ;;
  esac
}

mkreq() {
  python3 -c 'import json,sys; op,agent,issue,run,opr,path=sys.argv[1:7]; d={"v":"1","operation":op,"agentId":agent,"issueId":issue,"runId":run,"operatorRunId":opr,"path":path,"expectedSha":"b"*64,"content":"ok","contentSha":"a"*64}; print(json.dumps(d))' "$@"
}
PASSED=0; FAILED=0; TOTAL=0
case_() {
  local name="$1" expect="$2"; shift 2
  TOTAL=$((TOTAL+1))
  local output
  output="$(validate "$(mkreq "$@")" 2>&1)"
  if [ "$expect" = "OK" ] && [ "$output" = "OK" ]; then
    PASSED=$((PASSED+1)); printf 'PASS %s\n' "$name"
  elif [ "$expect" != "OK" ] && [[ "$output" == *"$expect"* ]]; then
    PASSED=$((PASSED+1)); printf 'PASS %s\n' "$name"
  else
    FAILED=$((FAILED+1)); printf 'FAIL %s: expected %s, got %s\n' "$name" "$expect" "$output"
  fi
}

CANARY=/paperclip/vps-ops/canary/app.conf
case_ "issue-bound live run can patch canary" OK host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
case_ "audited operator mutation remains valid" OK host.backup.create "$AGENT" "$IID" "" "$OPR" ""
FIX_OPR_EXPIRES=2020-01-01T00:00:00Z
case_ "expired operator run denied" "operatorRunId expired" host.backup.create "$AGENT" "$IID" "" "$OPR" ""
FIX_OPR_EXPIRES=2099-01-01T00:00:00Z
case_ "non-canary path denied" "path outside allowlist" host.file.patch "$AGENT" "$IID" "$RUN" "" /paperclip/vps-ops/policy/POLICY.md
FIX_RUN_ROW="running|$FOREIGN|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "foreign agent run denied" "runId mismatch agent/company" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="running|$AGENT|99999999-9999-4999-8999-999999999999|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "foreign company run denied" "runId mismatch agent/company" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="running|$AGENT|$COMPANY|$OTHER_IID|$OTHER_IID|$OTHER_IID|$OTHER_IID|2099-01-01T00:00:00Z"
case_ "run bound to another issue denied" "runId not bound to this issue" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="running|$AGENT|$COMPANY|||||2099-01-01T00:00:00Z"
case_ "unbound run denied" "runId not bound to this issue" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="cancelled|$AGENT|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "cancelled run denied" "runId not live" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="running|$AGENT|$COMPANY|$IID|$IID|$IID|$IID|2020-01-01T00:00:00Z"
case_ "expired run denied" "runId expired" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_RUN_ROW="running|$AGENT|$COMPANY|$IID|$IID|$IID|$IID|2099-01-01T00:00:00Z"
case_ "runId alone does not open other mutation" "operatorRunId" host.backup.create "$AGENT" "$IID" "$RUN" "" ""
case_ "no mutation context denied" "operatorRunId" host.file.patch "$AGENT" "$IID" "" "" "$CANARY"
case_ "malformed run id denied" "invalid runId" host.file.patch "$AGENT" "$IID" "not-a-uuid" "" "$CANARY"
case_ "operator id is not silently replaced by runId" "operatorRunId not active operator" host.file.patch "$AGENT" "$IID" "$RUN" 77777777-7777-4777-8777-777777777777 "$CANARY"
FIX_ISSUE_ROW="$IID|done|$AGENT|$COMPANY"
case_ "terminal issue denied" "issue terminal" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
FIX_ISSUE_ROW="$IID|in_progress|$FOREIGN|$COMPANY"
case_ "issue owned by different agent denied" "issue not owned by agent" host.file.patch "$AGENT" "$IID" "$RUN" "" "$CANARY"
printf '%s\n' "---" "TOTAL=$TOTAL PASS=$PASSED FAIL=$FAILED"
[ "$FAILED" -eq 0 ]
