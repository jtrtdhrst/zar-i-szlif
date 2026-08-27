# Governance — Kompas Zbiórek

## Delivery
- Strumień domyślny: Engineer → QA → Done
- Maks. 2 aktywne wyniki produktu
- Nowe issue = nowy, niezależnie wartościowy deliverable
- Znany bloker zewnętrzny → czekanie pasywne, bez pętli recovery
- Paperclip Ops i Kompas Product to osobne domeny
- `shared_workspace` nieużywany

## Definition of Done
- **Write task:** isolated workspace → implementacja kompletna → testy → commit → push → SHA → dyspozycja issue
- **Blocked task:** zapis `BLOCKER / OWNER / EXACT ACTION` — nie kończ runa bez dyspozycji

## Wykonanie kontraktowe (CONTEXT-FIRST)
**EXECUTION ORDER na starcie runa:**
1. `PAPERCLIP_WAKE_PAYLOAD_JSON` / heartbeat-context / task context
2. HANDOFF (format w `skills/kompas-governance/SKILL.md`)
3. REPO MAP (`docs/AI-REPO-MAP.md`)
4. targeted file reads
5. code

Zasada: **Known context > targeted verification > broad discovery.**

Przed startem sprawdź **Definition of Ready** (upstream DONE + deliverable + finalized workspace + credentials + assignee bez error).

Nie zaczynaj taska od: listowania wszystkich issue/projektów/goals/agentów, szerokiego skanu repo, `git worktree list`, `git remote -v`, pełnego `git log` — chyba że task tego wymaga.

## STARTUP I/O BUDGET
- Paperclip: 1 odczyt heartbeat-context; komentarze tylko inkrementalne
- Git write task: `git branch --show-current` + `git status --short`; opcjonalnie `git rev-parse --show-toplevel`
- Bez wyszukiwania po całym boardzie; bez discovery repo gdy lokalizacja znana
- Autorytatywność mutacji: udana odpowiedź mutacji jest wiążąca, nie wykonuj potwierdzającego GET

## Cykl user-facing (kontrakt)
Docelowy cykl (TARGET): **Planowanie → Realizacja → Refleksja → Doskonalenie** — zob. `shared/PRODUCT.md`. Bieżący stan (CURRENT/AS-IS): zob. `shared/STATE.md`. `00`–`06` i model 9 kroków są historyczne/metodologiczne; nie są mapowaniem bieżącego kontraktu. AS-IS, TO-BE i DELTA: [KOMAA-48](/KOMAA/issues/KOMAA-48). Kanon statusów ról: `shared/CONTEXT.md`.

## Brand DNA
Charakter mapy/topografii/terenu; oszczędny żółto-złoty akcent; display serif; body geometryczny sans; hierarchia nad dekoracją.
