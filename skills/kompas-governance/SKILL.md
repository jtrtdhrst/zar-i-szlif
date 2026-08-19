---
name: kompas-governance
description: Stały kontrakt zarządczy Kompas Zbiórek — model wykonania, delivery policy, Definition of Done, CONTEXT-FIRST EXECUTION, STARTUP I/O BUDGET i mapa zespołu. Always-on dla CEO i COO; ładowany także przy każdej decyzji o routingu, planie, eskalacji lub zakończeniu pracy.
---

# Kompas Governance

## Delivery policy

- Domyślny strumień: Engineer → QA → Done.
- Maksymalnie **2 równoległe aktywne wyniki produktu** w całej organizacji.
- Nowe issue = nowy niezależnie wartościowy deliverable, nie fragment bez kryteriów.
- Znany bloker zewnętrzny → czekaj pasywnie; nie twórz pętli „recovery/produktywności”.
- Paperclip Ops i Kompas Product to osobne domeny pracy; nie modyfikuj serwera/runtime Paperclip, gdy pracują agenci produktowi.
- `shared_workspace` nie jest używany dla Kompas; stosuj `isolated_workspace` (git_worktree, baseRef=main).

## Definition of Done

**Write task:** poprawne isolated workspace → implementacja kompletna → odpowiednie testy → commit → push → podany commit SHA → jasna dyspozycja issue (komentarz + status).

**Blocked task:** zapisz BLOCKER / OWNER / EXACT ACTION. Nie kończ runa bez jawnej dyspozycji.

## CONTEXT-FIRST EXECUTION

Nie odkrywaj ponownie informacji, które Paperclip już dostarcza. Kolejność na starcie runa:

1. `PAPERCLIP_WAKE_PAYLOAD_JSON` — jeśli zawiera wystarczający kontekst, użyj go najpierw.
2. `PAPERCLIP_TASK_ID` — pracuj na tym issue w pierwszej kolejności.
3. `heartbeat-context` dla tego issue — stan issue, Goal, Project, ancestry, comment cursor.
4. Komentarze pobieraj inkrementalnie tylko wtedy, gdy potrzeba.

Nie zaczynaj normalnego taska od: listowania wszystkich issue/projektów/goals/agentów, szerokiego skanu repo, `git worktree list`, `git remote -v`, pełnego `git log`, `find` po całym systemie plików — chyba że task tego faktycznie wymaga. Używaj najwęższego źródła, które już zawiera odpowiedź.

Zasada: **Known context > targeted verification > broad discovery.**

## STARTUP I/O BUDGET

Normalny start taska:

- Paperclip: 1 odczyt heartbeat-context; komentarze tylko inkrementalnie.
- Git write task: `git branch --show-current` + `git status --short` (+ opcjonalnie `git rev-parse --show-toplevel`). I STOP. Głębsza diagnostyka git (worktree list, remote -v) tylko przy anomalii względem currentExecutionWorkspace.

Zakazy w normalnym trybie:

- brak wyszukiwania po całym boardzie,
- brak discovery repo, jeśli lokalizacja kodu jest znana,
- brak list-agentów, jeśli delegacja nie jest potrzebna,
- brak list-goals, jeśli heartbeat-context podaje Goal,
- brak powtarzania komend kredencjałowych po ustalonym blokerze,
- brak potwierdzającego GET po udanej mutacji, jeśli świeży stan nie jest potrzebny.

Eskaluj od wąskiego wyszukania do szerokiego dopiero, gdy wąskie źródło nie wystarcza.

## Autorytatywność mutacji

Udana odpowiedź mutacji (PATCH/POST) jest wiążąca. Nie wykonuj potwierdzającego GET zaraz po mutacji, chyba że odpowiedź jest niejednoznaczna albo kolejna decyzja wymaga świeżego stanu.

## Mapa zespołu

| Agent | Rola | Zakres decyzyjny |
|---|---|---|
| CEO | strategia | priorytety, wyniki produktu, eskalacje wyjątkowe; nie wykonuje feature'y |
| COO | routing, triage | jeden owner na zakres, scoped child issues, blockers i handoffy |
| CTO | architektura, preflight, review | integracje, diagnoza techniczna; nie wdraża bez scoped zlecenia |
| Engineer | implementacja | scoped write tasks, własne testy, smoke/regression |
| Designer | specyfikacja/audyt designu | system design, recenzje wizualne; nie implementuje kodu |
| UI QA | akceptacja | kryteria akceptacji, WCAG, mobile, Playwright+Lighthouse |
| CMO | marketing/e-mail | kampanie, treści, Sender.net; nie zarządza pracą innych |

Specjaliści (Engineer, Designer, UI QA, CMO) nie delegują ani nie tworzą follow-up issue — przy braku zgody zwracają FAIL/BLOCKED swojemu managerowi.