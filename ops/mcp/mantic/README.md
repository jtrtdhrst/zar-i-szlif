# Mantic MCP — vendored source mirror + email-create write-contract patch

**Issue:** KOMAA-1102 (P0) · **Parent:** KOMAA-1082 (Harness) · **Consumer:** KOMAA-774 (Lifecycle Ops)
**DOC_IMPACT=YES** · No production email sends, no campaign activation, no campaign/segment/contact mutation.

## 1. Provenance

| Item | Value |
| --- | --- |
| Upstream | `https://github.com/Cbrown35/mantic-MCP` (public, third-party) |
| Pinned upstream commit | `12c233368a7498f5dded87905af5b102d38d6196` (`main`, "Upgrade to Mautic 7 with dual API support…") |
| Pinned file | `PINNED_UPSTREAM_COMMIT` |
| Why vendored | The upstream GitHub connection is **pull-only** (`permissions.push=false`). We cannot and do not push upstream, so the patch lives in our own repository as a pinned mirror. |
| Vendored tree | `src/` (upstream, unmodified except §2), `package.json`, `package-lock.json` (pristine), `tsconfig.json`, `.env.example`, `.gitignore` |
| Package identity | `mantic.dzind` / bin `mantic.dzind` kept **unchanged** so the host-side container command keeps working |

The mirror is a copy, not a submodule: the deployment host must not depend on
network access to GitHub at build time, and the patch has to be reviewable in
one diff against the pinned upstream commit.

## 2. The defect and the patch

### Root cause (proved from source, KOMAA-1082)

1. Upstream `src/tools/emails.ts` forwarded tool arguments **verbatim**:
   `client.v1.post('/emails/new', args)`.
2. Mautic 7 binds `isPublished` as `YesNoButtonGroupType` → `ChoiceType` with int
   choices `0`/`1`.
3. Mautic 7.x pins `symfony/* ~7.4.0`; `ChoiceToValueTransformer::reverseTransform()`
   throws `TransformationFailedException('Expected a string or null.')` for **any
   non-string** value.
4. `CommonApiController::processForm()` calls `$form->submit(...)` **without a
   try/catch**, so the exception escapes to the Mautic error handler and becomes
   **HTTP 500** (`mautic.core.error.generic`, "Looks like I encountered an error
   (error #500)") instead of a 400 validation error.

⇒ **Wire contract: `isPublished` must be the STRING `"0"` (draft) / `"1"` (published).**
A JSON boolean was the only non-string value in the failing payload.

Observed failure: invocation `9c61301d-b431-4acc-b90f-1d5909d098a0`,
`list_emails=0` afterwards.

### What changed

New file `src/tools/mautic-contract.ts` — the API-boundary contract:

* `normalizeIsPublished(value)` — `true → "1"`, `false → "0"`, **missing → `"0"`**
  (a create never publishes silently). A non-boolean (e.g. `"0"`, `1`) is
  rejected with a typed error before any provider call.
* `buildEmailCreatePayload(args)` — allowlist validation of the supported Mautic 7
  form fields (`name`, `subject`, `fromAddress`, `fromName`, `replyToAddress`,
  `customHtml`, `plainText`, `emailType`, `isPublished`). Unknown fields (e.g.
  `recipients`, `campaign`, `segmentId`) are rejected: upstream forwarded them
  verbatim, which let an audience field leak into a template write.
  `emailType` is enum-validated (`template` | `list`) and defaults to `template`.
  `name`/`subject` must be non-empty strings. **Raw HTML, plain text and Mautic
  personalization tokens are forwarded byte-for-byte** — never trimmed, rewritten
  or escaped.
* `findEmailsByExactName(client, name)` — exact-name lookup (paginated) used for
  the idempotent create and for reconciling an ambiguous provider failure.
* `MauticContractError` — typed MCP error (`ErrorCode.InvalidParams` /
  `InvalidRequest` / `InternalError`) with `contractCode` and `field`.

Patched `src/tools/emails.ts` — `create_email_template`:

1. Validate + normalize **before** the provider call (bad input never reaches Mautic).
2. **Idempotent create**: if an email with the exact same name exists, return it and
   write nothing (no duplicate template).
3. `POST /emails/new` with the normalized payload.
4. On a 5xx: reconcile by exact name. If the template exists → report the
   reconciled existing template (no second write). If it does not exist → raise a
   typed `mautic_server_error` that states nothing was created and that a blind
   retry is not allowed.

The **MCP schema is unchanged for callers**: `isPublished` stays `{ type: 'boolean' }`,
`required: ['name', 'subject']`, `emailType` stays `['template', 'list']`.
The conversion happens at the API boundary only.

### RED / GREEN control

Pristine upstream (`12c2333`), same input:

```json
{ "name": "MCP CANARY — TEST", "subject": "TEST", "emailType": "template",
  "isPublished": false, "customHtml": "<p>{{contact.email}}</p>",
  "recipients": "leak@example.com" }
```

→ `isPublished` is a **boolean** (the 500), and `recipients` is forwarded.

Patched build, same input:

```json
{ "name": "MCP CANARY — TEST", "subject": "TEST", "emailType": "template",
  "isPublished": "0", "customHtml": "<p>{{contact.email}}</p>" }
```

→ `isPublished` is the **string** `"0"`, `recipients` is rejected with
`unsupported_field` before the POST.

## 3. Build, test, verify

```bash
cd ops/mcp/mantic
npm ci --include=dev     # devDependencies are required for the TypeScript build
npm run build            # tsc -> build/
npm test                 # node --test "test/**/*.test.mjs"
npm run verify           # build + test
```

`npm ci` must be run with `--include=dev` when the environment sets
`NODE_ENV=production` / `npm config omit=dev`; otherwise `typescript` and
`@types/node` are missing and `tsc` fails with `TS2580: Cannot find name 'process'`.

### Test suites

* `test/mautic-email-contract.test.mjs` — 16 contract tests against a fake
  `MauticApiClient` that captures the wire body: string `"0"`/`"1"`, draft default,
  verbatim HTML/plain text/tokens, `emailType` enum, and the negative cases
  (bad `emailType`, non-boolean `isPublished`, unsupported fields, missing/empty
  `name`/`subject`) — each asserted to fail **before** the provider POST. Plus the
  500 surfacing, the ambiguous-500 reconciliation and the idempotent-create cases.
* `test/tools-list.test.mjs` — starts the real built server over stdio (MCP
  `initialize` + `tools/list`) and asserts the published schema and the tool
  surface (`create_email_template`, `list_emails`, `get_email`, `create_tag`,
  `add_contact_tags`, `create_campaign_with_automation`, `list_tags`,
  `list_segments`, `list_campaigns`).

Last run: **17 tests, 17 pass, 0 fail** (contract 16 + MCP readback 1).

## 4. Container image

```bash
cd ops/mcp/mantic
docker build -t mantic-mcp:komaa-1102 .
docker image inspect mantic-mcp:komaa-1102 --format '{{index .RepoDigests 0}}'
```

The base image is pinned (`node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`).
The image contains the patched stdio server at `/app/build/index.js`.

The HTTP wrapper that fronts the server on the host (`mantic-mcp-http:latest`) is
**host-owned packaging** and is not reproduced here: the upstream source speaks
MCP over stdio, so the wrapper is a host-side artifact whose source lives in the
deployment directory that the agent host lane cannot read.

## 5. Deployment (host-owner lane)

Current running images on the VPS host (readback `host.images`,
2026-10-20T16:38:01Z):

| Image | Image ID | Size |
| --- | --- | --- |
| `mantic-mcp-http:latest` | `8dca325d92b3` | 289 MB |
| `mantic-mcp:latest` | `00fe114aacd6` | 224 MB |

Containers (readback `host.ps`): `mantic-mcp-http`, `mantic-mcp`, `mautic-web`,
`mautic-worker`, `mautic-cron`, `mautic-db-1`.

**Agent-access boundary (verified, not assumed):**

* `host.container_inspect` on `mantic-mcp-http` → `POLICY_DENIED`,
  `errorCode=not_allowlisted`, `remediationOwner=owner`
  ("Request a CTO-owned policy pin for this target; do not bypass the supervisor").
  The allowlist is `paperclip, paperclip-db, paperclip-mcp-tunnel,
  emailens-mcp-bridge, playwright-mcp, discord-mcp, opencode, paperclip-healthwatch`.
* `host.container_build` / `host.service_start` / `host.service_restart` /
  `host.container.recreate` have **no supervisor lane** in policy v3.8
  (`failClosedNoLane`) or an **empty production allowlist** → fail closed.

⇒ The build+recreate of the Mantic MCP service is a **host-owner (CTO/Harness)
operation**, not an agent operation. The exact required operation is recorded on
KOMAA-1102. Do not bypass the supervisor, do not reuse another credential, do not
touch Paperclip/OpenCode Core.

### Rollback

* Keep the previous image IDs (`8dca325d92b3`, `00fe114aacd6`) — rollback is
  re-pointing the container at the previous image tag, not a rebuild.
* Rollback of a created TEST template is deleting that email ID in Mautic.
* This patch changes only the request payload and the error surface of
  `create_email_template`; no other tool, schema or provider behaviour changes.

## 6. Live canary procedure (only after an effective service + scoped write grant)

1. `list_emails` — confirm no duplicate TEST template with the exact name.
2. Call `create_email_template` **once** with:
   * `name`: `MCP CANARY — Żar i Szlif — NIE WYSYŁAĆ`
   * `subject`: `[TEST — NIE WYSYŁAĆ] Żar i Szlif`
   * `emailType`: `template`
   * `isPublished`: `false`
   * inert TEST-only `customHtml` / `plainText` (no recipients, no sender, no campaign)
3. Readback with `list_emails` / `get_email`: real unique ID, `isPublished=false`,
   `emailType=template`, exact HTML and tokens.
4. Read-only checks: `list_tags`, `list_segments`, `list_campaigns`.
5. Negative checks: `send_email`, `send_email_to_segment`, mass audience and
   production campaign stay denied. No real end-user contact data is mutated.

## 7. Known limits / out of scope

* **Dependency audit (open).** The pristine upstream lockfile reports
  `npm audit --omit=dev` → 14 vulnerabilities (1 low, 3 moderate, 8 high, 2 critical;
  `proxy-addr` critical, `path-to-regexp` high, `qs` moderate). Upgrading the
  dependency tree is a separate, explicitly authorized change — this patch keeps
  the upstream lockfile **pristine** (no dirty lockfile push).
* **Upstream fix.** The clean long-term fix is upstream mapping `isPublished` →
  `"0"`/`"1"`. This mirror carries the same behaviour until upstream lands it;
  re-pin `PINNED_UPSTREAM_COMMIT` when it does.
* This artifact does **not** authorize a production send. Lifecycle (KOMAA-774)
  stays blocked on KOMAA-790 (Supabase registration/outbox) and KOMAA-789 (creative).
