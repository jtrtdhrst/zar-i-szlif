---
name: ctb-delivery
version: 1.0.0
description: Kończy CTB wyłącznie z pełnym dowodem wdrożenia i rollbacku.
change_class: ctb
supported_modes: EXECUTE
---
# CTB Delivery

## Required Evidence
- diff, testy, commit, deployment, smoke, rollback state i korelacja Paperclip issue-run.

## Forbidden Actions
- Nie kończ na stanie "implementation ready".

## DoD
- Issue Paperclip zawiera dyspozycję, dowód i właściciela następnego kroku.
