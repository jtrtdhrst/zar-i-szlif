# Dokumentacja Kompasu Zbiórek

## Cel

Kompas Zbiórek jest interfejsem roboczym dla liderów Royal Rangers: łączy planowanie zbiórki, analizę problemu, eksperyment oraz wyszukiwanie aktywności.

## Jak działa

- **Karta aktywności** zawiera datę, obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, wynik, opinię skautów i refleksję. Dane robocze są zapisywane lokalnie w przeglądarce.
- **Karta problemu** prowadzi przez opis problemu, pięć pytań „dlaczego?”, hipotezę, eksperyment, rezultat i decyzję.
- **Plan roczny i kontekst zastępu** mają edytowalne tabele okresów, kalendarza oraz funkcji.
- **Sprawności i historia** pokazują roboczy opis do czasu podłączenia API sprawności; aplikacja nie wymyśla oficjalnych wymagań.
- **Ukończenie sprawności** (`W trakcie` → `Zrealizowane`) dodaje do tej samej lokalnej listy zadań jedno edytowalne zadanie `Wręcz naszywkę (Nazwa grupy) – Nazwa sprawności – Poziom`, ze statusem `Do zrobienia`. Wpis zawiera metadane najbliższej przyszłej aktywności z bieżącej karty lub kalendarza rocznego; bez takiej aktywności zadanie pozostaje niepowiązane. Id źródłowe sprawności zapobiega duplikatom po renderowaniu, odświeżeniu i ponownej zmianie statusu. W obecnym lokalnym UI nazwa grupy pochodzi z nazwy drużyny, a poziom z grupy programowej; podłączone API może przekazać poziom w `level` lub `poziom`.
- **Baza Aktywności RR** odczytuje dane z `https://zabawy.kompaszbiorek.pl/api/activities`. Obsługuje kategorię (wiele wartości), poziom i liczbę uczestników. Filtry są zapisane w adresie strony, wyniki pokazują wszystkie pola otrzymane z API, a dodanie aktywności uzupełnia pierwszy wolny wiersz planu.
- **Google Docs** umożliwia wybór szablonu lub własnego dokumentu przez Google Picker. Zapis w dokumencie nie jest jeszcze wdrożony: po potwierdzeniu podglądu karta pozostaje gotowa do zapisu, bez deklarowania, że dokument został zmieniony.

## Tryb zapisu

Interfejs domyślnie pracuje w trybie analizy. Przed każdą planowaną zmianą prezentuje podgląd. Potwierdzenie nie zastępuje rzeczywistego zapisu w Google Docs; po wdrożeniu integracji wymagane będą: wyraźne potwierdzenie użytkownika oraz odczyt kontrolny zmienionego fragmentu.

## Utrzymanie i wdrożenie

Źródło interfejsu znajduje się w `kompas-ui-plugin/web/src/static-app-v2.js`. Worker powstaje z `kompas-ui-plugin/cloudflare-worker/build-worker.mjs` i jest wdrażany jako `wtyczka-rr` dla `interfejs.kompaszbiorek.pl`.

Po zmianach uruchom kolejno:

1. `npm run build` w `kompas-ui-plugin`.
2. `node build-worker.mjs` w `kompas-ui-plugin/cloudflare-worker`.
3. `wrangler check` w katalogu Workera.
4. `wrangler deploy --keep-vars` w katalogu Workera.

## Testy wykonane przy tej zmianie

- kontrola zgodności filtrów i odpowiedzi narzędzia MCP z PRD Bazy Aktywności RR;
- build aplikacji;
- sprawdzenie konfiguracji Workera przed wdrożeniem;
- ręczna kontrola, że dodanie wyniku uzupełnia roboczy plan oraz że brakujące pola są oznaczane jako `Brak danych`.
