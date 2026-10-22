# OpenCode MCP Upstream

## Source

- Repository: `https://github.com/AlaeddineMessadi/opencode-mcp`
- Pinned commit: `4e4db4cc48225ff3ced403e639436669fd28ae51`
- Version: `1.11.0`
- License: MIT, Alaeddine Messadi
- Surface verified from source/tests: 80 tools, 10 resources, 6 prompts.

## Local Adapter

`ctb-gateway.mjs` starts the upstream stdio server and forwards its MCP methods unchanged. It does not reimplement the OpenCode API. Local code only adds OAuth enforcement, deterministic tool classification, CTB context validation, project isolation, Paperclip correlation registry, audit records and CTB skill discovery.

## Local Patches

- None in the upstream submodule.
- `npm run build` has a POSIX-only `chmod` postbuild. On Windows use `npx tsc`; the compiled engine is identical.

## Sync Procedure

1. `git -C opencode-mcp/upstream fetch origin main`
2. Review `git -C opencode-mcp/upstream log --oneline HEAD..origin/main`
3. Check out the reviewed commit in the submodule.
4. Run `npm ci`, `npm test`, and `npx tsc` in `opencode-mcp/upstream`.
5. Run `node test-ctb-mcp.mjs` against the local CTB gateway.
6. Commit the updated submodule pointer with the adapter changes.
