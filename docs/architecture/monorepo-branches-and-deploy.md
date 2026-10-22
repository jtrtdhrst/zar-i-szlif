# One-repository MCP architecture, branch governance and Coolify paths

**Owner decision 2026-10-22 overrides all earlier two-repository/owner-Harness instructions.** The only repository is `miloszspyrka-code/zar-i-szlif`. `main` is the **single integration and deploy branch**; do not create additional long-lived `main` branches for services. A feature/agent branch targets `main` with a PR, and is integrated **only after independent approved review, passing CI and recorded Paperclip release decision**. Do not auto-merge because a task is `in_review` or an agent run finished. Model configurations must never change without express user request.

## Canonical path map

```
app/
  web/               # PRODUCT APP frontend sources (existing)
  website/           # independent PRODUCT PUBLIC WEBSITE (candidate from KOMAA-1174)
  mcp-worker/        # PRODUCT MCP OAuth/knowledge worker (Cloudflare CURRENT)
  cloudflare-worker/ # legacy/product API integration separate from product MCP
  plugin/            # shared legacy product MCP/client knowledge; migrate safely
mcp/
  mantic/            # Mantic/Mautic MCP
  qdrant/            # standalone Qdrant MCP (source incomplete)
  penpot/            # Penpot MCP (source incomplete)
  plasmic/           # Plasmic/WAB MCP (ops/design-stack baseline + branch snapshots)
  supabase/          # host Supabase MCP (source incomplete, NOT product DB schema)
  ubuntu/            # Ubuntu host MCP (source incomplete)
  opencode/          # owned OpenCode MCP bridge
  paperclip/         # owned Paperclip MCP gateway/bridge
  opendesign/        # legacy OpenDesign bridge snapshot
supabase/            # PRODUCT schema/migrations, no standalone host connector
ops/coolify/         # deployment target manifest, existing frontend Dockerfile
```

### Raw branch resolution (do not merge conflicts by overwriting)
- Mantic: `KOMAA-1102` -> `mcp/mantic/**` 34 blobs; source branch remains.
- Plasmic baseline: source `main:ops/design-stack/**` -> `mcp/plasmic/**` 53 blobs. Competing snapshots `KOMAA-1084` and `KOMAA-1174` are isolated under `mcp/plasmic/_branches/<branch>/**` (57 and 51 blobs). Review and reconcile the 412 WAB fix and projects tools before promoting them into active `mcp/plasmic/**`.
- Qdrant standalone: only `KOMAA-411:scripts/mcp-qdrant-verify.mjs` currently staged as a verification snapshot. Product OAuth/RAG/Qdrant code from PR #69 remains `app/mcp-worker/**`.
- OpenCode: `main:dev/integrations/opencode-mcp/**` -> `mcp/opencode/**` and `KOMAA-168` -> `mcp/opencode/_branches/KOMAA-168/**` (old variant).
- Paperclip: `main:dev/integrations/paperclip-mcp/**` -> `mcp/paperclip/**`.
- OpenDesign: legacy source snapshot under `mcp/opendesign/_branches/main/**`; source branch `feat/opendesign-brand-mcp` still needs dedicated reconcile.
- Public website: `KOMAA-1174:content/marketing/landing-zar-i-szlif-website.html` -> `app/website/index.html` plus SVG assets. This is a **candidate**, not approved visual production.
- Product database, app UI, product MCP and mascot branches **must not** be folded into the host `mcp/**` tree. Full remote branch inventory with original SHA is in `docs/architecture/branch-inventory-20261022.json`.

The source copies are additive; original paths and all original Git refs remain. Do not delete legacy code from the running app until the independent Coolify release for its replacement is verified. Do not directly deploy historical `_branches` snapshots; they are reconciliation inputs and may conflict.

## Paperclip agent / PR review contract

1. COO classifies scope and creates accurate task DAG/dependencies; every issue retains its mandatory native watchdog (parent agent where present, otherwise its own owner). Parent/child is not itself a blocking edge; only true prerequisite issue relations block.
2. Engineers change **only their domain** on an issue branch: product app `app/web/**`, website `app/website/**`, customer MCP `app/mcp-worker/**`, integrations `mcp/<service>/**`. Nonowner changes need explicit cross-service dependency and reviewer. Harness owns runtime bridges and host deploy; MCP Engineer implements scoped service code; CTO reviews exact SHA; COO owns dispatch.
3. One candidate SHA per PR, tests specific to changed paths, negative authentication/security tests where required; no independent review by author. If any commit changes after review, re-review that SHA.
4. Authorized CTO (or independent designated reviewer) approves; only then merge PR to `main`; production only from exact immutable approved main SHA. No fast-forward of old 82 branch heads, no forced merges, no rewritten history or branch deletion until unique changes reconciled.
5. A merge is NOT a deployment: each Coolify app has its own base-directory/build-context/Dockerfile, scoped trigger and secret config, plus health and released SHA/image digest; failed build must leave previous version running. Service may be declared production-ready only after authenticated MCP `initialize` and `tools/list` and safe canaries.
6. GitHub branch protections/rulesets **must** require CI and independent review to enforce this beyond Paperclip. The connected GitHub App lacks administration, so the branch protection is **not verified configured**; no claim of automatic enforcement.

## Exact Coolify source locations

All applications select **the same repository** and **the same approved `main`**. Each app is a separate Coolify service. Table below is the intended configuration, not a claim all services are deployed:

| Coolify application | Base directory | Dockerfile | Build context | Runtime | Status |
|---|---|---|---|---|---|
| PRODUCT APP | `/` | `ops/coolify/Dockerfile` | `/` | nginx :80 serves `app/web/dist` | Dockerfile exists |
| PRODUCT WEBSITE | `/` | `app/website/Dockerfile` | `/` | nginx :80 serves `app/website/index.html` | new candidate |
| PRODUCT MCP | `/app/mcp-worker` (source only) | **none** for Coolify | **none** | currently Cloudflare Worker using OAuth/KV/Workers AI | NOT Coolify-ready; requires deliberate runtime port with tests |
| OWN MANTIC MCP | `/mcp/mantic` | `Dockerfile` | `/mcp/mantic` | MCP server per pinned manifest, inspect port | candidate import; needs test |
| OWN PLASMIC MCP | `/mcp/plasmic` | `Dockerfile.mcp` | `/mcp/plasmic` | MCP HTTP :8091 per existing compose | candidate import; WAB and split bridge must be validated |
| OWN QDRANT, PENPOT, SUPABASE, UBUNTU MCP | `/mcp/<service>` | **pending actual source** | **pending** | no verified image/runtime | NOT deployable from current source |
| OWN OPENCODE/PAPERCLIP/OPENDESIGN MCP | `/mcp/<service>` | **pending standalone runner** | **pending** | host bridge; no verified target | source staged, NOT proven deployable |

Coolify source tree differs from its `Base directory` for PRODUCT APP and WEBSITE because the Dockerfile must COPY files from both root/workspaces. Avoid a root-wide wildcard webhook triggering all apps; configure **service-specific watched paths** from `ops/coolify/targets.json` or CI service-specific release promotion. Coolify per-service path filtering must be confirmed in the live panel; repository contents do not prove it is enabled.

**Product MCP warning:** current `app/mcp-worker/src/index.ts` imports Cloudflare `@cloudflare/workers-oauth-provider` and requires Cloudflare KV and Workers AI; it cannot be safely rebranded as a Coolify container simply by choosing a root directory. Do not use `wrangler dev` for production. Keep current Cloudflare deployment live until a separate authenticated, staging-proven Coolify adapter with equivalent security exists.

## Acceptance and rollout

PR > native Paperclip CTO review > approved merge to main > path-scoped Coolify service build > runtime health/tools/readback > rollback evidence. For each service: `commit SHA`, source path, Dockerfile, image digest, port and domain, health verification and safe negative tests must all be recorded. Missing source is **not done**.

Previous incompatible PRs #71 and #73 required a separate private owner-Harness repository and blocked new `mcp/**` paths. Those policies are now superseded by this owner monorepo decision and must not be merged. The code in this segmentation PR is quarantined until independent approval.
