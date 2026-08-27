# Stan produktu — Kompas Zbiórek (CURRENT / AS-IS)

> Ten plik opisuje **zweryfikowany stan obecny** (CURRENT/AS-IS) z dowodem. Cel: `shared/PRODUCT.md` (TARGET). Kontrakt ról: `shared/KONTRAKT-WIEDZY.md`.

## Bieżący cykl user-facing (AS-IS)
**Planowanie → Realizacja → Analiza → Decyzja** — udokumentowany stan obecny (źródło: [KOMAA-48](/KOMAA/issues/KOMAA-48), AS-IS). Tylko Planowanie ma checkpointy: Cel i sprawności, Przebieg, Przygotowanie. Etapy 2–4 nie mają zatwierdzonych podzadań ani bramek.

> Docelowy kontrakt to **Planowanie → Realizacja → Refleksja → Doskonalenie** (zob. `PRODUCT.md`). Różnica (DELTA) w [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Integracje (stan)
| Integracja | Status | Zasada |
|---|---|---|
| Baza aktywności RR | odczyt przez Worker | filtry `category`, `level`, `energy`, `participants`; brak paginacji |
| API sprawności | odczyt przez Worker (v14 zweryfikowane) | `pobierzSprawnosciRR`: 1 poziom, 1 wywołanie na odpowiedź |
| API daty/godziny | zablokowane | strefa `Europe/Warsaw` |
| Google Sheets | wdrożone | `POST /panel/save`, `drive.file` |

## Invarianty (obowiązujące teraz)
Patrz `shared/PRODUCT.md` → Invarianty techniczne. Nie zmieniaj bez upoważnienia.

## UNAPPROVED
Onboarding (Docs/Wiki) = **UNAPPROVED / DO NOT ASSUME** — brak akredytacji produktowej. Nie używać jako wymagania ani bieżącego flow. Źródło: [[wiki/projects/kompas-zbiorek/decisions]].

## Zasady
- Weryfikacja wymaga dowodu; sam status issue nie jest dowodem implementacji.
- CMO publikuje na podstawie tego pliku (CURRENT), nie `PRODUCT.md` (TARGET).
