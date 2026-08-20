---
id: 04_WNIOSKI_I_WIEDZA
etap: wnioski
status: historical_methodological
wersja: 2.0
wymaga: 03_OCENA_I_PROWADZENIE_EKSPERYMENTU
wyjscie: decyzja, aktualizacja wiedzy i regula operacyjna
nastepny_etap: 06_CYKL_DOSKONALENIA
---

# Wnioski po działaniu i zapis wiedzy

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt etapu

| Element | Wymaganie |
|---|---|
| Start | Zamrożona wersja oraz komplet rekordów prób z `03` |
| Wynik | Ocena dowodu, aktualizacja założeń, jedna decyzja i reguła operacyjna albo powód zamknięcia |
| Decyzja | Wdrożyć, obserwować, przeprojektować, odłożyć czy zakończyć kierunek? |
| Dalej | Przekaż decyzję do [[06_CYKL_DOSKONALENIA]] albo nową potrzebę projektu do [[02_HIPOTEZA_I_EKSPERYMENT]] |
| Zakaz | Nie zmieniaj kryteriów po wyniku i nie uruchamiaj kolejnego testu automatycznie |

## Cel i granica

Zamień ukończone działanie i rekordy prób w wiedzę, która zmienia następną decyzję. Nie projektuj ponownie eksperymentu, dopóki nie zostanie oceniona obecna wersja.

Wynik „było lepiej” nie jest wnioskiem. Wniosek określa, co dane zmieniły w rozumieniu, w jakim zakresie oraz co z tego wynika.

## Warunek wejścia

Potrzebne są:

- zamrożona wersja hipotezy i eksperymentu;
- przewidywanie, kryterium sukcesu i reguła decyzji zapisane przed próbą;
- rekordy wykonanych, niewykonanych i przerwanych okazji;
- informacje o zakłóceniach, kosztach i interwencjach.

Brak danych jest osobną kategorią, nie wynikiem negatywnym.

## Proces

### 1. Odtwórz rzeczywistą wersję działania

Opisz to, co faktycznie spotkało uczestników: ingerencję, moment, zakres, intensywność i odchylenia. Nie opieraj się wyłącznie na planie lub nazwie eksperymentu.

### 2. Oceń jakość dowodu przed kierunkiem wyniku

Sprawdź:

- wierność wykonania;
- liczbę realnych okazji;
- porównywalność warunków;
- kompletność zapisu;
- siłę zakłóceń i alternatywnych wyjaśnień.

Oznacz jakość dowodu:

- **mocna:** spójne wykonanie, kilka odpowiednich okazji, podobny kierunek i brak lepszego wyjaśnienia;
- **umiarkowana:** wynik powtarzalny, ale zakres jest wąski lub pozostaje ważna alternatywa;
- **słaba:** pojedyncza okazja, duże odchylenia, nieporównywalne warunki albo głównie wrażenie.

### 3. Porównaj przewidywanie z obserwacją

Dla każdego ważnego przewidywania użyj jednej kategorii:

- zgodne;
- częściowo zgodne;
- sprzeczne;
- nierozstrzygnięte.

Nie zmieniaj znaczenia sukcesu po wyniku. Dodatkowe korzyści zapisz jako odkrycie, ale nie jako spełnienie pierwotnego kryterium.

### 4. Oddziel wykonanie od efektu

| Wykonanie | Efekt | Wniosek |
|---|---|---|
| Tak | Tak | Hipoteza wyniku otrzymuje wsparcie w sprawdzonym zakresie |
| Tak | Nie | Ta wersja hipotezy wyniku zostaje osłabiona |
| Nie | Tak | Nie przypisuj poprawy eksperymentowi |
| Nie | Nie | Brak podstaw do oceny wpływu |

### 5. Sprawdź wyjątki, koszty i trwałość

Ustal:

- co różniło udane i nieudane okazje;
- czy efekt zależał od osoby prowadzącej lub dodatkowej pomocy;
- czy poprawa nie przeniosła kosztu na bezpieczeństwo, udział, relacje lub kadrę;
- czy pojawiło się bliskie niepowodzenie;
- czy efekt narastał, utrzymywał się albo wygasał.

### 6. Zaktualizuj założenia oddzielnie

Nie oceniaj całego pomysłu jednym słowem. Wskaż, które założenia:

- otrzymały wyraźne wsparcie;
- otrzymały ograniczone wsparcie;
- zostały osłabione;
- pozostały nierozstrzygnięte.

Nie używaj języka „udowodniono” ani „obalono”, gdy dane pochodzą z małej, zmiennej próby.

### 7. Ustal granicę uogólnienia

Wniosek dotyczy tylko sprawdzonych osób, zadań, warunków i sposobu wykonania. Wymień wyłącznie te niewiadome, które mogą zmienić następną decyzję.

## Decyzja po eksperymencie

Wybierz jeden stan:

1. **Przyjąć jako standard:** dane wystarczają do zwykłego użycia.
2. **Utrzymać jako praktykę warunkową:** działa tylko w nazwanym kontekście.
3. **Kontynuować obserwację:** wersja pozostaje bez zmian, potrzebne są naturalne okazje.
4. **Zawęzić zakres:** ujawniono granicę działania.
5. **Przeprojektować jeden element:** dane wskazują konkretną potrzebną korektę.
6. **Odłożyć:** potencjał istnieje, ale obecne warunki nie pozwalają ocenić użyteczności.
7. **Zakończyć kierunek:** prawidłowe próby nie dały efektu lub koszt i ryzyko są zbyt duże.

Nie twórz kolejnego testu automatycznie. Zrób to tylko wtedy, gdy konkretna niewiadoma blokuje decyzję wartą kosztu kolejnej próby.

## Reguła operacyjna

Zapisz wiedzę w formie:

> W sytuacji [X] zastosuj [Y], ponieważ w sprawdzonym zakresie prowadziło to do [Z], o ile [W]. Nie stosuj, przerwij lub zmień sposób, gdy [Q].

Reguła musi zawierać zakres, dowód, koszt i sygnał ostrzegawczy. Inny lider powinien móc jej użyć bez pamięci autora.

## Sprawdzenie trwałości

Jeżeli praktyka zostaje przyjęta, ustal termin krótkiego przeglądu. Domyślnie sprawdź po około dwóch tygodniach lub po odpowiedniej liczbie kolejnych okazji, czy korzyść utrzymuje się przy normalnym wysiłku i bez ukrytego kosztu.

## Format wyniku

```text
Stan danych i jakość dowodu:
Rzeczywista wersja działania:
Różnica względem przewidywania:
Aktualizacja założeń:
Warunki graniczne:
Bilans korzyści, kosztów i ryzyka:
Decyzja:
Reguła operacyjna:
Otwarta niewiadoma:
Termin sprawdzenia trwałości:
```

## Przekazanie po decyzji

1. Pokaż ocenę danych, aktualizację założeń, granicę wniosku, bilans, decyzję i regułę.
2. Uzyskaj akceptację użytkownika przed zapisaniem wiedzy jako obowiązującej.
3. Dla decyzji `przyjąć`, `praktyka warunkowa`, `kontynuować obserwację` lub `zawęzić` przekaż regułę i termin przeglądu do `06`, stan 8 lub 9.
4. Dla decyzji `przeprojektować` przekaż do `02` dokładnie jeden element do zmiany i uzasadnienie. Następna próba musi przejść ponownie przez `03`.
5. Dla decyzji `odłożyć` lub `zakończyć` przekaż do `06` powód zamknięcia oraz zachowaną wiedzę.
6. Nie twórz następnego eksperymentu w tym samym kroku.

**Następny plik:** [[06_CYKL_DOSKONALENIA]] albo, wyłącznie po decyzji o nowej wersji, [[02_HIPOTEZA_I_EKSPERYMENT]].
