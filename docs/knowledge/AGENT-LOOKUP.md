# Repowise agent lookup contract

- Private endpoint: `http://repowise-mcp:7338/mcp` in the Coolify internal network; requires bearer authentication.
- First call `list_repos`, confirm distinct aliases `product` and `harness` and indexed commit SHA.
- Use `get_context`, `search_codebase`, `get_why` and `get_change_risk` for target code and decisions.
- Use `get_blast_radius` and `get_architecture` for multi-repo impact, but inspect evidence; generic route matches `/health` or OAuth discovery **do not prove** a dependency.
- Validate against actual GitHub, service configuration and Coolify readback; never assume an open PR is indexed `main`.
- Only trust historical Paperclip pages as provenance, not active Multica role instructions.
