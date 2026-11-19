---
title: Product MCP — Supabase PII encryption and zero-disclosure contract
type: concept
tags: [privacy, security, supabase, encryption, mcp, pii, gdpr]
updated: 2026-10-20
status: PLANNED_NOT_IMPLEMENTED
owner: CTO
implementers: [Engineer, MCP Engineer]
reviewer: CTO
---

# Supabase user identity privacy: encrypt at rest and NEVER disclose to ChatGPT/Claude product MCP

> **Decision 2026-10-20:** The Żar i Szlif product MCP must never expose users' email addresses, surnames or given names, whether plaintext, encoded, decrypted, partially masked, or recoverable through tool composition. Encrypt application-owned personally identifying profile fields in Supabase and enforce a separate **zero-PII MCP output boundary**. This is a required architecture and release gate, **not an implemented security claim**.

## Scope / trust boundaries

- Applies to Żar i Szlif user-facing product MCP, currently `app/mcp-worker/**`, product data accesses, tools, OAuth session projections and shared knowledge retrieval `app/plugin/knowledge/**` in `miloszspyrka-code/zar-i-szlif`. Supabase/Postgres remains domain source of truth; Qdrant is a derived index. Do NOT change Paperclip administration MCP or legacy Workers by implication.
- Protected: email, first name, last name/full name, display/recipient names when identifying a person; nested profile objects, contact lists, member/admin export records, invite/notification addresses, calendar participant names/emails, tool arguments, errors, logs, telemetry, embeddings, citations and searchable metadata. Apply data classification to new identity fields by default.
- Customer web/mobile application may display identity via its **separate, authenticated, purpose-restricted backend** to the rightful authorized user. **Product MCP/ChatGPT/Claude is an explicitly untrusted-to-PII channel**: it receives only opaque non-reversible subject IDs and minimal non-identity business data, after server-side authorization.
- Never offer MCP a generic SQL/REST proxy, user/profile database search, arbitrary column selection, admin/service-role client, decryption RPC, free-form user enumeration or unrestricted fetch. Allowlisted MCP tools may resolve identities internally for authorization but must drop PII before their return value, errors, snippets and resources leave the trust boundary.
- Supabase Auth `auth.users.email` is a managed credential/login identifier. Do **not** attempt to rewrite/encrypt that managed column (would break authentication). Restrict its database access; never expose it through product MCP. Encrypt application-owned copies of email separately. The application must document this residual Supabase Auth plaintext dependency and validate login, recovery and email-change workflows. No blanket claim that every email stored anywhere in Supabase is encrypted.

## Minimum cryptographic design

1. Inspect the ACTUAL production schema via authorized non-PII schema introspection before migrations. Inventory `public` app profiles, team memberships, joins, exports, triggers, Supabase Auth mirrors, views, functions and existing RLS. No assumptions about column names.
2. Encrypt app-owned identity fields **before persistence** in a trusted app backend using vetted authenticated encryption (AES-256-GCM or XChaCha20-Poly1305), cryptographically fresh unique nonce per value, explicit `key_version`, and AAD including tenant/user/field/schema context. Never invent crypto primitives or store encryption keys in Supabase tables, Cloudflare KV, Git, issues or wiki. Use a dedicated KMS/secure secret manager outside the database with narrow decrypt grants to the app identity service, *not* to product MCP runtime. Plan managed rotation/re-encryption.
3. Preserve existing stable random user UUIDs. For exact-case-insensitive email uniqueness/lookup, use a separately keyed HMAC-SHA-256 **blind index** (canonicalization policy explicit, secret distinct from data encryption key); do not hash raw email with unsalted SHA or put identity fragments in indexes, JWT metadata, URLs or analytics. Scope index to tenant only when product semantics permit; confirm global email login uniqueness separately.
4. Database grants, RLS, separate `private` encrypted columns/tables and app-facing security-definer functions must follow least privilege. Validate all SECURITY DEFINER `search_path` and caller checks. RLS alone is not enough when service-role privileges bypass it.
5. Non-MCP application decryption is explicitly authorized, auditable, minimally scoped and only returns identity where product UX requires it. Product MCP bindings do **not** receive decrypt key, decryption endpoint/service binding, raw profile table grants, or a service-role credential with alternate PII reachability.

## MCP response isolation (independent of database encryption)

- Enforce a dedicated **PII-free response DTO/schema** per MCP tool, resource, prompt, OAuth identity projection and data-layer query. Explicit field allowlists beat regex-only redaction; prohibit names, emails and raw profile JSON. Treat unknown fields as denied. Filter nested arrays, metadata, Qdrant documents and source citations, not only top-level JSON. Tool descriptions may mention the policy but cannot replace code enforcement.
- `search_knowledge`, `get_knowledge_source`, `search`, `fetch` and all future tools must enforce tenant/team access from verified server-side identity, with no user-supplied impersonation scope. Knowledge documents, ingestion pipelines, snapshots and embeddings must be PII-classified **before** indexing. Remove and reindex previously ingested PII if found, including snippets/citations.
- No raw email/first/last names in user-facing MCP tool responses, MCP protocol errors, tool schemas/examples, response resources, completion messages, structured logs, exception traces, outbound analytics or Langfuse traces. Scrub pre-existing telemetry/cache with a documented retention/remediation plan; do not send plaintext to an LLM and then attempt to redact it.
- Access-token/OAuth subject mappings remain server-side. An opaque UUID may be returned only if essential, privacy reviewed, non-guessable as used, and never paired with reversibility metadata. Do not leak Google profile claims such as `email`, `name`, `given_name`, `family_name`, picture metadata or account display name in MCP.

## Migration / delivery sequencing

A. **Inventory and threat model** (Engineer + CTO): actual schema, Auth exceptions, API access graph, all existing tool outputs, Qdrant/caches/log destinations, backup/export exposure, PII data flow diagram.
B. **Trusted app encryption + migration** (Engineer): versioned cipher envelope, KMS grants and blind index; additive schema migration, rollback strategy, staged dual-read when necessary, idempotent chunked historic backfill and readback; validate registration, OAuth, email changes, deduplication, account deletion, role management and application UI. Restrict plaintext legacy columns and safely remove only after reconciliation. For historical backups/retention and irrecoverable old traces, document real limitations.
C. **Product MCP deny-by-default contract** (MCP Engineer): explicit safe projections, no decrypt route/binding, tenant isolation, Qdrant ingestion/metadata sanitization, negative tests of all public tools and token claims. Keep MCP endpoints functional for non-sensitive tasks.
D. **Independent security/E2E validation** (CTO; separate from implementers): seeded synthetic user test fixtures, normal authorized app experience, denied MCP identity queries (direct, indirect, nested, pagination, errors, tool chaining), cross-tenant/role isolation, unauthorized/expired token 401/403, search/fetch/source metadata, prompt-injection attempts, log/trace/artifact inspection, key isolation and backups. Record tested commit SHA, build/Worker digest and readable redacted evidence.
E. **Controlled rollout** (CTO): backup and restoration drill, canary, migration lock/roll-forward controls, monitor for output leakage, rollback compatible with encrypted writes, independent review and release gate. Never call it LIVE_VERIFIED based on mocks or CI alone.

## Non-negotiable acceptance

- **Zero plaintext first name, surname or email in any product MCP tools/call result**, resource, error, Qdrant excerpt or observational artifact for controlled synthetic identities; explicit deny tests for direct and indirect attacks; permit legitimate non-PII tasks.
- **Zero product MCP capability to decrypt or select raw profile identities** even when a tool is misused, arguments are forged, identity switches, or a nested field is introduced. Negative permissions tests confirm the denial is enforced by the backend, not by prompt instructions.
- Application-owned PII ciphertext at rest; unique nonce, AEAD tag, correct tenant/user AAD, key rotation + key loss/recovery design; verified indexed lookups and sign-in semantics. **Supabase Auth managed email exception documented and protected**.
- Migration historic row count, reconciliation, rollback, RLS/permissions and audit retention proven on real schema; no real PII placed in issues, wiki, tests or shared LLM context.
- CTO independently verifies immutable candidate SHA and redacted artifacts before release. Failure keeps release blocked. No approval bypass, no fake done states.

## Linked authoritative architecture

- [[wiki/concepts/product-mcp-cloudflare-worker]] — deployed code ownership/runbook and `app/mcp-worker` topology.
- [[wiki/sources/integracje-mcp]] — Supabase SSOT and integration contracts.
- [[wiki/agents/mcp-engineer/AGENTS]] — product MCP Engineer path boundaries and role.
- Product repository: `miloszspyrka-code/zar-i-szlif`.
- Implementation DAG: see Paperclip project **Integrations & Data**, issue root created for this policy; root ID to be linked once created.

## Delivery tracking

- Canonical root: [KOMAA-1108](https://paperclip.kompaszbiorek.pl/KOMAA/issues/KOMAA-1108) (COO coordinator, Harness watchdog; CTO independent final reviewer).
- P1: KOMAA-1110 — live schema + exposure inventory (Engineer).
- P2: KOMAA-1111 — application-owned Supabase encryption, safe migration (Engineer), blocked by P1.
- P3: KOMAA-1113 — deny-by-default PII-free product MCP contract (MCP Engineer), blocked by P2.
- P4: KOMAA-1114 — independent negative E2E (CTO), blocked by P3.
- P5: KOMAA-1115 — controlled production release + verification (CTO), blocked by P4.
- State: **PLANNED, NOT IMPLEMENTED** as of 2026-10-20. Paperclip native parent, dependency and watchdog configurations must be inspected before declaring orchestration ready.
