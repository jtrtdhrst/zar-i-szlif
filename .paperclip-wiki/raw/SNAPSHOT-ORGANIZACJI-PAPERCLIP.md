# Snapshot organizacji Paperclip — 2026-08-17

Stan odczytano przed przebudową organizacji. Snapshot jest tylko do odczytu; żadne dane Paperclip nie były zmieniane bezpośrednio w bazie.

## Agenci

| Agent | ID | reportsTo | Status | Adapter / model | maxConcurrentRuns | Apps |
| --- | --- | --- | --- | --- | ---: | --- |
| Kompas CEO | `7cbc484a-bd04-4a7b-bc16-cbd643acf519` | — | error | opencode_local / openai/gpt-5.6-terra | 20 | Git, mcp.cloudflare.com |
| Kompas CTO | `ff703eba-3c3d-46f0-b265-df0db1101a19` | CEO | paused | opencode_local / openai/gpt-5.6-terra | 20 | Git, mcp.cloudflare.com |
| Kompas Engineer | `3fe90c23-8386-40d5-b0a8-52d8c40f812e` | CTO | idle | opencode_local / openai/gpt-5.6-terra | 20 | Git, Playwright |
| Kompas UI QA | `2642a166-36dc-475b-8e17-f9332f769636` | CEO | paused | opencode_local / openai/gpt-5.6-terra | 20 | Clarity, Playwright |
| Kompas Designer | `a9de363c-345f-4b32-822d-4c847c4819fe` | CEO | idle | opencode_local / openai/gpt-5.6-terra | 20 | MagicUI |
| Kompas CMO | `78608591-71b4-471f-a5eb-17122d8db7da` | CEO | idle | opencode_local / openai/gpt-5.6-terra | 20 | Clarity, mcp.sender.net MCP |

## Access i skille

- CEO ma `agents:configure`, `skills:create`, `tasks:assign`; pozostali agenci mają `tasks:assign` oraz `canCreateSkills`.
- Wszystkie istniejące granty `tasks:assign` są szerokie (`scope: null`).
- Wszyscy agenci mają identyczny techniczny superset 11 skilli:
  - `local/183a703743/ceo-retro`
  - `paperclipai/bundled/docs/doc-maintenance`
  - `paperclipai/bundled/paperclip-operations/issue-triage`
  - `paperclipai/bundled/paperclip-operations/reflection-coach`
  - `paperclipai/bundled/paperclip-operations/task-planning`
  - `paperclipai/bundled/quality/qa-acceptance`
  - `paperclipai/bundled/software-development/github-pr-workflow`
  - `paperclipai/optional/browser/agent-browser`
  - `paperclipai/optional/product/design-critique`
  - `paperclipai/optional/software-development/prepare-mcp-integration`
  - `paperclipai/paperclip/para-memory-files`

## Aktywna praca i recovery

| Issue | Status | Assignee | Workspace |
| --- | --- | --- | --- |
| KOMAA-1 — audyt bieżącego pluginu i zgodności z PRD | blocked | CEO | — |
| KOMAA-2 — audyt zgodności kompas-ui-plugin z PRD | in_progress | CTO | shared_workspace / reuse_existing |
| KOMAA-3 — audyt UI kompas-ui-plugin | in_progress | UI QA | shared_workspace / reuse_existing |

- CEO ma recovery run `provider_quota_recovery` dla KOMAA-1; nie uruchomiono takeover runa.
- CTO i UI QA są paused mimo przypisanych issue. Engineer eskaluje do paused CTO.
- Projekt `Kompas Zbiórek` nie ma `executionWorkspacePolicy` ani project leada.
- Rutyna `CEO Retro - poprawa wykonania` jest aktywna, ma `concurrencyPolicy=coalesce_if_active` oraz schedule `0 8 * * 1`, `Europe/Warsaw`.

## Zasada mutacji

Wszystkie późniejsze mutacje konfiguracji są wykonywane wyłącznie przez oficjalne API lub UI Paperclip. SQL pozostaje narzędziem read-only do snapshotów i diagnostyki.
