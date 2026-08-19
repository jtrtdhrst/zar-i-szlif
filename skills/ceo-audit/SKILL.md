---
name: ceo-audit
description: Codzienna kontrola wykonania zespołu — audyt marnowania pracy, tokenów i złych operacji u pozostałych agentów. Używaj, gdy masz wykonać rutynę „CEO Audit wykonania” albo gdy issue, nad którym pracujesz, jest oznaczone etykietą `ceo-audit`. Wykrywa wzorce nieefektywności (rework, powtórzone błędy, martwe runy) i przekazuje je do poprawki w `ceo-retro`.
---

# CEO Audit wykonania

## Overview

Codzienna, lekka kontrola wykonania zespołu. Przeszukujesz dane wykonawcze, wykrywasz marnowanie pracy i tokenów u pozostałych agentów oraz decydujesz o jednym następnym kroku: poprawka prompta/skilla (via `ceo-retro`), nowe issue naprawcze albo brak działania. Cel: zatrzymać utratę tokenów, zanim retro (tygodniowe) je dopiero zauważy.

**Najważniejsza zasada**: ten skill jest wyłącznie dla CEO (nie jest częścią supersetu 6 agentów). Nie rozgłaszaj go innym agentom.

## Źródła danych

Audyt oparty jest na danych, które faktycznie istnieją. Brak telemetrii liczników tokenów — nie ma `/api/runs` ani `/api/usage`, a run-logi to strumienie stdout bez pól `usage`. Mierz więc metryki proxy marnowania pracy:

1. **Paperclip MCP** (narzędzia `paperclip_*`): issue ze statusami i cyklami, komentarze, dokumenty (plany, raporty), heartbeat.
   - Metryki: liczba cykli na issue, reopen, powtórne review, wstrzymane/eskalowane assignee, issue bez postępu.
2. **Run-logi** lokalne: `C:\Users\milos\.paperclip\instances\default\data\run-logs\{companyId}\{agentId}\*.ndjson`
   - Sygnały: powtarzane błędy (np. `RegionError` / `403` — model niedostępny w regionie), retry loop, runy kończące się od razu błędem, martwe runy bez aktywności.
3. **Workspace operation logs**: `C:\Users\milos\.paperclip\instances\default\data\workspace-operation-logs\{companyId}\*.ndjson`
   - Sygnały: tworzenie worktree i sprawdzanie bez realnej pracy, operacje git bez zmian.
4. **Rozmiary promptów**: `C:\Users\milos\.paperclip\instances\default\companies\{companyId}\agents\{agentId}\instructions\`
   - Puchnięcie AGENTS.md/CONTEXT.md = wzrost kosztów kontekstu u danego agenta.

## Workflow

### 1. Zbierz dane (maks. ~10 minut)

- Pobierz issue z ostatnich 24–48 h: nowe, w toku, wstrzymane, zakończone (Paperclip MCP).
- Otwórz run-logi agentów aktywnych w tym przedziale; szukaj błędów i retry.
- Porównaj rozmiar plików instructions (przyrost od ostatniego audytu, jeśli dostępny).

### 2. Przeanalizuj wzorce

Szukaj wzorców, nie pojedynczych zdarzeń. Sygnały uwagi:
- Ten sam błąd API powtórzony >2× w runie jednego agenta (marnowany czas + tokeny na retry).
- Issue z reopen lub wieloma cyklami review bez zmiany zakresu.
- Agent długo „idle” z przypisanym in_progress, albo eskalujący do paused przełożonego.
- Prompt agenta znacząco większy niż standard (puchnący kontekst).
- Powtórzone budowanie/deploy bez zmian (jeśli widoczne w logach).

### 3. Decyzja: jeden następny krok

| Sygnał | Działanie |
|---|---|
| Powtórzony błąd wykonawczy (wzorzec) | Komentarz + dopisek do dokumentu `ceo-audit`; przekaż do poprawki w następnym `ceo-retro` z dowodem |
| Issue wstrzymane/eskalowane bez właściciela | Wznowij albo przenumeruj assignee; komentarz z rekomendacją |
| Puchnący prompt jednego agenta | Zaproponuj refaktoryzację kontekstu (skill `context-refactor`) — nie tnij sam bez zgody |
| Pojedyncze zdarzenie bez wzorca | Brak działania — tylko zapis |

**Zakaz**: nie zmieniaj promptów ani skilli innych agentów w tym skille samodzielnie. To domena `ceo-retro` (poprawki poparte dowodami). Tu tylko wykrywasz i porządkujesz dowody.

### 4. Zapis

Zapisz wynik w dokumencie `ceo-audit` na issue rutyny (aktualne issue):
- **Wykryte sygnały** — co i gdzie (agent → issue → dowód).
- **Decyzje** — co robisz dalej (nic / issue naprawcze / rekomendacja retro).
- **Metryki** — liczba cykli, reopen, retry, rozmiar promptów (dla trendu dzień do dnia).

### 5. Działanie

- Jeśli sygnał wymaga poprawki prompta/skilla → utwórz pod-issue dla `ceo-retro` z dowodem, albo zostaw wpis w `ceo-audit` do najbliższego retro.
- Jeśli to bug produktu/integracji → utwórz issue naprawcze (np. dla CTO/Engineer).
- Jeśli nic → zamknij krótkim komentarzem.

## Granice

- Brak telemetrii tokenów — nie zgłaszaj „kosztów modelu” jako liczby, których nie ma w danych.
- Nie eskaluj bez dowodu; pojedynczy błąd nie jest wzorcem.
- Nie modyfikuj cudzych promptów ani nie przydzielaj pracy za innego agenta bez wyraźnego upoważnienia.
