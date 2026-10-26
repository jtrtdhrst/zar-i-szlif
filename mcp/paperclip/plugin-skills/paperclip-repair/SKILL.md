---
name: paperclip-repair
description: Apply the smallest authorized and verifiable repair to Paperclip task state, documents, or managed runtime services.
---

# Repair Paperclip Execution

Use this skill only after observation identified a concrete failure and the user/role authorizes a mutation. The existing `paperclip` skill remains the source of truth for scope, authority, evidence, and status.

## Repair gate

Before writing, freshly read:

1. issue and heartbeat context;
2. active run and run events/workspace operations;
3. blocker diagnostics and recovery actions;
4. current workspace close-readiness or runtime service state when relevant.

Prove the current run ID and mutation authority. If the gateway cannot attach a valid run context, fail closed and report the exact blocker; do not reuse a stale/static run ID. Never bypass permissions, approval gates, ownership, signed run identity, or workspace contracts.

## Classify before changing

Choose one root cause:

- transient `process_lost` or bounded runtime failure;
- incorrect status, ownership, or dependency edge;
- workspace policy/validation failure;
- missing or corrupt document/artifact;
- stalled review/approval;
- missing authorization or run context.

Authorization failures are not repaired by changing status or retrying. `workspace_validation_failed`, ownership conflicts, a live run, and a changed watchdog fingerprint are not blind-retry cases.

## Smallest safe repair

- Correct a status, comment, blocker, or document only when that is the diagnosed root cause.
- Restore a specific document revision only after identifying the target revision and preserving evidence.
- Use Paperclip-managed runtime controls for runtime services; never start hidden background processes.
- Use recovery endpoints through `paperclipApiRequest` only with their required authority: recovery-action resolve requires a valid action/run scope; scheduled retry, false-positive/cancelled watchdog actions, force-release, approvals, and liveness instance recovery may be board-only.
- Allow at most one controlled retry for `process_lost`; stop after two identical failures.
- Do not delete data, force overwrite, create a duplicate guardian issue, or mark `done` as the first response.

## Verify after every mutation

Re-read the mutation result, issue status, run status/events, blocker readiness, workspace close-readiness, and evidence. A successful HTTP request is not proof that the repair took effect. If the repair changes scope into new work, return to `paperclip-plan-dag`.

End with:

```text
ROOT CAUSE:
REPAIR:
VERIFICATION:
STATUS:
NEXT OWNER:
REMAINING RISK:
```
