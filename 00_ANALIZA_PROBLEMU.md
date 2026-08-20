---
id: 00_ANALIZA_PROBLEMU
etap: diagnoza
status: historical_methodological
wersja: 2.0
wejscie: opis zdarzenia lub powtarzalnego problemu
wyjscie: sprawdzalny opis problemu i stan wiedzy
nastepny_etap: 01_PRAPRZYCZYNA_OPERACYJNA
---

# Analiza problemu

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt etapu

| Element | Wymaganie |
|---|---|
| Start | Surowy opis zdarzenia, wzorca albo ogólna ocena |
| Wynik | Jedna zaakceptowana karta problemu z faktami, standardem, skalą i brakami |
| Decyzja | Czy ten skutek jest właściwym priorytetem cyklu? |
| Dalej | Po akceptacji przekaż kartę do [[01_PRAPRZYCZYNA_OPERACYJNA]] |
| Zakaz | Nie analizuj przyczyn i nie proponuj rozwiązań |

## Cel i granica

Zamień chaotyczną relację, ocenę lub etykietę w sprawdzalny opis jednego priorytetowego problemu. Ten etap porządkuje fakty, oczekiwania, skutki i luki w danych. Nie szuka jeszcze praprzyczyny i nie proponuje rozwiązania.

Jeden priorytetowy problem oznacza jeden skutek wybrany do pracy. Nie oznacza jednej przyczyny ani jednej osoby odpowiedzialnej.

## Kiedy używać

Użyj tego źródła, gdy:

- użytkownik opisuje wiele zdarzeń naraz;
- problem ma formę oceny, np. „brak dyscypliny” lub „słaba komunikacja”;
- nie wiadomo, co konkretnie się wydarzyło albo jaki standard nie został spełniony;
- trzeba wybrać problem o największym znaczeniu dla następnego cyklu.

Nie używaj go do analizy gotowego eksperymentu ani wyników po działaniu.

## Zasady

1. Oddziel obserwacje od interpretacji, ocen i założeń.
2. Zamieniaj cechy osób na zachowania możliwe do zaobserwowania.
3. Nie przypisuj intencji bez danych.
4. Nie szukaj winnego. Opisuj sytuację, zachowanie, standard i skutek.
5. Pytaj tylko o dane, które mogą zmienić wybór problemu lub jego opis.
6. Nie przechodź do rozwiązania ani praprzyczyny przed zamknięciem tego etapu.

## Proces

### 1. Zrekonstruuj zdarzenie

Ustal:

- co dokładnie się wydarzyło;
- gdzie i kiedy;
- kogo lub jakiej roli dotyczyło;
- co wydarzyło się bezpośrednio przed i po;
- czy to pojedyncze zdarzenie, czy powtarzalny wzorzec.

### 2. Rozdziel warstwy informacji

| Warstwa | Znaczenie | Przykład |
|---|---|---|
| Obserwacja | Można ją zobaczyć, usłyszeć lub policzyć | Trzy osoby rozpoczęły zadanie dopiero po drugim poleceniu |
| Interpretacja | Znaczenie nadane obserwacji | Pierwsze polecenie było niejasne |
| Ocena | Etykieta osoby lub grupy | Uczestnicy są niesamodzielni |
| Założenie | Informacja przyjęta bez sprawdzenia | Każdy znał podział ról |

### 3. Ustal stan oczekiwany

Sprawdź:

- co dokładnie miało się wydarzyć;
- skąd uczestnicy mieli znać oczekiwanie;
- czy oczekiwanie było możliwe do spełnienia w danych warunkach;
- po czym dałoby się poznać jego spełnienie.

### 4. Określ skalę i skutek

Ustal częstotliwość, zakres oraz wpływ na bezpieczeństwo, rozwój uczestników, realizację programu, czas, relacje i obciążenie kadry. Nie zawyżaj skali na podstawie jednego wyrazistego przypadku.

### 5. Wybierz jeden priorytetowy problem

Jeżeli problemów jest kilka, porównaj je według:

- ryzyka dla bezpieczeństwa i godności;
- wpływu na cel rozwojowy i program;
- częstotliwości lub powtarzalności;
- kosztu dla uczestników i kadry;
- możliwości sprawdzenia poprawy w małej skali.

Bezpieczeństwo i godność mają pierwszeństwo przed pozostałymi kryteriami.

### 6. Zidentyfikuj luki w danych

Zadawaj pytanie tylko wtedy, gdy odpowiedź może:

- zmienić opis problemu;
- zmienić wybrany priorytet;
- wykazać, że oczekiwany standard nie był znany lub wykonalny;
- odróżnić zdarzenie jednostkowe od wzorca.

Zatrzymaj pytania, gdy dalsze szczegóły nie zmienią następnej decyzji albo wymagałyby zgadywania.

## Bramka zakończenia

Etap jest gotowy, gdy istnieją:

- jeden obserwowalny skutek wybrany do pracy;
- jawny stan oczekiwany;
- lista najważniejszych faktów;
- skala i skutek problemu;
- lista założeń oraz braków mogących zmienić opis.

Jeżeli któryś z tych elementów nie istnieje, nie przechodź do `01_PRAPRZYCZYNA_OPERACYJNA`.

## Format wyniku

```text
Problem priorytetowy:
W sytuacji [kontekst] [osoba/rola/grupa] robi [obserwowalne zachowanie],
mimo że oczekiwano [stan]. Zdarza się [skala] i powoduje [skutek].

Fakty:
- ...

Stan oczekiwany i jego źródło:
- ...

Interpretacje i założenia:
- ...

Skala i znaczenie:
- ...

Braki mogące zmienić opis:
- ...

Powód wyboru tego problemu:
- ...
```

## Przekazanie do następnego etapu

1. Pokaż kompletną kartę problemu.
2. Zapytaj, czy opis i priorytet są poprawne.
3. Jeżeli użytkownik koryguje opis, pozostań w `00` i zaktualizuj kartę.
4. Jeżeli użytkownik akceptuje albo jednoznacznie prosi o dalszą analizę, przekaż do `01`: problem priorytetowy, fakty, stan oczekiwany, skalę, założenia i ważne braki.
5. Nie dodawaj przyczyn podczas przekazania.

**Następny plik:** [[01_PRAPRZYCZYNA_OPERACYJNA]]
