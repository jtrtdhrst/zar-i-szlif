---
name: ceo-retro
description: Tygodniowa retrospektywa wykonania zespołu Kompas Zbiórek. Używaj, gdy masz wykonać rutynę „CEO Retro – poprawa wykonania” albo gdy issue, nad którym pracujesz, jest oznaczone etykietą `ceo-retro`. Zbiera feedback z ukończonych zadań i wdraża poprawki promptów i skilli podwładnych poparte dowodami.
---

# CEO Retro – poprawa wykonania

## Overview

Pętla doskonalenia egzekucji zespołu. Analizujesz ukończone zadania, piszesz strukturalny feedback i wdrażasz poprawki prompty/skille wyłącznie na podstawie dowodów (powtórzone błędy, niejednoznaczne instrukcje, brak kontekstu, złe kryteria akceptacji). Cel: mniej poprawek w kolejnych tygodniach, nie więcej zmian.

## Workflow

### 1. Zbierz dane

- Pobierz issue z `status=done` zamknięte w ostatnich 7 dniach (Paperclip UI albo `GET /api/issues?companyId=9894e3c2-3317-46ca-8c72-7a442a76a78e` z `Authorization: Bearer $env:APITOKEN`).
- Przeczytaj komentarze i raporty wykonawców. Szukaj wzorców — nie pojedynczych zdarzeń.

### 2. Feedback

Zapisz wnioski w dokumencie `ceo-feedback` na issue rutyny, w sekcjach:
- **Co działa** — zachowaj i utrwal w promptach.
- **Co poprawić** — z dowodem (task → powtarzany problem).
- **Decyzje** — co zmieniasz i gdzie.

### 3. Poprawki (tylko poparte dowodami)

Prompty — edytuj pliki bezpośrednio na dysku:

`C:\Users\milos\.paperclip\instances\default\companies\9894e3c2-3317-46ca-8c72-7a442a76a78e\agents\{AGENT_ID}\instructions\{AGENTS.md|TOOLS.md|CONTEXT.md|SOUL.md}`

Dozwolone: doprecyzowanie routingu/delegacji, kryteriów akceptacji, zakazów narzędziowych, kontekstu projektu. Zapis UTF-8 bez BOM.

Skille — `POST http://127.0.0.1:3100/api/agents/{AGENT_ID}/skills/sync` z `Authorization: Bearer $env:APITOKEN`, body `{"mode":"replace","desiredSkills":[...]}`.

**KRYTYCZNE**: skille materializują się we wspólnym `~/.claude/skills` — lista `desiredSkills` musi być IDENTYCZNA u wszystkich 6 agentów (superset: `agent-browser`, `ceo-retro`, `design-critique`, `doc-maintenance`, `github-pr-workflow`, `issue-triage`, `para-memory-files`, `prepare-mcp-integration`, `qa-acceptance`, `reflection-coach`, `task-planning`). Syncuj wszystkich 6 agentów, nigdy pojedynczo, inaczej ostatni sync usuwa linki pozostałych.

Narzędzia (Apps) — nie zmieniaj bindingów; zgłoś wniosek boardowi.

### 4. Weryfikacja

- Zmiany dot. UI → utwórz pod-issue dla Kompas UI QA.
- Pozostałe → sprawdź składnię i komplet sekcji zmienianych plików.
- Metryka: porównaj błędy z poprzedniego retro z bieżącymi.

### 5. Raport

Podsumuj na issue rutyny: zmiana → agent → powód → dowód. Nie zostawiaj zmian bez wpisu w dokumencie `ceo-feedback`.

## Mapy agentów

| Agent | ID | Zakres promptów |
|---|---|---|
| CEO | `7cbc484a-bd04-4a7b-bc16-cbd643acf519` | AGENTS.md: delegacja, plan review, pętla poprawy; TOOLS.md: Cloudflare+Git |
| CTO | `ff703eba-3c3d-46f0-b265-df0db1101a19` | TOOLS.md: Cloudflare+Git |
| Engineer | `3fe90c23-8386-40d5-b0a8-52d8c40f812e` | TOOLS.md: Git+Playwright |
| UI QA | `2642a166-36dc-475b-8e17-f9332f769636` | TOOLS.md: Playwright+Clarity |
| Designer | `a9de363c-345f-4b32-822d-4c847c4819fe` | TOOLS.md: MagicUI |
| CMO | `78608591-71b4-471f-a5eb-17122d8db7da` | TOOLS.md: Sender+Clarity |

Directory: 9894e3c2-3317-46ca-8c72-7a442a76a78e