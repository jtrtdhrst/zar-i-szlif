---
title: Maskotki — UI QA acceptance rubric for the post-rejection rework (2026-10-20)
type: concept
tags: [zar-i-szlif, mascot, ui-qa, acceptance, contrast, penpot]
created: 2026-10-20
updated: 2026-10-20
---

# Maskotki — UI QA acceptance rubric for the post-rejection rework

## 2026-10-21 — V7 OWNER-REJECTED NEGATIVE QUALITY BENCHMARK (TOP PRIORITY)

The user's screenshot of V7 `mascots-v7-design-preview` has been rejected. The design must NOT be approved just because it has ~21 native paths/character, a five-color palette, green SVG/alpha hashes, or connected PNG at 32px. The release gate must distinguish (a) renderer integrity, (b) actual visually grounded independent art critique, (c) human/owner direction acceptance and (d) Penpot/UI QA on the exact same SHA.

**Hard visual regressions to catch:** anthropomorphic fox feet merge into invisible light accents on white/cream paper; fox expression reads neutral and the body reads blob; raven body/beak/wing feel generic and toy-like rather than a character; the "pair" has no shared gaze/gesture; tiny full-body silhouettes 32px are unrecognizable colored dots. A 32px asset requires a separately artist-designed optical head/bust; existence of a 32px raster or connected alpha is not a pass. A/B/C must each present distinguishable large silhouettes, not three color/paw variants.

**Always use the REAL app's actual colors for QA:** `--paper #f5f0df`, `--paper-2 #ece5d1`, `--forest-950 #162313` from the CSS; the navy `#16202E`/camp `#22405C` background in earlier standalone preview *is not the actual product surface*. A green contrast fix only on that mock navy is not relevant proof for the shipped app. Independently inspect true 1:1 32/64 with captions hidden; show a zoom only as an additional explanation.

**Disposition:** UI QA technical PASS without genuine independent CMO art verdict and direct owner concept sign-off = **ART_REVIEW_PENDING/REJECTED**, never production. Original owner Penpot team remains distinct from staging.

**Status: ACCEPTANCE RUBRIC (measurable targets), not a style decision and not an approval.** It records what
UI QA will *measure* on the next candidate and which environment facts are now verified. Art direction stays
with the Designer and the independent CMO reviewer; release authority stays with the CTO.

Companion hub: [[wiki/concepts/mascot-style-2-pipeline]] (pipeline contracts, V3/V4 history, DAG, owners).
Source evidence: issue documents on **KOMAA-1095** (`qa-evidence-v4-app-surface-contrast`,
`qa-evidence-v4-optical-cut-plane`, `qa-rubric-delivery-note`).

## 1. Why the basis changed

The owner **rejected the V4 candidate `2a09273490ebbe73fead95f09378057d67a903ec`** (KOMAA-1094, 2026-10-20
21:42Z): monolithic fox anatomy, weak paws/face/plan handoff, raven anatomy; dark/camp contrast and optical
crop concerns. That SHA is a **negative baseline** — do not re-verify it, do not ship it, and do not treat it
as a QA target. The Designer workstream was reopened (Designer agent `a9de363c…`) to produce three new
directions under the same independent CMO reviewer; no self-approval.

UI QA's earlier measurements of that baseline are **not void** — they are the acceptance targets for the
rework, because the owner's rejection cites exactly the two concerns they measured (contrast, crop).

## 2. Contrast: the app's real surfaces, and the element classes that die on them

The dark/camp colours used in the V4 pipeline's own proof sheets (`#16202E`, `#22405C`) are **not app
surfaces** — the app never renders them. Acceptance must be measured against the app's own tokens
(`app/web/src/styles.css:3-11`; light theme only — there is no `prefers-color-scheme` block in
`app/web/src`):

| token | value | where it is used |
|---|---|---|
| `--paper` | `#f5f0df` | page background (whole app) |
| `--paper-2` | `#ece5d1` | card backgrounds |
| `--gold-soft` | `#e4c557` | gold-tint chips / selected states |
| `--forest-950` | `#162313` | **72 px sticky app header** + hover/checked chips; hosts the 42×42 brand-logo slot (`.brand img`) |
| `--forest-900` | `#1d2d19` | deep forest tints |
| `--forest-800` | `#2a3d24` | borders, tints, status chips |
| `--black` | `#070907` | strongest dark |

**Target: ≥ 3 : 1** (WCAG non-text minimum) for every element that carries the silhouette or the face, on the
surface it actually ships on. Measured on the rejected V4 palette (9 fills), the failure classes are:

* **Dark-surface class — Szlif's silhouette (≈31 % of the art) disappears**: body/head/hackle `#232833` =
  1.01–1.35 : 1 and wing/crest `#3C4757` = 1.25–1.74 : 1 on the forest family. Only his amber beak and
  pale-slate eye survive → a floating bill and eye.
* **Dark-surface class — Iskra keeps her mass but loses her face**: orange `#E2702D` = 4.57 : 1 passes, but
  the face ink `#2B2A33` (eyes, nose, fringe lock, fringe tuft) = 1.03–1.41 : 1 → at 32 px on a dark surface
  she has no features.
* **Light-surface class — the fox's light accents vanish on the paper**: cream muzzle and raised paw
  `#F7E8D3` = **1.04–1.06 : 1**, Szlif's eye `#D7DCE3` = 1.10–1.21 : 1 → the "weak paws / face / plan
  handoff" the owner named.
* **Weakened but legible**: Iskra orange 2.53–2.79 : 1 on paper, turquoise scarf 1.96–2.16 : 1, Szlif's beak
  1.79–1.97 : 1.

**One light rim cannot fix this** — a cream rim is invisible on cream paper and a dark rim is invisible on
the forest header. The treatment must be defined **per surface family** and aimed at named elements
(silhouette mass, face ink, light accents), never at "add contrast" in general.

## 3. Crop acceptance test for a new optical view

Two cheap, decisive checks, both reproducible from the committed SVG/PNGs of a candidate SHA:

1. **Per-fill cut test** — no fill's content bbox may cross the crop plane (unless the cropped part is a
   documented decorative element). The rejected V4 had **3 of 9** fills crossing it, with **141.62 units =
   40 % of the artwork** below the plane.
2. **Per-column run test** — in the rendered export, no column may terminate on a canvas edge with a long ink
   run; V4 reached **28–33 of 37 rows at 64 px** (76–89 % of the height), i.e. the crop sliced a *mass*, not a
   tip.
3. **Widening trap** — extending the viewBox down a little does **not** fix a mid-mass cut, it **deepens**
   it: V4's `398 252` still left 112.83 units of Szlif's body below the new plane. A cut that must end
   cleanly has to land outside the content bbox (V4 would have needed height ≈ 372), which changes the export
   aspect — decide that deliberately, do not nudge.

Note for Penpot staging: the V4 optical crop reproduced the source crop exactly only after a **source-viewBox
clip frame** was added to the native file (rev7) — a plain import preserves editable path geometry but loses
the viewport crop, and the resulting group render must not be counted as source-equivalent.

## 4. Per-size proof expectations

* Declare the per-size source explicitly. In the V4 set 32/64 was one composition
  (`optical/iskra-szlif-optical-vignette.svg`, 29 paths) and 128/512 another
  (`scenes/iskra-szlif-vignette.svg`, 42 paths, with ground shadow and camp-fire glow) — two compositions, not
  one asset scaled.
* Ship **silhouette** and **forest/light-surface** variants at every size, rendered against the real app
  surfaces (§2).
* `verify.mjs` checks clipping (≥ 128 px only), provenance and reproducibility — **not contrast**, and not
  the 32/64 edge-clip case. A green pipeline is not evidence of legibility.

## 5. Measurement method (stdlib only, reproducible)

* SVG geometry: parse `M`/`L`/`C`/`Z`, per-cubic **exact extrema** (derivative roots), per fill and per path
  — not a control-point approximation.
* Raster: `zlib` + per-scanline unfiltering (filters 0–4), 8-bit; edge analysis = contiguous opaque run per
  column terminating at each border row; components = 4-connected flood fill, alpha ≥ 128.
* Contrast: sRGB → linear → relative luminance → `(L1+0.05)/(L2+0.05)` (WCAG 2.x). For gradients, sample the
  **actual rendered position** of the element (CSS gradient-line geometry), not the worst-case stop: V4's
  scene copy measured 4.18 : 1 against the lightest stop but **6.67 : 1 where it actually sits**.

## 6. Verified environment notes (removes a dead end for the next agent)

Verified 2026-10-20 while running the full 1440/390 + a11y pass:

* The headless Chrome (chrome-devtools MCP) runs in a **different container** than the agent shell: it cannot
  read the shell's `file://` paths and cannot reach `127.0.0.1`. Serve the built asset with
  `python3 -m http.server <port> --bind 0.0.0.0` and navigate to the **container IP** (e.g.
  `http://172.20.0.8:8098/...`).
* Screenshots written with `filePath` land in the **browser container's** filesystem; capture them **without**
  `filePath` to receive them inline.
* The earlier blocker `browser_runtime_absent_libglib2.0` is **RESOLVED** — Chrome launches, so 1440/390
  visual, keyboard/focus and measured overflow passes are runnable again. Do not re-report it as blocked.

## 7. Gap that blocks *recording* QA verdicts (owner: Harness / MCP gateway)

Agent **comment and status writes are refused** with `403 cross_issue_influence_run_context_required`
(`cross_issue_influence_run_context_required`) even when the live run id is supplied explicitly on the request
(both the `runId` field and the legacy `operatorRunId` alias). **Issue document writes succeed.** Practical
consequence for this lane: a QA verdict on a live candidate must be carried in an **issue document**, and the
review decision must be recorded by the named reviewer or the board — not by an agent comment. Do not work
around it by creating a second issue, a substitute status write, or a direct API call with the session key:
this is a platform defect, not a QA repair. Cross-issue writes to another agent's issue are also correctly
fail-closed (`Agent cannot mutate another agent's issue`), and an issue held by another agent's live run
returns `409 ACTIVE_RUN_CONFLICT` — in that case wait for the lock or use a comment once the platform gap is
closed.

Internal operational text stays English; Polish brand, product copy and the names Żar i Szlif are never
translated.