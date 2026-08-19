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

## Zakres pracy

- Domyślna praca Designera to specyfikacja i audyt.
- Designer nie implementuje kodu produktu, chyba że task jawnie przypisuje implementację.
- System design: `kompas-ui-design/opendesign/design-systems/kompas-rrp/` (SKILL.md, README.md, `tokens/colors_and_type.css`, `brand/`);
  instrukcje brandingowe: `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md`.
- Wynik audytu: priorytetyzacja jako P0/P1/P2.