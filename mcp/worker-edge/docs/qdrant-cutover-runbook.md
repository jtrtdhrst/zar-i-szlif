# Qdrant Coolify edge cutover runbook

This runbook covers moving the **Qdrant edge proxy** from the Cloudflare Worker to its dedicated Coolify app. The Qdrant engine remains behind its existing Cloudflare Tunnel at `https://qdrant-engine.zariszlif.pl/mcp`. This is a per-service cutover: do not change another service's edge, engine, credentials, or hostname as part of this procedure.

## Current topology

| Role | Value |
|---|---|
| Worker config | `mcp/worker-edge/wrangler.qdrant.jsonc` |
| Worker host | `qdrant-mcp.zariszlif.pl` |
| Engine URL | `https://qdrant-engine.zariszlif.pl/mcp` |
| Coolify app | `qdrant-edge-coolify` |
| Coolify build directory | `/mcp/worker-edge` |
| Coolify Dockerfile | `Dockerfile.coolify` |
| Container port / health path | `8787` / `/healthz` |
| Per-app selector | `EDGE_SERVICE_ID=qdrant` |
| Public client credential | `MCP_AUTH_TOKEN_QDRANT` |
| Engine credential | `UPSTREAM_TOKEN_QDRANT` |

Both Qdrant credentials are required by `coolify-routing.mjs`. Keep them in the Coolify app's runtime secret store; never put values in Git, command history, logs, issue comments, or this runbook. The public client token and upstream engine token are separate credentials. The edge must return `401` for an unauthenticated MCP request; `/healthz` is intentionally unauthenticated and must not disclose secret values.

## Coolify app configuration

Use the existing `qdrant-edge-coolify` app and verify its settings before changing any routing:

- Repository: `miloszspyrka-code/zar-i-szlif`; branch: `main` after the reviewed change is merged.
- Build pack: Dockerfile; base directory `/mcp/worker-edge`; Dockerfile path `/Dockerfile.coolify`.
- Exposed port `8787`, health check `GET /healthz` returning `200`, and watch path `mcp/worker-edge/**`.
- Auto-deploy enabled. The container starts `node coolify-server.mjs` and must log `coolify-mcp-edge listening on 8787`.
- Set `EDGE_SERVICE_ID=qdrant`, `MCP_AUTH_TOKEN_QDRANT`, and `UPSTREAM_TOKEN_QDRANT` as runtime variables/secrets. Do not enable public previews or alter unrelated app settings.

For another service, use its existing `wrangler.<service>.jsonc` and `SERVICES` record as the source for the service id, host, upstream, and auth requirements. Create or update only that service's dedicated app; set its selector and service-specific credential names (for example `*_PLASMIC`). Never infer a service's auth mode from Qdrant. Paperclip OAuth proxy routing (Paperclip) is identity-preserving and must not receive a shared `MCP_AUTH_TOKEN` or `UPSTREAM_TOKEN`.

## Pre-cutover checks

1. Confirm the target app identity, repo, `main` branch, build directory, Dockerfile, port, health check, watch paths, runtime selector, and auto-deploy setting in Coolify. Confirm both Qdrant secrets exist without revealing their values.
2. Confirm the engine remains reachable at the configured upstream and that the existing Cloudflare Tunnel and engine authorization are healthy. Do not restart or recreate the engine for an edge-only release.
3. Review the exact Git commit and its CI/test results. Do not deploy an unreviewed candidate or edit production DNS/Worker routes before the reviewed merge.
4. Capture the current app deployment/image and working public endpoint behavior so rollback has a known target. A Coolify `running:healthy` status alone is not functional MCP acceptance.

## Deploy and verify the Coolify edge

After merge, let the existing Coolify `main` auto-deploy complete. Do not run a second manual build or change DNS during deployment. Record the deployment identifier, source commit, image digest if available, and timestamps.

Check the direct app FQDN first (retrieve it from the Coolify application record; do not construct it manually):

1. `GET <app-fqdn>/healthz` must return HTTP `200`, JSON `{"ok":true,"artifactSha256":"<64 hex chars>"}`, and `Cache-Control: no-store`.
2. Compare `artifactSha256` with the hash computed by `coolify-server.mjs` over, in order, `coolify-server.mjs`, `coolify-routing.mjs`, and `src/index.ts`, separated by `\n--mcp-edge--\n`. This is a source-artifact fingerprint, **not** a container image digest or Git SHA. Independently record the deployed source commit/image digest as available.
3. Send a harmless unauthenticated request to `<app-fqdn>/mcp` (or the app's MCP path). It must be rejected with HTTP `401` and a Bearer challenge; a `200`, empty `200`, HTML response, or upstream success without credentials is a failure. Do not send a real user token to an unauthenticated test.
4. Using an approved secret-injection path, make an authenticated MCP `initialize` and `tools/list` request, then one non-mutating Qdrant read if available. Confirm the response is from the Qdrant engine and that the app does not echo credentials. Keep tokens out of shell history and captured output.
5. Check Coolify app status/logs and confirm no restart loop, `502`/`503`, or upstream auth failure. Save timestamped status codes, sanitized response fields, source artifact hash, commit/image identity, and deployment id as evidence.

The direct Coolify hostname may route through a different Host value than the production Qdrant domain. The dedicated app must use `EDGE_SERVICE_ID=qdrant`; production Host routing remains the existing Worker behavior until the separate, approved DNS/route cutover. Passing direct-app tests does not prove production traffic has moved.

## Production cutover, acceptance, and rollback

Changing `qdrant-mcp.zariszlif.pl` DNS/route is a separate production action and requires its own authorization. Before that action, establish the new edge's direct functional checks above and preserve the existing Worker route as the rollback target. After an authorized switch, repeat the public health/artifact and anonymous-401 checks against the production hostname, then run authenticated MCP `initialize` and `tools/list`. Confirm the reported artifact fingerprint and deployment identity match the reviewed source. Monitor the engine and edge logs for errors.

If any health, artifact, authorization, or MCP functional check fails, stop the cutover (or restore the prior route using the authorized DNS/route owner), leave the engine and its data untouched, and record the failing evidence. Do not rotate credentials as a diagnostic step. Re-enable the old route only through the owner of that route, verify the old endpoint, and preserve Coolify logs/deployment metadata for diagnosis.

Acceptance evidence must include the exact reviewed commit, green checks, independent CTO decision, Coolify deployment id and image/source identity, `/healthz` status/body fingerprint, anonymous `/mcp` rejection, and authenticated read-only MCP result. A healthy container, a successful HTTP status without checking its body, or a direct app test alone is insufficient to claim production cutover or close the delivery.

### Live baseline observed for this runbook

On 2026-10-27, Coolify reported `qdrant-edge-coolify` as `running:healthy`, with the expected repository, `main`, `/mcp/worker-edge`, `Dockerfile.coolify`, port `8787`, `/healthz` health check, auto-deploy, and `mcp/worker-edge/**` watch path. Its container log showed the edge listener on `8787`. However, requests from the configured app FQDN returned `200` with an empty body (`Content-Length: 0`) for both `/healthz` and `/mcp`. This does **not** satisfy the required JSON artifact fingerprint or anonymous `401` checks; the current public app is therefore not accepted as functionally verified. Investigate the Coolify routing/serving path with its owner before any production route change. No engine, DNS, Worker variable, or secret was changed during this observation.
