---
name: ctb-validation
version: 1.0.0
description: Waliduje CTB przez testy, integrację, regresję i smoke endpointu.
change_class: ctb
supported_modes: PLAN, EXECUTE
---
# CTB Validation

## Workflow
1. Uruchom testy targeted i regresję.
2. Sprawdź OAuth, scopes, izolację ścieżek i korelację issue-run.
3. Wykonaj publiczny oraz wewnętrzny smoke, gdy endpoint jest wdrożony.

## Failure Modes
- Brak testu, deployu lub smoke oznacza brak DoD.

## DoD
- Wyniki zawierają komendę, rezultat i dowód.
