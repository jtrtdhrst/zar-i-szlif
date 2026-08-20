# Kompas Zbiórek: dokument zastępu

## Kontrakt dokumentu

| Element | Wymaganie |
|---|---|
| Start | Kopia tego szablonu przypisana do jednego zastępu |
| Wejście | Zatwierdzony artefakt z jednego etapu lub rekord jednego działania |
| Wynik | Jedna zaktualizowana karta albo jeden dopisany rekord |
| Dalej | Zapisany stan staje się wejściem następnego pliku wskazanego przez `06` |
| Zakaz | Nie zapisuj kilku kart w jednej operacji ani zbędnych danych dzieci |

Zachowaj nagłówki w nawiasach kwadratowych. Są stabilnymi identyfikatorami struktury dokumentu zastępu; stanowią podstawę szablonu arkusza Google Sheets panelu `/panel`. Tekst `{w klamrach}` jest polem do zastąpienia.

## Sposób aktualizacji

1. Odczytaj `[KOMPAS_META]`, `[KOMPAS_KONTEKST]` i `[KOMPAS_AKTYWNY_CYKL]`.
2. Wskaż dokładnie jedną kartę docelową.
3. Pokaż użytkownikowi pełny podgląd zmiany.
4. Po zgodzie zaktualizuj jedną kartę lub dopisz jeden rekord.
5. Odczytaj zmienioną kartę i porównaj ją z podglądem.
6. Po zamknięciu cyklu dopisz skrót do archiwum, a kartę aktywną wyczyść w osobnej operacji.

## [KOMPAS_META] Metadane

| Pole | Wartość |
|---|---|
| Nazwa zastępu | {nazwa lub neutralny identyfikator} |
| Grupa programowa | {Odkrywcy / Zwiadowcy / Wędrownicy / do potwierdzenia} |
| Dokument ID | {identyfikator} |
| Właściciel merytoryczny | {rola dorosłego} |
| Strefa czasowa | Europe/Warsaw |
| Wersja szablonu | 2.0 |
| Ostatnia aktualizacja | {YYYY-MM-DD HH:mm} |

## [KOMPAS_KONTEKST] Kontekst zastępu

### Dane stałe

| Pole | Wartość |
|---|---|
| Liczba zapisanych | {liczba} |
| Typowa frekwencja | {liczba lub zakres} |
| Rytm działań | {np. zbiórka raz w tygodniu} |
| Typowe miejsce | {opis} |
| Dostępne role kadry | {role} |
| Stałe zasoby i ograniczenia | {opis} |

### Sposób działania

| Pole | Wartość |
|---|---|
| Główny cel długoterminowy | {co ma się trwale zmienić i do kiedy} |
| Powtarzalny wzorzec zachowania grupy | {obserwowalne zachowania, bez etykiet charakteru} |
| Styl prowadzenia | {ile samodzielności otrzymuje zastęp i kiedy prowadzący ingeruje} |
| Aktualny priorytet programu | {wynik API sprawności / oficjalne źródło / do uzupełnienia} |

### Aktualne możliwości

| Poziom | Konkretne zachowania lub umiejętności |
|---|---|
| Wykonują samodzielnie | {lista} |
| Wykonują po instrukcji, przypomnieniu lub wsparciu | {lista} |
| Jeszcze nie wykonują | {lista} |
| Współpraca i podział ról | {jak podejmują decyzje, dzielą pracę i kończą zadania} |

### Zasady danych

- Używaj ról lub zanonimizowanych oznaczeń zamiast imion dzieci.
- Nie zapisuj danych zdrowotnych, opiekuńczych, kontaktowych ani innych danych wrażliwych.
- W razie potrzeby wpisz `sprawdź w uprawnionej dokumentacji`, bez kopiowania danych tutaj.

## [KOMPAS_AKTYWNY_CYKL] Aktywny cykl

| Pole | Wartość |
|---|---|
| Cykl ID | {YYYY-MM-krotka-nazwa} |
| Status | {0 kontekst / 1 podsumowanie / 2 problem / 3 przyczyna / 4 hipoteza / 5 projekt / 6 próby / 7 wnioski / 8 wdrożenie / 9 przegląd} |
| Data rozpoczęcia | {YYYY-MM-DD} |
| Planowany przegląd | {YYYY-MM-DD lub liczba okazji} |
| Właściciel następnego kroku | {rola} |
| Następny plik | {identyfikator 00-06} |

### Problem priorytetowy

- Problem: {W sytuacji ... występuje ..., mimo że oczekiwano ...}
- Skala: {częstotliwość i zakres}
- Skutek: {bezpieczeństwo / rozwój / program / czas / relacje / obciążenie}
- Fakty: {lista}
- Stan oczekiwany i źródło: {opis}
- Założenia: {lista}
- Ważne braki: {lista lub brak}

### Praprzyczyna operacyjna

- Warunek lub warunki: {lista}
- Mechanizm: {łańcuch lub gałęzie}
- Dowody: {obserwacje}
- Alternatywa: {najważniejsze konkurencyjne wyjaśnienie}
- Pewność: {potwierdzona / najbardziej prawdopodobna / nierozstrzygnięta}
- Granica analizy: {powód zatrzymania}

### Hipoteza i warunek docelowy

- Hipoteza zmiany: {jeżeli ..., to ..., ponieważ ...}
- Najważniejsze założenie: {opis}
- Warunek docelowy: {zachowanie, jakość, pomoc, stabilność i koszt ochronny}

### Eksperyment

- Wersja: {V1, V2...}
- Pytanie testowe: {jedna niepewność}
- Zakres i liczba okazji: {opis}
- Zmiana i odpowiedzialność: {opis}
- Punkt odniesienia: {opis}
- Kontrola wykonania: {opis}
- Wynik główny: {obserwacja}
- Koszt ochronny: {obserwacja}
- Kryterium sukcesu: {próg}
- Warunek przerwania: {próg}
- Reguła decyzji: {sukces / częściowy / brak wsparcia / nierozstrzygnięty}

### Stan decyzji

- Postęp prób: {wykonane / planowane}
- Ostatnia decyzja: {opis lub brak}
- Reguła operacyjna: {opis lub brak}
- Otwarta niewiadoma: {opis lub brak}
- Następny krok: {jedna czynność}

## [KOMPAS_DZIALANIA] Rejestr zbiórek i wyjazdów

> Skopiuj kartę dla każdego działania. Najnowszy wpis umieść na górze sekcji.

### [DZIALANIE:{YYYY-MM-DD}:{ID}] {rodzaj i nazwa}

- Data i miejsce: {opis}
- Cel rozwojowy: {opis}
- Powiązanie z programem RR: {API sprawności / oficjalne źródło / do uzupełnienia}
- Planowany przebieg: {skrót}
- Faktyczny przebieg: {obserwacje}
- Najważniejsze odchylenia: {lista}
- Wynik celu: {obserwacja}
- Bezpieczeństwo, koszt lub bliskie niepowodzenie: {opis lub brak}
- Dane aktywnego eksperymentu: {opis lub nie dotyczy}
- Bezpośredni wniosek do następnego planu: {opis}

## [KOMPAS_PROBY] Rejestr prób

> Zapisz każdą planowaną okazję, również niewykonaną albo przerwaną.

### [PROBA:{CYKL_ID}:{NUMER}] Próba {numer}

- Data i kontekst: {opis}
- Wersja eksperymentu: {V...}
- Kluczowa zmiana wykonana: {tak / częściowo / nie}
- Co rzeczywiście wykonano: {opis}
- Wynik główny: {obserwacja}
- Poziom pomocy lub interwencja: {opis}
- Istotne zakłócenie: {opis lub brak}
- Koszt, ryzyko lub bliskie niepowodzenie: {opis lub brak}
- Obserwacja bez interpretacji: {jedno zdanie}

## [KOMPAS_WIEDZA] Reguły operacyjne

> Dodaj tylko regułę wynikającą z zamkniętego cyklu i zaakceptowaną przez użytkownika.

### [REGULA:{ID}] {krótka nazwa}

- Status: {standard / praktyka warunkowa / obserwacja / wycofana}
- Reguła: W sytuacji {X} zastosuj {Y}, ponieważ {Z}, o ile {W}; przerwij lub zmień sposób, gdy {Q}.
- Zakres: {opis}
- Podstawa: {cykl ID i jakość dowodu}
- Korzyść: {opis}
- Koszt i ryzyko: {opis}
- Data przyjęcia: {YYYY-MM-DD}
- Ostatni przegląd: {YYYY-MM-DD}
- Następny przegląd: {data, warunek lub brak}

## [KOMPAS_ARCHIWUM] Archiwum cykli

### [CYKL:{CYKL_ID}] {problem w skrócie}

- Okres: {od - do}
- Problem i praprzyczyna: {opis}
- Testowane wersje: {lista}
- Jakość dowodu: {mocna / umiarkowana / słaba}
- Decyzja: {jeden z siedmiu stanów}
- Reguła lub powód zamknięcia: {opis}
- Nierozstrzygnięta kwestia: {opis lub brak}
- Powiązany wpis wiedzy: {REGULA:ID lub brak}

## Przekazanie do następnego etapu

Po każdym zapisie odczytaj `[KOMPAS_AKTYWNY_CYKL]` i zwróć:

```text
Cykl ID:
Status zapisany:
Karta zmieniona:
Następny plik:
Wejście dla następnego pliku:
```
