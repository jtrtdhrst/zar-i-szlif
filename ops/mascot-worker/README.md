# Mascot Factory render service — deployment contract

**Status 2026-11-16: implemented and tested locally; NOT deployed.** No Coolify
application for this service exists yet, no live render has ever succeeded, and
nothing here is production proof. The only live Żar i Szlif production surface is
the static panel (`zar-i-szlif-web`, `ops/coolify/Dockerfile`). This service is a
separate image and must never be smuggled into that one: the panel image is, and
stays, a static nginx site.

The problem this exists to fix: `scripts/mascot-factory.mjs` was merged, but the
only deployed image served `app/web/dist` through nginx, so the Mascot Factory
had no executable runtime anywhere in production.

## What runs

| Path | Role |
| --- | --- |
| `scripts/mascot-factory.mjs` | The merged fail-closed runner (transport policy, budget, PNG gate, provenance, verifier). Unchanged behaviour; reused verbatim. |
| `scripts/mascot-factory-service.mjs` | The long-lived HTTP service wrapping it: liveness, readiness, release provenance, authenticated bounded render, artifact paths. |
| `ops/mascot-worker/reference-pins.json` | Brand lock: SHA-256 of both reference images plus the pinned prompt and graph-template hashes. |
| `ops/mascot-worker/Dockerfile` | `node:24-bookworm-slim`, non-root uid 10001, no npm install, no third-party dependency. |

## Endpoints

All responses are JSON. No endpoint ever returns a credential.

| Method | Path | Contract |
| --- | --- | --- |
| `GET` | `/healthz` | `200 {"ok":true}` — process liveness only. A ComfyUI outage must not restart a healthy container. |
| `GET` | `/__release.json` | `{"commit":"<40-hex>","source":"zar-i-szlif/mascot-factory"}` — the exact `SOURCE_COMMIT` the process started with. |
| `GET` | `/readyz` | Probes the **actual** ComfyUI engine, then answers `200` only when references match their pins, the cost ledger is readable with budget left, **and** an authenticated read-only probe of `GET /system_stats` plus `GET /object_info/CodexExecImageGen plus GET /object_info/ImageScale` succeeds. Otherwise `503` with a `blockers` array of exact codes: reference blockers (`REFERENCE_MISSING:<profile>:<role>`, `REFERENCE_HASH_MISMATCH:<profile>:<role>`), pin blockers (`GRAPH_TEMPLATE_HASH_MISMATCH:<profile>`, `PROMPT_HASH_MISMATCH:<profile>`), budget blockers (`BUDGET_LEDGER_CORRUPT`, `RENDER_BUDGET_EXHAUSTED …`), transport `MISSING_REMOTE_CREDENTIAL`, and backend probe codes `BACKEND_UNREACHABLE`, `BACKEND_UNAUTHORIZED`, `BACKEND_NODE_MISSING`, `BACKEND_TIMEOUT`, `BACKEND_HTTP_ERROR_<status>`, `BACKEND_INVALID_RESPONSE`. The probe is bounded (`MASCOT_FACTORY_PROBE_TIMEOUT_MS`, default 2500 ms), carries the configured credential, and uses **GET only** — readiness never submits a billable `/prompt`. |
| `GET` | `/status` | Pinned graph/prompt hashes per profile, backend scheme/host (no secret), budget usage, in-flight/accepted counters, `artifact_status: AWAITING_HUMAN_BRAND_QA`, `publication: disabled`. |
| `POST` | `/render` | Body `{"profile":"zar"｜"szlif"}`. Requires `Authorization: Bearer <MASCOT_FACTORY_API_TOKEN>`. `401` without/with a wrong token, `400` for a token in the query string or a credential-shaped body key, `409` while a render is in flight, `503 NOT_READY` with blockers, `200` on success, `502 RENDER_FAILED` with a redacted code. |

A successful render returns `prompt_id`, output `sha256`, `workflow_sha256`,
dimensions, budget usage and absolute artifact paths
(`…/render.png` — the raw backend render, `…/candidate.png` — its deterministic
alpha-exported RGBA form, `…/provenance.json`), with
`status: AWAITING_HUMAN_BRAND_QA` and `brand_review: PENDING_MANUAL`. Nothing is
published, promoted or approved by this service.

## Required configuration

Startup is fail-closed: a missing or weak value refuses to start (exit 1) rather
than serving a misconfigured render endpoint.

| Variable | Required | Meaning |
| --- | --- | --- |
| `SOURCE_COMMIT` | yes | Exact 40-hex commit. Invalid → `SOURCE_COMMIT_INVALID`. Coolify supplies its own commit variable; map it to this name. |
| `MASCOT_FACTORY_API_TOKEN` | yes (secret) | Bearer token for `/render`, ≥ 32 chars, no whitespace. Store it in the Coolify secret store; never in this repository. |
| `COMFY_URL` | yes | ComfyUI base URL. A non-loopback endpoint must be `https:` **and** carry a credential, otherwise startup is refused. |
| `COMFY_API_TOKEN` **or** `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` | yes for a remote endpoint | Backend credential, environment only. Never logged, never in provenance, never in a response. |
| `MASCOT_FACTORY_REFERENCES` | yes (mount) | Read-only directory holding the two reference PNGs named in the pin file (`zar.png`, `szlif.png`). |
| `MASCOT_FACTORY_REFERENCE_PINS` | default in image | Path to the pin file; the image ships it at `/app/ops/mascot-worker/reference-pins.json`. |
| `MASCOT_FACTORY_OUT_DIR` | default `/var/lib/mascot-factory/out` | Artifact root. Mount a persistent volume: artifacts and the budget ledger must survive a container replace. |
| `MASCOT_FACTORY_BUDGET_LEDGER` | default `<out>/.mascot-render-budget.json` | Daily cost ledger. A corrupt/unreadable ledger blocks rendering instead of resetting. |
| `MASCOT_FACTORY_MAX_RENDERS` | default `2` | Per-UTC-day render budget (stricter than the CLI default of 4; a daemon is unattended). |
| `MASCOT_FACTORY_PROBE_TIMEOUT_MS` | default `2500` | Bound on the whole `/readyz` backend probe (both GETs share one deadline). Must be a positive integer ≤ 30000, otherwise `INVALID_PROBE_TIMEOUT`. |
| `COMFY_CODEX_HOME` | never set here | Account binding for the `CodexExecImageGen` node belongs to the backend deployment, not to this service. |

The pin file is the brand lock. Changing a prompt or the graph shape changes its
`prompt_sha256` / `graph_template_sha256`, so readiness fails until the pin file
is deliberately updated and re-reviewed. A reference image that does not hash to
its pin (`REFERENCE_HASH_MISMATCH`) blocks every render — a swapped mount cannot
silently change what the model is locked to.

## Image build

- Context: repository root. Dockerfile location: `/ops/mascot-worker/Dockerfile`.
- No package manager step: both scripts use Node's standard library only, so the
  image has no dependency graph to drift from a lockfile.
- The image runs as uid 10001, exposes `8080`, and carries a `/healthz`
  `HEALTHCHECK`.
- `ops/coolify/Dockerfile` (static panel) is untouched by this service.

## Network and exposure rules

1. **Private only.** No public route, no public FQDN, no unauthenticated
   ingress. The service requires a bearer token for `/render`, but a private
   address is still mandatory: health and status must not be internet-reachable.
2. Do **not** reuse the panel's public FQDN; the panel is a static site with no
   API runtime.
3. If an operator later needs to call it from outside the private network, that
   is a separate decision requiring Cloudflare Access (service token) plus an
   independent review. Do not add an anonymous tunnel or a `--allow-unauthenticated`
   style bypass; the existing ComfyUI exposure defect must be removed, not
   extended.
4. Reach ComfyUI only over loopback inside the same private network or an
   authenticated HTTPS path with a service token. Never expose ComfyUI itself
   publicly.

## Release and acceptance path (not performed by an agent)

1. Independent CTO review of the exact PR head SHA (this task ships source only).
2. Merge by the authorized release controller, then create the Coolify
   application for this service from `ci-approved`, base directory `/`, Dockerfile
   `/ops/mascot-worker/Dockerfile`.
3. Readback required before any claim of production: deployment finished at the
   merge SHA, `/__release.json` `commit` equals the merge SHA, `/healthz` → 200,
   `/readyz` → 200 with an empty `blockers` array **and** `backend.probe: null`
   (that value is only `null` when a real authenticated probe of ComfyUI
   succeeded; `BACKEND_*` codes mean the engine is down, refusing the credential
   or missing `CodexExecImageGen`), image digest recorded, previous image retained
   as rollback. A green `/healthz` alone is not readiness.
4. One real render per profile, then independent QA: `prompt_id`, output
   `sha256`, transparent RGBA pass, provenance file, plus UI QA and CPO visual
   approval. A healthy container or a green `/healthz` alone is not acceptance.
5. Any change to identity, prompt, pins or budget requires re-review; historic
   approved masters (`zar_final.json`, `szlif_final.json`,
   `mascot_factory_identity_scene_v2_approved_v20.json`) are never overwritten.

## Known external blockers (2026-11-16)

- **Backend authorization:** `CodexExecImageGen` is installed and has separate successful art-generation history. That does not prove the Mascot Factory worker can generate under its own runtime identity or that a private production deployment is authorized. The worker has performed no billable render in this candidate; real model access and budget remain an independent release gate.
- **Agent-side ComfyUI access:** `https://mcp-comfy.kompaszbiorek.pl/mcp` sits
  behind Cloudflare Access with interactive-only methods (no
  `client_credentials`), so an unattended agent cannot authenticate; a 401 from
  the edge proves reachability, not origin health. The owner-side fix is a
  Cloudflare Access **Service Token** plus a Service Auth policy, delivered
  through the platform secret store and consumed by this service as
  `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.
- **Image build gate:** `product-ci.yml` builds only `ops/coolify/Dockerfile`.
  Adding a build job for this image is a workflow change the current task's Git
  credential cannot push; until the owner or controller adds it, this image's
  manifest is covered by a static contract test instead of a real build.

Until the first two are resolved by the owner, the correct state is **blocked
with the exact reason above** — never an invented PASS and never a rendered
"example" image.

## Local verification

```bash
node --test tests/mascot-factory-service.test.mjs tests/mascot-factory.test.mjs
```

The suite drives a real HTTP server against a mock ComfyUI: liveness, release
provenance, readiness pins/budget blockers, real backend probe failures
(unreachable, `401`, missing `CodexExecImageGen`, timeout), token/query/body
rejection, single-flight, budget exhaustion, backend failure, prompt-id
traversal and the image manifest contract. It proves the service contract, never
live model output. Readiness is asserted to use GET only: no probe may submit a
billable `/prompt`.


## 18 November 2026 — CodexExecImageGen adapter migration (review required)

This source migration is stacked on product PR #182 (alpha export v3), NOT on the old #179 ArkCodex release lane. The brand-locked worker loads both references, normalizes each with `ImageScale`, combines them through `ImageBatch`, submits one `CodexExecImageGen` task (`model=gpt-6-luna`, `concurrency_count=1`, `images` batch), rescales generated RGB to 1254×1254, and performs deterministic transparent RGBA export. These are actual installed node inputs; `CodexExecImageGen` does not expose partner-node background or quality controls. Standalone image approval remains independent. No raw model credentials are injected in graph inputs. Reference PNG pins and the exact prompts are unchanged, but both graph-template SHA-256 values change and must match `computePins()`. Verify old Ark-source assets only through the historical verifier branch; new paid inference MUST NOT silently downgrade to the legacy backend.

`/readyz` performs GET-only `/system_stats` plus `/object_info/CodexExecImageGen`, `/object_info/ImageScale`, and `/object_info/ImageBatch` and never submits a paid prompt. A successful GET of `/object_info` proves *installation/schema visibility*, not an authorized Codex CLI image generation session. Therefore authorized Codex model access must be confirmed separately by the owner in ComfyUI before the first approved bounded paid render. HTTP 200 readiness without that proof is NOT visual or inference E2E acceptance.

The operator already verified this graph's class, model and input names by reading the connected ComfyUI schema and live `object_info` for `CodexExecImageGen`, `ImageScale`, `ImageBatch`, `SaveImage` and `LoadImage`. A local offline Docker run proved `/healthz` 200, exact `/__release.json`, unauthorized `/render` 401 and authenticated `/render` 503 when the backend is intentionally unreachable, without any provider spend. Source tests include non-billable negative probes (absent scaler, absent reference batch, no duplicate paid prompt, legacy export verification).

The worker still requires an **authorized private** Coolify service, immutable digest, known reference mounts, an authorized live CodexExecImageGen session, a real paid render per character under approved budget, exact candidate SHA and independent UI QA/CPO review before marking Multica ZARI-241/ZARI-220 DONE. Staged unit tests and offline Docker health alone do not satisfy these gates. Do not expose the worker publicly or loosen authorization to make a test green.
