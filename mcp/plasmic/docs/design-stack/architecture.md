# Architektura design-stack

```mermaid
flowchart TB
    PC[Paperclip<br/>control plane] --> OC[OpenCode<br/>runtime]
    OC --> ODL[open-design<br/>lokalne stdio]
    OC --> PM[plasmic<br/>stdio / localhost HTTP]
    OC --> GH[github MCP]
    ODL --> ODD[OpenDesign daemon :7456]
    PM --> WAB[Plasmic WAB :3004<br/>WAB REST, bez przeglądarki]
    ODB[opendesign-bridge-mcp<br/>READ-ONLY HTTP] --> ODD
    REMOTE[zdalni klienci<br/>Bearer] --> ODB
    REMOTE --> PM
    OC --> GH_REPO[(GitHub repo<br/>canonical kod)]
    WAB -. kompozycja .-> APP[Application]
    GH_REPO --> APP
    APP --> SUPA[(Supabase)]
    DS[design-sync<br/>status/plan/apply] --> ODD
    DS --> WAB
```

## Ownership

Szczegóły: skill `skills/design-stack/SKILL.md`. Zasada naczelna: jeden właściciel
na artefakt, synchronizacja jednokierunkowa (OpenDesign → kontrakt → repo → Plasmic).
Brak multi-master. (v0 usunięte z warstwy decyzją operatora — implementacje robi OpenCode.)

## Komponenty

- `services/plasmic-mcp` — 17 narzędzi `plasmic_*` (dokumentacja: `plasmic-mcp.md`).
- `services/opendesign-bridge-mcp` — 9 narzędzi `design_*`, READ-ONLY.
- `libs/*` — klienci REST + kontrakty (DesignContext, hashe, locki, idempotencja, audyt).
- `design-sync/` — `token-map.json`, `component-map.json`, CLI status/plan/apply.
- `workflows/prepare_ui_task.ts` — agregacja kontekstu + rekomendacja celu.
