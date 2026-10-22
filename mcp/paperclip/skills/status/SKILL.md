---
name: status
description: Szybko sprawdza stan pracy w Paperclip i odpowiada, czy system czeka na decyzję lub zatwierdzenie. Użyj, gdy użytkownik pyta o status, „jaki jest stan”, „co czeka na decyzję”, „co jest zablokowane”, „czy system czeka”, albo chce przeglądu przypisań, approvals oczekujących i issues w toku.
---

# Status — szybki przegląd przez Paperclip MCP

Ten przepływ używa wyłącznie narzędzi tylko-do-odczytu serwera Paperclip MCP. Nie wywołuj narzędzi zapisu (tworzenie, zmiana statusu, decyzje) — raport ma być bez skutków ubocznych.

## Kroki

1. `paperclipInboxLite` — przypisania bieżącego agenta z aktualnymi statusami. To daje pierwszą informację, co jest w toku, co czeka na start.
2. `paperclipListApprovals` z argumentem `status` = `pending` — wnioski czekające na decyzję. Jeśli wynik jest pusty, potwierdź wywołaniem bez filtra, że w firmie nie ma żadnych approvals w toku.
3. `paperclipListIssues` osobno dla `status` = `in_review` i `status` = `blocked` — praca czekająca na ruch.
4. Dla każdego issue w `in_review` lub `blocked` wywołaj `paperclipGetIssue`, aby poznać powód blokady (`blockedByIssueIds`, `unblockDescriptor` — kto i jakim działaniem odblokowuje).
5. Interakcje `ask_user_questions`, `request_confirmation` i `request_checkbox_confirmation` bez odpowiedzi nie mają osobnego listingu — sprawdź ostatnie komentarze przez `paperclipListComments` na podejrzanych issues.

## Raport

Odpowiadaj zwięźle po polsku, w tej kolejności:

1. **Czeka na decyzję**: TAK/NIE, z liczbą pending approvals i interakcji bez odpowiedzi. Jeśli zero, napisz wprost: „System nie czeka na żadną decyzję”.
2. **W toku**: lista `in_progress`/`in_review` z identyfikatorami i tytułami.
3. **Zablokowane**: lista `blocked` z powodem blokady i właścicielem odblokowania.

Nie rozbudowuj raportu o pełne treści issues ani komentarze. Podawaj tylko informacje potrzebne do podjęcia następnego kroku.