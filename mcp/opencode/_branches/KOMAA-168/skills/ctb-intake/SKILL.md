---
name: ctb-intake
version: 1.0.0
description: Klasyfikuje zmianę systemową i wybiera bezpieczny tryb CTB.
change_class: ctb
supported_modes: DIAGNOSE, PLAN, EXECUTE
---
# CTB Intake

## Preconditions
- Ustal, czy żądanie zmienia mechanizm, architekturę lub capability systemu.
- Odrzuć zwykły feature produktu, copy change i lokalny bugfix do Paperclip RTB/ITB.

## Workflow
1. Zwróć `CHANGE_CLASS`, `MODE`, `SCOPE`, `RISKS` i `REQUIRED_EVIDENCE`.
2. Wybierz `DIAGNOSE` dla rozpoznania i `PLAN` dla projektu zmiany.
3. Wybierz `EXECUTE` wyłącznie dla CTB z istniejącym issue Paperclip.

## Write Boundary
- EXECUTE wymaga `paperclipIssueId`, `changeIntent`, `scope`, `acceptanceCriteria` i `idempotencyKey`.
- Brak któregokolwiek pola kończy się `CTB_CONTEXT_REQUIRED`.

## DoD
- Klasyfikacja jest jawna, deterministyczna i zawiera właściciela dalszej pracy.
