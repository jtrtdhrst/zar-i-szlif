---
name: ctb-implementation
version: 1.0.0
description: Wdraża najmniejszą zmianę architektoniczną realizującą zatwierdzone CTB.
change_class: ctb
supported_modes: EXECUTE
---
# CTB Implementation

## Preconditions
- Ukończony ctb-intake i ctb-preflight.
- Pełny execution envelope oraz ważny issue Paperclip.

## Allowed Actions
- Zmieniaj tylko katalog dopuszczony przez policy gateway.
- Użyj istniejącego mechanizmu upstream, gdy pokrywa funkcję.

## Forbidden Actions
- Nie twórz drugiego engine ani tymczasowego obejścia zamiast zmiany mechanizmu.
- Nie modyfikuj provider credentials bez `opencode:admin`.

## Test Contract
- Uruchom targeted testy mechanizmu oraz test integracyjny granicy policy.
