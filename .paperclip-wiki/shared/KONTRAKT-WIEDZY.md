# Kontrakt wiedzy agentów Kompas Zbiórek

Ten kontrakt ustala, skąd agent bierze fakty produktowe i jaki status mają poszczególne informacje. Zapobiega kopiowaniu tych samych faktów do wielu promptów oraz trzymaniu przestarzałego cyklu jako aktywnego kontraktu.

## Cztery statusy wiedzy

| Status | Plik źródłowy | Co opisuje | Dowód / źródło |
|---|---|---|---|
| **TARGET / MUST-HAVE** | `shared/PRODUCT.md` | Co produkt MUSI być; w tym docelowy cykl user-facing | Decyzja produktowa, [KOMAA-48](/KOMAA/issues/KOMAA-48) (TO-BE) |
| **CURRENT / AS-IS** | `shared/STATE.md` | Co jest zweryfikowane dziś (stan, integracje, bieżący cykl) | Implementacja, [KOMAA-48](/KOMAA/issues/KOMAA-48) (AS-IS) |
| **DELTA** | [KOMAA-48](/KOMAA/issues/KOMAA-48) | Różnica między TARGET a CURRENT | Issue KOMAA-48 |
| **UNAPPROVED** | onboarding (CMO) | Brak akredytacji produktowej — DO NOT ASSUME | [[wiki/projects/kompas-zbiorek/decisions]] |

## Docelowy cykl (TARGET)
**Planowanie → Realizacja → Refleksja → Doskonalenie** — to kontrakt docelowy w `shared/PRODUCT.md`.

## Bieżący cykl (CURRENT / AS-IS)
**Planowanie → Realizacja → Analiza → Decyzja** — udokumentowany stan obecny w `shared/STATE.md` (źródło: [KOMAA-48](/KOMAA/issues/KOMAA-48), AS-IS). Nie jest to już aktywny kontrakt docelowy; DELTA do docelowego prowadzi KOMAA-48.

## Reguły dla ról
- **AGENTS (wszystkie):** nie kopiuj faktów produktowych do własnego promptu. Czytaj `shared/PRODUCT.md` (TARGET) i `shared/STATE.md` (CURRENT) przez `../../shared/...`. Szczegóły w `CONTEXT.md`.
- **CMO:** publish gate = **CURRENT**. Publikuj / komunikuj tylko to, co jest zweryfikowane jako CURRENT/AS-IS (`STATE.md`). Nie publikuj TARGET (`PRODUCT.md`) ani UNAPPROVED (onboarding) jako żywej funkcji.
- **Engineer / CTO / Designer / UI QA:** pracuj w kombinacji **TARGET (`PRODUCT.md`) + CURRENT (`STATE.md`) + acceptance bieżącego issue**. Nie traktuj TARGET jako stanu obecnego i odwrotnie.
- **Onboarding:** pozostaje **UNAPPROVED / DO NOT ASSUME** do czasu zatwierdzenia produktowego.

## Zasady
- `PRODUCT` opisuje cel, `STATE` opisuje stan z dowodem. Nie odwracaj ról.
- Stary cykl (Analiza → Decyzja) występuje wyłącznie jako CURRENT/AS-IS w `STATE.md`, nigdy jako aktywny kontrakt w promptach operacyjnych.
