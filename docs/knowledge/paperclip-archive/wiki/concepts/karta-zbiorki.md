---
title: Karta zbiórki — samowystarczalny artefakt
type: concept
tags: [karta-zbiorki, domenowa, ux]
sources: [raw/WSPOLNY_KONTEKST.md, raw/PRD-KOMPAS-ZBIOREK.md]
created: 2026-08-20
updated: 2026-10-23
---

# Karta zbiórki

Karta zbiórki jest samowystarczalnym artefaktem roboczym dla jednej aktywności. Ma prowadzić instruktora od planowania przez realizację do refleksji i następnej decyzji, bez sprowadzania produktu do generatora planów albo obowiązkowego eksperymentu.

## Dziennik Aktywności w obozowisku — TARGET

W obozowisku stale dostępny jest **interaktywny rekwizyt Dziennik Aktywności** (nazwa robocza) przy Stole Wypraw, ze skrótem tekstowym również na mobile. Dziennik **nie jest siódmą lokacją** i nie przechowuje drugiej kopii kart.

- Karty **minionych** aktywności: chronologiczne przeklikiwanie ostatnich zbiórek, szybki odczyt planu, rzeczywistego przebiegu, wyników i podsumowania/refleksji.
- Karty **nadchodzących** aktywności: przegląd, otwieranie i uzupełnianie terminów, planów, elementów, materiałów, zadań i checklist.
- **Te same rekordy** kart i kalendarza, odczytywane i zapisywane w Supabase/Postgres zgodnie z uprawnieniami; bez auto-oznaczania planowanych elementów jako wykonanych. Karta po terminie bez relacji z wykonania pozostaje **do podsumowania**.
- **Brak wbudowanego AI**: dziennik działa samodzielnie. Opcjonalna zewnętrzna pomoc AI może użyć autoryzowanego MCP aplikacji.

Powiązanie: [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]], [[wiki/concepts/arc-02-wyznaczamy-kierunek]]. Nazwa **Dziennik Aktywności** ustalona, forma wizualna i szczegółowy UX do dopracowania.

## Kanoniczna mapa karty: nazwy, pola i właściwy moment pracy (2026-10-19)

**Źródło opisowe obecnego interfejsu:** przykład **Karty Zbiórki** przekazany przez właściciela. Poniżej: (A) pola i etykiety z tego widoku, (B) ustalenia dotyczące kolejności Arc 3/Arc 4 oraz (C) **proponowane** pola po realizacji. To **TARGET + dokumentacja wyglądu opisanego UI**, a nie zweryfikowany z kodu CURRENT ani dowód uruchomienia.

**Nagłówek jednej karty:** **Nazwa zbiórki**, **Data zbiórki**, **Start**, **Koniec**. Karta ma trzy zakładki: **Planowanie**, **Podsumowanie**, **Problemy**. W Arc 3 użytkownik pracuje **tylko w Planowaniu**; po przeprowadzeniu zbiórki przechodzi do Podsumowania i opcjonalnie Problemów w Arc 4.

### Arc 3 — Planowanie: istniejące pola i logika

Pod nagłówkiem: checklista **„Uzupełnienie najbliższej aktywności”**. Istniejące trzy pozycje z możliwością kliknięcia ticka: **„Cel i sprawności”**, **„Przebieg”**, **„Przygotowanie”**. Tick aktualizuje się po uzupełnieniu odpowiedniego pola/sekcji; ręczne oznaczenie nie może udawać oficjalnego zaliczenia sprawności, wykonania planu ani ukończenia zadań logistycznych.

| Miejsce w karcie / etykieta | Pola i działania opisane przez właściciela | Zadanie w Arc 3 | Co pozostaje na później |
|---|---|---|---|
| **Nagłówek** | Nazwa zbiórki; Data zbiórki; Start; Koniec. Domyślnie przykładowy czas 17:00–19:00, z możliwością edycji. | **1. Wybierz cel wyprawy** (identyfikacja aktywności) | Faktyczne odbycie się zbiórki |
| **Cel horyzontu · 3 miesiące** | Wgląd w cel z planu rocznego, jego DoD oraz ewentualne kamienie milowe i warunki. Gdy brak celu: „Cel kwartalny nie został jeszcze opisany w planie rocznym”. | **1. Wybierz cel wyprawy** (kontekst, bez przepisywania) | Potwierdzenie kamieni i DoD |
| **Cel i sprawności** | Dodaj **cel zbiórki**; opcjonalnie wybierz **sprawności** i konkretne wymagania przez „Dodaj sprawność”; statusy wspólne z kanonicznym kontekstem/Tablicą Sprawności i Stopni. Możliwy pusty stan „Nie wybrano jeszcze sprawności…”. | **1. Wybierz cel wyprawy** | Faktyczne wykonanie wymagań |
| **Do sprawdzenia** | Eksperyment powiązany z poprzednim podsumowaniem, jeśli instruktor rzeczywiście zaplanował go na tę zbiórkę. | **Pierwsza zbiórka: bez eksperymentu i bez zadania**. W kolejnych tylko widok planowanej próby. | Wynik eksperymentu, poprawa, nowa wiedza, niewiadome — Arc 4 |
| **Przebieg** | Tabela: **Start**, **Czas trwania (min)**, **Aktywność** („Znajdź w bazie” / „+ Dodaj opis”), **Aspekt**, **Osoba**, **Materiały**, operacje **× / ↑ / ↓**. Start kolejnego wiersza wyliczany z czasu poprzedniego. | **2. Ułóż trasę zbiórki** | Jak naprawdę poszło przy każdym elemencie |
| **Przygotowanie** | Zadania i materiały **poniżej planu godzinowego**; dodawanie/edycja pozycji; statusy zadań **Do zrobienia / W trakcie / Ukończono** i „×”; osoba tylko gdy są skonfigurowani współprowadzący. Materiały przy wierszach przebiegu mogą również zasilać wspólną listę rzeczy potrzebnych. | **3. Spakuj potrzebne rzeczy** | Uzupełnienie stanu materiałów i zadań w praktyce, bez utożsamiania z przeprowadzeniem zbiórki |

**Ważne:** sekcja „Przygotowanie” może być kompletna *jako formularz*, gdy jej wpisy istnieją, choć poszczególne zadania nadal mają status „Do zrobienia”. Nie dublować list materiałów między tabelą Przebiegu, Przygotowaniem a kartką przygotowań na ekranie obozu. Materiały i zadania pozostają zapisane na tej samej karcie / w powiązanych kanonicznych rekordach.

**Zasada dla pierwszej zbiórki:** z definicji **brak eksperymentu z wcześniejszej aktywności**. W „Do sprawdzenia” można pokazać neutralne „Nie zaplanowano eksperymentu” albo nie pokazywać sekcji. Nie dodawać warunku eksperymentu do checklisty Arc 3 i nie generować sztucznego eksperymentu.

### Arc 4 — po rzeczywistej zbiórce: mapa danych i proponowane pola

**Tu nie ma jeszcze zweryfikowanego z kodu zestawu etykiet pól; poniższe pola są roboczą propozycją wynikającą z decyzji właściciela o przebiegu, wymaganiach, kamieniach i eksperymencie.** Zachować istniejące zakładki i tę samą kartę.

| Zakładka / część | Co zapisuje instruktor po realizacji | Zadanie Arc 4 |
|---|---|---|
| **Podsumowanie — wykonanie przebiegu** | Przy **każdym wcześniej zaplanowanym wierszu**: jak naprawdę poszło, co się odbyło, co zmieniono/odwołano i najważniejsza obserwacja. Nie przepisywać planu. | **1. Odtwórz przebieg** |
| **Podsumowanie — sprawności** | Które **konkretne wymagania** rzeczywiście wykonano, a których nie. Zachować status otwartych wymagań. Realizacja grupowa ≠ formalne przyznanie indywidualnej sprawności/stopnia. | **2. Zaznacz postęp** |
| **Podsumowanie — kamienie milowe** | Czy warunki konkretnych **kamieni milowych** zostały spełnione; potwierdzenie instruktora. Główny cel 3 miesięcy z osobnym DoD nie kończy się automatycznie. | **2. Zaznacz postęp** |
| **Podsumowanie — wnioski** | Co wyszło dobrze, co nie, czego się nauczyliśmy i co warto zrobić inaczej; zwięźle, bez przymusu pełnego raportu. | **3. Zapisz, czego się nauczyliśmy** |
| **Podsumowanie — wynik eksperymentu (tylko jeśli istniał)** | Czy próbę wykonano; **czy coś poprawiła**, **co nowego pokazała**, **czego nadal nie wiadomo**; rezultat, obserwacje i decyzja co dalej. | **3. Zapisz, czego się nauczyliśmy** |
| **Problemy — doskonalenie (opcjonalnie)** | Co zachować, zmienić lub odrzucić. Opcjonalnie zaplanuj **konkretną zmianę/eksperyment na następną odpowiednią zbiórkę** oraz prosty sposób oceny, czy pomógł. | **4. Ustal następny krok** |

### Ciągłość danych między zbiórkami

1. **Pierwsza: Planowanie** → nie ma poprzedniego eksperymentu.
2. **Pierwsza: Podsumowanie/Problemy** → opisz fakty, wykonane wymagania, kamienie milowe i wnioski; **dopiero tu** można zaplanować pierwszy eksperyment **na kolejną zbiórkę**.
3. **Kolejna: Planowanie** → jeśli wcześniej zaplanowany eksperyment dotyczy właśnie tej zbiórki, pokaż go w „Do sprawdzenia”. **Sugeruj niewykonane wymagania i otwarte kamienie milowe**, ale ich nie zaliczaj, nie wciskaj ich automatycznie do planu ani nie wymuszaj powtarzania całej aktywności.
4. **Kolejna: Podsumowanie/Problemy** → oceń rezultat faktycznie wykonanej próby: poprawa / nowa wiedza / nadal niewiadome; zdecyduj, czy zmianę zachować, poprawić lub porzucić. Nie trzeba planować kolejnego eksperymentu.
5. **Brak wcześniejszej karty, brak eksperymentu, odwołana zbiórka:** to prawidłowe stany. Żaden nie powoduje wymyślania wyniku ani braków kompetencji.

**Kanoniczność:** Stół Wypraw, Dziennik Aktywności, Tablica Sprawności i Stopni, Namiot Zastępu oraz kartka przygotowań pokazują widoki właściwych wspólnych rekordów w Supabase/Postgres, a nie kopie tych samych pól. Zewnętrzne AI może ewentualnie korzystać z autoryzowanego MCP; **w UI nie ma wbudowanego AI**.

**Właściwa narracja:** [[wiki/concepts/arc-03-przygotujmy-zbiorke]] (tylko planowanie) i [[wiki/concepts/arc-04-co-zabieramy-dalej]] (po realnej zbiórce).

## Rdzeń karty

Karta zawiera:
- dane aktywności i obecność;
- cel główny aktywności;
- sprawności i konkretne wymagania;
- przygotowanie: materiały, rzeczy do pozyskania i zadania przygotowawcze;
- plan godzinowy z elementami aktywności i czasem trwania;
- opcjonalny eksperyment;
- podsumowanie i refleksję po realizacji.

Powtarzalne dane powinny pozostać edytowalne w tabelach, m.in. zadania, plan, wymagania sprawności, materiały i historia eksperymentów.

## Kontekst planowania

Karta nie istnieje w próżni. Planowanie może korzystać z:
- planu rocznego jako kierunku;
- celu na około 3 miesiące;
- aktywnych sprawności drużyny;
- Bazy Aktywności RR;
- historii poprzednich aktywności i wniosków w pamięci drużyny.

Element aktywności może realizować jeden z czterech aspektów: fizyczny, społeczny, duchowy lub intelektualny. System może pomóc zauważyć zaniedbany aspekt i zasugerować aktywność lub sprawność pasującą do kontekstu.

## Plan ≠ wykonanie

Zaplanowane wymaganie sprawności nie oznacza, że zostało zrealizowane. Wykonanie oznacza się dopiero w podsumowaniu po aktywności. To samo dotyczy innych założeń planu — refleksja ma opisywać rzeczywisty przebieg, a nie automatycznie zatwierdzać plan jako wykonany.

## Eksperyment

Eksperyment jest opcjonalną warstwą doskonalenia. Gdy instruktor chce poprawić konkretny obszar, wybiera jedną małą zmianę i określa po czym pozna, czy zadziałała. Nie trzeba zaczynać każdej karty od problemu lub eksperymentu.

## Refleksja i Doskonalenie

Po aktywności instruktor zapisuje wynik, opinie uczestników, własną refleksję i faktycznie wykonane wymagania sprawności. Następnie wybiera co powtarza, co zmienia, a co odrzuca. Ważny wniosek może zostać zapisany w trwałej pamięci drużyny po potwierdzeniu użytkownika.

Aktualny cykl: **Planowanie → Realizacja → Refleksja → Doskonalenie** — zob. [[wiki/concepts/cykl-doskonalenia]].

Przy braku danych z oficjalnego źródła obowiązuje jawny stan `Brak danych` + edytowalny opis roboczy; nie wolno wymyślać wymagań sprawności. Zob. [[wiki/concepts/stan-braku-danych]].

## Google Calendar — kalendarz aplikacji (TARGET 2026-10-21)

Użytkownik może **opcjonalnie** połączyć konto Google i dodać osobny, edytowalny kalendarz **„Żar i Szlif”** do Google Calendar. Zaplanowane zbiórki, biwaki i wyjazdy są wydarzeniami odpowiadającymi **tym samym rekordom aktywności** i ich kartom w Supabase/Postgres. Zmiana nazwy, daty, godziny lub dozwolonej lokalizacji w karcie aktualizuje wydarzenie, a zmiana tych pól w kalendarzu Google może wrócić do tej samej karty przez autoryzowaną synchronizację. Do Google nie przenosić danych dzieci, historii szczegółowego przebiegu, cudzych zadań, eksperymentów ani indywidualnego postępu sprawności. **Wyjątek po decyzji z 2026-10-23:** bezpiecznie filtrowane zadania przypisane wyłącznie właścicielowi połączonego kalendarza, ich statusy, stan realizacji wydarzenia i dokładny deep link do karty znajdują się w opisie. Usunięcie z kalendarza nie kasuje samoczynnie historii faktycznych zbiórek. Integracja nie jest obowiązkowa do pracy z dziennikiem. Pełny kontrakt: [[wiki/concepts/google-calendar-integration]]. Status: TARGET, nie wdrożone.


## Po zakończeniu zbiórki — decyzje 2026-10-23 (TARGET)

### Opcjonalny przycisk: „Zaproponuj do Bazy Aktywności”

W zakładce **Podsumowanie** już przeprowadzonej aktywności instruktor może świadomie wybrać **„Zaproponuj do Bazy Aktywności”**. Nie wywołuje tego sam status ukończenia ani zapis podsumowania. Po kliknięciu instruktor wybiera całą aktywność lub wybrany jej element, otwiera **edytowalny szkic**, ręcznie koryguje przede wszystkim **tytuł i opis**, może poprawić treść dla innych odbiorców, zobaczyć podgląd docelowej karty oraz **osobno zatwierdzić wysłanie propozycji do weryfikacji**. Przed zatwierdzeniem publikacji wpis jest niewidoczny w katalogu. Ostateczne umieszczenie w Bazie wymaga **ręcznej akceptacji właściciela produktu**, nie automatycznego importu. Nowa wersja bazy nie modyfikuje historycznej karty. Opis pełnego workflow, ról i danych: [[wiki/sources/baza-aktywnosci]].

### Wymagania sprawności i zadania z naszywką

Po rzeczywistej aktywności w **Podsumowaniu** instruktor potwierdza faktycznie wykonane wymagania; status zaplanowano ≠ zaliczono. Gdy **całość właściwych wymagań** została rzeczywiście zaliczona oraz uprawniony instruktor potwierdził przyznanie danej sprawności, system **tworzy dwa zadania logistyczne** powiązane z najbliższą kolejną aktywnością: **„Zabierz naszywkę”** oraz **„Wręcz naszywkę”** (z kontekstem sprawności), przypisane uprawnionemu instruktorowi. Zadania są odrębnie odhaczane i nie mogą się duplikować; jeśli nie ma zaplanowanej następnej zbiórki, czekają na jej termin. Sam postęp grupowy nie przyznaje indywidualnych sprawności bez weryfikacji i właściwych uprawnień. Zasady: [[wiki/sources/baza-aktywnosci]].

### Google Calendar — związek z jedną kartą

Google OAuth do kalendarza jest **opcjonalny, uruchamiany z sekcji Kalendarz, nigdy przy rejestracji/logowaniu**. Każda podłączona pozycja Google jest po **trwałym Google event ID** mapowana dwukierunkowo na **tę samą kanoniczną kartę aktywności**. Wygenerowany opis wydarzenia zawiera **dokładny link do tej karty**, **stan realizacji aktywności**, a także **wyłącznie zadania przypisane właścicielowi połączonego Google Calendar**, powiązane z wydarzeniem, wraz z aktualnymi statusami. Dane zadań oraz status są projekcją danych aplikacji; nie dokonuje się zaliczania z dowolnej edycji opisu Google. Bez danych dzieci, cudzych zadań i informacji wrażliwych. Szczegółowa umowa: [[wiki/concepts/google-calendar-integration]].

**Status: TARGET / decyzje produktowe, bez potwierdzenia wdrożenia.**
