# Kontekst rozwiązania: Kompas Zbiórek

## Czym jest to rozwiązanie

Kompas Zbiórek to cyfrowy przewodnik pracy drużyny Royal Rangers Polska. Składa się z dwóch połączonych elementów:

1. **Interfejsu internetowego** (panel.kompaszbiorek.pl) — aplikacji, w której lider planuje zbiórki i wyjazdy, prowadzi dokumentację sprawności, eksperymentów oraz planu rocznego.
2. **Wtyczki dla ChatGPT** — pozwala rozmawiać z asystentem AI, który zna kontekst drużyny i pomaga w planowaniu oraz prowadzeniu cyklu doskonalenia, a na życzenie przygotowuje gotowe treści do zapisu w dokumentacji.

Rozwiązanie jest przeznaczone przede wszystkim dla **lidera drużyny** — osoby, która zna lokalne warunki, odpowiada za decyzje i zatwierdza każdy zapis do dokumentu drużyny. System wspiera decyzje lidera, ale nigdy nie podejmuje ich za niego.

## Jaki problem rozwiązuje

Liderzy drużyn planują zbiórki „z głowy", powtarzają te same błędy, a wnioski z działań przepadają między spotkaniami. Kompas Zbiórek zamienia codzienne obserwacje z pracy drużyny w uporządkowany proces:

- chaotyczny opis sytuacji → jeden priorytetowy problem,
- problem → jego rzeczywistą przyczynę źródłową (nie objaw),
- przyczynę → sprawdzalną zmianę do przetestowania,
- test → uczciwą ocenę wyniku,
- wynik → konkretną regułę działania na przyszłość.

Efekt: wiedza o drużynie przestaje być osobista i ulotna, a staje się trwałym zasobem, który można ponownie wykorzystać.

## Serce systemu: cykl doskonalenia

Cała praca opiera się na czteroetapowym cyklu (domyślnie około dwóch tygodni, ale długość wynika z liczby realnych okazji do sprawdzenia zmiany):

1. **Planowanie** — podsumowanie ostatniego działania, wybór jednego problemu, analiza przyczyny źródłowej, zaprojektowanie zmiany (hipoteza, warunek docelowy, eksperyment) i jej „zamrożenie".
2. **Realizacja** — przeprowadzenie zaplanowanych prób z lekkim zapisem wykonania, efektu, zakłóceń i kosztu.
3. **Analiza** — ocena jakości dowodu, wyciągnięcie wniosków, aktualizacja założeń.
4. **Decyzja** — jedna decyzja (praktyka wsparta / osłabiona / nierozstrzygnięta), sformułowanie reguły operacyjnej i terminu przeglądu trwałości.

Zasady cyklu:

- Każdy etap ma jedno wejście i jeden wynik; system nigdy nie wykonuje kilku etapów naraz.
- Eksperyment zawsze ma wersję, sposób kontroli, kryterium sukcesu i kryterium przerwania.
- Wynik nigdy nie jest automatycznym potwierdzeniem albo obaleniem hipotezy — zawsze jest oceniony jako wsparcie, osłabienie lub nierozstrzygnięcie.
- Każdy zamknięty cykl kończy się decyzją i regułą, nie tylko notatką.

## Dokument drużyny

Trwałą pamięcią każdej drużyny jest jeden arkusz Google Sheets utworzony na podstawie szablonu. Zawiera on: stały kontekst zastępu, jeden aktywny cykl doskonalenia, rejestr ostatnich działań i prób, zaakceptowane reguły operacyjne oraz archiwum zamkniętych cykli. Zapis do arkusza następuje wyłącznie po pokazaniu pełnego podglądu i jednoznacznym potwierdzeniu przez użytkownika, a po zapisie system sprawdza i potwierdza rzeczywisty rezultat.

## Karta zbiórki — samowystarczalny artefakt roboczy

Podstawowym narzędziem codziennej pracy jest karta aktywności (zbiórki lub wyjazdu), która zawiera wszystko potrzebne do poprowadzenia spotkania i wyciągnięcia z niego wniosków:

- numer, tytuł, datę i obecność,
- realizowane sprawności wraz z wymaganiami,
- cel i eksperyment,
- tabelę przygotowania (osoba, zadanie, status),
- plan godzinowy (godzina, aktywność, aspekt programowy, osoba, materiały),
- refleksję po spotkaniu (wynik eksperymentu, opinia skautów, wnioski).

Oprócz karty zbiórki interfejs obejmuje: stronę główną z listą zadań użytkownika i trasą kroków milowych cyklu, widok eksperymentów, plan roczny z kalendarzem, kontekst zastępu oraz historię sprawności z licznikiem postępu na stopień.

## Sprawności i baza aktywności

System korzysta z oficjalnego katalogu sprawności Royal Rangers — wymagania i statusy pochodzą wyłącznie z podłączonego oficjalnego źródła. Po oznaczeniu sprawności jako ukończonej system sam dodaje zadanie wręczenia naszywki i wiąże je z najbliższą zaplanowaną aktywnością.

Do planowania godzinowego służy Baza Aktywności RR — wyszukiwarka gotowych aktywności według warunków zbiórki. Wybrana pozycja wypełnia wiersz planu nazwą, opisem i czasem trwania. System nigdy nie wymyśla wymagań sprawności ani danych, których oficjalne źródło nie zwróciło — gdy danych brak, pokazuje to jasno i zostawia miejsce na roboczy opis użytkownika.

## Bezpieczeństwo i granice

- Bezpieczeństwo i godność dzieci mają zawsze pierwszeństwo przed planem i eksperymentem.
- System nie proponuje testów opartych na zawstydzaniu, prowokowaniu konfliktu ani pozbawianiu potrzeb.
- Dane dzieci są minimalizowane: domyślnie stosuje się role lub zanonimizowane oznaczenia zamiast imion; dane wrażliwe (zdrowotne, opiekuńcze, kontaktowe) nie trafiają do kart.
- Tryb pracy jest dwustopniowy: domyślnie system tylko analizuje i proponuje; zapis do dokumentacji wymaga jawnego potwierdzenia konkretnej treści. Awaria nigdy nie jest przedstawiana jako udany zapis.

## Współpraca z ChatGPT

Wtyczka dla ChatGPT pozwala prowadzić całą rozmowę o drużynie w języku naturalnym: „zaplanujmy najbliższą zbiórkę", „podsumujmy ostatnie działanie i wybierzmy najważniejszy problem", „oceńmy, czego nas nauczyła ostatnia zmiana". Asystent pracuje w tym samym cyklu doskonalenia, korzysta z tych samych źródeł wiedzy i tych samych zasad bezpieczeństwa co interfejs internetowy — to dwa wejścia do jednego systemu, nie dwa różne produkty.

## Stan obecny

Działające i dostępne: pełny interfejs panelu (strona główna, karta aktywności, sprawności, eksperymenty, plan roczny, kontekst zastępu), zapis karty zbiórki do Google Sheets po wyborze arkusza, integracja z katalogiem sprawności i bazą aktywności, wtyczka ChatGPT z kontrolowanym trybem zapisu oraz sekwencja e-maili powitalnych dla nowych użytkowników.

Planowane: integracja ze stopniami Royal Rangers oraz dalsze dopinanie źródeł danych oficjalnych. Ograniczeniem obecnym jest to, że dane robocze trzymane lokalnie w przeglądarce synchronizują się między urządzeniami dopiero poprzez zapis do arkusza Google Sheets.
