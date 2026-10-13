# Żar i Szlif — kanoniczna nazwa produktu

**Status:** zatwierdzona decyzja właściciela produktu, 2026-10-13.

- Publiczna nazwa aplikacji: **Żar i Szlif** (dokładna pisownia).
- Poprzednia nazwa „Kompas Zbiórek” to alias historyczny i uzasadniony identyfikator techniczny, nie druga aktywna marka.
- **Żar:** energia, zaangażowanie i ognisko, wokół którego wspólnie działamy.
- **Szlif:** praktyka, refleksja, małe próby i systematyczne doskonalenie.
- Nazwa łączy pracę nad rozwojem lidera z grywalizacją opartą o budowę wirtualnego obozowiska. Nie zmienia cyklu produktu, zakresu funkcjonalnego, grupy docelowej ani architektury.
- **Nie są zatwierdzone:** logotyp, slogan oraz wizualny redesign. Nie dopowiadać ich samodzielnie.

## Granice migracji

Aktualizuj bieżące napisy produktu: tytuł dokumentu HTML, tekstowy nagłówek, aktualne strony marketingowe, bieżące opisy produktu i przyszłe mailingi. Nie przemianowuj automatycznie: `kompas-zbiorek`, `kompaszbiorek.pl`, endpointów, slugów, ścieżek Wiki, importów, sekretów, kluczy localStorage, nazw baz, istniejących plików klientów ani historii decyzji. Historyczne materiały nie są aktywnymi źródłami aktualnej marki.

## CURRENT, nie deklaracja wdrożenia

Ta decyzja dotyczy nazwy **TARGET/brand**. Aktualność produkcyjnego UI wymaga osobnej weryfikacji deployed SHA i browser acceptance. Repozytorium i `.paperclip-wiki/` są stanem źródeł / snapshotem, **nie** potwierdzają zapisu do żywego Paperclip Wiki. Kanoniczne aktywne Wiki należy zmienić odczyt → propose → apply(expectedHash) → read-back, a potem przeprowadzić przegląd przez osobę inną niż autor.

## Test regresji

`tests/brand-contract.test.mjs` uruchamia się przez rootowe `npm test` / `npm run validate:code` i zabezpiecza kluczowe publiczne etykiety przed powrotem do nazwy historycznej. Pozostałe treści onboardingowe mogą wymagać osobnej akceptacji, zanim będą wysyłane; sam rebranding repo nie uruchamia kampanii.
