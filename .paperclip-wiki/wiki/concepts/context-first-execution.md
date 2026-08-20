---
title: CONTEXT-FIRST execution — kontrakt wykonawczy
type: concept
tags: [kontrakt, wykonanie, startup-budget]
sources: [raw/WSPOLNY_KONTEKST.md]
created: 2026-08-20
updated: 2026-08-20
---

# CONTEXT-FIRST execution

**Order**: `PAPERCLIP_WAKE_PAYLOAD_JSON` → `PAPERCLIP_TASK_ID` → `heartbeat-context` → inkrementalne komentarze → REPO MAP (`docs/AI-REPO-MAP.md`) → targeted reads → code. Nie odtwarzać contextu, który Paperclip już podaje (bez listowania board/goals/agents, bez `git worktree list`/`remote -v`, bez szerokich skanów na starcie).

**Definition of Ready**: upstream DONE + deliverable + finalized workspace + credentials + assignee bez error; FAIL → `BLOCKER/OWNER/ACTION` bez recovery issue (zob. `skills/kompas-governance`).

**STARTUP I/O BUDGET**: 1 odczyt heartbeat; git `branch --show-current`+`status --short` (+ opcjonalnie `rev-parse --show-toplevel`) i STOP; dalsza diagnostyka tylko przy anomalii. Mutacja wiążąca — bez potwierdzającego GET.

**Narrowest source principle**: Known context > targeted verification > broad discovery.

