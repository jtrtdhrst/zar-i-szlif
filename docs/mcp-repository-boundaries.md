# MCP repository boundary (owner directive, 2026-10-22)

There must be **two independent physical GitHub repositories**, not two branches of the same repository.

- **PRODUCT:** `miloszspyrka-code/zar-i-szlif`; the customer-facing product MCP and OAuth Worker live in `app/mcp-worker/**` and deploy independently.
- **OWNER HARNESS (private):** separate, verified owner-controlled repository; all self-hosted integration MCP sources, Paperclip gateway/supervisor and host bridges live here.

## Canonical owner-Harness service roots

| Previously used name | New owner-Harness path |
|---|---|
| `mantic-mcp-http` | `mcp/mantic/` |
| `mcp-qdrant` | `mcp/qdrant/` |
| `penpot/mcp` | `mcp/penpot/` |
| `plasmic-mcp` | `mcp/plasmic/` |
| `Supabase MCP` | `mcp/supabase/` |
| `Ubuntu MCP` | `mcp/ubuntu/` |

Host-owned gateway/supervisor and other MCP integrations should use separate sibling roots, for example `mcp/paperclip/` and `mcp/opencode/`. A service's transport (such as HTTP) belongs in its manifest/README, not in an inconsistent directory name.

## Required delivery contract

1. Inventory original revisions and dirty worktrees, and preserve clean, recoverable backups before moving.
2. Verify git remote, realpath, service source root and active VPS container/service before any mutation. Reject wrong repo/root before commit, build or deploy.
3. Migrate actual code (no empty placeholder trees), tests, pinned dependencies, container/service definitions, and non-secret env examples into the corresponding root.
4. Run per-service CI on touched paths only, with independent reviewer, pinned commit SHA and reproducible artifact digest.
5. Deploy to the **real VPS unit** with an authorized host operation, backup/rollback, and authenticated MCP initialize/tools/list readback. A GitHub commit or green CI alone is not evidence of a live deploy.
6. Never modify Paperclip/OpenCode Core or agent model assignments as part of this migration.

The product repository's `MCP repository boundary` check rejects modifications to known host-only MCP paths, while allowing deletions of old copies as part of the clean split. This guard does not itself create, provision or deploy the private Harness repository. Its check should be required by branch protection to prevent bypasses.
