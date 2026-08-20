---
id: 01_PRAPRZYCZYNA_OPERACYJNA
etap: przyczyna
status: historical_methodological
wersja: 2.0
wymaga: 00_ANALIZA_PROBLEMU
wyjscie: drzewo przyczyn i praprzyczyna operacyjna
nastepny_etap: 02_HIPOTEZA_I_EKSPERYMENT
---

# Praprzyczyna operacyjna

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt etapu

| Element | Wymaganie |
|---|---|
| Start | Zaakceptowana karta problemu z `00` |
| Wynik | Zweryfikowane gałęzie przyczynowe, praprzyczyna operacyjna, pewność i granica analizy |
| Decyzja | Który zmienialny warunek należy testować jako pierwszy? |
| Dalej | Po akceptacji przekaż wybrany warunek do [[02_HIPOTEZA_I_EKSPERYMENT]] |
| Zakaz | Nie projektuj rozwiązania ani eksperymentu |

## Cel i granica

Znajdź najwcześniejszy istotny i możliwy do zmiany warunek, który wyjaśnia powtarzanie się ustalonego problemu. Nie szukaj jednej „ostatecznej” przyczyny. Problemy mogą wymagać kilku współdziałających warunków.

Ten etap zaczyna się od zaakceptowanego opisu problemu. Nie projektuje jeszcze zmiany ani eksperymentu.

## Definicja

Praprzyczyna operacyjna to warunek, który:

- istniał przed podobnymi zdarzeniami;
- realnie zwiększał ich prawdopodobieństwo;
- wyjaśnia powtarzanie lub ważne wyjątki;
- znajduje się w zakresie wpływu użytkownika albo właściwej roli;
- po zmianie powinien ograniczyć problem bez stałego, nadzwyczajnego pilnowania.

Warunek poza zakresem wpływu nazwij tłem lub ograniczeniem, a nie głównym punktem działania.

## 5 Why jako technika, nie licznik

Nie twórz pięciu odpowiedzi dla samej liczby pięć. Każde kolejne „dlaczego” musi wyjaśniać poprzedni element i wynikać z całego obrazu danych.

Zamiast ogólnego „dlaczego?” pytaj:

- Co sprawiło, że ten skutek stał się prawdopodobny?
- Co musiało być prawdą, aby ten mechanizm zadziałał?
- Dlaczego istniejące zabezpieczenie nie zatrzymało problemu?
- Co odróżnia sytuacje z problemem od sytuacji bez problemu?
- Czy bez tego warunku problem nadal wystąpiłby w podobnej skali?

Jeżeli odpowiedź zawiera niezależne warunki połączone słowem „i”, zbuduj osobne gałęzie zamiast sztucznego łańcucha.

## Poziomy zależności

| Poziom | Rola w analizie |
|---|---|
| Skutek | Ustalony problem, od którego zaczyna się analiza |
| Wyzwalacz | Bezpośrednie zdarzenie uruchamiające problem |
| Przyczyna bezpośrednia | Mechanizm przekładający wyzwalacz na skutek |
| Warunek sprzyjający | Zwiększa ryzyko, ale nie musi wystarczać sam |
| Praprzyczyna operacyjna | Wcześniejszy, zmienialny warunek podtrzymujący wzorzec |

## Proces

### 1. Zamroź skutek startowy

Użyj opisu z etapu `00`. Nie zmieniaj problemu w połowie łańcucha. Jeżeli pojawia się inny ważny problem, zapisz go osobno do późniejszej analizy.

### 2. Zbuduj łańcuch lub drzewo

Połącz fakty w zależności przyczynowe. Uwzględnij co najmniej:

- oczekiwania i instrukcje;
- role i odpowiedzialność;
- wiedzę, umiejętności, czas i zasoby;
- informację zwrotną oraz punkty kontroli;
- reakcje po wykonaniu i niewykonaniu;
- spójność działania liderów;
- sytuacje, w których problem nie wystąpił.

### 3. Sprawdź każde połączenie

Dla każdej strzałki ustal:

- czy przyczyna poprzedzała skutek;
- jaki mechanizm je łączy;
- jaki fakt wspiera połączenie;
- czy istnieje ważny wyjątek;
- czy alternatywne wyjaśnienie pasuje równie dobrze.

### 4. Oceń kandydatów

Kandydat na praprzyczynę powinien przejść test:

1. **Poprzedzanie:** istniał przed skutkiem.
2. **Mechanizm:** wiadomo, jak wpływał na wynik.
3. **Powtarzalność:** wyjaśnia więcej niż pojedynczy epizod.
4. **Kontrafaktyczność:** bez niego problem byłby wyraźnie mniej prawdopodobny.
5. **Zasięg:** wyjaśnia ważne różnice i wyjątki.
6. **Zmienialność:** można go ograniczyć w analizowanym zakresie.
7. **Dowody:** wniosek opiera się na danych, nie tylko na spójnej opowieści.

### 5. Oznacz pewność

- **Potwierdzona:** związek wspierają powtarzalne, bezpośrednie obserwacje.
- **Najbardziej prawdopodobna:** wyjaśnia najwięcej danych, ale pozostaje ważna alternatywa.
- **Nierozstrzygnięta:** kilka wyjaśnień pasuje podobnie, a brakujący fakt może zmienić wybór.

Nie używaj pewnego tonu, gdy dane są słabe.

## Warunki zatrzymania

Zatrzymaj każdą gałąź, gdy:

- wyjaśnia powtarzanie problemu;
- wskazuje istotny i zmienialny warunek;
- jego usunięcie powinno osłabić łańcuch;
- dalsze pytanie prowadzi wyłącznie do historii, ogólnika lub obszaru bez wpływu;
- brakuje danych, więc kolejny krok wymagałby zgadywania;
- dalsza odpowiedź nie zmieniłaby następnej decyzji.

Nie zatrzymuj się, gdy odpowiedź nadal jest etykietą osoby, pasuje do każdego problemu albo wymaga stałego pilnowania zamiast zmiany warunku.

## Bramka zakończenia

Etap jest gotowy, gdy:

- każda istotna gałąź ma zakończenie;
- wskazane warunki są możliwe do zmiany albo jawnie oznaczone jako ograniczenia;
- fakty i hipotezy są rozdzielone;
- poziom pewności oraz najważniejsza alternatywa są jawne;
- wiadomo, dlaczego dalsze pytania nie poprawią decyzji.

## Format wyniku

```text
Skutek startowy:
- ...

Łańcuch lub gałęzie przyczynowe:
- [warunek] -> [mechanizm] -> [skutek]

Praprzyczyna lub zestaw praprzyczyn operacyjnych:
1. ...

Dowody wspierające:
- ...

Najważniejsza alternatywa:
- ...

Pewność:
- potwierdzona / najbardziej prawdopodobna / nierozstrzygnięta, ponieważ ...

Granica analizy:
- dalsze pytania zatrzymano, ponieważ ...
```

## Przekazanie do następnego etapu

1. Pokaż drzewo, dowody, alternatywę, pewność i powód zatrzymania.
2. Wskaż jeden warunek do pierwszego testu. Jeżeli warunki współdziałają nierozdzielnie, nazwij minimalny pakiet.
3. Zapytaj, czy użytkownik akceptuje ten punkt działania.
4. Po korekcie pozostań w `01`; po akceptacji przekaż do `02`: problem, wybraną praprzyczynę, mechanizm, dowody, pewność, alternatywę i ograniczenia.
5. Nie proponuj konkretnej zmiany podczas przekazania.

**Następny plik:** [[02_HIPOTEZA_I_EKSPERYMENT]]
