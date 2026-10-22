# Owner MCP mono-repository services

All service code stays in `miloszspyrka-code/zar-i-szlif`. Each `mcp/<service>/` is independently owned, tested and deployed after CTO review; `_branches/` are raw source snapshots for later AI reconciliation and must NOT be executed or deployed. Product OAuth MCP lives separately in `app/mcp-worker/`. See `docs/architecture/monorepo-branches-and-deploy.md` and `ops/coolify/targets.json`. The presence of a directory does NOT imply a functioning Coolify service.
