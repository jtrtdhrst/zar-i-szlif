---
name: kompas-design-context
description: Stały kontekst designu Kompas Zbiórek — DNA marki, typografia, mobile, hierarchia informacji i zakres pracy Designera. Always-on dla Designera; ładowany także przy recenzjach wizualnych.
---

# Kompas Design Context

## Visual DNA

- Charakter: topografia / mapy / teren / góry.
- Akcent: żółć/złoto używana oszczędnie.
- Typografia: display = serif, body = geometryczny sans.
- Hierarchia nad dekoracją; mocna, czytelna struktura informacji.

## Zakazy dekoracji

- Bez poziomic, koncentrycznych kół, gradientów, offsetowych cieni i dwukolorowych pasków jako ozdobników kart.
- Na ciemnych panelach czyste tło i kontrast tekstu; żadnych adnotacji o źródłach danych ani objaśnień technicznych w UI.
- Motywy ilustracyjne tylko z udokumentowanym zastosowaniem i właściwą skalą.
- Nie wymuszaj minimalnej wysokości kart, jeśli tworzy pustą przestrzeń.

## Reguły interfejsu

- Działanie główne najłatwiejsze do zauważenia i kliknięcia; data, godzina, etykiety i pola nie konkurują z tytułem.
- Kanoniczny komponent referencyjny (np. CTA): odwzoruj proporcje, kolory i podział elementów — bez luźnej wariacji.
- Karty 8 px, formularze 48 px, CTA pigułka.
- Minimum touch target: 44×44 px na mobile.
- Maksymalnie 1–3 fonty, spójna temperatura kolorów.

## Walidacja mobile

- Szerokości: 360, 375, 390, 412, 430.
- Bez poziomego przewijania; informacje i działania dostępne w jednej kolumnie.

## Kanoniczne źródła designu

- Skrócony brand system: `dev/design-system/BRAND-DESIGN-SYSTEM-COMPRESSED.md`.
- Pełny brand system: `dev/design-system/BRAND-DESIGN-SYSTEM.md`.
- Design system OpenDesign: `dev/design-system/opendesign/design-systems/kompas-rrp/`.
- Tokeny: `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css`.
- Runtime UI, którego dotyczy implementacja: `app/web/`.

Nie używaj `archive/` jako źródła aktualnego designu. Przy konflikcie brand systemu z runtime sprawdź bieżący task i aktualny widok, nie stary audyt.

## Zakres pracy

- Domyślna praca Designera to specyfikacja i audyt.
- Designer nie implementuje kodu produktu, chyba że task jawnie przypisuje implementację.
- Kod design systemu jest w `dev/design-system/`; kod produktu jest w `app/` — nie mieszaj tych warstw.
- Wynik audytu: priorytetyzacja jako P0/P1/P2.
