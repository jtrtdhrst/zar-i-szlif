# Skill: design-stack (Etap 27)

Warstwa integracyjna Paperclip → OpenCode → {OpenDesign, Plasmic} → GitHub.
Używaj ZAWSZE przy zadaniach dotykających UI/designu.

## Ownership (nie negocjuj — egzekwuj)

- GitHub = jedyna prawda o kodzie (React/Next, logika, Supabase, routing, API, testy, deploy).
- OpenDesign = jedyna prawda o design-systemie (tokeny, typografia, kolory, spacing, komponenty źródłowe).
- Plasmic = TYLKO kompozycja stron, layouty, sekcje, użycie zarejestrowanych komponentów.
- Implementacje powstają w OpenCode/repo. Każdy trwały rezultat → GitHub przez PR.
- ZAKAZ multi-master sync (Plasmic ↔ OpenDesign ↔ GitHub). Kierunek: OpenDesign → kontrakt → komponenty repo → kompozycja Plasmic.

## Wybór narzędzi

| Narzędzie MCP | Użycie |
|---|---|
| `open-design` (lokalne stdio) | list_projects, get/list/search plików, get_artifact — pełny odczyt + start_run generowania |
| `open-design-remote` (`design_*`, HTTP) | TYLKO odczyt dla zdalnych klientów; write-back ZABRONIONY (propozycja → Paperclip/OpenCode → walidacja → OD) |
| `plasmic` (`plasmic_*`) | Odczyt struktury + kontrolowane zapisy (lock, dryRun, idempotencja). Tworzenie przez klonowanie wpisów |
| `github` | branch → testy → PR → review → merge. NIGDY push na prod bez review |

## Routing zadań (Etap 12)

- layout/content strony → Plasmic
- design-system → OpenDesign → komponent repo → rejestracja w Plasmic
- business logic → OpenCode/repo
- większy frontend → OpenCode → GitHub
- DB/schema/backend → OpenCode → Supabase/repo (Plasmic NIE DOTYKA)

## Reguły twarde

1. Operacje Plasmic po `elementId` (iid), nie po nazwach. Nazwa → tylko do resolution, przy kolizji żądaj id.
2. Destrukcyjne: najpierw `dryRun:true`, potem zapis. `create/insert` zawsze z `idempotencyKey`.
3. Konflikt sync (`SYNC_CONFLICT`) = STOP, pokaż diff, nie nadpisuj.
4. Sekrety (service_role, hasła, tokeny OAuth) NIGDY do logów ani do kontekstu przeglądarki Plasmic.
5. Start typowego zadania: workflow `prepare_ui_task` (tokeny + komponenty + struktura Plasmic + pliki repo + rekomendacja) zamiast 30 wywołań narzędzi.
6. Supabase: Plasmic dostaje tylko operacje client-safe; service_role i migracje tylko po stronie serwera/repo.
