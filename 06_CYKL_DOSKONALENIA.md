---
id: 06_CYKL_DOSKONALENIA
etap: koordynacja
status: historical_methodological
wersja: 1.0
wejscie: aktualny stan, artefakt lub opis intencji użytkownika
wyjscie: aktualny stan cyklu i jednoznaczny nastepny krok
---

# Cykl doskonalenia

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt koordynatora

| Element | Wymaganie |
|---|---|
| Start | Dowolny aktualny stan, gotowy artefakt albo intencja użytkownika |
| Wynik | Jeden rozpoznany stan, jedna brakująca bramka i jeden następny plik |
| Decyzja | Kontynuować, cofnąć o jeden uzasadniony etap, wdrożyć czy zamknąć cykl? |
| Dalej | Skieruj do dokładnie jednego źródła `00-05` albo do przeglądu trwałości w `06` |
| Zakaz | Nie wykonuj kilku etapów naraz i nie zastępuj instrukcji źródła etapowego |

## Cel

Prowadź jedną małą, mierzalną zmianę od obserwacji do decyzji i trwałej wiedzy. Domyślny horyzont to około dwóch tygodni, ale liczba rzeczywistych okazji do próby jest ważniejsza niż sztywna data.

Cykl ma budować nawyk uczenia się, a nie produkować dokumentację. Każdy etap wytwarza tylko dane potrzebne do następnej decyzji.

## Zasady nadrzędne

1. Pracuj nad jednym priorytetowym skutkiem naraz.
2. Dopuszczaj kilka współdziałających przyczyn.
3. Oddziel hipotezę przyczynową od hipotezy zmiany.
4. Zmieniaj jeden główny warunek na wersję eksperymentu.
5. Ustal kryteria przed poznaniem wyniku.
6. Oddziel wykonanie, efekt, zakłócenia i koszt.
7. Traktuj wynik nierozstrzygnięty jako poprawny stan wiedzy.
8. Kończ cykl decyzją i regułą operacyjną albo jawnym zamknięciem kierunku.
9. Bezpieczeństwo, godność i prywatność dzieci są ważniejsze niż tempo cyklu i wartość danych.

## Dwie pętle

### Pętla działania

Dotyczy każdej zbiórki lub wyjazdu:

1. zaplanuj działanie;
2. wykonaj je;
3. zapisz fakty, odchylenia i obserwacje;
4. wyciągnij bezpośredni wniosek do następnego planu.

### Pętla doskonalenia

Łączy kilka działań wokół jednej zmiany:

1. wybierz problem;
2. ustal praprzyczynę operacyjną;
3. zbuduj hipotezę i eksperyment;
4. przeprowadź serię prób;
5. oceń dowód i podejmij decyzję;
6. utrwal wiedzę i sprawdź trwałość.

Pętla działania dostarcza danych pętli doskonalenia. Nie każdy element zbiórki musi należeć do eksperymentu.

## Stany cyklu i bramki

### 0. Kontekst

**Cel:** odczytać aktualny stan drużyny, poprzednie decyzje i aktywny cykl.

**Gotowe, gdy:** wiadomo, czy kontynuujemy istniejący cykl, rozpoczynamy nowy, czy tylko planujemy działanie bez eksperymentu.

### 1. Podsumowanie działania

**Cel:** zapisać obserwowalny przebieg ostatniej zbiórki lub wyjazdu.

**Gotowe, gdy:** oddzielono fakty, odchylenia, wyniki i opinie oraz wskazano ważne różnice względem planu.

### 2. Problem priorytetowy

**Źródło:** `00_ANALIZA_PROBLEMU`.

**Gotowe, gdy:** istnieje jeden sprawdzalny skutek, stan oczekiwany, skala, znaczenie i powód priorytetu.

### 3. Praprzyczyna operacyjna

**Źródło:** `01_PRAPRZYCZYNA_OPERACYJNA`.

**Gotowe, gdy:** istotne gałęzie mają zmienialne zakończenia, poziom pewności i uzasadnioną granicę analizy.

### 4. Hipoteza i warunek docelowy

**Źródło:** `02_HIPOTEZA_I_EKSPERYMENT`.

**Gotowe, gdy:** jedna hipoteza zmiany wynika z mechanizmu, a warunek docelowy opisuje obserwowalne zachowanie, stabilność i koszt ochronny.

### 5. Zamrożony eksperyment

**Źródła:** `02_HIPOTEZA_I_EKSPERYMENT` oraz `03_OCENA_I_PROWADZENIE_EKSPERYMENTU`.

**Gotowe, gdy:** wersja ma zakres, odpowiedzialność, kontrolę wykonania, kryterium sukcesu, warunek przerwania i regułę decyzji. Werdykt brzmi „gotowy do testu”.

### 6. Próby

**Źródło:** `03_OCENA_I_PROWADZENIE_EKSPERYMENTU`.

**Gotowe, gdy:** zakończono ustaloną liczbę okazji albo spełniono warunek przerwania, a każda okazja ma rekord.

### 7. Wnioski i decyzja

**Źródło:** `04_WNIOSKI_I_WIEDZA`.

**Gotowe, gdy:** oceniono jakość dowodu, zaktualizowano założenia, wybrano jeden stan decyzji i zapisano regułę operacyjną lub powód zakończenia kierunku.

### 8. Wdrożenie lub kolejna wersja

Jeżeli decyzja oznacza wdrożenie, dodaj praktykę do planu następnych działań i ustal kontrolę trwałości. Jeżeli potrzebna jest kolejna wersja, zmień jeden uzasadniony element i wróć do stanu 5. Jeżeli zmieniło się rozumienie problemu, wróć do odpowiedniego wcześniejszego stanu.

### 9. Przegląd trwałości

Po około dwóch tygodniach lub ustalonej liczbie naturalnych okazji sprawdź:

- czy korzyść się utrzymuje;
- czy wymagany wysiłek nie wzrósł;
- czy nie pojawił się ukryty koszt;
- czy praktyka działa bez autora pomysłu;
- czy zmiana warunków nie unieważniła reguły.

Wynik przeglądu: utrzymaj regułę, zawęź ją, wróć do testu albo wycofaj.

## Rytm dwutygodniowy

Przykładowy rytm, gdy zbiórka odbywa się raz w tygodniu:

| Moment | Działanie |
|---|---|
| Po zbiórce 1 | Podsumowanie, wybór problemu i brakujących danych |
| Przed zbiórką 2 | Praprzyczyna, hipoteza, projekt i ocena eksperymentu |
| Zbiórka 2 | Pierwsza właściwa próba lub pilotaż techniczny |
| Kolejne okazje | Dalsze próby tej samej wersji |
| Po serii | Wnioski, decyzja i reguła operacyjna |
| Około 2 tygodnie później | Krótki przegląd trwałości przy normalnym wysiłku |

Nie przyspieszaj wniosku tylko po to, aby zamknąć cykl w 14 dni. Nie przedłużaj go, jeżeli dodatkowe dane nie zmienią decyzji.

## Zasady przejścia

- Rozmowa może rozpocząć się w dowolnym stanie, jeśli wcześniejsze artefakty istnieją.
- Nie powtarzaj wcześniejszych etapów bez konkretnej luki blokującej pracę.
- Nie przechodź automatycznie do następnego etapu po przygotowaniu artefaktu. Pokaż wynik i uzyskaj akceptację kierunku.
- W danej odpowiedzi korzystaj głównie z jednego źródła etapowego.
- Po każdym kroku nazwij aktualny stan, brakującą bramkę i jeden następny krok.

## Routing jednego następnego kroku

| Jeżeli aktualnie... | Następny plik |
|---|---|
| Brakuje sprawdzalnego opisu problemu | [[00_ANALIZA_PROBLEMU]] |
| Problem jest zaakceptowany, ale nie znamy warunku podtrzymującego | [[01_PRAPRZYCZYNA_OPERACYJNA]] |
| Mechanizm jest zaakceptowany, ale nie ma zamrożonej próby | [[02_HIPOTEZA_I_EKSPERYMENT]] |
| Istnieje projekt do oceny lub trwają próby | [[03_OCENA_I_PROWADZENIE_EKSPERYMENTU]] |
| Seria się zakończyła i istnieją rekordy | [[04_WNIOSKI_I_WIEDZA]] |
| Trzeba zaplanować najbliższe działanie | [[05_PLANOWANIE_ZBIORKI_I_WYJAZDU]] |
| Praktyka została wdrożona i nadszedł termin kontroli | Pozostań w [[06_CYKL_DOSKONALENIA]] i wykonaj przegląd trwałości |

Wybierz pierwszy wiersz, którego brak rzeczywiście blokuje decyzję. Jeżeli artefakt istnieje i spełnia bramkę, przejdź dalej bez jego odtwarzania.

## Minimalna karta stanu

```text
Cykl ID:
Status:
Data rozpoczęcia:
Planowany przegląd:
Problem priorytetowy:
Praprzyczyna i pewność:
Hipoteza zmiany:
Warunek docelowy:
Wersja eksperymentu:
Postęp prób:
Ostatnia decyzja:
Reguła operacyjna:
Otwarta niewiadoma:
Następny krok i właściciel:
```

Jeżeli nie da się uzupełnić pola bez zgadywania, wpisz „brak danych” zamiast tworzyć pozornie kompletny cykl.

## Format przekazania

```text
Stan bieżący: [0-9 i nazwa]
Artefakt zaakceptowany: [nazwa lub brak]
Brakująca bramka: [jedna lub brak]
Następny plik: [dokładnie jeden identyfikator]
Wejście przekazywane dalej: [konkretne pola]
```

Nie wykonuj treści następnego etapu w tym samym przekazaniu, chyba że użytkownik jednoznacznie prosi o kontynuację i wszystkie bramki są spełnione.
