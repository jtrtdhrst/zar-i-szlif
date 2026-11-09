---
title: Żar i Szlif — User, Team, Tasks and MCP Data Contract v1
type: concept
tags: [supabase, postgres, rls, team, tasks, privacy, mcp]
updated: 2026-10-20
status: DESIGN_CANDIDATE_NOT_DEPLOYED
owner: CTO
implementers: [Engineer, MCP Engineer]
---
# User + team + tasks — proposed relational source of truth

STATUS: DESIGN ONLY — not live Supabase schema. Prior to any migration, independently inspect the real schema via KOMAA-1110 and compare collisions/backfill needs. This extends the existing policy at wiki/concepts/product-mcp-supabase-pii-privacy.md; it does not replace, unblock or waive its requirements.

## Product semantics (authoritative targets)
- Authenticated account keyed by auth.users.id; never manipulate managed auth.users.email. Application-owned legal name/email live only in an encrypted private identity store under KOMAA-1111. Product MCP must never have decrypt or PII read paths.
- Group is the user-facing drużyna represented by team. One ACTIVE team per user; team history retained. Szczep is a separate organizational unit, not another tenant credential. Team can have many memberships. User avatar species must be unique among ACTIVE memberships in the same team and is reselected when switching teams; fox/raven reserved for guide NPCs.
- Ognisko manages teams, member lists, administrator/member role, independent organizational functions, requests/invites, join code rotation and audit. An invitation or valid team code NEVER grants active membership. Join request requires authorized approval.
- User-only tasks and team-shared tasks are separate scopes. Parent and blocking dependency are distinct first-class relations; prevent cycles, cross-team dependency, personal leakage and parent/dependency confusion. For team tasks support assignee, status, dueAt, owner, resource links and activity/meeting references. The Stół Wypraw remains the canonical task/activity presentation; do not duplicate its facts into camp UI.
- Team and personal Iskry: use an immutable ledger with typed beneficiary (member vs team), idempotency key and balance computed from ledger; no client-controlled balance writes. Do not model child participants or individual RR advancement as user accounts by default.

## Proposed relational inventory (canonical working names; map to actual schema before DDL)
| Relation | Keys and essential attributes | Principal links / constraints |
|---|---|---|
| app_user_profiles | user_id UUID PK -> auth.users; onboarding_state; private experience settings; timestamps | identity ciphertext in separate private table, not in MCP projection |
| organizations | id; name; timestamps | szczep / parent organization, tenant-scoped where necessary |
| teams | id PK; organization_id FK; name; status; created_by UUID; timestamps | one-to-many members and group tasks |
| team_memberships | id PK; team_id FK; user_id FK; role (owner/admin/member); avatar_species; status; joined_at | UNIQUE active user across teams; UNIQUE active (team,species) |
| team_function_catalog | code PK; label; active | functions do not confer authorization |
| member_functions | membership_id FK; function_code FK; PK pair | separate organizational titles from security role |
| team_join_codes | team_id; version; keyed HMAC digest; expires_at; revoked_at | restricted/private, rotated; never return digest through MCP |
| team_join_requests | id; team_id; requested_by; status; reviewed_by; reviewed_at | pending request does not grant permissions |
| team_invitations | id; team_id; destination blind index; expiry; state | no plaintext invite email visible to product MCP; confirmation after login |
| product_tasks | id; scope personal/team; team_id nullable; owner_user_id; assigned_to_user_id; title; description; state; due_at; parent_task_id nullable; activity_id nullable | CHECK scope owner/team; FK and server guard for parent scope and membership |
| product_task_dependencies | blocked_task_id FK; blocker_task_id FK; type blocks; PK pair | no self/cycle, same tenancy and scope, independent of parent |
| task_events | id; task_id; actor_id; type; revision; occurred_at | immutable audit, no secrets / names |
| spark_ledger | id; task_id nullable; beneficiary_user_id XOR beneficiary_team_id; amount; reason; idempotency_key | durable append-only accounting; uniqueness/idempotency |
| user_preferences | user_id; support_level; onboarding progression | private: only self, NEVER reveal experience via MCP by default |

Proposed object identifiers are CONTRACT NAMES, not claims of already existing production tables. Mapping must favor existing verified models instead of duplicate tables.

## Database access and security
1. Supabase/Postgres is the only domain SSOT. Additive versioned SQL migrations, backup/readback, safe historic mapping, rollback. No parallel D1 store.
2. PostgreSQL RLS on every user/team table. Public/anon receives no team data. Sensitive private identity storage, invitation blind indexes and join-code digests are not exposed to authenticated users via raw SELECT.
3. Every query must derive actor subject from trusted auth session, NOT from user-supplied userId/teamId arguments. The product MCP Worker MUST verify Google OAuth -> internal Supabase account mapping server-side and check active membership, including role for sensitive operations.
4. No generic SQL executor / arbitrary REST, arbitrary table selector, join-code lookup or user directory tools exposed via product MCP. App-only trusted backend implements atomic owner/admin member management, code rotation, invite acceptance and join approval; writes audited.
5. Do not directly expose free-form user/team/task text to a model without a content classification and sanitizer: titles/descriptions may contain names, emails or child data. Product MCP responses use deny-by-default safe DTOs, and only allow classified non-PII task content.
6. Revoked user, pending membership, another team, expired/replayed code, stale/forged OAuth subject and service-role bypass attempts return no data. Restrict service-role access at the Worker binding boundary, not just RLS. Test nested arrays, exports, metadata, errors, logs, Qdrant, pagination and traces.
7. Personal task is readable only by its owner. Group task is readable only by an ACTIVE team member. Group-management requests are visible only to requester and authorized administrators. No user enumeration.

## Initial read-only MCP API phase (after security approval; NOT a permanent CRUD ban)

**Scope clarification 2026-11-07:** this section specifies an early safety-scoped read projection. It does not say that MCP cannot perform authenticated writes, that ChatGPT subscriptions determine server CRUD support, or that instructors should be charged for app CRUD. Typed create/edit/delete for tasks, activities, materials and experiments remain the *target* contract in [product MCP tool catalog](wiki/concepts/product-mcp-tool-catalog-proposal.md); the app's authenticated backend must offer free-to-end-user CRUD independent of ChatGPT plan. ChatGPT Free custom MCP availability is unverified and must be measured per client. See [canonical clarification](wiki/concepts/product-mcp-crud-and-chatgpt-client-eligibility-20261107.md).

### Proposed read-only projection (early release phase)
- get_my_context(): opaque current user_id and active_team_id, onboarding status, avatar species and permitted safe profile settings; never email/name.
- list_my_teams(): minimally returns the active team id and approved non-identifying team metadata (team name only when explicitly privacy-classified; its free text can be PII).
- get_team_overview(team_id): authenticated active membership required; returns safe role/capabilities, camp metadata, task counts; no member emails/names.
- list_team_tasks(team_id, status?, limit?, cursor?): only own ACTIVE team; task id, status, due date, safe title/description after policy classification, assignments represented by opaque ids only if essential.
- list_my_tasks(status?, limit?, cursor?): own personal tasks and authorized assigned team tasks with scope indicators.
- get_task(task_id): scope-checked task + safe parent ID and block edges; no unbounded joins, private comments or PII-bearing free-form fields.
- list_task_dependencies(task_id): only graph nodes with scope authorization; max depth/edge count, no cross-team references.
The initial product MCP currently exposes four KNOWLEDGE-ONLY tools, not these APIs. These calls are PROPOSED and should not be advertised as live before implementation. Keep any knowledge MCP endpoints working and apply privacy controls in KOMAA-1113.

## Work sequencing & acceptance
- P0 inventory: inspect actual Supabase schema and current product app data models first (reuse KOMAA-1110).
- P1 align proposed entities with existing schema, confirm one-team+species invariants and derive an additive migration.
- P2 implement relational schema, DB constraints, read-only RLS, administrative transaction handlers, seed fixture and migration validation.
- P3 provide explicit MCP DTOs and server-side Google OAuth/Supabase identity join, constrained read-only queries, pagination, denial tests; coordinate with KOMAA-1113.
- P4 independent security and behavior review using synthetic users: owner, member, admin, pending applicant, revoked membership, foreign team, personal tasks, cycle and duplicate avatar, code replay, malformed auth, PII in free-text, zero PII in logs.
- P5 production rollout only after reviewed SHA, migration backup and rollback, real Supabase readback, safe MCP live authenticated calls and CTO approval.
- Every task has owner, native parent/blockedBy, CTO review and stop-state watchdog. No review/self-approval bypass, no completion based on a document alone.

## Related concepts
- wiki/concepts/onboarding.md
- wiki/concepts/zar-i-szlif-swiat-i-gamifikacja.md
- wiki/concepts/product-mcp-supabase-pii-privacy.md
- wiki/concepts/product-mcp-cloudflare-worker.md
- github.com/miloszspyrka-code/zar-i-szlif / supabase/README.md

## Delivery artifacts and live tracking (created 2026-10-20)

- Canonical coordinator and acceptance: [KOMAA-1120](https://paperclip.kompaszbiorek.pl/KOMAA/issues/KOMAA-1120), parent has native blockedBy KOMAA-1127, CTO independent reviewer, Harness subtree watchdog.
- Proposed SQL + safe DTO source: [Draft PR #60](https://github.com/miloszspyrka-code/zar-i-szlif/pull/60), candidate SHA b46d5cc425d248e81c7f8d699ad45c07aea95eef; SQL is explicitly a non-persisting ROLLBACK proposal, not executable released migration.
- Engineer: KOMAA-1122 (mapping; depends privacy KOMAA-1110), KOMAA-1123 (versioned schema/RLS; depends 1122), KOMAA-1124 (Ognisko membership/join transactions; depends 1123).
- MCP Engineer: KOMAA-1125 (safe read-only MCP; depends 1124 + privacy KOMAA-1113).
- CTO independent acceptance: KOMAA-1126 (depends 1125 + privacy KOMAA-1114).
- CTO production release: KOMAA-1127 (depends 1126 + privacy KOMAA-1115).
- Native dependency graph verified via Paperclip 2026-10-20 with no detected anomalies. Schema remains a DESIGN CANDIDATE; live DB schema, MCP read deployment, and production authorization are NOT VERIFIED.
