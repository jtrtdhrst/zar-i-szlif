# Żar i Szlif — Mascot Factory E2E

**Status: backend blocked, runtime harness tested against a mock ComfyUI API.** This is not a successful production image render and does not assert visual-identity acceptance.

## Source inputs

- Żar: `żar.png` (1254×1254 RGBA), SHA-256 `0ef5e535677030f697a75f2d59f8ad8895119ffc85c9f2063374d7e6264d059c`
- Szlif: `szlif.png` (1254×1254 RGBA), SHA-256 `53e511a27367ee016e9c2def36c528e370d55037263a6aaf43eaf1fba0955094`

## What is implemented

- Versioned `zar` / `szlif` brand-locked prompts; primary identity reference and secondary style-only reference.
- ComfyUI direct HTTP API runner (Node.js 24+), uploads both source images to `/upload/image`, submits `/prompt`, polls `/history/{prompt_id}` and reads output through `/view`.
- Fail-closed output gate: RGBA PNG only, 512–4096px, coverage and subject bounds verification, rejects cropped / opaque output.
- Each completed candidate stored as `candidate.png` and `provenance.json` with source/output SHA-256 hashes and prompt ID. **All images stay pending manual brand review; no automatic publication.**
- Test fixture HTTP server exercises the full loop without calling an external paid service.

## Commands

```bash
node --test tests/mascot-factory.test.mjs
node scripts/mascot-factory.mjs validate --file /path/to/zar.png
node scripts/mascot-factory.mjs run --profile zar \
  --identity /path/to/zar.png --style /path/to/szlif.png \
  --url http://127.0.0.1:8188/ --out ./out/mascots
```

> Reference paths are on the machine where the command runs. The ComfyUI API must be reachable from that machine and restricted to a trusted private/loopback network. The script intentionally has no service-token configuration; use an authenticated service proxy or add explicit support before exposing it remotely.

## Security and operational gates

1. Never expose an unauthenticated ComfyUI/MCP port on the public internet. The observed existing `--allow-unauthenticated-non-loopback` setting must be removed before network exposure.
2. ArkCodexImageGen was present, but both live prompts on 2026-11-16 failed with `CodexImageUnavailable`, so **no real candidate exists**.
3. The connected ComfyUI uses CPU-only PyTorch and has zero installed image models. Do not download expensive weights or run a cloud provider without GPU/cost approval.
4. The runner tests use an HTTP mock and make no claim about real model inference, visual quality, reproducibility with fixed seeds or billable-provider readiness.
5. Manual identity acceptance must check eye shape, facial expressions, paw/wing anatomy, scarf/cap identity, color palette and shared 2D brand style. A structural pass never auto-approves a mascot.
6. Production readiness additionally needs: authenticated ComfyUI access from the Multica runtime, approved inference backend, independently verified live image render for both profiles, QA signoff, review-gated branch/merge and artifact publication.

## Prior ComfyUI graphs already saved to user library

- `zar-i-szlif/mascot_factory_v1_zar_brandlocked_20261116.json`
- `zar-i-szlif/mascot_factory_v1_szlif_brandlocked_20261116.json`
- `zar-i-szlif/mascot_factory_v1_new_character_template_20261116.json`

## Multica tasks

- `ZARI-220` CPO — coordination and acceptance, currently blocked.
- `ZARI-221` Mascot Designer — identity/visual specification.
- `ZARI-222` Harness Engineer — agent transport and reproducibility; confirmed missing secure ComfyUI MCP exposure.
- `ZARI-223` UI QA — independent E2E after backend/transport readiness.
