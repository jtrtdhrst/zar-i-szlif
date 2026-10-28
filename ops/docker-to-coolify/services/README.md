# Uslugi: Docker rootless -> Coolify

Data: 2026-10-28 | Baza: main @ e3dd9cbb419a39aa6934546a1aa9a310058d6573

| Usluga (rootless) | Cel w Coolify | Status |
|---|---|---|
| app (www) | aplikacja WWW | do zweryfikowania |
| registry | rejestr | do zweryfikowania |
| supabase | baza / auth / storage | do zweryfikowania |
| workery pomocnicze | jobs / kolejki | do zweryfikowania |

Status calosci: inwentaryzacja w toku, zero zmian wdrozenowych.
Sekrety: brak w repo (nie dodawac zadnych kluczy ani tokenow).

## Stagingi Coolify utworzone 2026-10-28

| Staging | UUID Coolify | Status | Uwagi |
|---|---|---|---|
| qdrant-data-staging | eciprwgeyol4znmdd0dpu3xc | running:unknown | log: Qdrant 1.20.0 nasluchuje na 6333; snapshot `long_term_memory-1622037727927157-2026-10-28-14-58-54-0.snapshot` (sha `8c01689c…`) zabezpieczony w `/tmp/opencode/qdrant-migration`; restore pending |
| mautic-staging | xnyvriux31whmlvrlkftyjn3 | exited | do diagnostyki |
| supabase-staging | r2gnunvpkqwmuew1tupbf7lx | exited | przed deployem kolizja `container_name` — do rozwiazania |
| opik-staging | s7a4rwqbij7w4fxlnauriblo | exited | do diagnostyki |
