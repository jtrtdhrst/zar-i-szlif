# `mcp/comfyui/patches/` — durable custom-node + MCP patches

All patches are idempotent (safe to re-run). MCP `dist` patches apply at
`comfyui-mcp` image build time via `Dockerfile.mcp`; custom-node patches target
the persistent `comfy-custom` volume and are applied live + re-appliable via
`/opt/comfy/patches/apply.sh` after any volume restore.

| File | Target | What it fixes |
|---|---|---|
| `patch-v1.mjs` | comfy-mcp dist | `upload_image data_base64` (remote clients, SHA-256, magic check, 30 MB cap); `train_doctor` ready flags |
| `patch-validator-v2.mjs` + `patch-validator-v2b.mjs` | comfy-mcp dist | Validator dynamic-combo parity 1:1 with server: flat `"model": key` + `"model.<sub>"` required; nested dicts rejected as unexecutable |
| `patch-validator-v3.mjs` | comfy-mcp dist | Loader-combo subfolder refs (`brand/x.png`) warn instead of error (server resolves them at execution) |
| `patch-validator-v4.mjs` | comfy-mcp dist | Unwired hard-switch (`ComfySwitchNode`) branch with consumed output errors (was `NoneType` crash at runtime; soft switch excluded — it falls back) |
| `patch-validator-v5.mjs` | comfy-mcp dist | Multi-node dependency cycles error (server rejects them; in-graph retry loops impossible — orchestrate re-enqueue with cap) |
| `patch-validator-v6.mjs` + `patch-validator-v6b.mjs` | comfy-mcp dist | `enqueue_workflow` converts Web-UI `nodes[]/links[]` to API format like validate does (was: server 500 in `node_replace_manager`); v6b uses the converted graph in both seed branches |
| `patch-color.mjs` | comfy-mcp dist | Uniform fills report FLAT, not washed-out |
| `qc_reject_patch.py` | comfyui volume `variation/qc.py` | `REJECT` fails the gate like `fail`; JSON `null` fails closed (no NoneType) |
| `llm_json_tolerant_patch.py` | comfyui volume `codex_provider/llm.py` | `json_only` accepts a leading JSON object, drops trailing prose (vision verdicts) |
