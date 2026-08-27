# Stan produktu — Kompas Zbiórek (CURRENT / AS-IS)

> Zweryfikowany stan obecny (CURRENT/AS-IS) z dowodem. Cel: `shared/PRODUCT.md` (TARGET). Kanon statusów: `shared/CONTEXT.md`. `last_verified`: 2026-08-27.

## Bieżący cykl user-facing (AS-IS)

**Planowanie → Realizacja → Analiza → Decyzja** — udokumentowany stan obecny (źródło: KOMAA-48, AS-IS). Tylko Planowanie ma checkpointy (Cel i sprawności, Przebieg, Przygotowanie); etapy 2–4 nie mają zatwierdzonych podzadań ani bramek.

> Docelowy kontrakt to **Planowanie → Realizacja → Refleksja → Doskonalenie** (zob. `PRODUCT.md`); różnica (DELTA) w KOMAA-48.

## Integracje (stan, last_verified 2026-08-27)

| Integracja | Status | Zasada | Evidence |
|---|---|---|---|
| Baza aktywności RR | odczyt przez Worker | filtry `category`, `level`, `energy`, `participants`; brak paginacji | Worker `caches.default` + IndexedDB |
| API sprawności | odczyt przez Worker (v14 zweryfikowane) | `pobierzSprawnosciRR`: 1 poziom, 1 wywołanie na odpowiedź | Dokumentacja_API_SPRAWNOSCI.md v14 |
| API daty/godziny | zablokowane | strefa `Europe/Warsaw` | — |
| Google Sheets | wdrożone | `POST /panel/save`, `drive.file` | panel-handler.ts |

## Invarianty (obowiązujące teraz)

Patrz `shared/DELIVERY.md` → Architektura i invarianty. Nie zmieniaj bez upoważnienia.

## UNAPPROVED

Onboarding (Docs/Wiki) = **UNAPPROVED / DO NOT ASSUME** — brak akredytacji produktowej. Nie używać jako wymagania ani bieżącego flow. Źródło: wiki/projects/kompas-zbiorek/decisions.

## Brak wpisu = UNKNOWN / VERIFY

Każda informacja o stanie, której nie ma w tym pliku ani w powiązanym dowodzie, ma status **UNKNOWN** — nie zakładaj, że działa. Zweryfikuj przed użyciem jako CURRENT.

## Zasady

- Weryfikacja wymaga dowodu; sam status issue nie jest dowodem implementacji.
- CMO publikuje na podstawie tego pliku (CURRENT), nie `PRODUCT.md` (TARGET).
