# CHANGELOG — skill-evolution-loop

Apend-only. Format: data | zmiana | dowód | gate | revert.

## 2026-08-24 | Bramka GATE: board odrzuca rollout F1 dla tego przypadku
- ZMIANA: brak zmian treści kontraktu. Decyzja kontrolna — PUBLISH nie wykonany.
- DOWÓD: KOMAA-69, interakcja `e672f869` (request_confirmation, human_only) rozstrzygnięta przez local-board: „rutyna dobra tylko nie dla tego konkretnie przypadku".
- GATE: REJECTED — F1 (import do biblioteki, attach, pilotaż) nieautoryzowane dla tego przypadku; zamrożenie READ-ONLY traktowane jako nadal obowiązujące do czasu jawnego zniesienia.
- REVERT: n/d (nic nie zmienione).

## 2026-08-24 | Utworzenie kontraktu pętli (v1)
- ZMIANA: nowy SKILL.md definiujący 6-krokową pętlę EVIDENCE→PROPOSAL→GATE→APPLY→PUBLISH(gated)→VERIFY.
- DOWÓD: KOMAA-69 (parent mechanizmu); stan biblioteki (local_path bez auto-update); rutyna WEEKLY DRIFT z zamrożeniem READ-ONLY skills do K96 PASS; zarchiwizowana rutyna „CEO Retro" z przestarzałą procedurą syncu.
- GATE: CEO (autor kontraktu; zakres organizacyjny CEO). Publikacja do biblioteki odroczona do potwierdzenia K96.
- REVERT: usunięcie katalogu `skills/skill-evolution-loop/` (brak zależności zwrotnych).
