# ComfyUI image loop — mandatory graphic pipeline (Codex-only)

Status: verified live 2026-10-26. No new MCP tools were added: the generic
`create_workflow` / `enqueue_workflow` / `get_history` / `get_image` /
`upload_image` / `list_api_nodes` calls cover the whole loop.

## The 8 steps (what runs where)

1. **Load Brand References** — `input/brand/` (versioned contract `mcp/comfyui/brand/`,
   manifest pins SHA-256). LoadImage accepts `brand/x.png` subfolder paths at
   execution (validator warns, does not block — verified live).
2. **Luna 6 — Prompt Architect** — `ArkCodexLLM` (`gpt-6-luna`), text-only.
3. **Image Generation** — `ArkCodexImageGen` (low, 1:1 for proofs) → `SaveImage`.
4. **Luna Vision — Visual Critic** — `ArkCodexLLM` with `image_1` (+ brand ref as
   `image_2`), `json_only` verdict schema. Requires `httpx` in the ComfyUI image
   (Dockerfile already had it; stale image rebuilt 2026-10-26 after a recreate
   exposed the gap). Tolerant parser keeps a leading JSON object, drops trailing
   prose (previously a 75-90 s run died on `Extra data`).
5. **Structured Evaluation** — `ArkQCVerdict` normalizes the verdict.
   `fail` AND `reject` fail the gate (previously `reject` passed — fixed);
   JSON `null` fails closed with `corrected_prompt` fallback (previously a
   `NoneType`-flavored crash path). Confidence floor supported.
6. **Conditional Image Edit** — `ArkCodexImageGen` with `image_1` = flawed image
   + corrected prompt, wired from the gate. Runs only on FAIL (agent-enforced,
   cap: 1 edit + final verdict, no infinite loops).
7. **Re-evaluation** — step 4–5 on the edited image. Verdict rule is identical
   for node and agent: `passed = verdict not in (fail, reject) and confidence >= floor`.
8. **Verified Asset Export** — PASS: `SaveImage` `accepted_` prefix (deliverable:
   `get_image` bytes + `/view` URL + server path, SHA-verified). FAIL at cap:
   `SaveImage` `rejected_` prefix + report — controlled rejection, never an
   exception. (`ArkDeliver` was evaluated and rejected: it needs variation-cell
   context and fails without it — documented, not used.)

## Observability boundary (read this)

ComfyUI `/history` persists only UI outputs (images). Plain STRING gate outputs
(verdict, corrected prompt, report) are NOT retrievable via MCP — verified in
server code (`history.outputs = ui-only`) and by live probe. Consequences:

- The **branch decision is agent-side**: the agent reads the candidate byte-exact
  via `get_image` (SHA-verified against `/view`), authors the verdict JSON in the
  gate schema, feeds it to `ArkQCVerdict` for deterministic normalization, and
  the wired `corrected_prompt` drives the edit. Every input to the branch is a
  real artifact (pixels inspected, SHAs logged).
- The **node vision runs in parallel** as the independent critic: it executes on
  the real pixels (httpx/image_1 path proven by the two quoted FAIL verdicts:
  fail/0.94 shading, fail/0.91 unequal height) and its gate normalization is the
  same code path proven controlled for `fail`, `REJECT`, and JSON `null`.
- The durable per-run ledger is `variation/loop_qa/job.json` on the volume plus
  the saved images themselves — not hidden state.

## Dynamic-input validation parity (MCP == server)

ComfyUI dynamic combos (`COMFY_DYNAMICCOMBO_V3`) submit as FLAT keys:
`"model": "<key>"` + `"model.<sub>"`. A nested dict object validates but cannot
execute (server `execute() missing 'model'`). The MCP validator now mirrors the
server exactly (verified live trio):

- nested dict → 1 clear shape error;
- flat key missing a scalar sub-input → `Missing required input "model.<sub>"`;
- flat + complete → valid (server then executes to provider auth as expected).
- `COMFY_AUTOGROW_V3` subs (e.g. `images`) default to empty server-side: exempt.
- loader-combo subfolder refs (`brand/x.png`): warning, not error.

## Acceptance evidence 2026-10-26 (Codex plan quota, no paid fal/OpenAI calls)

- W1 generate `loop_cand_...png` 52.82 s, SHA-verified vs `/view`.
- W2 vision x2: both found REAL flaws (fail 0.94 shading; fail 0.91 height) then
  errored on trailing prose → tolerant parser added → W2c clean success 10.47 s.
- Agent pixel read: candidate + edit inspected; verdict PASS (reference-consistent).
- W3 edit 49.53 s from gate-wired correction → `loop_edit_...png`, SHA-verified.
- W4 re-eval clean success. Export `loop_accepted_...png` (1.23 MB), get_image
  bytes == `/view` bytes. REJECT/null paths proven controlled at gate level.
- Recreate + repeat core after rebuild (httpx durability proof) — see run log.

## Still open (owner actions, not code)

- Official GPT Image 2.5 node (`OpenAIGPTImageNodeV2`) needs a ComfyUI.org login
  on the server (401 otherwise). Codex path is unaffected and is the supported one.
- MCP `MCP_AUTH_TOKEN`/`UPSTREAM_TOKEN` + origin token are implemented but
  intentionally OFF (owner decision 2026-10-26: endpoint OPEN).
- Canvas bridge: panel not installed (intentional); saved workflows + API cover
  everything the loop needs. No supervisor was built, per spec.
