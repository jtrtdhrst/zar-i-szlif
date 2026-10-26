#!/usr/bin/env python3
"""Apply a narrow, source-hash-pinned live-run auth patch to the supervisor image."""
from hashlib import sha256
from pathlib import Path
import os

BASE_WATCHER_SHA = "2bba0666de8fd555c0de6c1c4c65e9e85aecb89e8e66383b60a7dd677931167d"
BASE_POLICY_SHA = "09d72401f93fda42b8945a1259e3e6f7db9b95d981160f651ac16d31e5fc1560"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, found {count}")
    return text.replace(old, new, 1)


def write_verified(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.chmod(tmp, path.stat().st_mode & 0o777)
    os.replace(tmp, path)


watcher = Path("/opt/sup/watcher.sh")
policy = Path("/opt/sup/POLICY.md")
if sha256(watcher.read_bytes()).hexdigest() != BASE_WATCHER_SHA:
    raise SystemExit("watcher.sh is not the pinned 1.0.19 source")
if sha256(policy.read_bytes()).hexdigest() != BASE_POLICY_SHA:
    raise SystemExit("POLICY.md is not the pinned v3.10 source")

source = watcher.read_text()
source = replace_once(
    source,
    'MUT_OPS="restart deploy-paperclip mcp.build_candidate mcp.test_candidate mcp.deploy_candidate mcp.rollback host.file.patch host.container.recreate host.service.reload host.backup.create host.backup.restore_to_staging host.migration.apply"',
    '''MUT_OPS="restart deploy-paperclip mcp.build_candidate mcp.test_candidate mcp.deploy_candidate mcp.rollback host.file.patch host.container.recreate host.service.reload host.backup.create host.backup.restore_to_staging host.migration.apply"
LIVE_RUN_MUT_OPS="host.file.patch"''',
    "live-run mutation allowlist",
)
source = replace_once(
    source,
    '''  exp="$(db1 "SELECT context_snapshot->>'expiresAt' FROM heartbeat_runs WHERE id='$opr';")"
  if [ -n "$exp" ] && [ "$(date -u +%s)" -gt "$(date -u -d "$exp" +%s 2>/dev/null || echo 9999999999)" ]; then
    echo "operatorRunId expired ($exp)"; return
  fi''',
    '''  exp="$(db1 "SELECT context_snapshot->>'expiresAt' FROM heartbeat_runs WHERE id='$opr';")"
  if [ -n "$exp" ]; then
    local now_epoch exp_epoch
    now_epoch="$(date -u +%s)"
    exp_epoch="$(python3 -c 'from datetime import datetime,timezone; import sys; d=datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")); d=d.replace(tzinfo=d.tzinfo or timezone.utc); print(int(d.timestamp()))' "$exp" 2>/dev/null || echo 0)"
    [ "$exp_epoch" -gt "$now_epoch" ] || { echo "operatorRunId expired ($exp)"; return; }
  fi''',
    "strict operator expiry parsing",
)
source = replace_once(
    source,
    '''  echo "OPR-OK $oag $oco"
}

validate() {''',
    '''  echo "OPR-OK $oag $oco"
}

check_live_run() { # $1=run id $2=agent id $3=company id $4=resolved issue UUID
  local rid="$1" agent="$2" company="$3" issue_id="$4"
  local rrow status rag rco issue_a issue_b issue_c issue_d expires now_epoch exp_epoch
  local uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  [[ "$rid" =~ $uuid_re ]] || { echo "invalid runId"; return; }
  rrow="$(db1 "SELECT status||'|'||agent_id::text||'|'||company_id::text||'|'||coalesce(context_snapshot->>'issueId','')||'|'||coalesce(context_snapshot->>'taskId','')||'|'||coalesce(context_snapshot->>'taskKey','')||'|'||coalesce(context_snapshot->'paperclipWake'->'issue'->>'id','')||'|'||coalesce(context_snapshot->>'expiresAt','') FROM heartbeat_runs WHERE id='$rid';")"
  [ -n "$rrow" ] || { echo "unknown runId"; return; }
  IFS='|' read -r status rag rco issue_a issue_b issue_c issue_d expires <<< "$rrow"
  [ "$status" = "running" ] || { echo "runId not live (status=$status)"; return; }
  [ "$rag" = "$agent" ] && [ "$rco" = "$company" ] || { echo "runId mismatch agent/company"; return; }
  { [ "$issue_a" = "$issue_id" ] || [ "$issue_b" = "$issue_id" ] || [ "$issue_c" = "$issue_id" ] || [ "$issue_d" = "$issue_id" ]; } || { echo "runId not bound to this issue"; return; }
  if [ -n "$expires" ]; then
    now_epoch="$(date -u +%s)"
    exp_epoch="$(python3 -c 'from datetime import datetime,timezone; import sys; d=datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")); d=d.replace(tzinfo=d.tzinfo or timezone.utc); print(int(d.timestamp()))' "$expires" 2>/dev/null || echo 0)"
    [ "$exp_epoch" -gt "$now_epoch" ] || { echo "runId expired"; return; }
  fi
  echo "RUN-OK $rag $rco $issue_id"
}

validate() {''',
    "issue-bound heartbeat auth helper",
)
source = replace_once(
    source,
    r'''  local row st asg comp rest
  local issue_esc="${issue//\'/\'\'}"
  row="$(db1 "SELECT status||'|'||coalesce(assignee_agent_id::text,'')||'|'||company_id::text FROM issues WHERE id::text='$issue_esc' OR identifier='$issue_esc' ORDER BY CASE WHEN id::text='$issue_esc' THEN 0 ELSE 1 END LIMIT 1;")"
  [ -n "$row" ] || { echo "unknown issue"; return; }
  st="${row%%|*}"; rest="${row#*|}"; asg="${rest%%|*}"; comp="${rest#*|}"''',
    r'''  local row st asg comp rest iid
  local issue_esc="${issue//\'/\'\'}"
  row="$(db1 "SELECT id::text||'|'||status||'|'||coalesce(assignee_agent_id::text,'')||'|'||company_id::text FROM issues WHERE id::text='$issue_esc' OR identifier='$issue_esc' ORDER BY CASE WHEN id::text='$issue_esc' THEN 0 ELSE 1 END LIMIT 1;")"
  [ -n "$row" ] || { echo "unknown issue"; return; }
  iid="${row%%|*}"; rest="${row#*|}"; st="${rest%%|*}"; rest="${rest#*|}"; asg="${rest%%|*}"; comp="${rest#*|}"''',
    "resolved issue UUID",
)
source = replace_once(
    source,
    r'''  if in_list "$op" $MUT_OPS; then
    [ -n "$opr" ] || { echo "mutating op requires operatorRunId (audited StartOperatorRun)"; return; }
    local ook
    ook="$(check_opr "$opr")"
    case "$ook" in OPR-OK*) : ;; *) echo "$ook"; return ;; esac
    [ "${ook#OPR-OK }" = "$agent $COMPANY" ] || { echo "operatorRunId mismatch agent/company"; return; }
  else
    if [ -n "$opr" ]; then
      local ook2
      ook2="$(check_opr "$opr")"
      case "$ook2" in OPR-OK*) : ;; *) echo "$ook2"; return ;; esac
    elif [ -n "$run" ]; then
      local rrow rst rag rco rr
      rrow="$(db1 "SELECT status||'|'||agent_id::text||'|'||company_id::text FROM heartbeat_runs WHERE id='$run';")"
      [ -n "$rrow" ] || { echo "unknown runId"; return; }
      rst="${rrow%%|*}"; rr="${rrow#*|}"; rag="${rr%%|*}"; rco="${rr#*|}"
      { [ "$rst" = "running" ] || [ "$rst" = "operator" ]; } || { echo "runId not live (status=$rst)"; return; }
      [ "$rag" = "$agent" ] && [ "$rco" = "$COMPANY" ] || { echo "runId mismatch agent/company"; return; }
    else
      echo "read op requires runId or operatorRunId"; return
    fi
  fi''',
    r'''  if in_list "$op" $MUT_OPS; then
    if [ -n "$opr" ]; then
      local ook
      ook="$(check_opr "$opr")"
      case "$ook" in OPR-OK*) : ;; *) echo "$ook"; return ;; esac
      [ "${ook#OPR-OK }" = "$agent $COMPANY" ] || { echo "operatorRunId mismatch agent/company"; return; }
    elif in_list "$op" $LIVE_RUN_MUT_OPS; then
      [ -n "$run" ] || { echo "mutating op requires operatorRunId or issue-bound runId"; return; }
      local live
      live="$(check_live_run "$run" "$agent" "$COMPANY" "$iid")"
      case "$live" in RUN-OK*) : ;; *) echo "$live"; return ;; esac
    else
      echo "mutating op requires operatorRunId (audited StartOperatorRun)"; return
    fi
  else
    if [ -n "$opr" ]; then
      local ook2
      ook2="$(check_opr "$opr")"
      case "$ook2" in OPR-OK*) : ;; *) echo "$ook2"; return ;; esac
    elif [ -n "$run" ]; then
      local live2
      live2="$(check_live_run "$run" "$agent" "$COMPANY" "$iid")"
      case "$live2" in RUN-OK*) : ;; *) echo "$live2"; return ;; esac
    else
      echo "read op requires runId or operatorRunId"; return
    fi
  fi''',
    "runId authorization branches",
)
write_verified(watcher, source)

policy_text = policy.read_text()
policy_text = replace_once(
    policy_text,
    """# VPS-OPS operational policy v3.10 (KOMAA-1415, live with supervisor 1.0.19):
#
""",
    """# VPS-OPS operational policy v3.11 (KOMAA-1458, live with supervisor 1.0.20):
#
# v3.11 delta vs v3.10 (narrow issue-bound live-run file-patch auth):
# - host.file.patch may use a running heartbeat runId only when the host DB confirms
#   the same agent, company and exact owned non-terminal issue. All other mutations
#   retain the audited operatorRunId requirement; canary path restrictions are unchanged.
#
""",
    "policy version header",
)
policy_text = replace_once(
    policy_text,
    """- Auth: owned non-terminal issue + live runId (read) or active unexpired
  operatorRunId with matching agent/company (mutating). operatorRun expiresAt
  enforced host-side too.""",
    """- Auth: owned non-terminal issue + same-agent/company live runId or audited operatorRunId for reads.
  Mutations retain active unexpired operatorRunId except host.file.patch, which may also use a
  running heartbeat runId bound in context_snapshot to the exact issue. Host validation repeats
  issue status, ownership, company, agent, run liveness and issue binding; canary paths are unchanged.""",
    "policy auth contract",
)
policy_text = replace_once(
    policy_text,
    "# - host.file.patch (MUT, operatorRunId + single-flight): canary paths ONLY",
    "# - host.file.patch (MUT, operatorRunId or issue-bound live runId + single-flight): canary paths ONLY",
    "policy file.patch rule",
)
write_verified(policy, policy_text)
