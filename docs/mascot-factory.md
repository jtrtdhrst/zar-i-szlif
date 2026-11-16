# Żar i Szlif — Mascot Factory E2E

**Status: backend blocked, runtime harness tested against a mock ComfyUI API.** This is not a successful production image render and does not assert visual-identity acceptance.

## Source inputs

- Żar: `żar.png` (1254×1254 RGBA), SHA-256 `0ef5e535677030f697a75f2d59f8ad8895119ffc85c9f2063374d7e6264d059c`
- Szlif: `szlif.png` (1254×1254 RGBA), SHA-256 `53e511a27367ee016e9c2def36c528e370d55037263a6aaf43eaf1fba0955094`

## What is implemented

- Versioned `zar` / `szlif` brand-locked prompts; primary identity reference and secondary style-only reference.
- ComfyUI direct HTTP API runner (Node.js 24+), uploads both source images to `/upload/image`, submits `/prompt`, polls `/history/{prompt_id}` and reads output through `/view`.
- **Authenticated transport only for remote hosts**: non-loopback endpoints must be `https:` and must carry `COMFY_API_TOKEN` (bearer) or a Cloudflare Access service token (`CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET`). Credentials come from the caller's environment only — never CLI flags, files or the repo — and are never written into provenance. Plain HTTP to a remote host, an unauthenticated remote host, and URLs with embedded `user:pass` are refused before any request is made.
- **Bounded retries that cannot duplicate a render**: `GET` requests (system stats, history, `/view`) retry on 429/502/503/504 and transient network errors with backoff; `POST /prompt` is attempted exactly once.
- **Fail-closed output gate**: RGBA PNG only, 512–4096px, coverage and subject bounds verification, rejects cropped / opaque output.
- **Render budget**: one unit of a per-UTC-day ledger is consumed *before* the prompt is submitted (`--max-renders`, default 4; `--budget FILE` to pin a shared ledger). An exhausted or corrupt ledger blocks the run instead of resetting.
- Each completed candidate stored as `candidate.png` and `provenance.json` with source/output SHA-256 hashes, prompt ID, canonical workflow hash, prompt hash, transport scheme and budget usage. **All images stay pending manual brand review; no automatic publication.**
- **Independent verifier** (`verify --dir`) recomputes every claim from the bytes on disk instead of trusting the runner: artifact hash, PNG chunk CRC/structure/alpha/coverage/bbox, reference hashes, canonical workflow hash for the recorded profile, prompt hash, and the no-self-approval / pending-status rules.
- Test fixture HTTP server exercises the full loop without calling an external paid service.

## PNG structural gate

`validatePng()` verifies the container before any pixel heuristic runs. Every rejection is a hard failure; the runner writes no artifact when it throws.

| Check | Rejection code |
| --- | --- |
| PNG signature | `NOT_PNG` |
| Chunk framing: length within the file, type is 4 ASCII letters | `MALFORMED_PNG_CHUNK`, `MALFORMED_PNG_CHUNK_TYPE` |
| **Per-chunk CRC-32 over `type + data`** (every chunk, including `IDAT`/`IEND`) | `PNG_CHUNK_CRC_MISMATCH:<TYPE>` |
| First chunk must be `IHDR`, exactly one `IHDR` of length 13 | `PNG_IHDR_NOT_FIRST`, `INVALID_IHDR` |
| `IEND` present, empty, and the last bytes of the file | `PNG_MISSING_IEND`, `PNG_IEND_NOT_EMPTY`, `PNG_TRAILING_DATA` |
| At least one non-empty `IDAT` | `PNG_MISSING_IDAT` |
| 8-bit, colour type 6 (RGBA), no interlace, compression/filter method 0 | `PNG_MUST_BE_NONINTERLACED_RGBA8` |
| Inflate is bounded to the exact scanline size; bombs and truncation fail closed | `PNG_IDAT_INFLATE_FAILED`, `PNG_DECOMPRESSED_LENGTH_INVALID` |
| Opaque coverage, canvas-edge clipping, transparent corners | `PNG_EMPTY_OR_OPAQUE_BACKGROUND`, `MASCOT_TOUCHES_CANVAS_EDGE`, `PNG_NONTRANSPARENT_CORNERS` |

A structural pass returns `crc_check: "PASS"` and `structural_check: "PASS"` with `brand_review: "PENDING_MANUAL"`; it never approves a mascot.

## Tests

`node --test tests/mascot-factory.test.mjs` runs 15 tests. The PNG gate group covers the graph shape, CRC known-answer vectors (`123456789` → `0xCBF43926`, `IEND` → `0xAE426082`), a CRC-correct positive fixture that must pass, and negative fixtures for corrupt/zeroed CRC, trailing bytes after `IEND`, missing `IEND`, truncated chunks, `IHDR` not first, non-empty `IEND`, wrong decompressed length, an inflate bomb and non-RGBA colour types. The transport/budget/verifier group covers the authenticated-transport policy, bearer propagation without secret leakage, retry-only-idempotent-GET semantics, the fail-closed render budget, and the independent verifier rejecting tampered artifacts. The mock-backend group covers a successful run, a failed node and a corrupt PNG returned by the backend.

Fixtures are built with computed CRCs and a deterministic deflate stream, so a broken validator can no longer "pass" an invalid file; they are still mock data and prove nothing about live model output.

## Continuous integration status (2026-11-16)

GitHub Actions `Product CI` for PR #178 at `4402c1e7` reported `failure` on job `validate-product` (`43878218959` / job `133336791898`) with no steps and no runner assigned. The check-run annotations returned by the GitHub API state: *"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*. That is an account billing/quota condition on the runner platform, not a defect in this code, and it cannot be fixed from the repository. Workflow policy is unchanged; clearing it requires an owner action on GitHub billing. Local `npm run validate:code` at the same commit is the accepted fallback evidence until hosted runners run again.

## Commands

```bash
node --test tests/mascot-factory.test.mjs
node scripts/mascot-factory.mjs validate --file /path/to/zar.png

# Loopback (no credential required)
node scripts/mascot-factory.mjs run --profile zar \
  --identity /path/to/zar.png --style /path/to/szlif.png \
  --url http://127.0.0.1:8188/ --out ./out/mascots

# Remote authenticated endpoint (HTTPS required; credential from the environment)
export COMFY_API_TOKEN='...'        # or CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
node scripts/mascot-factory.mjs run --profile szlif \
  --identity /path/to/szlif.png --style /path/to/zar.png \
  --url https://comfy.example.internal/ --out ./out/mascots --max-renders 2

# Independent re-verification of a produced artifact directory
node scripts/mascot-factory.mjs verify --dir ./out/mascots/zar/<prompt_id> \
  --identity /path/to/zar.png --style /path/to/szlif.png
```

> Reference paths are on the machine where the command runs. The ComfyUI API must be reachable from that machine over loopback or an authenticated private HTTPS path. `COMFY_CODEX_HOME` may bind the `ArkCodexImageGen` node to a specific owner-managed Codex account; it is passed to the node only, recorded in provenance as `codex_home_configured`, and never read as a credential.

## Security and operational gates

1. Never expose an unauthenticated ComfyUI/MCP port on the public internet. The observed existing `--allow-unauthenticated-non-loopback` setting must be removed before network exposure. The runner enforces this from its side: a non-loopback endpoint without HTTPS plus a credential is refused before any request.
2. Credentials are supplied per run through the environment only (`COMFY_API_TOKEN` or the Access service-token pair). They must never be committed, passed as flags, written into provenance or echoed in logs; rotate them through the owner's secret store.
3. ArkCodexImageGen was present, but both live prompts on 2026-11-16 failed with `CodexImageUnavailable`, so **no real candidate exists**. A replacement account (`COMFY_CODEX_HOME`) or an approved backend is still an owner decision; nothing in this runner can supply that.
4. The connected ComfyUI uses CPU-only PyTorch and has zero installed image models. Do not download expensive weights or run a cloud provider without GPU/cost approval.
5. The runner tests use an HTTP mock and make no claim about real model inference, visual quality, reproducibility with fixed seeds or billable-provider readiness.
6. Manual identity acceptance must check eye shape, facial expressions, paw/wing anatomy, scarf/cap identity, color palette and shared 2D brand style. A structural pass never auto-approves a mascot.
7. Production readiness additionally needs: authenticated ComfyUI access provisioned for the Multica agent runtime (workspace MCP entry or run-scoped credential — the transport code supports both, the platform binding does not exist yet), approved inference backend, independently verified live image render for both profiles, QA signoff, review-gated branch/merge and artifact publication.

## Prior ComfyUI graphs already saved to user library

- `zar-i-szlif/mascot_factory_v1_zar_brandlocked_20261116.json`
- `zar-i-szlif/mascot_factory_v1_szlif_brandlocked_20261116.json`
- `zar-i-szlif/mascot_factory_v1_new_character_template_20261116.json`

## Multica tasks

- `ZARI-220` CPO — coordination and acceptance, currently blocked.
- `ZARI-221` Mascot Designer — identity/visual specification.
- `ZARI-222` Harness Engineer — authenticated transport, bounded retries/budget, independent verifier implemented; agent-side ComfyUI credential/endpoint binding still unprovisioned.
- `ZARI-223` UI QA — independent E2E after backend/transport readiness.
