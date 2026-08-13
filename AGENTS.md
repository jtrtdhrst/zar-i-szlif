# Instrukcje dla agentów

## Zakres edycji

- Edytuj, twórz, przenoś i usuwaj wyłącznie pliki znajdujące się w katalogu `C:\Kompas Zbiórek` lub jego podkatalogach.
- Nie modyfikuj plików poza `C:\Kompas Zbiórek`.
- Nie przenoś plików poza `C:\Kompas Zbiórek`.
- Nie twórz kopii tego projektu w innym katalogu.
- Przed edycją sprawdź, czy ścieżka docelowa zaczyna się od `C:\Kompas Zbiórek\`.

## Zasady projektu

- Zachowuj język polski i istniejące nazwy plików.
- Używaj `apply_patch` do ręcznej edycji plików.
- Nie usuwaj istniejących treści ani plików bez wyraźnego polecenia użytkownika.
- Po zmianach sprawdź linki wikilink, strukturę Markdown i spójność dokumentacji.
- Przy zmianach prompta, PRD lub dokumentacji API zaktualizuj powiązane odwołania w tym samym katalogu.

## Stały sposób pracy

Przy każdej zmianie produktu wykonaj tę kolejność:

1. Przeczytaj aktualne PRD oraz dokumentację API dotyczącą zmienianego obszaru.
2. Porównaj wymagania z istniejącą implementacją i zapisz brakujące lub niespójne funkcje.
3. Wprowadź najmniejszą kompletną zmianę, która realizuje wymaganie i nie udaje działania niedostępnej integracji.
4. Uruchom właściwe testy, kontrolę składni oraz build; dla zmian UI sprawdź również widok desktopowy i mobilny.
5. Uzupełnij `documentation.md` w katalogu głównym: opisz funkcję, sposób użycia, źródła danych, ograniczenia i wykonane testy. Jeżeli plik nie istnieje, utwórz go.

Nie oznaczaj funkcji jako gotowej, jeśli test, build, wdrożenie albo wymagany zapis do dokumentacji nie został wykonany.

## Zasady UX i danych

- Nie zastępuj wymaganych danych roboczych tekstem typu „uzupełnij gdzie indziej”. Jeżeli dane są potrzebne w karcie, pokaż edytowalne pole albo jawny, nieblokujący stan braku danych.
- Karta zbiórki jest samowystarczalnym artefaktem roboczym: zawiera dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy oraz refleksję.
- Dla powtarzalnych danych stosuj czytelne tabele z nagłówkami i wierszami edytowalnymi: zadania, plan, wymagania sprawności, plan roczny, kalendarz, funkcje i historia eksperymentów.
- Nie wymyślaj wymagań sprawności ani danych z integracji. Gdy API nie jest podłączone, pokaż jasny stan braku danych i pozwól wyłącznie na roboczy opis użytkownika.
- Przed zmianą UI porównaj widoki z aktualnym PRD, szablonem dokumentu drużyny i dokumentacją API. Nie redukuj wymaganych pól do demonstracyjnych skrótów bez wyraźnej zgody użytkownika.
- Po zmianach UI sprawdź build, składnię oraz czytelność desktopową i mobilną; weryfikuj kolejność: nagłówek, kontekst, działanie, dane robocze.

## Obowiązkowe wdrożenie Cloudflare

- Docelowym Workerem produkcyjnym jest `wtyczka-rr`, z powiązaną domeną interfejsu `interfejs.kompaszbiorek.pl`. Nie wdrażaj tego projektu na `kompas-zbiorek` ani nie twórz zastępczych Workerów.
- Po każdej zmianie w `kompas-ui-plugin` zbuduj całość i wdroż aktualną wersję produkcyjną Workera `wtyczka-rr` na Cloudflare przed zgłoszeniem zadania jako ukończonego.
- Kolejność jest stała: `npm run build` w `kompas-ui-plugin`, `node build-worker.mjs` w `kompas-ui-plugin\cloudflare-worker`, `wrangler check`, a następnie `wrangler deploy --keep-vars` w katalogu Workera.
- Po wdrożeniu podaj użytkownikowi adres produkcyjny oraz identyfikator wersji zwrócony przez Wrangler.
- Jeśli wdrożenie jest zablokowane, nie przedstawiaj zmiany jako wdrożonej; podaj dokładną przyczynę i gotowy krok potrzebny do wznowienia.

## Plik bazy aktywności

Kanoniczny plik PRD i dokumentacji API bazy aktywności znajduje się tutaj:

`C:\Kompas Zbiórek\PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`

Przy pracy nad Bazą Aktywności RR edytuj ten plik oraz powiązane pliki wyłącznie w katalogu `C:\Kompas Zbiórek`.
