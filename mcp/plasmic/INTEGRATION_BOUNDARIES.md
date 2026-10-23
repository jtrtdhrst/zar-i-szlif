# Plasmic MCP integration boundaries (WAB master, 2026-10-23)

This adapter operates against the **self-hosted Plasmic WAB REST API**. It does not modify Plasmic Core, the application's product code, or AI model assignments.

## Ownership — no duplicate GitHub tools

| Action | Owner |
| --- | --- |
| List/edit Plasmic projects and design branches | Plasmic MCP over WAB REST |
| Read/write design revisions and inspect merge conflicts | Plasmic MCP |
| Preview a design-branch merge | Plasmic MCP (`pretend:true` only) |
| Commit a reviewed design merge or publish Plasmic version | A separate explicitly approved workflow; **not** GitHub branch merge |
| Run `plasmic sync` / codegen into working directory | CI / isolated runner with Plasmic CLI pinned and checked against the self-hosted WAB instance |
| Create Git branches/commits/PRs, review checks and merge PRs | **GitHub MCP**, not Plasmic MCP |
| Publish application code after codegen PR merge | Existing protected GitHub CI/CD, not Plasmic MCP |
| Edge authentication/routing | Cloudflare Worker; no Plasmic business logic in Worker |
| Mail HTML export, lint and Mautic deployment | Separate orchestrated pipeline using Emailens/Mautic with approval gate |

Official WAB REST source in `plasmicapp/plasmic`:
- `platform/wab/src/wab/server/AppServer.ts`: /api/v1/projects/:projectId/branches, /merge, /publish, /revisions.
- `platform/wab/src/wab/server/routes/projects.ts`: listBranchesForProject, createBranch, tryMergeBranch (pretend preview), saveProjectRev and publishProject.
- `platform/wab/src/wab/shared/ApiSchema.ts`: CreateBranchRequest, TryMergeRequest, PublishProjectRequest.
- CLI codegen: https://docs.plasmic.app/learn/codegen-guide/ and https://docs.plasmic.app/learn/cli/
- Browser-side design editing: https://docs.plasmic.app/learn/plasmic-mcp/

## Production gates

1. Never mutate the main design branch without a live reviewer and an approved Plasmic project revision.
2. Do not put GitHub credentials in Plasmic MCP, WAB environment variables, or Cloudflare edge secrets.
3. Lock and dry-run a prospective WAB write; then write, read back the new revision on the **same design branch**, and validate changed entries.
4. Any "WRITE_READBACK_UNVERIFIED" error may mean the write committed: inspect latest revision before retrying.
5. Isolate idempotency and change tracking by project **and design branch**. A PR must contain only MCP adapter changes; main merge requires review and CI.
6. The configured `PLASMIC_MODEL_SCHEMA_HASH` must match the running WAB version; determine it from that instance after upgrades, rather than assuming a checked-in default.
7. Check Plasmic auth/CSRF and response code paths against the installed WAB version. `/health` at the Cloudflare Worker alone is **not** an end-to-end test.
8. Acceptance gate: unauthorized HTTP 401, MCP initialize, tools/list, read-only WAB API, a disposable branch create/readback, a disposable component write/readback/rollback, codegen into a disposable GitHub branch, CI and reviewer approval; no writes to production design without approval.

## Test status

`tests/plasmic-wab-contract.test.ts` tests mocked WAB REST route contracts and mutation readback. It **does not** prove current VPS runtime availability, real WAB schema compatibility, application codegen or browser canvas behavior. Verify live E2E separately before production release.
