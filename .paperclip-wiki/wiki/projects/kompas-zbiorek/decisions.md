---
title: Kompas Zbiórek — decyzje
type: project
tags: [decyzje, adr]
sources: [raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md]
created: 2026-08-20
updated: 2026-08-27
---

# Kompas Zbiórek — decyzje

| Data | Decyzja | Uzasadnienie | Źródło |
|---|---|---|---|
| 2026-08-20 | Single source of truth = WSPOLNY_KONTEKST.md | rozproszenie między repo/AGENTS/global | [[wiki/synthesis/single-source-of-truth]] |
| 2026-08-20 | Wiki `C:\Kompas Zbiórek\.paperclip-wiki` jako durable layer | ujednolicenie external agents knowledge source | [[wiki/entities/external-agent-knowledge]] |
| 2026-08-20 | `isolated_workspace` + `git_worktree` tylko | uniknięcie write do `main` | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-20 | Panel Google Sheets jako trwały stan | arkusz jako trwała pamięć i stan drużyny | [[wiki/entities/panel-google-sheets]] |
| 2026-08-20 | Worker `wtyczka-rr` jako cel deploya | kontrakt techniczny wdrożenia | [[wiki/entities/worker-wtyczka-rr]] |
| 2026-08-27 | Cykl docelowy = **Planowanie → Realizacja → Refleksja → Doskonalenie** | prosty model obejmujący całą pracę wokół aktywności | [[wiki/concepts/cykl-doskonalenia]] |
| 2026-08-27 | Planowanie jest głównym wejściem produktu | realnym konkurentem jest improwizacja; problem solving ma być warstwą pogłębiającą | [[wiki/projects/kompas-zbiorek/index]] |
| 2026-08-27 | AI jest opcjonalnym interfejsem do tego samego procesu | docelowy produkt ma działać także ręcznie w panelu; decyzje pozostają po stronie instruktora | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-27 | Plan ≠ wykonanie | wymagania sprawności i elementy planu potwierdza się po fakcie, nie automatycznie | [[wiki/concepts/karta-zbiorki]] |
| 2026-08-27 | Wizja produktu = TARGET / MUST-HAVE | skonceptualizowana funkcja docelowa jest obowiązkową częścią produktu, ale nie oznacza ukończonej implementacji | [[wiki/projects/kompas-zbiorek/index]] |
| 2026-08-27 | Stan działania = CURRENT / AS-IS | agent może uznać funkcję za dostępną dziś tylko na podstawie aktualnego dowodu wykonania | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-27 | DELTA = TARGET minus CURRENT | rozdzielenie wizji od bieżącego zakresu pozwala agentom planować rozwój bez fałszywych obietnic | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-27 | Onboarding = UNAPPROVED / DO NOT ASSUME | dotychczasowe wersje nie mają akredytacji produktowej; czekamy na nowy zatwierdzony flow | [[wiki/projects/kompas-zbiorek/index]] |
| 2026-08-27 | Marketing buduje proof przez demonstrację mechanizmu | brak wystarczających danych na testimonials, procenty i social proof | [[wiki/synthesis/invarianty-i-brand]] |

## Reguła statusu funkcji

Każdy agent ma rozróżniać:

- **TARGET / MUST-HAVE** — zatwierdzona funkcja docelowego produktu; ma zostać dowieziona.
- **CURRENT / AS-IS** — funkcja potwierdzona jako działająca teraz.
- **DELTA** — brakujący zakres między stanem bieżącym a wizją.
- **UNAPPROVED / DO NOT ASSUME** — pomysł lub flow bez akredytacji produktowej.

Szczegółowy opis funkcji, ekran, flow lub wymaganie w Docs nie jest automatycznie dowodem statusu CURRENT.

## Onboarding

Na dziś **nie ma zatwierdzonego onboardingu**. Poprzednie wersje i reguły maili zostały wycofane z kanonu. Nie implementować ich i nie używać jako podstawy komunikacji do czasu nowej decyzji produktowej.

## Powiązane zasady

- Wizja produktu: [[wiki/projects/kompas-zbiorek/index]].
- Rozdzielenie TARGET/CURRENT/DELTA: [[wiki/sources/wspolny-kontekst]].
- Docelowy cykl: [[wiki/concepts/cykl-doskonalenia]].
- Głos, audience i proof: [[wiki/synthesis/invarianty-i-brand]].