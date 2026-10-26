---
name: paperclip-plan-dag
description: Plan or revise a Paperclip task as an explicit acyclic dependency graph with owners, blockers, acceptance criteria, and evidence.
---

# Plan a Paperclip DAG

Use this skill when the user wants to decompose work, start parallel agent work, add dependencies, or revise a stalled graph.

## Control-plane rules

- Treat Paperclip issues as the durable DAG. OpenCode `task`, queue entries, and parallel chat work are ephemeral execution aids, not DAG nodes.
- Treat ChatGPT as coordinator. The assigned OpenCode/Paperclip agent executes code in its managed workspace; do not claim that ChatGPT ran local commands.
- The existing `paperclip` skill is the authority for scope, ownership, permissions, heartbeat, evidence, and truthful status. Follow it first.
- Do not infer authority from the user's request alone. Check the current issue, assignee, effective permissions, review policy, and run context.

## Inspect before planning

Read only the current scope first:

1. `paperclipGetIssue` for the current issue, parent, goal, assignee, status, blockers, workspace, and review policy.
2. `paperclipGetHeartbeatContext` for the wake reason, current run, workspace, and continuation state.
3. `paperclipListComments` incrementally for recent decisions and blockers.
4. Existing `plan` and relevant documents with `paperclipListDocuments`/`paperclipGetDocument`.
5. Existing children and dependency diagnostics through `paperclipApiRequest` when the graph cannot be understood from the issue response.

Stop and report the missing fact if the parent issue, goal, authority, agent owner, or workspace policy is unknown.

## Graph semantics

- `parentId` expresses hierarchy. It does not make work wait.
- `blockedByIssueIds` expresses execution dependency. Use internal UUIDs, not human identifiers.
- `goalId` groups work under a goal. It is not a blocker.
- Every executable node needs one real `assigneeAgentId`.
- Technical work uses `reviewPolicy: "not_creator"` unless a narrower project policy requires otherwise.
- Do not create cycles, duplicate nodes, speculative tasks, or a child that only repeats its parent.
- Give every node an acceptance condition, evidence artifact, and next owner after completion.
- Prefer a small graph. Parallelize only independent work; keep shared-file work ordered.

## Proposal before mutation

Unless the user explicitly authorized creation, present a dry-run table before creating issues:

| node | owner | parent | blockers | acceptance | evidence |
| --- | --- | --- | --- | --- | --- |

When authorized, create the minimum nodes with `paperclipCreateIssue`, then re-read each created issue and verify its internal UUID, owner, parent, blockers, workspace policy, and review policy. Store the accepted graph in the `plan` issue document when durable recovery or handoff matters.

Never use a fake child, comment, or status change to simulate a DAG. If the graph is not executable, return `BLOCKER`, `OWNER`, and `EXACT ACTION` instead.

## Handoff

End with:

- graph created or proposal only;
- node UUIDs and owners;
- dependency edges verified or unresolved;
- first runnable nodes;
- exact condition that wakes the next node;
- remaining authority or run-context blocker.
