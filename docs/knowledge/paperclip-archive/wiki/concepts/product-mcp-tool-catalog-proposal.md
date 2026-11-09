---
title: Żar i Szlif — customer MCP full lifecycle, RR sprawności and activity-linked preparation (v4 proposal)
type: concept
tags: [product-mcp, activities, rr-proficiencies, requirements, experiments, tasks, materials, card-field-parity, milestones, proposal]
updated: 2026-10-21
status: PROPOSAL_NOT_APPROVED_NOT_IMPLEMENTED
owner: product/CTO/MCP Engineer
---
# Żar i Szlif — customer-facing MCP tools, full instructor lifecycle (v4)

**Latest user requirements 2026-10-21:** never call Polish RR *sprawności* "skills" in MCP names; use specific RR proficiency terminology. MCP must add, edit and delete **experiments, tasks and materials and link them to a specific activity**; all authorized fields of the canonical activity card must be writable and readable, in addition to requirement check/uncheck and historical amendments. Preserve the user's earlier request for structured Activity Library filters, real past activities including historical editing, and activity/milestone CRUD. Do not expose cosmetic camp/Sparks/avatars or optional onboarding status.

**STATUS**: functional TARGET / proposed MCP contract, NOT live or approved release. This page supersedes the earlier 9- and 13-tool draft lists. Last verified Worker `app/mcp-worker/**` has only `search_knowledge`, `get_knowledge_source`, `search` and `fetch` knowledge tools; last verified Cloudflare release is fail-closed due to missing OAuth. Nothing below proves current Supabase schema, deployed writes or authenticated E2E. Keep the current knowledge compatibility aliases until tested migration. This is the **user-facing product MCP**, NOT Paperclip's administrative MCP.

## Capability and ChatGPT plan clarification — 2026-11-07

**MCP itself supports create/update/delete; a particular deployed read-only Worker does not imply a permanent product CRUD or subscription restriction.** This document is the target 17-tool contract, not proof the writes are deployed. ChatGPT Free compatibility with our custom MCP plugin is NOT VERIFIED; Plus Paperclip admin MCP behavior is not proof about every client's entitlement. The user-facing product must offer free-to-instructor CRUD through its own authenticated app/API independently of ChatGPT plan; supported external MCP clients reuse the same domain services. Do not conceal mutations inside read-only tools. Canonical decision and acceptance: [Product MCP CRUD, client eligibility and free-user access](wiki/concepts/product-mcp-crud-and-chatgpt-client-eligibility-20261107.md).

## 1. End-to-end product loop

- **Direction**: annual theme (scout year September–August), one objective + observable DoD for current three-month horizon, optional milestones with individual completion criteria. Do not force planning all four horizons.
- **Inspiration**: filter **moderated Baza Aktywności RR** separately from the team's calendar; fetch reusable, approved scenarios and RR official requirements with IDs/provenance. Catalog item != actual meeting.
- **Create**: add meeting/camp/trip activity by date/month, optionally reuse catalog items; instantiate the single canonical activity card with real stable ID.
- **Plan**: fill header, goal/proficiencies/requirement plan, agenda rows, four aspects, equipment/materials, preparation tasks/checklists, optionally prior experiment. Every allowed field is addressable from MCP and saved to the same SSOT as the web application.
- **Execute**: conduct event in reality; elapsed date alone never marks activity or requirement completed.
- **Record reality**: inspect past card, report per-step actual outcomes, confirm performed requirements and achieved milestones with authorized instructor attestation, reflect and plan an experiment if useful. Historical records remain editable through audited correction, not silent overwrite.
- **Improve**: query unresolved requirements, milestones, past reflections and upcoming plans; create next real activity or edit existing one. No compulsory built-in AI or onboarding gate.

## 2. Target tools: 17 cohesive logical MCP tools, not one per UI field

| # | Domain | Proposed tool | Capabilities |
| --- | --- | --- | --- |
| 1 | Knowledge | `search_knowledge(query, category?, limit?)` | Safe product help, methodology and sourced RR knowledge |
| 2 | Knowledge | `get_knowledge_source(source_id)` | Retrieve grounded source and citation |
| 3 | Moderated activity library | `search_activity_library(filters, query?, cursor?, limit?)` | Structured filtering of approved reusable activity suggestions; not the team's calendar |
| 4 | Moderated activity library | `get_library_activity(library_activity_id)` | Retrieve full approved reusable library item and provenance |
| 5 | Direction | `get_planning_context(scout_year?)` | Annual theme, active quarter objective/DoD, milestones and RR proficiency priorities |
| 6 | Direction | `manage_plan(action, scout_year, fields, expected_version?, idempotency_key)` | Create/update annual theme and three-month goal/DoD |
| 7 | Milestones | `manage_milestone(action, milestone_id?, horizon_id?, fields?, expected_version?, idempotency_key)` | Create/update/delete/confirm/reopen optional milestones |
| 8 | Team diary | `list_activities(period?, status?, date_from?, date_to?, type?, horizon_id?, milestone_id?, cursor?, limit?)` | One filterable list of past and upcoming team activities, earliest-first |
| 9 | Activity card | `get_activity(activity_id)` | **Read all authorized fields** and attached tasks, materials, experiments, proficiency requirements, planning and historical report |
| 10 | Activity card | `manage_activity(action, activity_id?, fields?, library_source_ids?, expected_version?, idempotency_key)` | Create/update/archive actual team activity; header, goals, detailed agenda, checklists and activity links |
| 11 | Tasks | `list_tasks(scope?, status?, activity_id?, id?, cursor?, limit?)` | Read personal/team/linked tasks, filter by activity and status; bounded dependencies |
| 12 | Tasks | `manage_task(action, task_id?, activity_id?, fields?, expected_version?, idempotency_key)` | Create/update/delete/complete/reopen/link/unlink tasks; **link to activity ID** for activity-scoped operations |
| 13 | Materials | `manage_material(action, material_id?, activity_id?, agenda_item_id?, fields?, expected_version?, idempotency_key)` | **Create/update/delete/link/unlink/mark_ready/mark_needed**, with material quantities, units, preparation statuses and optional agenda-row association |
| 14 | Experiments | `manage_experiment(action, experiment_id?, activity_id?, source_activity_id?, target_activity_id?, fields?, expected_version?, idempotency_key)` | **Create/update/delete/link/unlink** experiment proposals and planned tests; connect originating retrospective to planned future activity; report factual results via the canonical activity report |
| 15 | Actual event report | `save_activity_report(activity_id, fields, expected_version, idempotency_key)` | Save/correct actual agenda outcomes, confirmed requirements/milestones, reflections and experiment results; audited historical edits |
| 16 | RR sprawności | `list_rr_proficiencies(query?, filters?, proficiency_id?, cursor?, limit?)` | Browse sourced **sprawności RR**, their official requirements and authorized group progress |
| 17 | RR requirements | `manage_rr_requirement_progress(action, proficiency_id?, requirement_id?, activity_id?, horizon_id?, fields?, expected_version?, idempotency_key)` | Attach/detach sprawności, plan/unplan individual official requirements, update app-owned notes/status, **check/uncheck** genuinely performed requirements with instructor attestation |

**Naming decision:** do not use `skills` in tool identifiers or exposed schema as a synonym for RR `sprawności`. The exact English domain label is `rr_proficiencies`; user-facing Polish copy remains `sprawności RR` and `wymagania sprawności`. The official catalog's text is immutable through end-user MCP. To update a requirement is to update **the team's planned/actual requirement progress**, not the official source wording.


## 3. Exact full-activity-card field coverage — mandatory parity contract

The authoritative TARGET field map is `wiki/concepts/karta-zbiorki.md`, with Arc 3 (`wiki/concepts/arc-03-przygotujmy-zbiorke.md`) and Arc 4 (`wiki/concepts/arc-04-co-zabieramy-dalej.md`). These documents describe target/UI labels but are **not live schema verification**. At implementation, map *each actual editable field on the live panel* to a strongly typed MCP input, validation, output readback and E2E test. No silent omission. Current known sections:

| Card section | Explicit supported fields and mutations | Canonical tool |
| --- | --- | --- |
| **Header** | Meeting/activity title, type if present, date, start time, end time; create/edit; correct time and move associated calendar entry without duplication | `manage_activity` |
| **Quarter context (view/link)** | Selected quarterly goal, DoD and associated optional milestone references; view current source without duplicating text into card; authorized change of links | `get_activity` / `manage_activity` / `manage_plan` |
| **Goal & skills** | Meeting-specific goal, add/remove proficiency links, select or remove individual planned RR requirement links, view previously verified statuses | `manage_activity` + `manage_rr_requirement_progress` |
| **Planning checklist** | Three section-completeness marks **Cel i sprawności**, **Przebieg**, **Przygotowanie**. Support appropriate manual override if actual UI permits and proper automatic derivation from non-empty fields; clearing previously entered text removes automatic complete mark. Do NOT confuse section completeness with finished logistics or earned skill | Typed `manage_activity` controls and authoritative server derivation |
| **Agenda/Przebieg table** | Each row: start, duration in minutes, activity (reused approved library ID OR authored description), developmental aspect enum `physical|social|spiritual|intellectual|none`, responsible person reference only if permitted by zero-PII contract, row materials. Add/edit/remove/reorder `×/↑/↓`. Recompute downstream starts on reorder/duration edit, validate against card duration | `manage_activity` (typed agenda row ops) |
| **Preparation** | Add/edit/remove logistics tasks and linked materials, record quantities/units and what remains to obtain/prepare; update statuses, activity_id and optional agenda_item_id, optional safe assignee reference; reflect same canonical items in home sheet with no duplicate manual lists | `manage_activity` + `manage_task` + `manage_material` |
| **To check / planned experiment** | Add/edit/remove optional planned experiment; title/hypothesis or proposed change, planned check and success criterion; source retrospective activity and optional future target activity links. No fabricated previous experiment for the first meeting | `manage_experiment` (planned test, linked by source/target activity) |
| **Summary / actual agenda** | For each planned row: `as_planned|changed|not_done` (map to actual domain), what actually happened, observed result, cancellation, additional actual step when supported; do not rewrite planned agenda as if it were performance | `save_activity_report` + `manage_experiment` (report owns factual result) |
| **Summary / RR requirements** | Mark concrete requirements `planned` versus `performed_and_instructor_confirmed`, uncheck/reopen when mistake; link to real activity/report, retain source evidence and history. An official badge/rank for a specific child is NOT auto-awarded | `manage_rr_requirement_progress` + `save_activity_report` |
| **Summary / milestones** | Instructor checks observable milestone condition with associated actual evidence; reopen/correct; parent quarter objective completion remains separate decision | `manage_milestone` + `save_activity_report` |
| **Summary / lessons** | What went well, what did not, what changed, lessons learned, follow-up decisions, group-level impressions (no names); full editable past historical report with revision history | `save_activity_report` |
| **Summary / experiment actual** | If planned and actually tested: attach the real target activity and record measured outcome, improvement/new learning/unknowns/next action in its activity report; no result or fake experiment where none existed | `save_activity_report` |
| **Problems / Improvement** | Retain/change/discard decision, optional problem notes, improvement/experiment proposal and future activity reference, optional criterion to assess next time | `save_activity_report` + planned future `manage_experiment` / `manage_activity` |
| **Attendance** | Only approved **aggregate/non-identifying counts or flags** through customer MCP if available/authorized. Per-person presence, personal names, emails or child identity fields remain app-backend/UI only under existing zero-PII policy; MCP cannot receive those fields or decrypt identities | `get_activity` / `save_activity_report` only with safe allowlisted aggregate DTO |

**Field parity acceptance:** an actual UI-to-MCP field mapping table must be generated from real schema/UI at implementation, covering every writable field; tests for create, update, readback, clear, nested agenda reorder, delete, validation and error. If actual card contains fields not listed above, explicitly classify them and expose a safe typed mapping (or document protected PII fields as app-only). Do not claim "100% all fields working" on this concept doc.

No field additions that quietly change app UX or data model. A new MCP field requires matching a verified canonical product field or a reviewed product-model addition. Avoid a massive unconstrained `fields: any` input.

## 4. RR proficiency/requirement lifecycle — mandatory behavior

- **Catalog**: official RR source text and code remain immutable under customer MCP. `list_rr_proficiencies` returns official provenance, filtered categories and requirement records. **Updating a requirement** means changing the TEAM's selection, planned work, status, safe note/observation and evidence links; if original requirement text is missing or obsolete, surface `Brak danych` and route catalog correction through moderated source management, not user-edit official source.
- **Add proficiency**: choose a catalog skill, attach it to the currently authorized quarter or a specific activity, select none/some/all requirements to plan. Avoid duplicate proficiency/requirement associations. Optional user-created working notes remain private, not official RR rules.
- **Plan requirements**: mark `planned` or `not_planned`; a checked planning checkbox does not mean completed. One requirement can be associated with multiple real activities.
- **Check/uncheck actual requirements**: only after activity reality is recorded and an authorized instructor explicitly confirms genuine group-level completion/experience. `check_requirement` and `uncheck_requirement` are **actions inside `manage_rr_requirement_progress`**, not extra MCP tools. Persist requirement ID, activity ID, actor, timestamp, expected revision and, where available, safe short evidence. Correcting a mistake appends an audit event. Do not infer from the clock or the submitted plan.
- **Progress**: `list_rr_proficiencies` can filter `planned|in_progress|performed` as supported by verified domain schema, and show exact verified vs open requirements. Do not count planned items as actual. Never fabricate official rank/badge certification or individual participant achievements.
- **Delete/detach**: remove an erroneous planning link without deleting catalog requirements or rewriting prior real performance. Historical audit survives; deny referentially unsafe deletion.

## 5. Moderated Activity Library versus personal/team Activity Diary

- `search_activity_library` supports only filters verified against actual accepted library schema: text, source category, 4 developmental aspects, estimated duration, required materials, indoor/outdoor, verified RR requirement mappings where present. Missing fields remain `unknown`, never made-up age/cost/certification data. Results include stable IDs and trusted provenance.
- `get_library_activity` returns a safe reusable source scenario, may be referenced by one or more agenda items via `manage_activity`. Modifying a team meeting never edits the global approved library.
- `list_activities(period=past|upcoming|all, status, date filters)` always sorts dated activities ascending by `start_at, id` for a stable paginated list. Unscheduled drafts separate at end; may include `needs_summary` after a past date without indicating execution. Past/next come from ONE common list API, not separate tools.
- `manage_activity(action=create|update|delete)` is domain-targeted CRUD, not a clone of `get_library_activity`. A past card and completed report can be corrected according to role, expected_version and audit, not silently replaced. Deletion is audited soft-delete/archive with checks for tasks, requirements, milestones, reports and historical link integrity. External confirmation for destructive impact.
- The UI's **Dziennik Aktywności** and **Stół Wypraw** both read the same activity record in Supabase/Postgres.

## 5A. Required activity linkage for experiments, tasks and materials

**Explicit user-directed requirement:** MCP must be able to CREATE all three record types and **attach each to the specific activity in which it is used**. An assistant instruction such as "dopisz 2 liny, zadanie kupna mapy i eksperyment do zbiórki w piątek" must persist three separately typed records linked to the same existing `activity_id`, then read those records back through `get_activity`.

| Object | Creation & edits | Link contract | Where shown |
| --- | --- | --- | --- |
| **Tasks** | `manage_task(create|update|delete|complete|reopen|link|unlink)`; title, safe description, due date, state, authorized owner/assignee by opaque ID if permitted, optional dependencies | `activity_id` **mandatory for any activity-scoped write/link**, optional only for genuinely standalone personal tasks; prevent cross-team assignment and dangling links | Karta Zbiórki → Przygotowanie, `list_tasks(activity_id)`, home preparation sheet |
| **Materials** | `manage_material(create|update|delete|mark_ready|mark_needed|link|unlink)`; item name, quantity, unit, notes if safe, preparation status | `activity_id` **mandatory**; `agenda_item_id` optional only when it belongs to that same activity. A source material reused in the agenda and checklist is ONE canonical linked record, not two copies | Karta Zbiórki → Przebieg row (when linked), Przygotowanie and home preparation list |
| **Experiments** | `manage_experiment(create|update|delete|link|unlink)`; what to change/test, how success will be judged, optional planned target date and status | At least ONE trusted activity relation is mandatory: either `source_activity_id` where idea originated (after reflection), or `target_activity_id`/`activity_id` for the event where it will be tested. Can be created "to schedule" from a past retrospective, then linked to a future event later. Cross-team linking forbidden. | Past card → Problemy/next step; next card → Do sprawdzenia; actual outcome → Podsumowanie |

### Referential behavior and truthfulness
- `get_activity(activity_id)` returns **all** authorized related experiment/task/material IDs and safe field values; maintain stable, unique IDs and consistent relationships on updates/reorder/deletes. Independent copies of the same logistics materials are prohibited.
- Deleting an activity checks attached experiments, tasks, material references, completed checklist items and historical reports. User authorizes any destructive impact; prefer archive/soft delete and preserve history. Detaching a task is NOT deleting an independent personal task. Detaching an experiment from a future activity can leave it connected to its origin if appropriate.
- Do not require a created activity to have an experiment or fabricated results. **Link capability is mandatory**, not "at least one experiment for every meeting." In the first meeting there is no experiment inherited from an earlier meeting; later retrospective may create one for a future test.
- When creating tasks/materials/experiments *for* an activity, `activity_id` or explicit existing/source/target relations cannot be omitted. If no activity exists yet, create a real activity card first (or explicitly create a standalone task/unscheduled experiment under the correct domain rules).
- All writes must be atomic where possible or use a typed batch with rollback/idempotent retry; avoid half-created orphan records. After each accepted write, read the same `get_activity` and verify each linked entity's ID, value and status. Do not infer successful linkage merely from a 200 response.
- UI and MCP must call the same backend domain operations and share Supabase/Postgres SSOT; each connected object must be visible both in the native card and `get_activity` outputs.


## End-to-end coverage examples for newly required linked records

| Natural language request | Mandatory backend result |
| --- | --- |
| "Dopisz do zbiórki mapy i 5 metrów liny." | `manage_material(create)` with validated `activity_id`, quantity/unit and canonical IDs → `get_activity` readback |
| "Dopisz zadanie kupienia liny do tej zbiórki." | `manage_task(create,activity_id)` → task appears in preparation checklist and `list_tasks(activity_id)` |
| "Oznacz mapę jako przygotowaną." | Resolve exact material ID for that activity → `manage_material(mark_ready)` → verified readiness readback, no fake activity completion |
| "Na następnej zbiórce sprawdźmy, czy krótsza odprawa pomaga." | `manage_experiment(create)` connected to source retrospective and proposed future target if known → visible in future `Do sprawdzenia` |
| "Usuń eksperyment z przyszłej zbiórki, ale zachowaj pierwotny wniosek." | `manage_experiment(unlink)` target relation, preserve source provenance and history |
| "Wpisz wynik tego eksperymentu po zakończonej zbiórce." | `save_activity_report` factual result on existing target activity and experiment relation → `get_activity` verified |
| "Pokaż mi wymagania sprawności Terenoznawstwo i zaznacz faktycznie wykonane." | `list_rr_proficiencies` → `manage_rr_requirement_progress(check_requirement)` only after instructor attestation, with activity link and audit; no award automation |

## 6. Practical E2E flows to test

| Natural language use case | Expected read/write behavior |
| --- | --- |
| "Dodaj do listopadowej zbiórki sprawność X i zaplanuj jej wymagania 1 oraz 3." | `list_rr_proficiencies` → `get_activity` → `manage_rr_requirement_progress(attach_skill, plan_requirement×2)` → readback `get_activity` / `list_rr_proficiencies`; never check actual completion |
| "Odznacz wymaganie 3 po wczorajszej zbiórce. Faktycznie je zrobiliśmy." | Read correct past activity + requirement → verify instructor authority / real completion intent → `manage_rr_requirement_progress(check_requirement)` with activity evidence + readback; no badge award |
| "To odhaczenie było pomyłką, cofnij." | `manage_rr_requirement_progress(uncheck_requirement)` with expected revision; retain audit trail |
| "Uzupełnij CAŁĄ kartę zbiórki zgodnie z planem." | Read existing `get_activity`, `get_planning_context`, optional library/skills → update every allowed requested header, goal, skills, agenda rows with timings/aspects/materials, tasks, checklists and optional experiment through typed mutations → readback ALL fields; no fictional post-event results |
| "W przebiegu zmień kolejność pozycji 2 i 3, ustaw na 15 min i dopisz liny." | Typed `manage_activity` agenda ops, consistent downstream start time + materials → readback |
| "Pokaż trzy minione zbiórki bez podsumowania." | `list_activities(period=past,status=needs_summary)` stable chronological filter |
| "Uzupełnij podsumowanie poprzedniej zbiórki i potwierdź osiągnięty kamień milowy." | `get_activity` → `save_activity_report` factual observations → `manage_milestone(confirm)` after instructor attestation + readback; parent quarterly DoD remains independent |
| "Usuń błędną zbiórkę i powiązany szkic, nie ruszaj katalogu RR." | Resolve exact activity → impact/linked records preview → explicit destructive approval → soft-delete `manage_activity` → verify no library mutation or historical disappearance |
| "Znajdź terenową grę na 45–60 min, użyj jej jako pozycji w zbiórce." | `search_activity_library` supported filters → `get_library_activity` → `manage_activity(update)` insert agenda item by library ID, not clone the globally moderated source |
 
## 7. Invariants, permission & rollout gates

- **ZERO raw first/last name, email, minors' PII or identifiable free-text leaks** to ChatGPT/Claude via MCP tool, source, trace, error, nested response. Per-user private onboarding answers are not MCP features. App may still display identity via separate secured backend. Existing PII contract: `wiki/concepts/product-mcp-supabase-pii-privacy.md`; this safeguard is not yet implemented in the live Worker.
- Supabase/Postgres is product SSOT; Cloudflare Worker enforces token-to-user mapping, active team membership and role checks per action; Qdrant is derived safe knowledge, never Paperclip `long_term_memory` user data.
- Every mutation has explicit caller intent, typed field allowlists and role gates, expected-version compare-and-swap, idempotency, validated references, full event audit and a positive read-after-write. Fail closed on cross-team IDs and protected fields. Frontend UI changes and MCP changes share one business domain mutation service/transaction, not separate conflicting logic.
- No unconfirmed automation of real-world events; planned != performed. Experiment linkage and material/task association are first-class required MCP capabilities, with a genuine activity relationship for activity-scoped changes. Milestone and RR requirement completion needs instructor confirmation; no child profile tracking or individual rank awarding through this MCP.
- Full card E2E includes all editable safe fields, empty/non-empty checklist transitions, row durations/order/time recomputation, linked experiment/task/material add-edit-delete-ready workflows and readback, material/task consistency, planned vs actual, past-card revision and permissions tests, historical audit integrity, rollback. Negative tests: invalid token, wrong team, revoked member, missing proficiency source, forged requirement IDs, race/stale revision, replay, malicious source text and nested PII.
- Staging first with synthetic fixtures and independent CTO review at immutable SHA, then exact deploy and authenticated live `initialize`, `tools/list`, `tools/call`, readback, security audit and rollback plan. Never claim shipped based on wiki write or CI alone.
- Existing task alignment: `KOMAA-1003` live knowledge Worker, `KOMAA-1108` PII safety, `KOMAA-1120` DB domain model, `KOMAA-1125` safe MCP read tools. Reconcile these issues and existing Core Product activity-card / skill workflows rather than duplicating tasks. Respect correct DAG relationships, independent reviewer, parent/self watchdog; architecture updates alone do not waive implementation prerequisites.

## 8. Remaining precision work before coding

1. Inspect CURRENT Supabase schema and actual panel Card fields, generate audited field-to-tool parity matrix to verify complete coverage; treat target wiki card map as starting reference.
2. Verify official RR catalog API/schema, requirement identifier granularity, planned versus actual group tracking. Disambiguate edits of app-owned status/notes from forbidden rewriting official published requirement text.
3. Resolve role × action matrix, historical report correction semantics, and referential soft delete behavior for used proficiency/requirement/milestone/activity records.
4. Confirm exact existing app completion UI behavior for manual checklist tick and auto-check/auto-uncheck from text content; implement identical semantics server-side so MCP and panel never diverge.
5. Only after owner/security approval, implement and test narrow tools against real backend and live auth. Do not assume these proposed names are currently available.


## Optional Google Calendar integration — activity lifecycle parity (TARGET 2026-10-21)

The app may connect a user's Google account to create a distinct editable secondary calendar named **Żar i Szlif**. Every activity-created event maps to the **same** canonical Supabase activity ID and is updated through the existing `manage_activity` mutation and `get_activity` / `list_activities` read contracts; no duplicate `manage_google_event` MCP tool or second event SSOT. A separate backend adapter performs idempotent outbound changes and authorized, conflict-safe inbound updates from the dedicated Google calendar. Google OAuth tokens and calendar-private data never enter product MCP tool input/output; the panel handles optional consent and connection lifecycle independently of product MCP Google sign-in. Full TARGET specification: [[wiki/concepts/google-calendar-integration]]. Not deployed or approved; do not count as an additional live MCP tool.
