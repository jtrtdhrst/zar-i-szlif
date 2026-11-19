---
title: Żar i Szlif — Arc 2: Wyznaczamy kierunek (prosty plan roczny, 3-miesięczne horyzonty)
type: concept
tags: [zar-i-szlif, arc-2, stol-wypraw, plan-roczny, temat-roczny, horyzonty, dod, sprawnosci, dziennik-aktywnosci, working-draft]
created: 2026-10-19
updated: 2026-10-19
---

# Arc 2 — „Wyznaczamy kierunek”

**Status: UZGODNIONE ZASADY PRODUKTU + ROBOCZA FABUŁA/UX (TARGET, nie CURRENT, nie dowód wdrożenia).** Uzgodnienia właściciela 2026-10-19: plan roczny zaczyna się od obowiązkowego **tematu rocznego**, ale szczegółowe planowanie ogranicza się do **jednego bieżącego horyzontu 3 miesięcy**, zawierającego **jeden główny cel z czytelnym DoD**, opcjonalne **kamienie milowe** (podetapy głównego celu z prostymi warunkami ukończenia), sprawności i aktywności. **Nie opieramy metodyki aplikacji na ERP Scout**. System ma być prosty i samowystarczalny, bez wbudowanego AI. Szczegóły dialogów i szczegółowego UX dalej robocze.

## 1. Sens arcu i zasady nienegocjowalne

- Arc 1 w [[wiki/concepts/arc-01-nasz-pierwszy-namiot]] opisuje zastęp, jego możliwości i grupową historię sprawności/wymagań stopni. Arc 2 jest naturalną kontynuacją **przy Stole Wypraw**.
- **Pierwszym faktycznym działaniem w Arc 2 jest „Dodaj plan roczny”**. Bez pięciu ekranów diagnozy lub „generatora AI”.
- **Temat roczny** jest wymagany, nadaje wspólną oś programową i jest widoczny u góry planu. Nie wymaga uszczegółowienia wszystkich 12 miesięcy.
- Rok w UI jest **wrzesień–sierpień**, w czterech kolejnych horyzontach: H1 **wrzesień–październik–listopad**, H2 **grudzień–styczeń–luty**, H3 **marzec–kwiecień–maj**, H4 **czerwiec–lipiec–sierpień**. Rok skautowy można identyfikować jako np. 2026/2027; miesiące styczeń–sierpień należą do drugiego roku kalendarzowego.
- **Nie planować z góry ponad 3 miesiące szczegółowo.** Tylko aktywny/wybrany bieżący horyzont wymaga pracy. Przyszłe horyzonty widoczne jako puste szkielety/nagłówki i zostają do uzupełnienia, gdy przyjdzie ich kolej. Istniejące/znane terminy większych wydarzeń można zapisać także dalej w przyszłości bez rozpisywania ich programu.
- **Jeden nadrzędny cel na horyzont 3 miesięcy** (nie 2–3 równorzędne cele). **„+ Dodaj kamień milowy”** oznacza wyłącznie **opcjonalne podetapy tego jednego celu**, a nie kolejne niezależne cele czy dodatkowe kierunki roczne. Każdy kamień milowy ma **krótkie i obserwowalne kryterium ukończenia**; kamienie są rozpisaniem drogi do DoD celu głównego, bez rozbudowanych formularzy.
- **Każdy główny cel ma czytelne DoD (Definition of Done / kryterium ukończenia):** po czym instruktor pozna, że cel osiągnięto. Krótkie, konkretne, obserwowalne; DoD nie oznacza automatycznej formalnej walidacji czy przyznania stopni. **Każdy dodany kamień milowy też ma własny prosty warunek ukończenia**; potwierdza go instruktor na podstawie wykonanej pracy, nie sam upływ daty lub dopisanie planu. Nie mnożyć wskaźników i pól.
- **Sprawności do realizacji** są opcjonalnie przypięte do horyzontu / planowanych aktywności z oficjalnego katalogu RR. Na tym etapie historia i plan są **grupowe, bez segmentacji uczestników**; nie przyznawać automatycznie indywidualnych odznak/stopni.
- **Aktywności** dodaje się prosto bezpośrednio przy miesiącu, jednym widocznym przyciskiem **„+ Dodaj aktywność”**. Wpis tworzy kanoniczną kartę aktywności (możliwy szkic z nazwą i orientacyjną datą), którą można potem rozbudować niezależnie.
- **Brak AI wewnątrz aplikacji.** UI działa natywnie; opcjonalne narzędzia AI poza aplikacją korzystają z uprawnionego MCP aplikacji. Metodyka, DoD i terminy są decyzją instruktora; bez AI-sugestii, rekomendacji czy generatora jako obowiązkowej części arcu.
- **Nie korzystamy z metodologii ERP Scout jako podstawy produktu.** Można użyć istniejących oficjalnych katalogów sprawności/stopni jako danych źródłowych tam, gdzie są autorytatywne; ERP to nie wzór rytuału misji, UX ani planowania.

## 2. Uproszczony rytuał Arc 2 (propozycja UX, nie kolejne obowiązkowe misje)

### Scena wprowadzająca — Stół Wypraw

Iskra rozwija mapę z pustą drogą; Szlif kładzie na stole kartkę z tytułem „Plan roczny”.

Roboczy dialog:
- Iskra: „Znamy już nasz zastęp. To teraz ruszamy!”
- Szlif: „Dokąd? Zapiszmy temat roku i wybierzmy pierwszy odcinek drogi.”
- Iskra: „Całego roku naraz?”
- Szlif: „Nie. Na początek najbliższe trzy miesiące.”

CTA: **„Dodaj plan roczny”**. Istniejący plan -> „Otwórz plan roczny” zamiast ponownego tworzenia lub nadpisywania.

### Krok A — Utwórz plan roczny

- Wskaż odpowiedni rok skautowy od września do sierpnia.
- **Wymagane pole: „Temat roczny”** (np. „Samodzielni w działaniu”). Przykład jest inspiracją, nie domyślnie przypisanym tematem.
- Zapisz nowy plan z automatycznie utworzonym układem 4 horyzontów (puste przyszłe, **nie** automatycznie wypełnione). Nie tworzyć 12 fikcyjnych zbiórek ani celów.
- Jeśli istnieje plan na dany rok, otwórz go, nie twórz duplikatu. Szkic zapisany/wznowiony ma zachować dane.

**Pierwszy realny rezultat:** utworzony plan roczny z tematem i szkieletem miesięcy. Jest to pierwsze działanie Arc 2, nie wymagamy od razu 12 miesięcy szczegółowego planu.

### Krok B — Jeden cel na najbliższe 3 miesiące

W aktywnym horyzoncie wyświetl pola:
1. **Cel (wymagany dla aktywnego horyzontu)** — jeden nadrzędny, odnoszący się do funkcjonowania/rozwoju zastępu, nie tylko nazwa tematu zajęć.
2. **DoD: „Po czym poznamy, że osiągnęliśmy cel?” (wymagane)** — krótki, czytelny sprawdzian obserwowalnego postępu.
3. **+ Dodaj kamień milowy** — opcjonalny, konkretny podetap większego celu. Każdy ma **nazwę rezultatu + prosty warunek ukończenia** (może być jednym krótkim zdaniem). Bez konkurencyjnych celów i skomplikowanego mierzenia.
4. **Sprawności / wymagania do realizacji** — opcjonalnie z oficjalnego katalogu, bez formalnego zaliczania przed realizacją.

Przykład — tylko ilustracja, nie automatyczne założenie:
- **Cel:** „Zastęp samodzielniej dzieli obowiązki podczas przygotowania zbiórki”.
- **DoD:** „Podczas kolejnych dwóch zbiórek zastęp sam ustala i wykonuje podział zadań z najwyżej jednym przypomnieniem instruktora”.
- **Kamień milowy 1 (opcjonalnie):** „Zastęp sam dzieli role” → warunek: „Podczas jednej zbiórki rozdzielił zadania bez podpowiedzi instruktora”.
- **Kamień milowy 2 (opcjonalnie):** „Zastęp kompletuje materiały” → warunek: „Samodzielnie przygotował pełną listę i materiały do jednej zbiórki”.
- Osiągnięcie kamieni milowych **nie zastępuje** osobnego DoD celu głównego i nie może być automatycznie przyznawane na podstawie samego planu.

Nie wymagać sztucznych punktowych scoringów, formalnych rankingów ani osobnych wbudowanych analiz AI. Można wrócić do opisu możliwości zastępu z Namiotu Zastępu, ale go nie przepisywać.

### Krok C — Dodaj aktywności do miesięcy

Pod nagłówkami wrzesień, październik, listopad (lub miesięcy aktywnego horyzontu) wyświetl listy kart.
- Przycisk **„+ Dodaj aktywność”** przy każdym miesiącu. Po kliknięciu co najmniej nazwa/rodzaj i ewentualna orientacyjna data; szybki zapis szkicu, bez obowiązku pełnego scenariusza na tym etapie.
- Każda aktywność to istniejący kanoniczny rekord/karta, z linkiem **„Otwórz zbiórkę →”** lub odpowiednią nazwą rodzaju aktywności.
- Powiązanie z celem horyzontu / sprawnością jest przydatne, ale nie wymaga osobnej wieloetapowej ceremonii; pozostaje możliwość dopisania później.
- Można mieć puste miesiące z komunikatem „Brak aktywności — dodaj przyciskiem +”. Znane wydarzenia poza horyzontem można zapisać terminowo, ale bez przymusu ich szczegółowego planowania.
- Zapis działa niezależnie od AI i zasilenia wszystkich pól.

### Krótki finał

Po utworzeniu planu rocznego, wprowadzeniu **jednego aktywnego celu z DoD** i (jeżeli są już pomysły) dodaniu pierwszej aktywności narrator pokazuje Stół Wypraw z tematem roku i bieżącym horyzontem. **Nie wymagać rozpisywania czterech horyzontów ani kalendarza całego roku.**

Roboczy dialog:
- Iskra: „Wiem, co robimy najpierw!”
- Szlif: „I po czym poznamy, że zrobiliśmy postęp.”
- Iskra: „To dopisujmy kolejne zbiórki, kiedy będziemy gotowi!”

**Warunek formalnego ukończenia Arc 2 i przyznanie Iskier pozostają do ustalenia.** Wstępna sugestia: plan z tematem + jeden bieżący cel z DoD wystarczy do zakończenia samouczka; aktywności można dodać od razu lub później. **Nie oznaczać tego jako zatwierdzonego warunku bez decyzji właściciela.**

## 3. Docelowy prosty widok planu — struktura

```text
PLAN ROCZNY                                 [2026/2027]
Temat roczny*  [..................................]   [Zapisz]

01  HORYZONT 1      WRZ — PAŹ — LIS        [BIEŻĄCY]
Cel*            [........................................]
DoD*            [Po czym poznamy ukończenie? ............]
[+ Dodaj kamień milowy — podetap z warunkiem ukończenia]
Sprawności do realizacji [ + Wybierz sprawność ]
Wrzesień       [ + Dodaj aktywność ]  [lista kart / pusty stan]
Październik    [ + Dodaj aktywność ]  [lista kart / pusty stan]
Listopad       [ + Dodaj aktywność ]  [lista kart / pusty stan]

02  HORYZONT 2      GRU — STY — LUT        [NIE PLANUJ TERAZ]
Cel             [uzupełnisz później]
Sprawności      [opcjonalnie później]
Miesiące        [skrót / puste stany; opcjonalne znane daty]

03  HORYZONT 3      MAR — KWI — MAJ        [NIE PLANUJ TERAZ]
04  HORYZONT 4      CZE — LIP — SIE        [NIE PLANUJ TERAZ]

[ Zapisz plan ]     [ Wróć do obozowiska ]
```

- Na ekranie pełna struktura 12 miesięcy, ale **domyślnie rozwinięty tylko bieżący horyzont**; pozostałe zwinąć, nie pokazywać ogromnych pustych formularzy.
- Przy przejściu do nowego okresu instruktor zachowuje widok poprzednich celów/DoD i wniosków, ustala nowy jeden cel na następne trzy miesiące. Cele nie kopiują się automatycznie.
- W październiku nadal bieżący H1 wrzesień–listopad; system nie udaje, że miniony wrzesień trzeba fikcyjnie zaplanować. Dopuszcza rozpoczęcie pracy od aktualnej daty wewnątrz horyzontu.
- Cel/Dod może ewoluować przy zmianie warunków; historii lub wyniku osiągnięcia nie wolno nadpisywać w sposób gubiący ustalenia.
- Uzgodnione roczne „temat”, aktualny 3-miesięczny cel i DoD to minimum metodyki; reszta służy realnej pracy, nie obciążaniu instruktora.

## 4. Stały Dziennik Aktywności w obozowisku

**Ustalona nazwa: Dziennik Aktywności** (zastępuje poprzednią nazwę „Księga Aktywności”).
- Stały, szybki do otwarcia element obozowiska, blisko Stołu Wypraw, z dostępnym skrótem także na mobile; **nie siódma lokacja**.
- Dwie podstawowe perspektywy: **„Minione”** (ostatnie karty, plan kontra wykonanie, jak poszło, refleksja) oraz **„Nadchodzące”** (przyszłe aktywności i ich karty do uzupełnienia).
- Chronologiczne, szybkie przełączanie „poprzednia/następna aktywność”, otwarcie szczegółów i możliwość edycji zgodnie z uprawnieniami; **brak wymogu ukończenia arcu**.
- Dziennik jest widokiem/indeksem do tych samych kart w Supabase/Postgres co Stół Wypraw i kalendarz; **nie osobna baza/kopia**. Zapis lub edycja w jednym miejscu widoczna w drugim.
- Aktywność z przeszłą datą ale bez podsumowania ma status **„do podsumowania”**, a nie automatycznie **„zrealizowana”**. Nie wymuszać przypisania postępu do poszczególnych dzieci.
- Plan roczny = temat i horyzonty; Dziennik = pojedyncze karty zbiórek i innych wydarzeń; Gniazdo Szlifa = analiza doświadczeń/doskonalenie odsyłające do kart. Nie scalać bez potrzeby.

## 5. Kontrakt danych i brak AI w aplikacji

- **Supabase/Postgres application SSOT.** Jedna wersja planu rocznego (rok/temat), cztery zdefiniowane horyzonty jako struktura widoku z ewentualnymi celami/DoD, opcjonalne powiązane kamienie milowe z własnym prostym warunkiem ukończenia, linki do aktywności/kart, opcjonalne sprawności/wymagania. Szczegóły schematu zależne od faktycznego CURRENT.
- Aktywności, wymagania i statusy pochodzą z tych samych kanonicznych rekordów co Karta aktywności/Tablica Sprawności i Stopni/Dziennik, bez kopiowania wartości między modułami.
- Dodanie aktywności do miesiąca tworzy/powiązuje rzeczywistą kartę aktywności (nie tylko tekstową dekorację w planie); readback po zapisie i stabilny identyfikator.
- Przesunięcie terminu aktywności aktualizuje jej położenie w planie i Dzienniku (bez duplikowania).
- **UI jest bez AI**: nie tworzy automatycznie celu z analizy, nie generuje zbiórek/scenariuszy i nie prosi o użycie AI. Opcjonalne zewnętrzne AI może pracować przez autoryzowane MCP aplikacji, z normalnym uprawnieniem zapisu.
- Weryfikacja DoD celu oraz warunków kamieni milowych jest **obserwacją i decyzją uprawnionego instruktora**, a nie zgadywanym przez system stanem; może być wsparta rzeczywistymi wpisami z kart. Status: do zrobienia / osiągnięty (opcjonalnie nieosiągnięty na koniec horyzontu). Przy ukończeniu zachować datę i potwierdzenie, nie wymuszać formularza dowodowego.
- Nie budować struktury szczegółowego planowania 12 miesięcy w imię formalnej kompletności. Puste przyszłe horyzonty są poprawnym stanem.

## 6. Otwarte decyzje / do ustalenia później

- Końcowe dialogi Iskry/Szlifa, sposób przejścia z Arc 1, animacja Stołu Wypraw.
- Dokładny ekran edycji: zapis per pole czy explicit „Zapisz”, na mobile zwinąć pozostałe horyzonty.
- Jak wygląda przycisk „Dodaj aktywność” i minimalny szablon nowej karty (nazwa/typ/data, bez pełnego scenariusza).
- Dokładny lifecycle celu głównego, DoD i kamieni milowych: potwierdzenie realizacji, częściowej realizacji i refleksji po horyzoncie; jak widok ma pokazywać zależność kamieni od celu nadrzędnego.
- Formalny próg ukończenia Arc 2, opcjonalność stworzenia pierwszej aktywności, nagroda Iskier (brak ustalonej wartości).
- Czy dodawanie/sprawdzanie stopni obok sprawności w planie na horyzont ma sens w obecnym zakresie; formalne indywidualne zaliczenia są poza tym rytuałem.
- Kto może modyfikować współdzielony plan, scenariusz dołączenia do już istniejącego planu, konflikt równoległych zapisów MCP/UI.

## Powiązania

- [[wiki/concepts/arc-01-nasz-pierwszy-namiot]] — punkt wyjścia, diagnoza zastępu.
- [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] — Stół Wypraw, sześć miejsc, brak AI w UI, Dziennik Aktywności.
- [[wiki/concepts/karta-zbiorki]] — kanoniczne karty i plan ≠ wykonanie.
- [[wiki/concepts/onboarding]] — dostęp do obozu bez bramki planu.
- [[wiki/projects/kompas-zbiorek/decisions]] — active decisions.
