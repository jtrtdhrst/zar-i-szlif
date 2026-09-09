---
name: ctb-preflight
version: 1.0.0
description: Zbiera ograniczony dowód przed transformacyjną zmianą systemu.
change_class: ctb
supported_modes: DIAGNOSE, PLAN, EXECUTE
---
# CTB Preflight

## Preconditions
- Potwierdź CTB i dozwolony projekt.

## Workflow
1. Sprawdź zdrowie runtime, stan Git i aktualną architekturę.
2. Zidentyfikuj istniejący mechanizm zamiast budować równoległy.
3. Zapisz testy, punkt rollbacku i granicę katalogu.

## Discovery Budget
- Jeden targeted context read, jeden targeted search na hipotezę i brak repo-wide archaeology bez nowej hipotezy.

## Forbidden Actions
- Nie wykonuj write przed zamknięciem preflightu.

## DoD
- Znane są aktualny stan, test contract, rollback i minimalny zakres zmiany.
