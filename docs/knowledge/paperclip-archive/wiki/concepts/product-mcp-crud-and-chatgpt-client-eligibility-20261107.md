---
title: "Product MCP CRUD, ChatGPT client eligibility and free-user access — authoritative clarification"
type: concept
tags: [product-mcp, crud, chatgpt, client-eligibility, free-users, architecture, decision]
updated: 2026-11-07
status: ARCHITECTURE_DECISION_NOT_DEPLOYMENT_PROOF
owner: CTO / MCP Engineer / Engineer
---
# Product MCP CRUD and ChatGPT client eligibility — authoritative clarification (2026-11-07)

**Owner decision / correction.** NEVER interpret a ChatGPT subscription tier or a read-only *deployed tool manifest* as a prohibition on MCP write operations. The earlier categorical claim "Free/Plus/Pro users cannot write through MCP" is **not a protocol rule** and is invalid as a general product architecture statement. Conversely, do not promise that every ChatGPT Free account can install and invoke this project's custom MCP write tools. Both categorical claims are unsupported. Evaluate the actual ChatGPT client + plugin + account/workspace eligibility separately.

## Four independent boundaries (do not conflate)

1. **MCP protocol/tool/server:** MCP permits typed create/read/update/delete operations, subject to server-defined tools and permissions. No technical CRUD restriction is imposed by MCP itself. Tool method, annotations and the product backend decide what each operation does.
2. **Specific deployed Żar i Szlif product Worker:** The 2026-10-20 historical readback of `app/mcp-worker/**` describes four knowledge-only tools (`search_knowledge`, `get_knowledge_source`, `search`, `fetch`) and an OAuth fail-closed release. This documents *that deployed version's state*, not the final product, not an immutable restriction and not current production proof. Recheck the current deployed artifact, authorized `initialize`/`tools/list` and real calls before asserting the present state.
3. **Product target contract:** `wiki/concepts/product-mcp-tool-catalog-proposal.md` defines the proposed 17 logical product tools, including `manage_activity`, `manage_task`, `manage_material`, `manage_experiment` and other typed write/delete actions. **TARGET / not proof of deployed features.** The read-only staged API in `wiki/concepts/supabase-users-teams-tasks-mcp-contract.md` is an early privacy/release *phase*, not a product decision to ban write APIs forever.
4. **Client platform entitlement:** ChatGPT determines which external MCP plugins/connections/tools a particular user can install and call. OpenAI's documentation states that the plugin directory exists across plans but individual capabilities depend on plan/workspace/region/permissions; its custom full-MCP connection article lists Business and Enterprise/Edu workspace availability. Other already-connected tools may expose write operations on an individual's Plus account. A real Plus + Paperclip (administrative MCP) write experience is evidence for *that connection*, not blanket proof of all custom product MCPs or ChatGPT Free support. Do not present a universal plan matrix without a dated source AND per-plan executable validation.

**Relevant official documentation checked 2026-11-07:**
- https://developers.openai.com/api/docs/guides/custom-mcp-server (custom MCP tools include read and write)
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt (workspace availability/permissions)
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt (directory available across plans; individual eligibility varies)

## Product requirement: free access without compulsory ChatGPT subscription

Instructors must be able to **create, read, edit, delete/archive and verify** their authorized Żar i Szlif data **without purchasing any ChatGPT plan**. Implement the default user path as:

`Żar i Szlif app chat/UI -> AI orchestration/model (operator-hosted or paid by product operator) -> authenticated typed product-domain API/service -> Supabase/Postgres SSOT`.

Expose the **same domain operations** through a separate MCP adapter for ChatGPT/Claude/other supported clients, reusing authorization and business rules. A user's ability to use ChatGPT's own free plan must NOT be a prerequisite for the product's free CRUD. Product operation may have VPS, inference/API and other operator costs; "free to end user" does **not** mean zero infrastructure cost.

Do not make Hermes a mandatory dependency unless its live integration and cost/availability are established; any compliant model/runtime can invoke the typed tools. Do not duplicate a second CRUD data store or bypass canonical app rules.

### Security and semantics (both API and MCP)

- Authenticate the **actual end-user principal**, derive team and role on the server and authorize each object/action. Never accept caller-supplied actor/team IDs as sufficient proof; enforce RLS plus domain checks.
- Server-side allowlisted typed operations, bounded payloads, validation, expected revision/version, idempotency keys, retries and an audit trail. No generic SQL/REST mutation tool or unrestricted model credentials.
- For deletion, distinguish unlink, archive/soft delete and irreversible delete; require explicit user intent for destructive cascades; preserve historical attestations and provenance as defined by the product contract.
- Protect children's data and other PII using the existing zero-PII-to-model contract and safe DTOs. No identity leakage in model arguments, tool responses, logs or traces.
- Every successful mutation is verified by **persisted read-after-write**, not only HTTP 200 or assistant text.
- **Never disguise write/delete as a read-only MCP tool** to bypass client plan/policy restrictions.

## Acceptance and evidence (do not declare DONE on documentation alone)

**Product app / no ChatGPT paid plan:** with two synthetic members/teams and real authenticated sessions, test create -> readback -> update -> readback -> delete/archive -> absence/archival readback -> audit, including cross-team denial, revoked membership, unauthorized roles, invalid version, duplicate requests and PII exclusions. Verify app UI and database state. Capture deployment SHA, tool/API version, session role, timestamps, sanitized evidence and owner costs. This is the core free-access acceptance path.

**ChatGPT connector compatibility:** separately test real Free, Plus and any business/workspace account in an actual chat: install/connect eligible plugin, OAuth, tools/list, create/readback/update/readback/delete. Mark each test `SUPPORTED_VERIFIED`, `BLOCKED_BY_PLATFORM` or `UNTESTED` with date and evidence. If Free is blocked, document that as a **ChatGPT client access limitation**, never as an MCP protocol limitation or a reason to remove CRUD from the product.

**Status at writing:** This document corrects the capability/architecture distinction only; it does NOT certify deployed CRUD, ChatGPT Free plugin access, or production E2E.

## Supersession / backlinks

This clarification takes precedence over older unsourced statements treating user ChatGPT subscription, legacy read-only tool manifests or early security-scoped read APIs as an architectural ban on product CRUD. Preserve dated implementation observations and privacy gates in:
- `wiki/concepts/product-mcp-cloudflare-worker.md`
- `wiki/concepts/product-mcp-tool-catalog-proposal.md`
- `wiki/concepts/supabase-users-teams-tasks-mcp-contract.md`
- `wiki/sources/integracje-mcp.md`
