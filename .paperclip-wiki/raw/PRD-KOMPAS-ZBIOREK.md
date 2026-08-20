# PRD: Kompas Zbiórek

**Wersja:** 1.7  
**Status:** uporządkowany zakres produktu  
**Produkt:** Wtyczka ChatGPT + własny interfejs (https://interfejs.kompaszbiorek.pl) dla liderów Royal Rangers Polska

## 1. Cel produktu

Kompas Zbiórek pomaga liderowi planować zbiórki i wyjazdy oraz prowadzić małe, bezpieczne cykle doskonalenia pracy drużyny. System zamienia obserwacje z działań w jeden priorytetowy problem, praprzyczynę operacyjną, sprawdzalną zmianę, serię prób i wiedzę możliwą do ponownego użycia.

Produkt ma poprawiać jakość decyzji lidera, a nie podejmować decyzje za niego. Domyślny cykl trwa około dwóch tygodni, lecz powinien wynikać z liczby rzeczywistych okazji do sprawdzenia zmiany.

## 2. Użytkownik

Głównym użytkownikiem jest lider planujący i podsumowujący pracę drużyny Royal Rangers. Użytkownik zna lokalne warunki, odpowiada za decyzje i zatwierdza każdy zapis do dokumentu drużyny.

## 3. Zakres

### W zakresie obecnej wersji

- podsumowanie zbiórki lub wyjazdu;
- wybór jednego priorytetowego problemu;
- analiza praprzyczyny operacyjnej;
- budowa hipotezy zmiany i warunku docelowego;
- projekt, ocena i prowadzenie małego eksperymentu;
- interpretacja wyników, decyzja i zapis wiedzy;
- planowanie zbiórki lub wyjazdu na podstawie celu i kontekstu;
- wyszukiwanie gotowych aktywności z Bazy Aktywności RR według warunków zbiórki;
- praca w domyślnym trybie analizy oraz kontrolowany tryb zapisu;
- przechowywanie kontekstu i stanu cyklu w jednym arkuszu Google Sheets na drużynę;
- używanie dat i terminów w strefie `Europe/Warsaw`;
- przygotowanie jawnego, edytowalnego artefaktu roboczego w ChatGPT Canvas, gdy interfejs go udostępnia.

### Integracje

- API sprawności ma zweryfikowany kontrakt `pobierzSprawnosciRR` opisany w [[Dokumentacja API SPRAWNOŚCI]]; wymaga podłączenia OpenAPI jako Action.
- API stopni nie jest dostępne i pozostaje integracją planowaną.
- API czasu ma bazowy URL `https://data.i.godzina.kompaszbiorek.pl` i opis odpowiedzi, ale pozostaje zablokowane do chwili podania URL OpenAPI.
- Operacje Google Sheets (wybór arkusza lub utworzenie kopii szablonu, zapis karty) są wdrożone w panelu `/panel` i opisane w `dokumentacja-integracji-kompas-zbiorek.md`.

System nie może wymyślać ani przedstawiać jako oficjalnych wymagań, których nie zwróciło podłączone API albo aktualny oficjalny dokument.

## 4. Główne przypadki użycia

1. Użytkownik opisuje ostatnią zbiórkę, a system pomaga oddzielić fakty od ocen i wybrać problem.
2. Użytkownik analizuje, co podtrzymuje problem, aż osiągnie próg wiedzy wystarczający do następnej decyzji.
3. Użytkownik buduje małą zmianę, którą można bezpiecznie sprawdzić w realnych warunkach.
4. Użytkownik zapisuje kolejne próby i ocenia jakość dowodu, nie tylko kierunek wyniku.
5. Użytkownik zamienia wynik w decyzję i warunkową regułę działania.
6. Użytkownik planuje następną zbiórkę lub wyjazd z użyciem kontekstu drużyny i ostatnich wniosków.
7. Użytkownik przegląda po około dwóch tygodniach, czy wdrożona praktyka nadal działa bez nadzwyczajnego wysiłku.

## 5. Cykl doskonalenia (aktualny kontrakt produktu)

Aktualny, widoczny dla użytkownika cykl ma cztery etapy: **Planowanie → Realizacja → Analiza → Decyzja**. Stan AS-IS, zatwierdzony TO-BE i DELTA są prowadzone w [KOMAA-48](/KOMAA/issues/KOMAA-48).

### Etap 1 — Planowanie

Jedynymi zatwierdzonymi systemowymi checkpointami są:

1. **Cel i sprawności** — `Dodaj cel i wybierz sprawność`.
2. **Przebieg** — `Uzupełnij plan godzinowy`.
3. **Przygotowanie** — `Dodaj zadanie`.

Checkpointy nie są zadaniami tworzonymi przez użytkownika.

### Etapy 2–4

Nie zdefiniowano zatwierdzonych podzadań ani bramek dla Realizacji, Analizy i Decyzji. Nie należy ich wyprowadzać ze starszej metodyki ani dodawać do kontraktu produktu.

### Materiał historyczny

Model `00`–`06` oraz opis dawnych kroków są **HISTORYCZNYM/METODOLOGICZNYM** materiałem traceability. Nie stanowią aktualnego kontraktu user-facing ani zatwierdzonego mapowania na cztery etapy.

### Zadania użytkownika i stałe kroki milowe

- Zadania operacyjne i przygotowawcze ustala użytkownik. Użytkownik może dodawać, edytować, przypisywać, łączyć ze zbiórką, zmieniać status oraz usuwać te zadania.
- Strona główna musi zawierać widoczną listę zadań użytkownika. Lista pokazuje zadania nieukończone, pozwala dodać nowe zadanie oraz zmienić jego nazwę i status bez opuszczania strony głównej. Dane zapisują się w tym samym roboczym szkicu co karta aktywności.
- Kroki milowe w kontekście realizacji etapów doskonalenia są stałym kontraktem systemu. System ustawia je automatycznie i wylicza ich postęp na podstawie danych wprowadzonych przez użytkownika.
- Kroki milowe nie są zadaniami użytkownika, nie mogą być dopisywane do jego listy ani zastępować jego zadań. Ręczne zaznaczenie etapu może być dostępne jako korekta stanu, ale nie zmienia stałej listy kroków.
- Na stronie głównej lista zadań użytkownika i trasa kroków milowych muszą być prezentowane jako dwa odrębne elementy interfejsu.

### Automatyczne zadanie po ukończeniu sprawności

- Po oznaczeniu sprawności jako ukończonej system automatycznie dodaje zadanie wręczenia naszywki.
- Nazwa zadania ma format: `Wręcz naszywkę (Nazwa grupy) – Nazwa sprawności – Poziom`.
- Jeżeli istnieje zaplanowana kolejna aktywność (najbliższa zbiórka lub wyjazd), system łączy zadanie z tą aktywnością; jeżeli nie ma takiej aktywności, zadanie trafia wyłącznie na listę zadań użytkownika.
- Zadanie jest tworzone jako nieukończone i podlega tym samym regułom co zadania dodane ręcznie: użytkownik może je edytować, zmieniać status oraz usuwać.
- Automatyczne zadanie nie jest krokiem milowym i nie zmienia stałej listy kroków doskonalenia.

## 6. Tryby pracy

### Tryb analizy

- Jest trybem domyślnym.
- System na początku rozmowy komunikuje `TRYB: ANALIZA`.
- System może czytać potrzebny kontekst, porządkować dane i tworzyć podgląd artefaktu.
- System nie zmienia zapisanych danych w arkuszu Google Sheets.

### Tryb zapisu

- Dotyczy jednej, dokładnie opisanej operacji.
- Przed zapisem system pokazuje miejsce docelowe i pełny podgląd treści.
- System pyta: `Czy zapisać dokładnie ten podgląd?`.
- Zapis następuje wyłącznie po jednoznacznym potwierdzeniu użytkownika.
- Zmiana podglądu unieważnia wcześniejsze potwierdzenie.
- Po zapisie system ponownie odczytuje zmieniony fragment i potwierdza rzeczywisty rezultat.
- Po zakończeniu operacji system wraca do trybu analizy.
- Błąd narzędzia nie może być przedstawiony jako udany zapis.

## 7. Dokument drużyny

Każda drużyna korzysta z jednego arkusza Google Sheets utworzonego na podstawie szablonu arkusza (struktura treści według `SZABLON GOOGLE DOCS.md`). Arkusz zawiera:

- trwały kontekst drużyny;
- jeden aktywny cykl doskonalenia;
- rejestr ostatnich działań i prób;
- zaakceptowane reguły operacyjne;
- archiwum zamkniętych cykli.

Nagłówki arkusza są kontraktem integracji: kolumny mapowane po znormalizowanych nazwach (aliasy pól z `SHEET_FIELDS`), a karta zbiórki jest dopisywana jako nowy wiersz zamiast niestrukturyzowanego tekstu na końcu.

### 7.1. Karty robocze interfejsu

Interfejs nie może redukować dokumentu drużyny do pojedynczych pól opisowych ani odsyłać lidera do innego widoku po podstawowy kontekst. Każda karta ma być czytelnym, samowystarczalnym artefaktem roboczym.

- **Karta aktywności / zbiórki:** numer i tytuł, data i obecność, realizowane sprawności oraz wymagania, eksperyment, cel, tabela przygotowania (`osoba`, `zadanie`, `status`), tabela planu (`godzina`, `aktywność`, `aspekt`, `osoba`, `materiały`) oraz refleksja (`wynik eksperymentu`, `opinia skautów`, `wnioski`).
- **Karta problemu:** problem, pięć kolejnych pytań „dlaczego?”, hipoteza przyczyny, eksperyment (`co testujemy`, `czego się spodziewamy`) oraz wynik i decyzja (`rezultat`, ocena hipotezy, wnioski).
- **Plan roczny:** temat roczny, jedna tabela okresów `IX–X` do `V–VI` z kolumnami `kierunek`, `efekt etapu`, `program`, a także kalendarz zbiórek i wydarzeń.
- **Kontekst zastępu:** grupa programowa, liczba zapisanych i typowa frekwencja, cel długoterminowy, charakter zastępu, styl prowadzenia, poziom samodzielności i współpracy, podział funkcji oraz dodatkowe informacje bez danych wrażliwych.
- W tabeli podziału zadań i funkcji (kolumny `Osoba`, `Funkcja`, `Zakres zadań / odpowiedzialności`) pole `Osoba` pierwszego wiersza jest automatycznie uzupełniane nazwą zalogowanego użytkownika z konta Google, o ile nie zawiera już wpisanej wartości. Pole pozostaje edytowalne, a użytkownik może je zmienić lub wyczyścić jak każde pole karty.
- Wybór godziny (domyślna godzina aktywności w kontekście zastępu oraz godziny rozpoczęcia i czasu trwania w planie zbiórki) odbywa się w krokach co 5 minut, a nie co 1 minutę.
- W pickerze katalogu sprawności (pole „Filtruj katalog") filtrowanie listy wyników odbywa się z opóźnieniem debounce (~300 ms) od ostatniego naciśnięcia klawisza, a nie natychmiast po każdym znaku. Zapobiega to widocznej pauzie przy wpisywaniu i pozwala na płynne przeszukiwanie katalogu.
- **Sprawności i historia:** wymagania i ich statusy pochodzą wyłącznie z API sprawności; historia zawiera aspekty programu oraz tabelę problemów, hipotez, rezultatów i wniosków z eksperymentów. Po oznaczeniu sprawności jako ukończonej system dodaje automatyczne zadanie wręczenia naszywki zgodnie z sekcją 5.
- W historii sprawności widoczny jest napis `Wymagania na stopień` z licznikiem postępu w formie `liczba spełnionych / wymagana`, osobno dla każdego z czterech aspektów programu. Wymagana liczba sprawności na stopień zależy od poziomu: **Odkrywcy — 4**, **Zwiadowcy — 3**, **Wędrownicy — 2**. Gdy w danym aspekcie zostanie osiągnięta wymagana liczba sprawności, ten aspekt (1 z 4) podświetla się na zielono i otrzymuje tick obok licznika; pozostałe aspekty pozostają bez podświetlenia, dopóki nie spełnią własnego wymagania.

Jeśli informacja z planu rocznego lub integracji nie istnieje, karta pokazuje edytowalne miejsce na roboczy opis albo jawny stan braku danych. Nie używa komunikatów blokujących typu „uzupełnij w planie rocznym”.

## 8. Źródła wiedzy historycznej / metodologicznej

Poniższe materiały zachowują traceability starszej metodyki; nie definiują aktualnych etapów produktu:

- [[00_ANALIZA_PROBLEMU]]
- [[01_PRAPRZYCZYNA_OPERACYJNA]]
- [[02_HIPOTEZA_I_EKSPERYMENT]]
- [[03_OCENA_I_PROWADZENIE_EKSPERYMENTU]]
- [[04_WNIOSKI_I_WIEDZA]]
- [[05_PLANOWANIE_ZBIORKI_I_WYJAZDU]]
- [[06_CYKL_DOSKONALENIA]]
- [[PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR]]

Nie używaj tych materiałów do definiowania nowych checkpointów, podzadań lub bramek bieżącego czteroetapowego cyklu.

## 9. Narzędzia

### Data i czas

Narzędzie zwraca aktualną datę i czas dla strefy `Europe/Warsaw`. System używa go, gdy znaczenie zależy od sformułowań względnych, takich jak „dwa dni temu”, „za tydzień” lub „następny piątek”.

### Google Sheets

Panel `/panel` umożliwia:

- wybór istniejącego arkusza drużyny (link lub Google Picker);
- utworzenie arkusza z szablonu (`SHEETS_TEMPLATE_FILE_ID`);
- zapis karty zbiórki do wskazanego arkusza po potwierdzeniu (`POST /panel/save`);
- potwierdzenie rzeczywistego rezultatu zapisu (zwrócony zakres wiersza).

### Sprawności Royal Rangers

Po podłączeniu OpenAPI operacja `pobierzSprawnosciRR` jest źródłem sprawności i ich wymagań. Obowiązuje przepływ z [[Dokumentacja API SPRAWNOŚCI]]: jeden poziom, najwyżej jedno wywołanie na odpowiedź i brak ponowienia po błędzie.

### Stopnie Royal Rangers

Integracja jest planowana. Do jej dodania system korzysta wyłącznie z aktualnego oficjalnego dokumentu przekazanego przez użytkownika albo jawnie oznacza brak źródła.

## 10. Canvas

Canvas służy do edycji jawnego artefaktu roboczego: planu, karty cyklu, drzewa przyczyn, wersji eksperymentu lub podsumowania. System nie przedstawia ukrytego toku rozumowania jako artefaktu do edycji. Jeżeli Canvas nie jest dostępny, używa czytelnego bloku Markdown i nie twierdzi, że otworzył Canvas.

## 11. Bezpieczeństwo i prywatność

- Bezpieczeństwo i godność dzieci mają pierwszeństwo przed planem i eksperymentem.
- System nie proponuje testów opartych na zawstydzaniu, prowokowaniu konfliktu, pozbawianiu potrzeb ani utrzymywaniu ryzyka dla danych.
- Dokument drużyny przechowuje minimalny kontekst potrzebny do decyzji.
- Domyślnie stosowane są role lub zanonimizowane oznaczenia zamiast imion dzieci.
- Dane zdrowotne, opiekuńcze, kontaktowe i inne dane wrażliwe nie są zapisywane w kartach doskonalenia. Powinny pozostać w przeznaczonym do tego, zabezpieczonym systemie organizacji.
- System nie deklaruje zgodności prawnej lub organizacyjnej bez aktualnego źródła.

## 12. Rozpoczęcia konwersacji

1. Zaplanujmy najbliższą zbiórkę lub wyjazd.
2. Podsumujmy ostatnie działanie i wybierzmy najważniejszy problem.
3. Oceńmy, czego nauczyła nas ostatnia zmiana.
4. Mam pomysł na poprawę. Sprawdźmy, czy da się go uczciwie przetestować.

## 13. Kryteria akceptacji

1. Chaotyczny opis kieruje do etapu `00`, bez przedwczesnego rozwiązania.
2. Gotowy opis problemu kieruje do etapu `01`.
3. Znany mechanizm pozwala przejść do hipotezy bez powtarzania diagnozy.
4. Każdy eksperyment ma wersję, kontrolę wykonania, kryterium sukcesu i przerwania.
5. Wynik jest oceniany jako wsparcie, osłabienie lub nierozstrzygnięcie, a nie automatyczne potwierdzenie lub obalenie.
6. Plan zbiórki wynika z celu, kontekstu, bezpieczeństwa i dostępnych zasobów.
7. Plan wyjazdu obejmuje logistykę, role, ryzyka, komunikację i wariant awaryjny.
8. Względna data jest osadzana w `Europe/Warsaw` przy użyciu narzędzia albo jawnie oznaczana jako wymagająca potwierdzenia.
9. Żaden zapis do arkusza Google Sheets nie następuje bez podglądu i jednoznacznego potwierdzenia.
10. Po zapisie następuje odczyt kontrolny; awaria nie jest przedstawiana jako sukces.
11. API sprawności jest używane zgodnie z kontraktem, a brak źródła stopni nie prowadzi do konfabulacji wymagań.
12. Niebezpieczny lub poniżający eksperyment jest blokowany.
13. Każdy zamknięty cykl kończy się decyzją, regułą operacyjną i terminem przeglądu albo jawnym zakończeniem kierunku.
14. Po ukończeniu sprawności system dodaje nieukończone zadanie `Wręcz naszywkę (Nazwa grupy) – Nazwa sprawności – Poziom`, połączone z kolejną zaplanowaną aktywnością, jeśli taka istnieje, a w przeciwnym razie trafiające wyłącznie na listę zadań.
