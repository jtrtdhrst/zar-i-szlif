---
name: infra-root-cause
version: 1.0.0
description: Diagnozuje problem infrastrukturalny przez ograniczone hipotezy i test rozstrzygający.
change_class: ctb
supported_modes: DIAGNOSE, PLAN
---
# Infrastructure Root Cause

## Workflow
1. Zapisz symptom oraz obserwowalny dowód.
2. Ułóż ograniczone hipotezy.
3. Dla każdej wykonaj test rozstrzygający.
4. Zapisz root cause, fix systemowy i ryzyko regresji.

## Forbidden Actions
- Nie skanuj pełnych logów ani repo bez hipotezy.
- Nie stosuj obejścia jako końcowego fixu systemowego.

## Output Contract
- `SYMPTOM`, `EVIDENCE`, `HYPOTHESIS`, `TEST`, `ROOT_CAUSE`, `SYSTEM_FIX`.
