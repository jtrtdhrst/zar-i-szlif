---
id: 03_OCENA_I_PROWADZENIE_EKSPERYMENTU
etap: test
status: historical_methodological
wersja: 2.0
wymaga: 02_HIPOTEZA_I_EKSPERYMENT
wyjscie: werdykt przed testem i komplet rekordow prob
nastepny_etap: 04_WNIOSKI_I_WIEDZA
---

# Ocena i prowadzenie eksperymentu

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt etapu

| Element | Wymaganie |
|---|---|
| Start | Zamrożona wersja eksperymentu z `02` |
| Wynik | Werdykt przed testem oraz kompletny rekord każdej zaplanowanej okazji |
| Decyzja | Czy test jest bezpieczny i rozstrzygający, a po serii czy dane nadają się do oceny? |
| Dalej | Po zakończeniu serii przekaż dane do [[04_WNIOSKI_I_WIEDZA]] |
| Zakaz | Nie zmieniaj wersji w trakcie i nie formułuj końcowego wniosku |

## Cel i granica

Sprawdź przed rozpoczęciem, czy eksperyment będzie bezpieczny, wykonalny i możliwy do interpretacji. Podczas realizacji pilnuj stałej wersji oraz lekkiego, kompletnego zapisu prób. Wnioski z wyników należą do etapu `04_WNIOSKI_I_WIEDZA`.

## Możliwe werdykty

- **Gotowy do testu:** próba jest jednoznaczna, bezpieczna i dostarczy danych do decyzji.
- **Gotowy po korekcie:** kierunek jest użyteczny, ale jedna wada zagraża wykonaniu lub interpretacji.
- **Nie testować w tej formie:** próba narusza bezpieczeństwo lub godność, jest niewykonalna albo żaden wynik nie zmieni decyzji.

## Kontrola przed rozpoczęciem

### 1. Związek z hipotezą

Sprawdź, czy zmiana rzeczywiście dotyka mechanizmu i testuje pytanie zapisane w wersji eksperymentu. Dobre działanie nie zawsze jest dobrym testem.

### 2. Jednoznaczność wykonania

Dwie przygotowane osoby powinny wykonać zmianę podobnie. Zastąp określenia „bardziej wspierać”, „lepiej pilnować” i „dać odpowiedzialność” konkretną czynnością, momentem i właścicielem.

### 3. Izolacja zmiany

Jeżeli równocześnie zmieniają się instrukcja, role, nagroda i kontrola, wynik dotyczy całego pakietu. Rozdziel zmiany albo jawnie nazwij nierozdzielny pakiet.

### 4. Kontakt ze zmianą

Uczestnicy muszą zetknąć się ze zmianą w sytuacji, w której miała wpłynąć na zachowanie. Sama obecność materiału lub odbyta wcześniej rozmowa nie potwierdzają wykonania.

### 5. Wierność wykonania

Ustal prosty ślad: krótki zapis po zdarzeniu, oznaczenie kroków albo obserwację drugiej osoby. Kontrola nie może być cięższa niż sam eksperyment.

### 6. Porównywalność okazji

Zapisuj różnice, które mogą wyjaśnić wynik: liczebność, trudność zadania, miejsce, zmęczenie, presję czasu, zmianę prowadzącego lub inne równoczesne działania. Nie wymagaj identycznych sytuacji, ale nie porównuj zdarzeń o całkowicie różnych warunkach.

### 7. Wartość dla decyzji

Wynik pozytywny, negatywny i nierozstrzygnięty muszą prowadzić do różnych możliwych decyzji. Jeżeli użytkownik niezależnie od wyniku zrobi to samo, jest to wdrożenie, a nie eksperyment.

### 8. Wykonalność po zakończeniu testu

Sprawdź, czy działanie da się utrzymać bez nadzwyczajnej uwagi, czasu lub obecności autora pomysłu. Test nie powinien mierzyć wyłącznie wyjątkowego zaangażowania lidera.

## Bezpieczeństwo i godność

Nie testuj działań opartych na:

- zawstydzaniu, publicznym ocenianiu lub wskazywaniu najsłabszych;
- pozbawianiu podstawowych potrzeb;
- prowokowaniu konfliktu lub stresu;
- celowym pozostawianiu dzieci bez potrzebnego wsparcia;
- utrzymywaniu ryzyka po to, aby zebrać dane;
- ujawnianiu prywatnych informacji uczestników;
- karaniu za brak udziału w obserwacji lub rozmowie.

Bezpieczeństwo, godność i ochrona danych mają pierwszeństwo przed wartością eksperymentu. Interwencja ochronna jest obowiązkowa; zapisz ją jako odchylenie i nie przypisuj uratowanego wyniku testowanej zmianie.

## Prowadzenie testu

### Zamrożenie wersji

Przed pierwszą właściwą próbą zapisz numer i treść wersji. Pilotaż techniczny może sprawdzać instrukcję, materiały i czas, ale nie jest dowodem wpływu, jeśli w jego trakcie poprawiano procedurę.

Istotna korekta tworzy nową wersję. Nie łącz wyników różnych wersji jako jednego eksperymentu.

### Nie ratuj wyniku

Dodatkowe podpowiedzi, przejęcie zadania, zmiana instrukcji lub przypomnienia spoza planu są odchyleniami. Nie ukrywaj ich. Oddziel pomoc potrzebną dla bezpieczeństwa od efektu przypisywanego eksperymentowi.

### Rejestruj wszystkie zaplanowane okazje

Brak wpisu nie oznacza sukcesu. Zapisz również okazję odwołaną, przerwaną lub taką, w której zmiana nie została wykonana.

## Minimalny rekord próby

```text
Próba: [numer]
Data i kontekst:
Wersja eksperymentu:
Czy kluczową zmianę wykonano: tak / częściowo / nie
Co rzeczywiście wykonano:
Wynik główny:
Poziom pomocy lub nieplanowana interwencja:
Istotne zakłócenie:
Koszt, ryzyko lub bliskie niepowodzenie:
Krótka obserwacja bez interpretacji:
```

Zapisuj obserwacje o zachowaniu i warunkach. Nie zapisuj zbędnych danych osobowych ani danych wrażliwych dzieci.

## Kiedy przerwać

Przerwij próbę, gdy:

- pojawia się zagrożenie bezpieczeństwa lub godności;
- uczestnicy doświadczają silnego stresu albo konfliktu;
- brakuje wymaganej kadry, sprzętu lub warunków;
- zmiany nie da się wykonać zgodnie z wersją;
- koszt jest wyraźnie nieproporcjonalny do oczekiwanej wartości.

Przerwanie może dowodzić problemu z wykonalnością lub kosztem. Nie dowodzi braku wpływu na wynik.

## Bramka przejścia do wniosków

Przejdź do `04_WNIOSKI_I_WIEDZA`, gdy:

- zakończono zaplanowaną serię albo spełniono warunek przerwania;
- wiadomo, którą wersję rzeczywiście testowano;
- istnieje rekord każdej zaplanowanej okazji;
- można oddzielić wykonanie, wynik, zakłócenia i koszty.

## Format oceny przed testem

```text
Werdykt:
Co naprawdę sprawdza eksperyment:
Największe zagrożenie dla wiarygodności:
Najmniejsza potrzebna korekta:
Kontrola wykonania:
Zakłócenia do zapisania:
Ryzyko i warunek przerwania:
Gotowa wersja: V...
```

## Przekazanie do następnego etapu

1. Przed próbą wydaj jeden werdykt: gotowy, gotowy po korekcie albo nie testować.
2. Po korekcie wróć do `02`, nadaj nową wersję i ponów ocenę.
3. Po werdykcie „gotowy” zbierz rekord każdej zaplanowanej okazji bez zmiany wersji.
4. Po zakończeniu lub przerwaniu serii sprawdź kompletność rekordów.
5. Przekaż do `04`: zamrożoną wersję, punkt odniesienia, wszystkie rekordy, odchylenia, zakłócenia, koszty i powód przerwania, jeśli wystąpił.

**Następny plik:** [[04_WNIOSKI_I_WIEDZA]]
