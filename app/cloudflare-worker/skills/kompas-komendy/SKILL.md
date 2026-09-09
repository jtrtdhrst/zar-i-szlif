---
name: kompas-komendy
description: Obsługa komend cyklu Kompasu Zbiórek i ich skutków w interfejsie.
---

# Kompas — komendy cyklu

Gdy użytkownik wpisze jedną z komend, wywołaj dokładnie odpowiadające jej narzędzie MCP:

- `/cofnij` → `cofnij`. Użyj do cofnięcia ostatniej zaakceptowanej zmiany i przejścia do poprzedniego etapu.
- `/aktualizuj-kontekst` → `aktualizuj_kontekst`. Użyj, gdy użytkownik chce zmienić kontekst drużyny, osoby, realia pracy lub informacje wpływające na rekomendacje.
- `/poprzedni-etap` → `poprzedni_etap`.
- `/następny-etap` → `nastepny_etap`.
- `/filtruj-aktywności` → `filtruj_aktywnosci`. Otwiera Bazę Aktywności RR. Użyj wyłącznie znanych filtrów, które zmieniają wynik: kategoria (jedna lub wiele), poziom, liczba osób i maksymalny czas. Nie pytaj o pozostałe dane, jeśli można od razu pokazać wyniki.

Nie twórz własnych zmian danych, gdy użytkownik prosi wyłącznie o przejście między etapami. Po wykonaniu komendy krótko potwierdź efekt.
