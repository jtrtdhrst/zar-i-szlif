---
name: status
description: Szybki przegląd stanu faktycznego przez MCP Paperclip. Używaj po komendzie `/status`, „status”, „jaki jest stan” oraz gdy użytkownik chce wiedzieć, czy system czeka na decyzję, zatwierdzenie albo ruch człowieka.
---

# Status — szybki przegląd przez MCP Paperclip

## Overview

Cel: w maksymalnie kilku wywołaniach MCP odpowiedzieć na dwa pytania:
1. Jaki jest stan faktyczny pracy (co jest w toku, co czeka)?
2. Czy system czeka na decyzję (approval, potwierdzenie, odpowiedź na pytanie, review)?

## Workflow

### 1. Przypisania i statusy

Wywołaj `paperclip_paperclipInboxLite` — to daje listę przypisań bieżącego agenta z aktualnymi statusami. Od razu widać, co jest `in_progress`, `in_review`, `blocked`, a co czeka na start.

### 2. Decyzje czekające na zatwierdzenie

Wywołaj `paperclip_paperclipListApprovals` z argumentem `status: "pending"` (jeśli zwróci pustą listę, spróbuj bez filtra, żeby potwierdzić, że nie ma żadnych). Dla każdego wyniku, przy którym widać brak decyzji:

- `paperclip_paperclipGetApproval` — szczegóły wniosku (typ, autor, payload);
- `paperclip_paperclipGetApprovalIssues` — issue powiązane z wnioskiem;
- `paperclip_paperclipListApprovalComments` — czy ktoś już komentował.

To jest główne źródło odpowiedzi „czy system czeka z decyzją”.

### 3. Praca czekająca na ruch

Wywołaj `paperclip_paperclipListIssues` osobno dla statusów `in_review` i `blocked`. Wyniki skróć do: identyfikator, tytuł, status, priorytet.

Jeśli issue jest `in_review` lub `blocked`, sprawdź `paperclip_paperclipGetIssue`, żeby zobaczyć `blockedByIssueIds` i `unblockDescriptor` — tam jest napisane, kto i jakim działaniem odblokuje pracę.

### 4. Interakcje czekające na użytkownika

Interakcje `ask_user_questions`, `request_confirmation`, `request_checkbox_confirmation` i `suggest_tasks` nie mają osobnego listingu — są widoczne w komentarzach. Dla podejrzanych issues wywołaj `paperclip_paperclipListComments` i sprawdź ostatnie komentarze pod kątem interakcji bez odpowiedzi (np. pytanie bez podjętej decyzji, confirmation bez akceptacji).

## Raport

Odpowiedz zwięźle po polsku, w tej kolejności:

1. **Czeka na decyzję (TAK/NIE)** — liczba pending approvals i interakcji bez odpowiedzi; jeśli zero, napisz wprost „System nie czeka na żadną decyzję”.
2. **W toku** — krótka lista `in_progress`/`in_review` z identyfikatorami.
3. **Zablokowane** — lista `blocked` z powodem blokady i właścicielem odblokowania.

Nie rozbudowuj raportu o pełne treści issues ani komentarze — tylko to, co trzeba wiedzieć, żeby podjąć następny krok.
