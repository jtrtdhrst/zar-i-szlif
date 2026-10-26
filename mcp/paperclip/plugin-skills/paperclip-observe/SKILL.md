---
name: paperclip-observe
description: Diagnose Paperclip task, heartbeat-run, workspace, dependency, and runtime state using bounded read-only inspection.
---

# Observe Paperclip State

Use this skill when the user asks what is happening, why an agent/DAG node is stuck, whether a run is alive, or what should happen next. This skill is read-only.

## Never mutate

Do not checkout, comment, change status, create tasks, retry, cancel, restart, approve, release, or edit documents. Do not call a mutating `paperclipApiRequest`. Observation is complete only when the evidence is sufficient for a separate execution or repair decision.

## Bounded inspection order

1. `paperclipGetIssue` for status, owner, parent, blockers, children, workspace, and review policy.
2. `paperclipGetHeartbeatContext` for wake reason, active run, workspace, and continuation.
3. `paperclipListComments` with `after` for new evidence only.
4. `paperclipGetRunDetail` with `includePrompt: false` for status, liveness, stages, errors, events, linked issues, token usage, and workspace operations.
5. Use `paperclipApiRequest` only for missing read-only diagnostics such as `/issues/{id}/diagnostics/blockers`, `/diagnostics/wakes`, `/diagnostics/subtree`, active/live runs, recovery projection, workspace close-readiness, or runtime service state.

Do not fetch the full prompt unless a specific hypothesis cannot be tested otherwise. Do not busy-poll. `running` is not proof of a live process; distinguish active process, queued wake, scheduled retry, zombie run, workspace validation failure, and process loss.

## Report facts, not guesses

Return this structure:

```text
SYMPTOM:
CONFIRMED EVIDENCE:
LIKELY ROOT CAUSE:
CONFIDENCE: high | medium | low
BLOCKER / OWNER:
NEXT ACTION:
```

Separate confirmed API data from hypotheses and missing information. Check dependency readiness, pending workspace finalization, pending interactions/approvals, review state, and whether a watchdog review already exists for the same stop fingerprint.

## Important distinctions

- A child can be complete while its parent is still blocked by another leaf.
- `parentId` is hierarchy; `blockedByIssueIds` is execution dependency.
- `cancelled` is not automatically a resolved blocker.
- `workspace_validation_failed` is usually a workspace policy/configuration error, not a retryable agent error.
- A `running` record without a live process can be zombie; a live process must not be retried blindly.
- OpenCode `task` output is not durable Paperclip evidence until attached to the issue/run.

End with the smallest next action and the skill that should perform it: `paperclip-execute`, `paperclip-plan-dag`, or `paperclip-repair`.
