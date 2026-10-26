---
name: paperclip-execute
description: Execute the currently assigned Paperclip task during one bounded heartbeat and leave verifiable evidence and a truthful final status.
---

# Execute a Paperclip Task

Use this skill when an assigned agent must perform one bounded unit of DAG work through OpenCode and Paperclip.

## Start safely

1. Read the current issue and `paperclipGetHeartbeatContext` before acting.
2. Confirm the issue is assigned to the current agent, actionable, and not blocked.
3. Use `paperclipCheckoutIssue` when checkout applies. A conflict is an ownership conflict; do not retry or take over.
4. Confirm the active heartbeat/run identity before any cross-issue mutation. If a valid run ID cannot be proven, do not mutate other issues, approvals, recovery state, or workspace ownership.

One heartbeat is one bounded execution opportunity. Do the most useful valid action now; do not manufacture comments, status churn, or background polling.

## OpenCode boundary

- Paperclip issue, assignee, workspace, dependency, and review policy are authoritative.
- OpenCode subagents and `opencode-queue` are ephemeral helpers. They do not replace a Paperclip issue or dependency edge.
- Never create branches or worktrees manually. Paperclip owns workspace and branch lifecycle; delivery uses the configured ancestry/merge path.
- Use Paperclip-managed runtime services and commands. Do not hide `npm run dev &`, ad-hoc daemons, or detached processes behind a successful status.

## Execute and record

Perform the smallest implementation that satisfies the issue. Preserve the current scope. Before finishing, record minimum verifiable evidence:

- changed artifact, diff, commit, or resulting API state;
- exact verification command and its result;
- relevant run/workspace operation or external link;
- unresolved blocker and its owner, if incomplete.

Use Paperclip-native tools where available. Use `paperclipApiRequest` for workspace/runtime controls or routes not exposed as tools, and pass the confirmed run ID for mutations. Never copy credentials into comments, documents, logs, or source files.

## Status gate

- `in_progress`: real execution is happening now.
- `blocked`: a concrete external action or dependency is required; state owner and exact action.
- `in_review`: work is complete and genuinely awaits the configured review/approval/verification path.
- `done`: only after completion, review requirements, and evidence are satisfied by the responsible reviewer.

Do not mark `done` because a command was sent. Re-read the resulting issue/run state. If the scope becomes a new graph, stop execution and return it to `paperclip-plan-dag`.

## Handoff

End with `RESULT`, `EVIDENCE`, `STATUS`, `NEXT OWNER`, and `BLOCKER` (or `none`).
