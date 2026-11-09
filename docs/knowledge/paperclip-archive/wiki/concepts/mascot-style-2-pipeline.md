---
title: Żar i Szlif — maskotki STYLE_2 i pipeline produkcji (roboczy profil)
type: concept
tags: [zar-i-szlif, art-direction, mascot, pipeline, penpot, svg]
created: 2026-10-19
updated: 2026-10-19
---

# Maskotki — STYLE_2_V0 / Soft Geometry V2

## 2026-10-21 — V7 REJECTED BY OWNER; RESTART ART DIRECTION (CURRENT, OVERRIDES HISTORICAL V3/V4/V5/V6 STATUS)

**OWNER VERDICT: REJECTED / do not ship V7.** The real owner screenshot of "ŻAR I SZLIF / KIERUNEK V7" was directly rejected as ugly; explicit complaint that the skills and pipeline are fundamentally flawed. The user rejected previous V4 too. Do not present V7 Git branch `mascots-v7-design-preview` or earlier V4 `2a092734...` as a passing style standard. Green 21–22 path counts, five colors, source hashes, Penpot readback, Pixelmatch and a "connected silhouette at 32px" did not catch severe aesthetic issues.

**Observed on the user's screenshot:** Iskra looks like an orange blob with an expressionless circular face, generic ears, scarf as a broad turquoise strip, toy-like short/weak feet, oversized prop and disconnected narrative; Szlif has a generic compressed bird posture with protruding bill, weak emotional intelligence, cluttered wing/tail. Their pairing is just stickers arranged side-by-side, not an intentional shared moment. "128/64/32px" shrinks the full bodies to dots with missing faces; the contact sheet shrinks primary art with excessive white margins. Existing claim of "actual-size proof" is technically literal but *visually dishonest* because no optical avatar was drawn.

**NEW PRIORITY ORDER:** human/art-directed visual concepts → true full-frame image critique → actual anatomy/face/pose corrections → independently inspected raster before/after → independent optical 64px/32px busts → original-owner Penpot native editability → technical validation → native CMO/UI QA/owner/CTO release. Do NOT author raw SVG bezier path math as the primary design technique or accept path quotas as an aesthetic gate. An unverified image-review adapter or simulated/mock Vision test never counts as inspecting a real screenshot.

**Canonical app backgrounds, NOT the mascot renderer's mock dark/camp:** actual `--paper: #f5f0df`, `--paper-2: #ece5d1`, `--forest-950: #162313` (brand/header), plus dark ink. Test pale paws/muzzles on paper (near-white disappearance), fox eyes on forest and raven bill on real surfaces; do not claim a custom navy preview is the product UI. These tokens were measured in the independently written QA rubric `wiki/concepts/mascot-rework-ui-qa-rubric.md`.

The company `mascot-style-2-pipeline` SKILL.md revision 25+ is authoritative for the new art-first mandatory gate; if a historical section below claims V4 CMO approval or green quality, that is not owner consent. Existing DAG stays KOMAA-1092/1093/1094/1095/1100 with real dependencies and per-task watchdog; route the known Paperclip reviewer status-drift to KOMAA-849. No new tasks or auto approvals just to create status.

**Status: WORKING SPECIFICATION, not validated final style or running generator.** "Stylistyka 2" has not been pinned to a verifiable visual reference in canonical wiki; Soft Geometry V2 is the provisional interpretation until the actual versioned reference and owner decision are recorded. This is not a claim of released art.

## Intent
Distinctive forest-adventure mascot language for **Żar i Szlif**; appealing but not generic AI-looking blobs. Editable native vectors, coherent stylistic family, repeatable production. Separate art direction from technical exporter. Never conflate screenshots/crops of references with editable art.

## Character identities
- **Iskra** (fox NPC, reserved): proactive, asymmetric fringe, distinctive large tail integrated into silhouette, tilted turquoise scarf, small eyes, expressive hands.
- **Szlif** (raven NPC, reserved): observant and analytical; distinctive raven beak and head feathers, quieter expression, optional notebook/plan.
- Player species never fox or raven, expandable catalogue; avatar customization only basic colors/clothes at product MVP. See [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]].

## Working design tokens
Soft custom geometry, strong 32/64px silhouette, clean transparent PNG, SVG editable paths/groups, 5 functional color groups target, no gradients/3D/shadows. Variants must preserve face landmarks, overall proportions and motif integrity. This profile is subject to explicit visual acceptance, not a mathematical fidelity claim.

## Pipeline contracts
1. Discover existing Penpot concept V2 and verify real accessibility + asset provenance; do not assume Penpot URL is accessible based only on ID.
2. Character Bible: design grammar, anchor proportions, palette, motifs and versioned reference ID.
3. Three distinctly different silhouettes per character; black shape sheets and comparative selection.
4. Original semantic SVG/native Penpot master with movable editable elements.
5. Character expressions and poses from the same masters, not unrelated regenerated images.
6. Deterministic export + validator: master SVG, transparent 512/256/128/64/32 PNG, SHA256, alpha, actual bounds, contact sheet, version manifest.
7. Visual QA: 64/32 readability, clipping, reference consistency, editability, both characters side-by-side, independently reviewed.
8. Git/source delivery with reproducible command, repo path, screenshots, working link, candidate SHA, CI evidence, reviewer, documentation disposition.

**Minimal DoD:** reusable skill installed for Designer, Engineer and UI QA; accepted Iskra and Szlif editable source files; repeatable local exporter and real PNGs; verified source link and contact sheet; independent visual PASS and CTO review for code. A created Paperclip issue or skill is **not** proof those outputs have been generated.

## Proposed integration
`assets/mascots/style-2/{character}/{source.svg,character.json,exports/*}`
`scripts/mascots/{generate,validate}.mjs`
`docs/mascots/style-2-character-bible.md`
Adapt paths to existing repo conventions after inspection, do not fork existing source-of-truth. No AI is embedded in the user-facing product; all generation is design/build time.

## Ownership
Designer: visual exploration, editable master and first export. Engineer: pipeline code, reproducibility and app-ready asset packaging. UI QA: independent visual proof. CTO: engineering acceptance and merge. Harness: fix access/runtime only. MCP Engineer remains owner of product MCP/Qdrant, **not** illustration work.

## 2026-10-20 — V3 recovery execution and visual quality contract

**Status: ACTIVE RECOVERY, ART CANDIDATE, NOT PRODUCTION-APPROVED.** The prior STYLE_2 draft passed technical checks without a true visual style acceptance. Never promote a PNG/SVG because only the hashes, shape count, dimensions, single-connected-piece check or UI QA technical PASS are green.

### Verified tangible V3 artifacts

- New headless Penpot file: `6769b9bc-1b9c-81d1-8008-d1c8a66be27f`, project `6769b9bc-1b9c-81d1-8008-d07af8f5f6e6`, team `fa45bb82-5782-8177-8008-cb9105f337f9`.
- One pair of native editable 512x512 masters: Iskra 20 semantic paths/ellipses in 5 colors, Szlif 19 in 5 colors; a named Penpot file snapshot was written and read back.
- GitHub draft design PR: https://github.com/miloszspyrka-code/zar-i-szlif/pull/55 — same SVG sources in `assets/mascots/concepts/minimal-flat-v3/` with source provenance, validation script and independent-art-review requirements.
- **Known access mismatch**: user's intended Penpot team `fa45bb82-5782-8177-8008-cb89bd5343d6` returns HTTP 404 to the currently configured Penpot MCP; Designer and UI QA's effective Penpot tool lists are empty. This is a real delivery blocker, not a graphical style issue. No claim of owner-visible editor link until the intended team is verified from the owner's account.

### Mandatory art-direction quality gates

1. Designer compares **three genuinely different silhouette/style approaches** per character; chooses a coherent pair; inspects actual PNG renders at 512, 128, 64 and 32 px (light and dark surfaces).
2. Character identity is mandatory: Iskra = asymmetric fringe, integrated fox tail, tilted turquoise scarf and energetic gesture; Szlif = unmistakable raven beak/head-feathers, thoughtful expression and neat design-tool/notebook. Small eyes, flat fills, restrained shape grammar. Aim at <=22 independently editable semantic shapes and <=5 functional color groups/character, but do not sacrifice beauty purely to hit counts.
3. No floating body parts, illegible beaks or faces, excess decorative complexity, gradients, screenshots passed as native vectors, fake links, external/raster image embeddings, or unreviewed reuse of a stock silhouette.
4. Independent UI QA tests source/readback/transparency and visuals at all sizes; an independent **CMO/CEO style sign-off** is required before any merge that changes shipped mascot appearance. A review of dimensions/geometry is not artistic approval.
5. Engineer integrates a finalized source into the existing *single* deterministic export pipeline, hashes/manifest, actual app previews and CI; CTO reviews exact PR SHA and checks. Do not mutate production/master while the art direction remains provisional.

### Native Paperclip DAG and owners

Parent: `KOMAA-1092` (CTO, CEO reviewer, COO watchdog).
- `KOMAA-1093` Harness (Penpot team + native Designer/UI QA MCP access) — independently executable, CTO reviewer; real external-service monitor may run only in `in_progress`/`in_review`.
- `KOMAA-1094` Designer (visual redesign/variants and real render contact sheets) — independently executable, CMO reviewer.
- `KOMAA-1095` UI QA — first-class blockedBy: `KOMAA-1093`, `KOMAA-1094`; CEO reviewer.
- `KOMAA-1100` Engineer integration — blockedBy: `KOMAA-1095`, existing `KOMAA-1011` (which transitively depends on `KOMAA-797` host GitHub auth); CTO reviewer.
One native COO-owned watchdog on root KOMAA-1092 covers all children. Do not create duplicate per-child watchdogs. The root watchdog has no authority to self-approve, bypass permissions, duplicate production sources or fake statuses. Keep operational notes and tests in English; Polish names/copy remain Polish.

## 2026-10-20 — Systemic V4 build and delivery recovery (operator-verified)

**Current state: V4 SOURCE PUBLISHED FOR REVIEW, NOT BRAND/PRODUCT APPROVED.** This section supersedes stale V3-only delivery claims, not V3 historical provenance.

### Verified immutable candidate and readbacks
- Design source art: commit `8e250de8d9d0b04740aa8d4f8383a6ba5397ee88` (KOMAA-1094), `assets/mascots/concepts/minimal-flat-v4/`. Six genuinely distinct A/B/C Iskra/Szlif construction-language SVG directions, two selected named editable masters, and one derived paired vignette. Export evidence: `exports/{sheet-directions.png,sheet-pair.png,sheet-backgrounds.png,manifest.json}`; 108 of 108 recorded export SHA-256s recomputed correctly in live worktree. These are technical proofs, NOT independent aesthetic acceptance.
- Release-gate repair commit `df18c7bc4b291950351bc2bac5698d21900e758a`, remote branch `KOMAA-1094` verified SHA parity. Draft GitHub PR **#61**: https://github.com/miloszspyrka-code/zar-i-szlif/pull/61. PR remains DRAFT, no merge.
- Root cause of first push failure: `scripts/release-targets.mjs` did not classify review-only `assets/mascots/concepts/**` paths and failed closed for 127 files. Narrow `NON_RELEASE_RULES` pattern added, plus regression in `tests/release-gate.test.mjs`. Unknown `assets/mascots/*` paths still fail closed. 21/21 classifier tests PASS; `git diff --check` PASS.
- Root cause of subsequent pre-push failure: local worktree omitted installed `@types/node` and `@types/express` despite declarations in existing `app/package.json` and `app/package-lock.json`. Restore from the existing lockfile with dev dependencies; **do not bypass pre-push hooks**. After install: root `npm run validate:code` PASS (plugin MCP 24/24, root Node 34/34, Worker 31/31) and full `git push --dry-run` PASS across both release gates; real GitPush remote readback PASS. For new isolated workspaces, verify `app/node_modules/@types/node`, `app/node_modules/@types/express`, and canonical full `npm run validate:code` before Git push. Do not mutate shared installation concurrently with other agents.

### Review and accessibility reliability contract
1. `KOMAA-1094` requires a **live** independent CMO art-review run on the exact art sources and actual sheets. A mere `in_review` status, named participant, hashes or individual designer self-scores are not evidence. The review previously reported wedged with zero live reviewer runs; route attempt returned stale 409, so a targeted first-class wake was issued. Require explicit first-class APPROVED/CHANGES REQUESTED, with independent review identity. Review not yet evidenced complete.
2. `KOMAA-1093` was mistakenly `blocked` with zero blocker edges; native `paperclipRepairIssue` moved it to `todo`, followed by a non-forced `paperclipWakeIssueFresh` to `in_progress`. Harness must verify run is actually executing, not just queued, and repair original external Penpot access. The configured Penpot connector lists only team `fa45bb82-5782-8177-8008-cb9105f337f9`, while owner's required team `fa45bb82-5782-8177-8008-cb89bd5343d6` yields HTTP 404. Verify correct instance/tenant/account and least-privilege team membership BEFORE import. Designer and UI QA targeted Penpot effective tool count remained 0. No false owner-visible links.
3. Independent `KOMAA-1095` UI QA only after 1093 + 1094 accepted. Visual gates: species distinction, eyes/snout/beak/fringe/crest, no floaters/clipping, 32/64 pixel readability, editability and owner visible Penpot access. `KOMAA-1100` integrates ONLY independently approved masters through the one canonical production renderer and actual app previews, no second generator or premature deploy.
4. GitHub API CI readback from PR #61 currently reports token GraphQL `Resource not accessible by personal access token` on statusCheckRollup: do not invent CI PASS; fix/read checks by an authorized CI-capable identity. Never self-approve or auto-merge artwork.
5. Task robustness: use real parent/subtask and direct blocker edges; never create `blocked` without authoritative reason, avoid timer wakes without causal delta, keep executable reviewer assigned and alive, and route Penpot/tool/runtime ownership to Harness rather than the user. Bound retry/watchdog behaviour; no blanket privileges.

**Production release acceptance remains OPEN.** Do not substitute PR publication, successful build, or model-generated aesthetics for real owner-visible Penpot, human-independent art-direction approval, UI QA, app screenshot and CTO CI/merge acceptance.

### 2026-10-20 — CMO independent V4 review verdict (read back)

- Exact source-art commit `8e250de8d9d0b04740aa8d4f8383a6ba5397ee88`, review PR #61 head `df18c7bc4b291950351bc2bac5698d21900e758a`.
- **CHANGES REQUESTED**, recorded as first-class review decision on KOMAA-1094 at ~18:52Z. The independent reviewer explicitly rejected aesthetics; this is not a technical/production rejection or user-facing sign-off. Root defects: Iskra's asymmetrical fringe reads as an eyebrow, the turquoise scarf as a horizontal bib, and traits collapse at 32 px; Szlif's feather crest reads as crown spikes/horns, head and body read penguin-like, wing/tail poorly separated, and pair interaction reads as two stickers rather than dialogue.
- Native Paperclip review->Designer handoff confirmed by authoritative `executionState.lastDecisionOutcome=changes_requested`, `changesRequestedCount=1`, status `in_progress`, return assignee Designer and a live Designer run. Independent CMO review must recur on a new source SHA after corrections. Preserve the CEO/UI QA/CTO gates and native dependencies.
- Existing root-only watchdog KOMAA-1092 is active and specifically covers descendants; avoid duplicate per-child configurations. Harness KOMAA-1093 is eligible with an issue-scoped run queued; **queued is not executing**, and owner-team Penpot 404 remains unresolved. Paperclip GitHub GraphQL statusCheckRollup remains unauthorized, but independent GitHub Actions `fetch_commit_workflow_runs` confirms CI run 39477977833 succeeded on the published candidate; approval/QA gates remain open.

## 2026-10-20 — Second CMO rejection of V4 and systemic optical-size gate

Independent CMO reviewed exact immutable V4 candidate `119b8907ddf842708aa367b920468b9f7ebc85e1` on draft PR #61, after an earlier rejection of source 8e250de. CI workflow 39481956205 succeeded on this new candidate; export manifest shows 108/108 SHA-256 checks consistent. This is **technical PASS only, not art PASS**. The first-class independent review at 2026-10-20 19:20Z recorded **CHANGES_REQUESTED** again. Failures: Iskra's supposed asymmetric fringe still reads as a centered brow stripe, the card is not legible at 32px, their interaction is too ambiguous in the 32px two-character vignette, and Szlif still retains a penguin-like full-body/weak tail fan silhouette despite improvements in the bill and scarf. Paperclip returned the issue to Designer, who is executing source changes; do not accept this rejected SHA or deploy it.

The underlying renderer in `assets/mascots/concepts/minimal-flat-v4/render.mjs` currently rasterizes the same detailed full-body SVG at 512, 128, 64 and 32. That is an architectural readability problem: tiny signature elements disappear predictably. The canonical company skill `mascot-style-2-pipeline` **0.2.0** now requires a true *optical-size vector art gate*: intentionally composed semantic derivatives for 64/32px where needed, with exact original-master and optical SVG source SHA per size, deterministic transforms, actual native-resolution previews and separately labelled zoom inspections, fail-closed tests for missing/incorrect optical sources, plus independent aesthetic review on the revised candidate. Do NOT create PNG-only substitutes, an extra original-master SSOT or false approval from automated hash checks. CMO/CEO determines actual art quality, UI QA separately checks native editability/owner-team Penpot, CTO retains code/release authority. One COO root watchdog remains the recovery owner.

Existing KOMAA-1011 generator hardening: commit `d109d32aaf8400843732baca5b241841b7132ca6` adds negative SVG/schema tests while preserving archived STYLE_2_V0 palette reproducibility; Engineer additionally committed `c7bdef8` to narrowly classify `assets/mascots/style-2/` as unpromoted design-only assets, then merged current main as `d860d5ac7f56a90e705e12399660df3937dab39b`. Independent readbacks: generator 14/14 tests PASS, release-gate regression 20/20 PASS, Git branch clean. Engineer owns remote publication and CTO's code gate; no production completion asserted. Penpot owner-team access remains OPEN and agent toolFilter penpot returns 0 for Designer/UI QA; Harness KOMAA-1093 started a real run around 19:26Z but exact credential/team fix not yet verified.


### 2026-10-20 — REAL PENPOT TOOL-GATEWAY PROBE: access projection vs execution

Harness KONAA-1093 operator comment at 19:30Z identifies active Penpot tool connection `0ca1b6c1-4517-48f1-8ca5-c8b019dcb534`; live gateway tools/list returns **20 active catalog tools**. Harness explicitly installed the existing connection for Designer `a9de363c-345f-4b32-822d-4c847c4819fe` and UI QA `2642a166-36dc-475b-8e17-f9332f769636` with native `/tool-connections/{id}/installs`; configuration readback was committed. Real authenticated `penpot_list_teams` test-call in original Designer identity `7d1dd1ee-2103-49cb-b671-a8180f6364d0` and UI QA identity `a203dfd3-e61b-412d-aa14-0204e40e39b8` both succeeded.

**Do not incorrectly downgrade these successful native tool-gateway tests based solely on compatibility `GetAgentEffectiveTools(toolFilter=penpot)` returning toolCount=0.** That projection reports tool not registered in the Paperclip MCP native tool catalog, while the separate runtime tool-gateway actually executes the Penpot connection. Harness must reconcile the diagnostic mismatch but can rely on *verified* native execution for original-agent testing. Avoid duplicate install/repeated token prompts.

However, the upstream Penpot credential still sees only team `fa45bb82-5782-8177-8008-cb9105f337f9`; intended owner team `fa45bb82-5782-8177-8008-cb89bd5343d6` returns **HTTP 404** on `penpot_list_projects`. No user-visible owner-team/editable master PASS until the correct principal/instance/team membership is repaired, tested with **team 200 + native object write/readback** under authorized identity. This remains the open causal gate for UI QA KOMAA-1095. Harness KOMAA-1093 has a running assigned execution; do not duplicate its wake or create another issue.
