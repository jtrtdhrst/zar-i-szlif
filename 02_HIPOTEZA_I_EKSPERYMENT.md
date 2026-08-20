---
id: 02_HIPOTEZA_I_EKSPERYMENT
etap: projektowanie
status: historical_methodological
wersja: 2.0
wymaga: 01_PRAPRZYCZYNA_OPERACYJNA
wyjscie: hipoteza zmiany, warunek docelowy i wersja eksperymentu
nastepny_etap: 03_OCENA_I_PROWADZENIE_EKSPERYMENTU
---

# Hipoteza zmiany i eksperyment

> **HISTORYCZNE/METODOLOGICZNE:** materiał traceability dawnego modelu. Nie definiuje aktualnego kontraktu user-facing ani checkpointów cyklu; obowiązujący kontrakt: [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Kontrakt etapu

| Element | Wymaganie |
|---|---|
| Start | Zaakceptowany mechanizm i wybrana praprzyczyna z `01` |
| Wynik | Jedna kompletna, zamrożona wersja eksperymentu |
| Decyzja | Czy ta najmniejsza próba rozróżni ważną niepewność? |
| Dalej | Przekaż wersję do oceny w [[03_OCENA_I_PROWADZENIE_EKSPERYMENTU]] |
| Zakaz | Nie interpretuj wyników, które jeszcze nie istnieją |

## Cel i granica

Przejdź od rozpoznanego mechanizmu do jednej sprawdzalnej hipotezy zmiany, obserwowalnego warunku docelowego i małego eksperymentu. Ten etap projektuje próbę, ale nie ocenia wyników po jej wykonaniu.

Hipoteza przyczynowa wyjaśnia, dlaczego problem występuje. Hipoteza zmiany przewiduje, co nastąpi po zmianie jednego warunku. Nie używaj tych pojęć zamiennie.

## Warunek wejścia

Potrzebne są:

- zaakceptowany problem;
- praprzyczyna operacyjna lub jawnie oznaczona hipoteza przyczynowa;
- poziom pewności;
- zakres, w którym użytkownik może działać.

Jeżeli przyczyna jest niepewna, eksperyment może jednocześnie sprawdzać diagnozę, ale trzeba to napisać wprost.

## Hipoteza zmiany

Użyj formuły:

> Jeżeli w sytuacji [kontekst] zmienimy [jeden główny warunek], to [zachowanie lub wynik] zmieni się w kierunku [oczekiwanie], ponieważ [mechanizm]. Zobaczymy [obserwowalny sygnał] w czasie [okres lub liczba okazji].

Dobra hipoteza:

- narusza rozpoznany mechanizm, a nie tylko objaw;
- zawiera przewidywanie, które może okazać się błędne;
- nie łączy kilku niezależnych zmian;
- wskazuje najważniejsze założenie i możliwe alternatywne wyjaśnienie;
- rozróżnia wykonanie zmiany od jej wpływu.

### Dwie hipotezy wykonawcze

- **Hipoteza działania:** ustalona zmiana da się wykonać spójnie w zwykłych warunkach.
- **Hipoteza wyniku:** poprawnie wykonana zmiana wpłynie na oczekiwany rezultat.

Brak wykonania nie obala hipotezy wyniku. Oznacza, że nie przeprowadzono rozstrzygającego testu.

## Warunek docelowy

Warunek docelowy opisuje sposób działania po poprawie, a nie nazwę narzędzia. Powinien określać:

- sytuację;
- osoby lub role;
- obserwowalne zachowanie;
- kryterium jakości;
- dopuszczalny poziom pomocy;
- stabilność w czasie lub liczbie okazji;
- ograniczenie ochronne, którego nie wolno pogorszyć.

Użyj formuły:

> W sytuacji [kontekst] [rola] wykonuje [zachowanie] zgodnie z [jakość], przy nie więcej niż [pomoc/odstępstwa], przez [okres/liczba okazji], bez pogorszenia [bezpieczeństwo, godność lub ważny koszt].

## Minimalna struktura eksperymentu

1. **Pytanie testowe:** jedna najważniejsza niepewność.
2. **Zakres:** grupa, sytuacja, liczba okazji i czas.
3. **Zmiana:** co dokładnie będzie robione inaczej, kiedy i przez kogo.
4. **Punkt odniesienia:** co działo się wcześniej w porównywalnych sytuacjach.
5. **Kontrola wykonania:** po czym wiadomo, że zastosowano ustaloną wersję.
6. **Wynik główny:** obserwacja związana z warunkiem docelowym.
7. **Koszt ochronny:** bezpieczeństwo, godność, przeciążenie, konflikt lub inny istotny skutek uboczny.
8. **Kryterium sukcesu:** próg ustalony przed wynikiem.
9. **Warunek przerwania:** kiedy bezpieczeństwo lub wykonalność kończą próbę.
10. **Reguła decyzji:** co dalej przy każdym rodzaju wyniku.

## Dobór skali i czasu

Wybierz najmniejszą próbę, która nadal obejmuje prawdziwy mechanizm. Czas określ liczbą realnych okazji, nie wyłącznie kalendarzem. Domyślny cykl trwa około dwóch tygodni, ale może być krótszy lub dłuższy, gdy okazje występują z inną częstotliwością.

Nie wprowadzaj kilku zmian naraz, chyba że stanowią nierozdzielny pakiet. Wtedy wynik dotyczy całego pakietu.

## Reguła decyzji przed próbą

- **Sukces:** zmiana została wykonana, próg osiągnięto, a koszt ochronny nie wzrósł.
- **Wynik częściowy:** kierunek się poprawił, ale próg nie został osiągnięty lub pojawił się koszt.
- **Brak wsparcia:** zmiana została wykonana, lecz oczekiwany sygnał nie wystąpił.
- **Nierozstrzygnięty:** wykonanie było niespójne, danych jest za mało albo silne zakłócenie uniemożliwia ocenę.

Nie obniżaj kryteriów po poznaniu wyniku.

## Bramka zakończenia

Projekt jest gotowy, gdy:

- istnieje jedna hipoteza zmiany związana z mechanizmem;
- warunek docelowy opisuje zachowanie, a nie działanie wdrożeniowe;
- można oddzielnie ocenić wykonanie, wynik i koszt;
- kryteria sukcesu oraz przerwania są zapisane przed próbą;
- każdy istotny wynik prowadzi do określonej decyzji;
- próba jest odwracalna, mała i możliwa do bezpiecznego wykonania.

## Format wyniku

```text
Wersja eksperymentu: V...
Pytanie testowe:
Hipoteza zmiany:
Najważniejsze założenie:
Warunek docelowy:
Zakres i liczba okazji:
Zmiana i odpowiedzialność:
Punkt odniesienia:
Kontrola wykonania:
Wynik główny:
Koszt ochronny:
Kryterium sukcesu:
Warunek przerwania:
Reguła decyzji:
```

## Przekazanie do następnego etapu

1. Sprawdź kompletność wszystkich pól formatu.
2. Nadaj wersję `V1` albo kolejny numer i nie zmieniaj jej treści po przekazaniu.
3. Uzyskaj akceptację hipotezy, warunku docelowego i kryteriów.
4. Po korekcie pozostań w `02`; po akceptacji przekaż do `03` pełną wersję, punkt odniesienia, odpowiedzialność, kryteria, ryzyka i regułę decyzji.
5. Każda późniejsza istotna korekta tworzy nową wersję.

**Następny plik:** [[03_OCENA_I_PROWADZENIE_EKSPERYMENTU]]
