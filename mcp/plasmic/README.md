# Plasmic MCP — canonical self-hosted adapter

The canonical source lives in `mcp/plasmic/**`. This adapter talks to the
self-hosted **Plasmic WAB REST API**, not GitHub. Repository branches, PRs and
CI checks belong to GitHub MCP.

## Servers

| Server | Command | Port | Function |
| --- | --- | --- | --- |
| Plasmic MCP | `node services/plasmic-mcp/server.ts` | 8091 | 21 agent-visible tools (projects, branches, design reading/editing, validation) |
| OpenDesign bridge MCP | `node services/opendesign-bridge-mcp/server.ts` | 8092 | OpenDesign brand/design sync |

The Plasmic tool catalog is asserted against a real **local stdio MCP server**
in `tests/plasmic-mcp-catalog.test.ts`, not a hardcoded production claim.

Branch creation **never** accepts WAB `base: "new"`, which could implicitly
publish a project. It uses `base: "latest"` and serializes/idempotently
deduplicates calls by project. Merge preview uses WAB `pretend: true` only;
the MCP tool **does not** commit a design merge.

## Local checks

From `mcp/plasmic`:

```bash
npm ci --include=dev
npm test
npm run typecheck
npm run lint
npm run preflight:source
```

The Dockerfile uses lockfile-only `npm ci --omit=dev --ignore-scripts`,
runs as the unprivileged `mcp` user, and exposes 8091/8092.

## Production release: fail closed on the known pipeline mismatch

```bash
npm run preflight:release
```

This checks the actual repository's GHCR workflow, canonical source path,
Dockerfile, `main` push gate and immutable Compose `IMAGE_TAG`. **At present
this command is expected to return RELEASE_BLOCKED**, because
`.github/workflows/opendesign-brand-mcp.yml` builds `ops/design-stack`
rather than `mcp/plasmic`. Do not mistake green root CI for a released MCP
image.

**Authorized release-lane migration** (requires the separate workflow/policy
owner; this PR intentionally does not edit `.github/**` or `ops/**`):

1. The production workflow's source trigger, test working directory,
   package-lock cache and Docker build context must all target
   `mcp/plasmic/**` (Dockerfile `mcp/plasmic/Dockerfile`).
2. Run `npm ci --include=dev`, `npm test`, `npm run typecheck`, `npm run lint`
   and `npm run preflight:release` before GHCR publication.
3. Publish a digest-verified image tagged by the **merge commit SHA on
   `main`**, not the feature-branch SHA; retain the previous deployed image.
4. On the host, only an authorized operator can update Compose
   `IMAGE_TAG=<verified-main-SHA>`, snapshot state, pull/recreate the service
   and confirm the resulting image digest. Cloudflare routing alone cannot
   deploy the container.
5. Run authenticated `initialize`/`tools/list` for all 21 tools, WAB API
   read and isolated disposable project/branch create/write/readback/rollback,
   plus an unauthorized 401 negative case. **WAB `branching:false` blocks
   a successful design-branch E2E test until resolved at the WAB owner.**
6. Roll back to the recorded previous image tag/digest if live health,
   authentication or tool list differs. Do not edit Plasmic Core or product
   code to fix the adapter.

The existing current GHCR pipeline and host deployment path are not modified
by this documentation. Production remains unverified until these gates pass.

See `INTEGRATION_BOUNDARIES.md` for GitHub MCP vs Plasmic MCP ownership.
