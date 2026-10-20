# Żar i Szlif — Supabase user/team/task & product MCP read contract (PROPOSAL)

**Status:** Not deployed, not a verified live schema. **Paperclip:** KOMAA-1120, detailed source at `wiki/concepts/supabase-users-teams-tasks-mcp-contract.md`. **Draft DDL:** `supabase/proposals/20261020_user_team_tasks_v1.sql` intentionally ends in ROLLBACK and must not be copied into `supabase/migrations/` before inventory, constraint triggers, app handlers, staging tests, privacy acceptance and CTO review.

## Existing constraints, not assumptions

- This repository currently has `supabase/README.md` and no versioned production migration on `main` as observed on 20 Oct 2026. Production Supabase schema remains unverified until KOMAA-1110 / KOMAA-1122 actual read-only introspection.
- Canonical app data store: Supabase/Postgres; NO Cloudflare D1 replica.
- Existing product Worker: `app/mcp-worker`, currently knowledge-only (`search_knowledge`, `get_knowledge_source`, `search`, `fetch`). The following seven API names are proposed **future** tools and must not be advertised as live.
- Privacy design: `wiki/concepts/product-mcp-supabase-pii-privacy.md` / KOMAA-1108. `auth.users.email` is a managed Supabase Auth exception; app-owned identity columns must be encrypted elsewhere and never readable by the MCP Worker. This proposal stores no first names, surnames, plaintext emails, invitation email copies, or keys.
- Product design: one active drużyna per signed-in person; code yields PENDING join request, not access; authorized Ognisko admin approves; roles differ from organizational functions; each active team has unique avatar species; Iskra (fox) and Szlif (raven) are reserved NPCs.
- RR group context is not a child-participant registry. Tasks should refer to canonical Stół Wypraw meetings/activities after actual schema mapping, not duplicate the content store.

## Relational model

`auth.users.id` → `product_user_profiles.user_id` → `team_memberships.user_id` ↔ `teams.id` → `organizations.id`.

`team_memberships.id` → `team_member_functions.membership_id` → `team_function_catalog.code`. Role (owner/admin/member) is authorization; functions are labels only.

`teams.id` → `team_join_requests.team_id`, `app_private.team_join_codes.team_id`, `app_private.team_invitations.team_id`. An invitation or a pending request has **no membership**; membership creation requires a single atomic authorization check.

`product_tasks.scope` is either `personal` (team_id NULL, owner-only) or `team` (team_id and active-membership required). `product_tasks.parent_task_id` encodes task tree; `product_task_dependencies.blocked_task_id → blocker_task_id` encodes a distinct blocking graph. Both require cycle guards. Scope and assignment invariants require SQL constraints/triggers + trusted backend checks.

`spark_ledger` stores immutable idempotent personal OR team events, never a mutable balance field.

## Required read-only product MCP calls (proposed)

| Tool | Required server-derived scope | PII-free result |
|---|---|---|
| `get_my_context` | validated OAuth subject mapped to internal user | opaque user id, active-team id, safe onboarding state |
| `list_my_teams` | current verified subject | active team identifier only; conditional safe team metadata |
| `get_team_overview` | active membership for requested team | team id, safe team status and task counts, caller role |
| `list_my_tasks` | current subject + active assignments | scope, opaque task ids, status, due date, safe title where classification passes |
| `list_team_tasks` | active member, requested team | opaque ids, allowed status/due, bounded cursor |
| `get_task` | owner or active member for source scope | one safe task, parent id, blocker ids if authorized |
| `list_task_dependencies` | same authorization for every traversed node | bounded separate tree/blocker edges |

**There is no generic list_users, get_user_identity, SQL query, arbitrary profiles REST, token exchange, invitation email search, decrypt RPC or user-supplied impersonation parameter.** The Worker must not be bound to a raw service-role credential with identity-table access; it must reach only limited trusted data endpoints. Owner/member/administrator checks happen in the backend on every request, not inside a prompt.

Example safe output for `get_my_context` (synthetic only):

~~~json
{
  "schema_version": 1,
  "user_id": "00000000-0000-4000-8000-000000000001",
  "active_team_id": "00000000-0000-4000-8000-000000000002",
  "onboarding_state": "complete"
}
~~~

Example safe output for a sanitized team-task list:

~~~json
{
  "schema_version": 1,
  "team_id": "00000000-0000-4000-8000-000000000002",
  "items": [
    {
      "task_id": "00000000-0000-4000-8000-000000000003",
      "scope": "team",
      "status": "todo",
      "due_at": null,
      "title": null,
      "content_redacted": true,
      "blocked_by_task_ids": []
    }
  ],
  "next_cursor": null
}
~~~

The title is NULL on purpose: even team/task free text can contain an email/name/child data. An allowlist/classification layer can release genuinely safe content once approved. Do not launder PII through source documents, Qdrant, model responses or errors.

## High-level authorization matrix

| Actor | Own profile | Team summary | Team tasks | Other team | Requests/admin decisions | Private identity |
|---|---|---|---|---|---|---|
| Unauthenticated | deny | deny | deny | deny | deny | deny |
| Registered, no active team | self only | deny | deny | deny | own request status | app-only separately authorized |
| Pending join applicant | self only | deny | deny | deny | own request status | app-only separately authorized |
| Active team member | self only | own team | own team | deny | own requests only | app-only separately authorized |
| Active team owner/admin | self only | own team | own team | deny | same-team requests via app backend | app-only separately authorized |
| Revoked/removed member | self only | deny | deny | deny | own historic request state if allowed | app-only separately authorized |
| Product MCP service | no raw table access | allowlisted DTO | allowlisted DTO | deny | no mutation | **deny**, including decrypt keys |

## Mandatory acceptance matrix

1. **Schema truth:** inventory actual public/private schemas, auth/user mapping, claims, existing migrations and Worker. Prefer reuse of existing tables. Do not assume this proposal is greenfield.
2. **Integrity:** unique active team per user under concurrent joins; unique species per team under races; fox/raven rejection; owner continuity; membership history; separate parent and blocker graphs, no self/cross-scope/cyclic refs; task assignment requires active membership.
3. **Mutations:** app-only create team, pending request, approve/reject, rotate/expire code, invite, change role/function, remove/leave; no client self-elevation and transactionally audited writes; code/invite handling does not expose HMAC or blind index.
4. **Reads:** effective Postgres RLS for real anon/authenticated DB roles plus unauthorized access denial under service credentials; principal derived from trusted server/OAuth mapping; user cannot request somebody else's subject.
5. **MCP/PII:** direct and indirect names/email in tasks, error messages, nested metadata, snippets, Qdrant, traces/caches; unknown output fields denied, no decrypt/service_role binding, no role bypass through multiple tools; 401/403 for stale/forged token, cross-team/membership revoked; bounded pagination.
6. **Delivery:** new branch/PR/exact SHA, non-PII synthetic staging fixtures and real DB readback, forward/rollback plan, backup/restore validation, independent CTO QA and controlled migration + Worker deployment. Do NOT claim this proposal is implemented based on the presence of files.

## Ordered native Paperclip DAG

- KOMAA-1122 — schema mapping; blocked by privacy inventory KOMAA-1110.
- KOMAA-1123 — additive schema/RLS, blocked by 1122.
- KOMAA-1124 — Ognisko member management, blocked by 1123.
- KOMAA-1125 — safe read MCP, blocked by 1124 and privacy MCP hardening 1113.
- KOMAA-1126 — independent QA, blocked by 1125 and privacy QA 1114.
- KOMAA-1127 — controlled deployment, blocked by 1126 and privacy release 1115.
- Root KOMAA-1120 — COO coordination + CTO independent acceptance and native Harness watchdog. The dependency DAG is separate from the parent structure.

All internal technical notes are in English; Polish product names and user-facing copy remain Polish.
