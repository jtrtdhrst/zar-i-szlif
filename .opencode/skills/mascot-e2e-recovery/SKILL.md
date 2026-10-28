---
name: mascot-e2e-recovery
description: Recover a stalled mascot pipeline by diagnosing exactly whether reference selection, ComfyUI execution, art QA, or alpha/export failed; change one causal strategy, protect the source and finish with verified files or a precise blocker. Use when a run fails or corrective renders repeat defects.
compatibility: opencode
metadata:
  workflow: mascot-generation
  stage: recovery
---

# Mascot E2E Recovery & Handoff

## Diagnose by phase, not by blind retry
- **REFERENCE fail**: missing/incorrect image, wrong role or unverified base. Resolve/stage the right source; reissue prompt from authoritative source.
- **EXECUTION fail**: unavailable `LoadImage` input, invalid graph, crashed ArkCodex node, exhausted backend, queue not done. Read exact graph/queue/history or diagnosis and fix actual cause. Never simulate success or quietly replace the configured model.
- **ART fail**: source identity drift, anatomy, face/expression or style bad. Form a specific hypothesis and change the prompt emphasis, real-animal reference, crop composition or source selection. Use one new candidate from the authoritative base; never keep compounding global redraws from failed generations.
- **ALPHA fail**: flat background not separable, erased dark detail, halos/fringe or output altered in persistence. Re-examine source/pipeline; if safe deterministic segmentation cannot preserve the subject, regenerate with cleaner edges rather than painting the lost anatomy.
- **DELIVERY fail**: image exists only on remote MCP host, `/view` inaccessible or bytes not verified. Use a verified transfer/attachment route and re-check the exact produced file, rather than reporting a fabricated download URL.

## Anti-loop rule
After **two failed attempts on the same defect using the same approach**, do not run a third equivalent attempt. Revise the approach in a substantive way and document that change. One different seed by itself is not a different approach. Never enqueue uncontrolled batches or waste renders on ceremonial checks.

## Completion contract
`DONE` requires both `ART PASS` and `TECHNICAL PASS`, successful persisted-file readback and actual delivered URLs/attachments. Use `REJECTED` for unacceptable artistic candidate; use `BLOCKED` only for real missing permissions, unavailable service or unsolvable external limitations. If blocked, deliver useful intermediate files **labeled as nonfinal**, exact failing criterion and next actionable step; never say the task is complete.

## Compact manifest example
```json
{
  "character": "ENTP-kuna",
  "brief_version": "2026-10-28",
  "source_refs": [{"filename":"kuna.png","sha256":"<measured>"}],
  "workflow": "asset_kuna_refinement_20261028.json",
  "prompt_id": "<exact id>",
  "output_ref": {"filename":"<exact filename>","subfolder":"<exact subfolder>","type":"output"},
  "art_checks": {"status":"PASS","notes":[]},
  "technical_checks": {"status":"PASS","notes":[]},
  "accepted": true,
  "remaining_risks": [],
  "files": ["<actual final rgba file>","<actual preview file>"]
}
```
Do not fill template placeholders with guessed data. Keep logs and manifest in English, short user handoff in Polish, with exact paths and factual evidence.
