---
title: Żar i Szlif — świat, fabuła i gamifikacja (kanon koncepcyjny)
type: concept
tags: [zar-i-szlif, gamifikacja, fabula, obozowisko, avatary, ekonomia, ux]
created: 2026-10-14
updated: 2026-10-19
---

# Żar i Szlif — świat, fabuła i gamifikacja

**Status: zatwierdzone założenia koncepcyjne (TARGET / APPROVED), NIE CURRENT / NIE potwierdzona implementacja.**
**Źródło decyzji:** bezpośrednie ustalenia właściciela produktu 2026-10-14, uzupełnione wcześniejszym kierunkiem z rozmowy. Rozdziały „Otwarte decyzje” i oznaczenia PROPOZYCJA nie są zatwierdzonym wymaganiem.
**Marka publiczna:** dokładnie „Żar i Szlif”. „Kompas Zbiórek” to historyczny/techniczny identyfikator. Nie zmieniać samodzielnie repo, DNS, domen ani istniejącego runtime tylko na podstawie tej strony.
**Priorytet:** użyteczność instruktora Royal Rangers i cykl Planowanie → Realizacja → Refleksja → Doskonalenie. Gamifikacja wzbogaca produkt, nie blokuje funkcji.

## 1. Wizja produktu

Aplikacja wspiera instruktorów i drużyny Royal Rangers w planowaniu zbiórek, ich prowadzeniu, dokumentowaniu przebiegu, wyciąganiu wniosków, zarządzaniu sprawnościami, pomysłami i planem rocznym. Jej gamifikacją jest **wspólne, wizualnie rozwijane obozowisko drużyny**:
1. Realne działania w aplikacji mogą dawać punkty / walutę „Iskry”.
2. Użytkownicy mają portfele **osobiste i wspólny portfel drużyny**.
3. **Osobiste Iskry** służą wyłącznie do personalizacji zwierzaka (**kolory i podstawowe ubranka**). **Drużynowe Iskry** finansują wyłącznie zakup kosmetycznych wariantów **istniejących budynków**. Zadania związane z **własnymi pomysłami i zadaniami** przyznają Iskry osobiste, a **planowanie i realizacja zbiórek** przyznają Iskry drużynowe; dokładne granice zdarzeń i balans są nadal otwarte.
4. Budynki reprezentują funkcjonalne moduły aplikacji; są umieszczone od razu i dostępne bez wydawania Iskier. Kliknięcie prowadzi do dialogu o funkcji i do odpowiedniego modułu.
5. Fabularne wydarzenia powiązane z budynkami wynikają **zarówno z ich kosmetycznych zakupów i ulepszeń, jak i z korzystania z funkcji aplikacji bez zakupów**; nigdy nie odblokowują/zamykają narzędzi produktowych.

**Nienegocjowalne granice koncepcji:** zero pay-to-win, zero blokowania funkcji za walutą, brak kar za nieaktywność, brak przeliczania dekoracji na autentyczne wykonanie oficjalnych sprawności.

## 2. Tożsamość narracyjna: Żar + Szlif

Żar oznacza pomysł, inicjatywę, odwagę i rozpoczęcie działania. Szlif oznacza refleksję, cierpliwość, naukę na doświadczeniach i doskonalenie. Wspólna myśl: **Żar daje początek, Szlif nadaje kształt**.
Gatunek opowieści: ciepła hybryda przygodowa z lekką, subtelną magią (mysterium dawnych znaków, paleniska, śladów historii); bez walki, potworów i rozbudowanych zaklęć. Styl baśniowo-leśny, obozowiskowy, przyjazny, ale nie infantylny.

**Robocza fabuła („Tajemnica Wygasłego Obozu”, tytuł części jeszcze niezatwierdzony):**
- Dawne obozowisko skupiało społeczność wędrowców, którzy łączyli inicjatywę z doskonaleniem. Z czasem zostało opuszczone i palenisko wygasło.
- Lis Iskra i kruk Szlif odkrywają pozostałości obozu i odbudowują jego życie z pomocą użytkowników.
- Każda funkcjonalna budowla ma swój wątek: sceny mogą pojawiać się zarówno podczas korzystania z modułu bez zakupów, jak i po kosmetycznym ulepszeniu. **Historia odkryć jest osobista dla użytkownika**, natomiast wygląd i stan obozowiska wspólny dla drużyny.
- Fabuła nie może wymuszać określonej kolejności zakupów ani zamykać dostępu do modułów aplikacji.
- Relacja bohaterów ewoluuje: Iskra uczy się planować i doprowadzać rzeczy do końca, Szlif uczy się podejmować działanie mimo niepewności.
- Ognisko to symboliczny środek świata, przy którym domyślnie przebywają awatary użytkowników.

## 3. Postacie fabularne — odrębne od graczy

**Iskra: lis.** Entuzjastyczny, energiczny, odważny i ciekawski, niekiedy impulsywny; reprezentuje inicjowanie pomysłów, tworzenie i działanie. Powiązany narracyjnie z Pracownią Iskry i Żarem.
**Szlif: kruk.** Dociekliwy, spostrzegawczy, analityczny, cierpliwy, lekko ironiczny; reprezentuje refleksję, pamięć, wnioski i poprawę. Powiązany narracyjnie z Gniazdem Szlifa.
Obaj są **stałymi przewodnikami świata i mieszkańcami wszystkich obozowisk**. Nie są awatarami użytkowników ani miejscami/nagrodami na wyłączność.
Dialogi i animacje mają wspierać odkrywanie funkcji, emocje i historię, nie stanowić przeszkody w pracy.

### Biblioteka archetypów i dialogów — PROPOZYCJA 2026-10-27

Nowa robocza **ósemka umownych osobowości zwierzęcych** (Iskra/lis–ISFP, Szlif/kruk–INFJ, wilk–ENTJ, dzik–ESTP, kuna–ENTP, niedźwiedzica–ISFJ, bocian–ENFJ, bóbr–ISTP) służy rozwijaniu wyrazistych charakterów, kontrastów, charakterystycznych cytatów i scen fabularnych. Pełne opisy, zalety, słabości, wszystkie kwestie i przykład zawalonego mostu: [[wiki/concepts/archetypy-zwierzat-i-dialogi]]. **To inspiracja kreatywna, nie decyzja o sześciu nowych stałych NPC, teście MBTI użytkowników ani nowych funkcjach.** Dotychczasowy podział na dwoje przewodników i awatary graczy pozostaje bez zmian.

## 4. Awatary użytkowników — aktualna decyzja właściciela

- Każdy zalogowany użytkownik otrzymuje własną, personalizowaną postać **zwierzątka**; na starcie może wybrać zwierzę i **później zmienić gatunek**.
- **Doprecyzowanie onboardingowe 2026-10-18:** użytkownik na początku pierwszego setupu dokonuje wstępnego wyboru zwierzaka **przed wskazaniem drużyny**; w docelowej drużynie potwierdza dostępność gatunku. Nie powtarzać tego przy każdym logowaniu. Pełne zasady: [[wiki/concepts/onboarding]].
- **W jednej drużynie może być tylko jeden aktywny awatar danego gatunku** (np. jeden bóbr, jedna sowa), niezależnie od koloru i ubrania. W innych drużynach gatunki mogą się powtarzać. Gatunek można zmienić na wolny w tej drużynie. **Pula dostępnych gatunków jest rozszerzana wraz z potrzebami**, zamiast ustalać sztywny limit. Brak aktualnie wolnych gatunków nie zezwala na duplikaty; przejściowa obsługa wyczerpania puli pozostaje otwarta.
- Przykładowe grywalne gatunki (pula rosnąca według potrzeb): wiewiórka, jeż, wydra, sowa, bóbr, szop. **Lis i kruk są zarezerwowane wyłącznie dla fabularnych NPC Iskry i Szlifa — gracz nie może wybrać tych gatunków.** Należy rozwijać katalog wraz z liczbą członków i utrzymywać przynajmniej jeden możliwy wybór dla nowej osoby.
- Awatary wyrażają tożsamość, **nie determinują rang, uprawnień, wyników ani statystyk**. **Personalizacja MVP: wybór gatunku, kolorów i podstawowych ubranek**; dodatkowe animacje, sylwetki i bardziej rozbudowany edytor są poza zatwierdzonym zakresem.
- **Na obecnym etapie nie projektujemy indywidualnych domków / miejsc graczy. Zwierzątka domyślnie siedzą przy wspólnym ognisku.**
- **Użytkownik może należeć tylko do jednej drużyny jednocześnie.** Przy zmianie drużyny **zawsze wybiera nowe zwierzątko** spośród wolnych gatunków w drużynie docelowej, nawet gdy dotychczasowy gatunek byłby wolny. Starego zwierzęcia nie przenosi automatycznie. Los osobistego salda Iskier, wcześniejszych ubranek/kolorów i historii indywidualnej przy takiej zmianie wymaga osobnej decyzji, bez domniemania resetu lub transferu.
- Nie zakładać obowiązkowych kont wszystkich uczestników zbiórek; to odrębna decyzja produktowo-prywatnościowa, szczególnie przy niepełnoletnich. Domyślnie awatary = zalogowani użytkownicy aplikacji.

## 5. Struktura wspólnego świata

- **Jedno wspólne obozowisko na drużynę.** Szczep jest kontekstem nadrzędnym/organizacyjnym; brak zatwierdzenia osobnego obozu szczepu.
- Obozowisko należy do drużyny, a nie do prywatnego konta instruktora.
- Każdy uprawniony członek tej drużyny widzi wspólny stan obozu i jego wizualny rozwój. Każde konto ma **maksymalnie jedną aktywną drużynę**. **Nie ma podglądu obozowisk innych drużyn**, również w trybie gościa, poza zakresem autoryzowanego własnego obozu.
- Przestrzeń przedstawiona jako stylizowana, czytelna mapa leśnego obozowiska (preferowany kierunek izometryczny do późniejszego potwierdzenia).
- Domyślnie awatary siedzą przy ognisku, a Iskra i Szlif mieszkają/pojawiają się w tym świecie.
- **Nie przewiduje się oddzielnych dekoracji ustawianych w osobnych slotach.** Personalizacja wspólnego obozowiska polega **tylko na kupowaniu i przełączaniu wariantów istniejących budynków** (wariant może zawierać wbudowane rośliny, oświetlenie i detale). Nie ma swobodnego edytora terenu.

## 5a. Ekran główny MVP: rozwijana kartka przygotowań + obozowisko — APPROVED 2026-10-18

**Decyzja właściciela, doprecyzowanie 2026-10-14:** po uruchomieniu aplikacji i zalogowaniu (po wymaganym setupie) otwiera się **główny panel z obozowiskiem**, a na pierwszym planie jest **domyślnie rozwinięta „kartka” / arkusz przygotowań**. Nie ma osobnej Polany Drużyny. Kartka to **element interfejsu na stronie głównej, nie szósty budynek ani osobna lokacja**.

### Zawartość rozwiniętej kartki — zatwierdzona koncepcja

1. **Najbliższa aktywność/zbiórka**: nazwa, termin, możliwość otwarcia jej karty.
2. **Czy jest plan**: widoczna informacja, czy dla najbliższej aktywności plan istnieje, czy go jeszcze nie ma. Plan ≠ wykonanie.
3. **Zadania**: **liczba zadań pozostałych do wykonania**, konkretna **lista zadań** z oznaczeniami wykonane / niewykonane i przejściem do szczegółów.
4. **Materiały**: **liczba materiałów pozostałych do przygotowania/pozyskania**, konkretna **lista materiałów** i ich stan przygotowania.
5. **Nadchodzące aktywności**: **lista kolejnych najbliższych aktywności** z datami/nazwami, prowadząca do ich kart.

### Rozwinięcie i minimalizacja

- Kartka jest **domyślnie otwarta po wejściu**; użytkownik od razu widzi stan najbliższej zbiórki, plan, liczniki i listy.
- Jedna wyraźna akcja **„Zwiń” / „Minimalizuj”** sprowadza kartkę do małego, czytelnego nagłówka z akcją **„Rozwiń” / „Otwórz”** i zwalnia przestrzeń dla widoku obozowiska.
- **Ponowne otwarcie** przywraca zawartość na **tym samym głównym ekranie**, bez zmiany zakładki, otwierania osobnego modułu ani tracenia kontekstu.
- Obozowisko pozostaje na tej samej stronie **pod kartką**, wyraźniej widoczne po zwinięciu. Dla telefonu układ musi respektować dostępne miejsce; listy pozostają łatwo dostępne.
- Kartka jest **metaforą estetyczną arkusza z przygotowaniami**, a nie odrębnym magazynem zadań. Liczniki, listy, terminy i status planu pochodzą z **kanonicznych danych zbiórek, kalendarza, zadań i materiałów**. Zakaz duplikacji źródeł prawdy.
- Jeśli nie ma zaplanowanej aktywności, widoczny jest **pusty stan i przejście do planowania**, nie wymyślone terminy, materiały czy zadania.
- Pierwszeństwo mają konkretne obowiązki i przygotowania, nie Iskry i fabuła. Zachować szybką nawigację tekstową i dostępność.
- Dokładny projekt graficzny kartki, wymiary, kolejność na mobile i sposób zapamiętywania minimalizacji pozostają do szczegółowego projektu UX.

### Schemat widoku (informacyjny, bez narzucania pixel-perfect)

```text
[ Nawigacja / profil / drużyna ]
┌───────────────────────────────────────────────┐
│ KARTKA — NAJBLIŻSZE AKTYWNOŚCI      [Zwiń ▴] │
│ Najbliższa zbiórka: [nazwa] [termin]          │
│ Plan zbiórki: [JEST / BRAK]                    │
│ Pozostałe zadania: [liczba]                    │
│ [ ] zadanie 1   [x] zadanie 2   ...           │
│ Pozostałe materiały: [liczba]                  │
│ [ ] materiał A  [x] materiał B  ...           │
│ Kolejne aktywności: [lista]                    │
│ [Otwórz kartę zbiórki]                         │
└───────────────────────────────────────────────┘
[     MAPA OBOZOWISKA: 6 PUNKTÓW FUNKCYJNYCH     ]

PO ZWINIĘCIU:
[ Kartka — przygotowania              [Rozwiń ▾] ]
[              WIĘKSZA MAPA OBOZU               ]
```

**Status: TARGET / zaakceptowana koncepcja, nie dowód bieżącego wdrożenia.**

## 6. Lokacje = funkcje produktu: sześć zwartych punktów — APPROVED 2026-10-19

**Sześć odrębnych miejsc w jednym małym obozowisku:** **Ognisko**, **Namiot Zastępu**, **Stół Wypraw**, **Pracownia Iskry**, **Gniazdo Szlifa**, **Tablica Sprawności i Stopni**. Decyzja właściciela z 2026-10-19 **zastępuje układ pięciu miejsc z 2026-10-18**; Namiot Wypraw nie jest już nazwą miejsca w aktualnym TARGET. Nadal brak osobnej Polany Drużyny.

| Miejsce | Przypisane funkcje | Rola |
|---|---|---|
| **Ognisko** | Członkowie drużyny, członkostwo i uprawnienia, Iskry osobiste i drużynowe, zwierzęce awatary i ich personalizacja, warianty kosmetyczne istniejących miejsc, NPC Iskra i Szlif, sceny fabularne | Wspólnota i świat |
| **Namiot Zastępu** | Szybki wgląd we względnie trwałe dane podstawowe i kontekst: identyfikacja i profil zastępu, powiązanie ze szczepem/drużyną, poziom metodyczny, realia działania, liczebność, umiejętności samodzielne/z pomocą/do rozwoju, współpraca, funkcje i odpowiedzialności, potrzeby, priorytety i dodatkowe informacje istotne w planowaniu | Kanoniczny punkt dostępu do wiedzy o zastępie |
| **Stół Wypraw** | Plan roczny, cele średnioterminowe, kalendarz, zbiórki, biwaki i wyjazdy, karta aktywności, cele, harmonogram, cztery aspekty rozwoju, planowanie i potwierdzenie faktycznej realizacji, obecności, materiały, zadania i checklisty | Bieżące planowanie i praca |
| **Pracownia Iskry** | Własne pomysły, zadania osobiste, inspiracje, moderowana Baza Aktywności RR, propozycje scenariuszy i wykorzystanie zaakceptowanych wpisów w planach | Pomysły i Żar |
| **Gniazdo Szlifa** | Refleksje i opinie po działaniach, faktyczny przebieg, historia/kronika, pamięć i wnioski drużyny, doskonalenie, małe eksperymenty | Pamięć i Szlif |
| **Tablica Sprawności i Stopni** | Oficjalne katalogi sprawności **i stopni** RR, wymagania, wybór i planowanie, statusy, potwierdzenie rzeczywistego wykonania, historia zdobywania i właściwe zadania końcowe; nie utożsamiać planu z zaliczeniem | Sprawności i stopnie |

### Ognisko — zarządzanie drużyną, członkami, rolami i kodem dołączenia — TARGET 2026-10-20

**Ognisko jest jedynym miejscem zarządzania składem drużyny w obozowisku**, obok funkcji wspólnoty, awatarów i Iskier. Nie tworzyć osobnej siódmej lokacji ani niezależnej bazy członków. Poniższy zakres to **zatwierdzony wymóg produktowy TARGET, nie potwierdzenie obecnej implementacji**.

1. **Lista osób w drużynie.** Czytelna lista aktywnych członków (imię/nazwisko, awatar, rola systemowa, funkcja organizacyjna), osób oczekujących na akceptację oraz wysłanych zaproszeń. Pokazywać status i dostępne działania zgodnie z uprawnieniami; nie ujawniać prywatnych odpowiedzi onboardingowych o stażu/doświadczeniu.
2. **Dodawanie osób.** Uprawniona osoba może zaprosić współprowadzących przez e-mail (również wiele adresów, zgodnie z onboardingiem), obsłużyć zgłoszenia z kodu drużyny i odwołać oczekujące zaproszenie. Samo zaproszenie lub wpisanie kodu **nie tworzy aktywnego członkostwa**.
3. **Usuwanie osób.** Uprawniony zarządzający może usunąć członka z drużyny po potwierdzeniu; użytkownik może wystąpić samodzielnie na zasadach zabezpieczających ciągłość administracji. Usunięcie odbiera dostęp do obozu i danych drużyny, zwalnia gatunek awatara, ale **nie kasuje historii zbiórek, zrealizowanych zadań, zakupów drużyny ani audit trail**. Nie dopuścić do usunięcia/degradacji ostatniego administratora bez przekazania zarządzania.
4. **Role i uprawnienia systemowe.** Ognisko umożliwia nadawanie, zmianę i odbieranie ról członkom; MVP może operować rolami roboczymi: **administrator drużyny** (skład, kod, akceptacje, role), **współprowadzący** (praca nad aktywnościami zgodnie z przyznanym zakresem), **członek** (uprawnienia podstawowe). Dokładna macierz CRUD modułów wymaga osobnego zatwierdzenia, nie wolno domyślnie przyznawać administratora każdemu uczestnikowi. Zmiana ról działa po stronie serwera/RLS i jest rejestrowana, nie jest wyłącznie zmianą etykiety UI.
5. **Funkcje organizacyjne to osobne pole.** Można przypisywać i edytować funkcje/odpowiedzialności (np. drużynowy, przyboczny, zastępowy, kwatermistrz; nazwy i zakres zależne od praktyki drużyny), niezależnie od ról systemowych. Samo nadanie nazwy funkcji **nie przyznaje uprawnień technicznych**. To informacja o strukturze drużyny; nie dublować danych kontekstowych Namiotu Zastępu.
6. **Kod drużyny.** Każda drużyna ma indywidualny kod dostępny w Ognisku dla osób uprawnionych do zarządzania naborem, z funkcjami **kopiuj/udostępnij, unieważnij i wygeneruj nowy**. Kod wskazuje konkretną drużynę; nie jest hasłem do jej danych ani samodzielnym uprawnieniem do członkostwa. Nie ujawniać go publicznie w katalogu drużyn.
7. **Dołączanie przez kod i akceptację.** Po zalogowaniu przez Google użytkownik wybiera „Dołącz do drużyny”, wpisuje kod, widzi bezpieczne potwierdzenie nazwy drużyny i wysyła **prośbę o dołączenie**. Zgłoszenie otrzymuje status **oczekuje na decyzję** widoczny dla wnioskodawcy i osób z prawem zatwierdzania w Ognisku. Uprawniony administrator **akceptuje albo odrzuca** prośbę. Dopiero akceptacja, ponowne sprawdzenie tożsamości, prawa jednej aktywnej drużyny i dostępności gatunku awatara skutkują aktywnym członkostwem. Odrzucenie nie daje dostępu; użytkownik może później użyć aktualnego kodu. Przy przerwanym procesie wznawia się aktualny stan bez duplikowania zgłoszeń.
8. **Przypadki graniczne i bezpieczeństwo.** Walidacja serwerowa kodu (ważny/unieważniony), ochrona przed enumeracją i brute force (limity prób), brak duplikatów członkostw i próśb, atomowe przyjęcie, idempotencja decyzji, kontrola równoległych akceptacji oraz audyt kto/kiedy zmienił skład/role/kod. Nie pozwalać dołączyć do drugiej aktywnej drużyny; zmiana drużyny wymaga opuszczenia dotychczasowej i ponownego wyboru wolnego zwierzaka. RLS musi chronić zasoby i listy członków, także po usunięciu. Zaproszenia mailowe oraz kod prowadzą do tego samego kanonicznego procesu zatwierdzenia.
9. **UX i komunikaty.** W Ognisku pokazać sekcje „Członkowie”, „Role i funkcje”, „Zaproszenia i prośby” oraz „Kod drużyny”. Akcje „Dodaj osobę”, „Usuń z drużyny”, „Zmień rolę”, „Przypisz funkcję”, „Kopiuj kod”, „Zmień kod”, „Zaakceptuj”, „Odrzuć”. Wyraźne stany pusty/oczekuje/przyjęto/odrzucono/kod nieważny/brak uprawnień, potwierdzenie operacji destrukcyjnych i informacja o skutkach. Przeznaczone dla autoryzowanych kont instruktorskich/współprowadzących; nie dodawać kont dzieciom automatycznie.

**Warunki akceptacji Ogniska:** (a) uprawniona osoba może dodać i usunąć członka oraz zmienić rolę i funkcję, a osoba bez uprawnień nie może; (b) kod drużyny generuje wyłącznie oczekujący wniosek, nie dostęp; (c) odmowa i unieważniony kod nie nadają dostępu; (d) akceptacja respektuje jedną aktywną drużynę i unikalny gatunek awatara przy równoczesnych zgłoszeniach; (e) po usunięciu członka dostęp jest odwołany, ale historyczne dane drużyny pozostają; (f) ostatni administrator nie może odejść/utracić roli bez następcy; (g) wszystkie operacje mają serwerowe autoryzacje, RLS i zapis audytowy.

Powiązanie z procesem pierwszego dołączenia: [[wiki/concepts/onboarding]]. Kanonicznym źródłem danych jest Supabase/Postgres; dopuszczone API/MCP aplikacji podlega identycznym kontrolom dostępu.

### Namiot Zastępu — reguły kontekstu

- To **stałe, łatwo dostępne miejsce odczytu danych podstawowych**, nie kolejna codzienna checklista. Domyślny widok to krótkie podsumowanie, a nie zawsze otwarty rozbudowany formularz.
- Dane zmieniają się zwykle rzadko i mogą być aktualizowane przez **UI aplikacji lub jej MCP**. Obie ścieżki korzystają z tych samych kanonicznych rekordów **Supabase/Postgres**; MCP nie ma tworzyć własnej, konkurencyjnej bazy kontekstu.
- Zachować źródło zmiany, czas aktualizacji, autoryzację i prawa dostępu. Wskazówki AI/MCP nie są same w sobie dowodem, że zastęp faktycznie opanował umiejętność; zmiany wymagają uprawnionej operacji zapisu.
- Odróżnić dane zastępu od danych nadrzędnej drużyny/szczepu; nie kopiować tych samych wartości do wielu niezależnych profili. Szczegóły modelowania wielu zastępów pozostają do określenia przy implementacji, bez zmiany reguły jednego aktywnego członkostwa drużynowego na użytkownika.
- Sprawności i stopnie mogą być pokazane jako skrót w profilu, ale **Tablica Sprawności i Stopni** pozostaje ich miejscem zarządzania i źródłem prawdy o postępie.
- **Arc 1:** roboczy scenariusz „Nasz pierwszy namiot” opisuje prolog i cztery kroki (realia, umiejętności, grupowa historia sprawności/wymagań stopni, podsumowanie). Bez segmentacji uczestników i wymuszania powtórek ze względu na nieobecnych. **Cele rozwojowe i plan roczny należą do Arc 2 przy Stole Wypraw.** Przebieg, copy, walidacja, nagrody i techniczna implementacja są wciąż **WORKING DRAFT**, nie finalnie zatwierdzone: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]].
- **Arc 2:** temat roczny obowiązkowy, planowanie kroczące po 3 miesiące z jednym celem i jego DoD; szczegóły: [[wiki/concepts/arc-02-wyznaczamy-kierunek]].

**Dawne nazwy i scalenia:** Namiot Wypraw → **Stół Wypraw** (planowanie); kontekst zastępu → **Namiot Zastępu** (wydzielony punkt). Wieża Horyzontu → Stół Wypraw; Chata Odkrywców → Pracownia Iskry; Kronika → Gniazdo Szlifa; Polana Drużyny → Ognisko; Galeria Sprawności → Tablica Sprawności i Stopni. **Kartka przygotowań** pozostaje warstwą głównego widoku, nie siódmą lokacją.

**Integralność funkcji:** Karta zbiórki pozostaje samowystarczalna: jej elementy sprawności/stopni, materiałów, zadań i refleksji są powiązane z właściwymi rekordami, a nie przepisywane do osobnych źródeł danych. Zaplanowanie wymagania nie oznacza wykonania. Jeśli katalog lub wymaganie nie zostało wiarygodnie pozyskane z oficjalnego źródła: `Brak danych`.

### Stały Dziennik Aktywności (nazwa robocza) — ustalenie 2026-10-19

- **Stały interaktywny przedmiot w obozowisku**, przy **Stole Wypraw**, stale dostępny także przez szybki skrót tekstowy na urządzeniach mobilnych. **Nie jest siódmą lokacją ani nowym budynkiem**.
- Służy do szybkiego **przeklikiwania kart ostatnich aktywności i czytania, jak poszło** (plan, rzeczywisty przebieg, wyniki, refleksje) oraz **otwierania i uzupełniania kart nadchodzących** (plan, termin, zadania i materiały). Chronologiczny indeks z szybkim przejściem do poprzedniej/następnej karty; dokładny UX do ustalenia.
- **Jedne dane:** dziennik to widok/nawigacja do kanonicznych kart i kalendarza w Supabase/Postgres. Nie tworzyć zduplikowanych rekordów kart, kalendarza, zadań ani materiałów. Kartki przygotowań na home również odczytują te same dane.
- Plan ≠ wykonanie. Minione karty pozwalają czytać historię oraz w razie uprawnień uzupełnić faktyczny przebieg, ale bez automatycznego potwierdzania wykonania. Gniazdo Szlifa nadal prowadzi refleksję i doskonalenie, odsyłając do tych samych kart.
- Dziennik nie wymaga ukończenia arcu, zakupów ani AI. Nazwa jest ustalona; wygląd pozostaje do zaprojektowania.

### AI wyłącznie zewnętrznie przez MCP — ustalenie 2026-10-19

- **Nie budujemy AI wewnątrz UI aplikacji**: brak wbudowanego asystenta/chatu/generatora planów, a wszystkie funkcje kontekstu, kalendarza, kart aktywności i planu rocznego muszą działać natywnie bez AI.
- **Opcjonalne AI działa poza aplikacją**, używając autoryzowanego **MCP aplikacji** do odczytu i dozwolonych modyfikacji tych samych rekordów. MCP nie stanowi drugiej bazy, nie omija uprawnień ani nie zmienia odpowiedzialności instruktora za wybory metodyczne.
- Arc 2 i inne misje **nie mają obowiązkowego generowania celów, planów, rekomendacji ani analiz AI**. Ewentualne propozycje od zewnętrznego klienta AI są osobną, niewymaganą ścieżką przez MCP.
- Starsze zapisy „AI jako opcjonalny interfejs” należy czytać jako **zewnętrzne AI przez MCP, nie funkcję wewnętrzną**. Jest to kierunek TARGET, nie dowód sprawnego wdrożenia MCP.

### Robot Łącznik MCP w obozowisku — przewodnik po ChatGPT i Claude — TARGET 2026-10-20

**Decyzja właściciela:** w obozowisku stoi **mały, jednoznacznie rozpoznawalny robot** (roboczo „Robot Łącznik”; nazwa i finalny projekt wizualny do dopracowania). Robot jest **stałym klikalnym NPC/przedmiotem interfejsu**, zlokalizowanym przy Ognisku lub w czytelnym miejscu ścieżki między wejściem a Ogniskiem. Nie jest siódmą lokacją, nowym budynkiem, zwierzęcym awatarem użytkownika ani kolejną postacią prowadzącą historię zamiast Iskry i Szlifa. Wraz z nimi współistnieje wizualnie, nie zasłania ogniska ani głównych funkcji; nie należy pobierać za niego Iskier.

**Cel:** po kliknięciu pokazuje prosty, aktualizowalny **przewodnik podłączenia zewnętrznego MCP produktu „Żar i Szlif” do ChatGPT lub Claude**, aby instruktor mógł korzystać z własnych autoryzowanych danych drużyny w wybranym zewnętrznym kliencie AI. Sam robot **nie prowadzi czatu AI, nie generuje planów ani odpowiedzi** — to lokalny interaktywny onboarding, dokumentacja i nawigacja. Korzystanie z MCP jest opcjonalne; wszystkie dotychczasowe funkcje aplikacji pozostają w pełni użyteczne bez MCP i bez konta w ChatGPT/Claude.

**Interakcja i UI:**
1. Pierwsze kliknięcie: zwięzłe objaśnienie: „Cześć! Jestem twoim łącznikiem. Pokażę Ci, jak połączyć Żar i Szlif z ChatGPT albo Claude. To opcjonalne — obozowisko działa także bez AI.” CTA **„Połącz z ChatGPT”**, **„Połącz z Claude”**, **„Później”**. Ponowne kliknięcie zawsze otwiera instrukcję; nie wyświetlać przymusowo modala przy każdym logowaniu.
2. Otwierany panel dostępny też z **nawigacji tekstowej/mobile** jako „Jak podłączyć MCP”. Dwie zakładki/platformy, każda ze zwięzłymi krokami, odnośnikiem do oficjalnej dokumentacji dostawcy, przyciskiem **„Kopiuj adres MCP”** (tylko gdy istnieje zweryfikowany publiczny endpoint produktu), **„Otwórz ChatGPT / Claude”**, informacją o potrzebnym planie/uprawnieniach i „Rozwiąż problem”.
3. URL MCP pochodzi **z konfiguracji wdrożenia produktu**, a nie z przykładowego ciągu w kodzie/copy; musi być właściwym publicznym endpointem HTTPS autoryzowanego **MCP produktu Żar i Szlif**, a nie Paperclip MCP, MCP administracyjnym, serwerem Qdrant ani prywatną usługą Docker. Jeśli endpoint nie jest gotowy lub autoryzacja nie działa, zamiast pozornego połączenia wyświetlić **„Połączenie MCP nie jest jeszcze dostępne”**, bez fałszywego linku i statusu.
4. **ChatGPT — instrukcja orientacyjna na 2026-10-20:** w dostępnych kontach/przestrzeniach roboczych otwórz **Wtyczki (Plugins) → + → Dodaj niestandardowy serwer MCP**, podaj nazwę „Żar i Szlif” i skopiowany endpoint HTTPS, wybierz uwierzytelnianie, zatwierdź ostrzeżenie oraz utwórz wtyczkę; po instalacji przywołaj ją w nowej rozmowie przez **@** i przetestuj odczyt własnych danych. Obecny zakres pełnych niestandardowych MCP w ChatGPT zależy od planu i polityki workspace (oficjalnie Business/Enterprise/Edu; administracja/uprawniony deweloper). Pokaż stosowny komunikat, jeśli konfiguracja nie jest dostępna — nie sugerować nieistniejącego przycisku u każdego użytkownika. Interfejs i plany mogą się zmieniać.
5. **Claude — instrukcja orientacyjna na 2026-10-20:** w **Customize → Connectors → + Add → Add custom connector** (lub aktualny odpowiednik „Custom / Web”) podaj nazwę i endpoint MCP, wybierz sposób uwierzytelnienia, zatwierdź połączenie własnym kontem i włącz connector w rozmowie. W planach Team/Enterprise może być wymagane wcześniejsze dodanie connectora przez właściciela organizacji. W dokumentacji Claude niestandardowe zdalne konektory są dostępne także na planie Free, z limitem jednego. Nie mylić z konfiguracją lokalnego MCP w pliku Claude Desktop.
6. **Połączenie z kontem produktu:** użyć indywidualnego OAuth/zgody użytkownika z najmniejszym niezbędnym zakresem, uwzględnić odpowiednie redirect URI / discovery / refresh token gdy wymagany przez klienta. Tokenów dostępu, client secrets, kodu drużyny ani danych wrażliwych **nie pokazywać jako wartości do kopiowania**. OAuth client produktu/panelu i MCP mogą mieć odrębne rejestracje; nie przekazywać administratorowego klienta OAuth wszystkim użytkownikom. Wyraźnie pokazać, jakie dane i operacje MCP może odczytać/zmienić, oraz jak odłączyć/odwołać zgodę.
7. **Status i diagnostyka:** odróżnić „MCP dostępny”, „Połącz w zewnętrznej aplikacji”, „Brak potwierdzenia połączenia”, „Połączono — zweryfikowano” i „Błąd / uprawnienia”. Status pozytywny wolno pokazać wyłącznie po rzeczywistym autoryzowanym sygnale weryfikacyjnym serwera/sesji powiązanej z użytkownikiem — nigdy po samym kliknięciu „Kopiuj” lub przekierowaniu. Rozwiązywanie problemów: nieobsługiwany plan/rola, niedostępny URL, błędne OAuth, brak odświeżenia tokenu, niewidoczne narzędzia, brak dostępu do drużyny.
8. **Wersjonowanie i odpowiedzialność:** instrukcje krok-po-kroku oraz linki do dokumentacji zewnętrznej powinny być aktualizowalną konfiguracją/contentem (platforma, data ostatniej weryfikacji, wersja UI, źródło). Produktowy MCP oraz auth/API należą do domeny MCP Engineer; ekran, postać, copy i accessibility do Designer/Engineer. Nie stawiać robota jako blokera wejścia do obozu ani obowiązkowego kroku onboardingowego.

**Oficjalne źródła odniesienia (stan sprawdzony 2026-10-20):**
- ChatGPT: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

**Warunki akceptacji (TARGET, nie test CURRENT):**
- Robot jest widoczny i osiągalny klawiaturą/czytnikiem ekranu na desktop/mobile, bez dodawania nowej lokacji i bez zakłócenia innych NPC.
- Kliknięcie pokazuje osobne, poprawne instrukcje ChatGPT/Claude, wymagania kont i działające linki do oficjalnych źródeł.
- Kopiowany URL jest sprawdzonym adresem **produktowego** MCP; przy braku wdrożenia UI jawnie sygnalizuje brak dostępności.
- Połączenie wymaga właściwego OAuth/scope danego użytkownika; odmowa, wycofanie zgody i członkostwo w innej drużynie nie dają dostępu.
- Połączenie i test odczytu wyświetlają PASS tylko na podstawie dowodu z rzeczywistego zewnętrznego klienta i backendu, bez mocków i sztucznego sukcesu.
- Robot nie zawiera modelu AI, rozmowy, wymuszonej rejestracji w zewnętrznym systemie ani obowiązku wykonania MCP przed używaniem obozu.

**Arc 2 / zasada planowania:** zaczyna się od **„Dodaj plan roczny”** z obowiązkowym **tematem rocznym**. Rok ma cztery horyzonty WRZ–PAŹ–LIS, GRU–STY–LUT, MAR–KWI–MAJ, CZE–LIP–SIE; są szkieletem widoku, ale szczegółowo planować należy wyłącznie **najbliższe 3 miesiące**. Dla bieżącego horyzontu: **jeden cel główny + jasne DoD (po czym poznamy, że zrealizowany)**, opcjonalne **kamienie milowe jako podetapy większego celu (każdy z prostym warunkiem ukończenia)** i sprawności, **„+ Dodaj aktywność”** przy każdym miesiącu. Żadnego przejmowania metodologii ERP Scout ani obowiązku planowania roku z góry. [[wiki/concepts/arc-02-wyznaczamy-kierunek]] (zasady uzgodnione, szczegóły fabuły robocze).

**Arki 3 i 4 / jedna karta zbiórki:** [[wiki/concepts/arc-03-przygotujmy-zbiorke]] i [[wiki/concepts/arc-04-co-zabieramy-dalej]]. Arc 3 to **Planowanie** w istniejącej karcie: **„Wybierz cel wyprawy”** (cel i opcjonalne sprawności), **„Ułóż trasę zbiórki”** (plan godzinowy), **„Spakuj potrzebne rzeczy”** (Przygotowanie). Pierwsza zbiórka **nie ma wcześniejszego eksperymentu**. Po realnej realizacji Arc 4 obejmuje **Podsumowanie** (jak poszły elementy, wymagania, kamienie, wnioski, ewentualny wynik eksperymentu) oraz opcjonalne **Problemy** (co poprawić / eksperyment na następną). Jedna karta, bez duplikatów. Mapa etykiet i pól: [[wiki/concepts/karta-zbiorki]]. Sceny i UX robocze, nie CURRENT.

### Wejście do miejsc / UX

- Wszystkie **sześć** miejsc jest widocznych i funkcjonalnie dostępnych **od pierwszego wejścia**, bez obowiązku zakupów i fabularnych odblokowań.
- Fabularne „powstanie” Namiotu Zastępu na początku historii jest prezentacją, **nie blokadą jego funkcji** ani dodatkowym zakupem.
- Pierwsza wizyta użytkownika w danym miejscu pokazuje krótki dialog NPC wyjaśniający funkcję, z możliwością pominięcia; później dialog na żądanie.
- Istnieje równoległa nawigacja tekstowa. Mapa ma pozostać zwarta i czytelna, z sześcioma odmiennymi sylwetkami (ognisko, namiot, stół/mapa, pracownia, gniazdo, tablica), a nie dwoma podobnymi namiotami.

## 7. Budowa obozowiska — zatwierdzona zasada miejsc i kosmetyki

- **Budowle są z góry osadzone w predefiniowanych miejscach / slotach**. Na MVP nie ma dowolnego przesuwania budowli ani edytora terenu.
- **W każdej lokalizacji przewidzieć 2–3 warianty wizualne** (lub warianty/poziomy rozwoju wyglądu). **Zakup jest trwały i bezzwrotny**; można potem **dowolnie i bezpłatnie przełączać zakupione warianty, również wracać do wyglądu bazowego**. Kupno kosmetyki obozowej wydaje Iskry drużynowe.
- Ulepszenia dodają wyłącznie estetyczne zmiany **w ramach wariantów istniejącego budynku**: fasada, wbudowane wyposażenie, światło, otoczenie, detale, ewentualnie animacje/scenki; **zero nowych funkcji i zero osobnych dekoracji do kupowania**.
- Podstawowa reprezentacja budynku istnieje od początku, nawet jeśli użytkownik nigdy nie kupił żadnego ulepszenia.
- „Budowa” w języku fabuły oznacza **kupienie kosmetycznego wariantu istniejącego budynku**, a nie stawianie dodatkowych wolnostojących obiektów lub odblokowanie lokacji.
- Warianty muszą zachowywać czytelną tożsamość lokacji i jej funkcjonalne wejście; nie wolno ukrywać klikalności pod dekoracją.
- Nie przesądzać jeszcze o szczegółach układu warstw, assetów, trybie renderowania i cenach.

## 8. Ekonomia: dwa portfele, swobodne zakupy

**Zatwierdzone:**
- Jedna waluta świata: **Iskry** (ta sama nazwa, dwa odrębne salda).
- **Osobisty portfel użytkownika** służy do zakupu kolorów i podstawowych ubranek własnego zwierzaka; punktują go zadania osobiste (pomysły i własne zadania).
- **Wspólny portfel drużyny** służy do zakupu wizualnych wariantów **istniejących budynków**, bez osobnych dekoracji; punktują go działania związane z planowaniem i realizacją zbiórek.
- **Podział zdarzeń na portfele:** pomysły i własne zadania → Iskry osobiste; planowanie i realizacja zbiórek → Iskry drużynowe. Dokładne wyzwalacze (np. zapis vs ukończenie), poziomy punktów i przypadki graniczne będą przedmiotem dalszej specyfikacji; **balans pozostaje na później**.
- **Każdy uprawniony członek obozowiska może kupić dowolny dostępny element samodzielnie, bez głosowania, weta ani akceptacji instruktora.**
- Wspólne zakupy zmieniają wizualny stan obozu wszystkich członków drużyny.
- **Zakupów nie cofa się i nie zwraca się Iskier.** Raz kupione warianty kosmetyczne są trwale dostępne i ich ponowne przełączenie jest darmowe.
- Waluta nie kupuje funkcji produktu, realnych sprawności RR ani przewag w pracy instruktora.
- Brak kar za nieaktywność, wygaszania zakupionych elementów i wymagania codziennego logowania.

**Nadal NIEUSTALONE:** szczegółowe nagradzane zdarzenia i walidacja ukończenia, ceny i balans (odłożone), anty-farming, historia wydatków/kontrybucji, los osobistego salda i zakupionych ubranek przy zmianie drużyny, widoczność sald/zakupów i wygląd sklepu.

**Bezpieczeństwo i spójność przyszłej implementacji:** atomowość transakcji, weryfikacja salda po stronie serwera, brak podwójnej realizacji zakupów i nagród, dziennik zdarzeń, RLS oraz uprawnienia do zapisu tylko we własnej drużynie. Użytkownik może mieć tylko jedną aktywną drużynę, a wydatki drużynowe pochodzą z jej salda.

## 9. Historia powiązana z obiektami

**Zatwierdzone:** historia rozwija się w związku z budowanymi, dekorowanymi i ulepszanymi obiektami.
- **Scenki uruchamiają się także bez kupowania czegokolwiek — podczas rzeczywistego korzystania z funkcji danej lokacji.** Zakup kosmetycznego ulepszenia może wywołać osobną scenkę/komentarz Iskry i Szlifa, ujawnić pamiątkę lub fragment dziejów obozu.
- Obiekty mają własne małe wątki, które współtworzą główną opowieść o odrodzeniu Wygasłego Obozu. **Postęp odkryć fabularnych zapisuje się osobno dla każdego użytkownika; stan wizualny obozowiska pozostaje wspólny**. Scenka widziana przez jednego gracza nie staje się automatycznie obejrzana u innych.
- Możliwość ponownego obejrzenia scenki w indywidualnej kronice jest nadal propozycją UX do potwierdzenia (nie decyzją właściciela).
- **Żaden wątek nie jest bramką dla modułu aplikacji.** Użytkownik może od początku planować, zapisywać refleksje itp.
- Kolejność kupowania ulepszeń może być dowolna; opowieść musi tolerować różną kolejność odkryć (sceny lokalne + główne fragmenty bez sztywnego łańcucha zakupów).

Przykład: użytkownik kupuje ulepszony wygląd warsztatu; Iskra i Szlif odnajdują stary przedmiot i prowadzą rozmowę. Nagrodą jest klimat i odkrycie fabularne, nie odblokowanie narzędzia.
Dalsze obszary świata mogą służyć tylko dekoracji/eksploracji, a nie blokowaniu istniejących modułów.

## 10. Założenia estetyczne i codzienne użycie

- Świat ma być ciepły, leśny, przygodowy i delikatnie baśniowy; przyjazny, ale odpowiedni dla instruktorów, nie przesadnie dziecinny.
- Bohaterowie żyją: mogą siedzieć przy ognisku, przemieszczać się, rozmawiać, pracować przy obiektach, reagować na ich wygląd.
- Preferowane: ambientowe zmiany dnia/nocy i sezonowe dekoracje, ale w MVP opcjonalne, nie przyjęte jako twardy zakres.
- Czytelny UI, tryb ograniczonych animacji, dostępność klawiaturowa i dotykowa, szybkie wejście do modułu; zgodność z zatwierdzonym design systemem, bez zastępowania nim istniejącego brand DNA.
- W przypadku danych osobowych/dzieci nie ujawniać automatycznie prywatnych danych na publicznej mapie.
- Osobne dekoracje obozowiska i prywatne domki graczy **nie należą do zatwierdzonego zakresu**. Ewentualni goście i przyszłe wydarzenia wymagają osobnej decyzji.

## 11. Relacja do istniejącego kontraktu produktu

- Planowanie → Realizacja → Refleksja → Doskonalenie pozostaje user-facing cyklem; mapa to nowa warstwa prezentacji.
- Plan =/= wykonanie; wykonanie sprawności RR jest faktyczne i odrębne od otrzymania Iskier.
- **Nowa decyzja setupu (2026-10-18):** dwa CTA → Google OAuth → wczesny wybór zwierzaka → dwa prywatne pytania o staż w RR i samodzielne prowadzenie zbiórek → imię/nazwisko, szczep i utworzenie/nazwanie lub dołączenie do jednej drużyny → potwierdzenie dostępności gatunku → opcjonalne zaproszenia e-mail współprowadzących → panel. Tag edukacyjny prywatny, bez ograniczeń funkcji. Powracający nie powtarza onboardingu. [[wiki/concepts/onboarding]].
- Supabase/Postgres pozostaje application SSOT, a Cloudflare Worker to API/integracje; ewentualny model stanów gamifikacji wymaga dopiero implementacji i RLS.
- Nazewnictwo „Żar i Szlif” z decyzji użytkownika z 2026-10-13 ma pierwszeństwo nad historycznymi nazwami w starszych wiki source pages.
- **Nie twierdzić, że świat, zakup, awatary czy ekonomia zostały zaimplementowane lub wdrożone.**

## 12. Decyzje potwierdzone w trzecim pakiecie (2026-10-14)

1. **Rozszerzalna pula gatunków** — nowe gatunki dodawane według potrzeb; brak sztywnej docelowej liczby.
2. **Lis i kruk tylko dla NPC** — Iskra jest jedynym lisem, Szlif jedynym krukiem w roli gatunków; nie są opcjami wyboru dla graczy.
3. **Zmiana drużyny wymaga ponownego wyboru zwierzątka** — zawsze nowy wybór spośród gatunków dostępnych w nowej drużynie.
4. **Personalizacja gracza** — tylko kolory i podstawowe ubranka w bieżącym zakresie.
5. **Typy zadań a waluta** — pomysły i własne zadania → Iskry osobiste; planowanie i realizacja zbiórek → Iskry drużynowe.
6. **Osobista fabuła, wspólny obóz** — indywidualna historia odkryć dla każdego użytkownika, wspólny stan wizualny budowli drużyny.
7. **Personalizacja obozu tylko przez istniejące budynki** — brak dodatkowych dekoracji do kupowania w osobnych miejscach.
8. **Brak oglądania innych obozowisk** — członek widzi tylko obozowisko swojej drużyny.

## 12a. Otwarte decyzje / następne pytania

1. Jak przejściowo umożliwić wybór postaci nowemu użytkownikowi, jeśli wszystkie gatunki w jego drużynie są zajęte, zanim dojdą nowe? Czy tymczasowy neutralny awatar czy inny proces?
2. Co dzieje się z osobistymi Iskrami, kolorami i kupionymi ubrankami po zmianie drużyny i obowiązkowym wyborze nowego zwierzęcia? A z osobistą historią odkryć?
3. Czy zwykła zmiana gatunku w tej samej drużynie też wymaga nowego zakupu kolorów i ubranek, czy kosmetyki są uniwersalne?
4. Czy postęp osobistej fabuły jest liczony z samego wejścia w budynek, ukończenia konkretnej czynności, czy według mieszanych triggerów?
5. Czy odblokowane scenki są możliwe do ponownego obejrzenia w prywatnej Kronice? Czy fabuła reaguje na zakupy wspólne dokonane przez innych członków?
6. Jak obsłużyć przerwany wybór wstępny zwierzaka i sytuację, gdy gatunek jest zajęty przy dołączaniu do drużyny? Wczesny wybór postaci został zatwierdzony.
7. Jak rozwiązać wizualnie wiele zwierząt przy ognisku: wszystkie naraz czy ograniczona liczba + rozwijana lista?
8. Jakie bazowe wyglądy i warianty sześciu ustalonych miejsc mają wejść do MVP? (Liczba i funkcje miejsc są ustalone; szczegóły assetów są otwarte.)
9. Szczegółowe triggery punktowania, kontrola anty-farm i balans — **balans jawnie odłożony**.
10. Czy członkowie widzą historię wspólnych zakupów i kto zmienił wariant wizualny budynku? Zakupów i tak nie można cofnąć.

## 13. Weryfikowalne warunki akceptacji (przyszłe, NIE wynik obecnych testów)

1. Każdy obiekt funkcyjny widoczny, aktywny i prowadzący do funkcji przed zdobyciem pierwszego punktu.
2. Przy pierwszym wejściu użytkownika do danej lokacji pojawia się dialog o jej funkcji; kolejne wejścia domyślnie go nie odtwarzają, ale da się go wywołać ręcznie. Stan dialogu jest osobisty, a nie wspólny dla drużyny.
3. Mapa ma stałe sloty; dla danego obiektu istnieją 2–3 warianty wyglądu, a kupione warianty są trwałe i można bezpłatnie je przełączać, także na bazowy.
4. Zmiana skórki/poziomu nie zmienia capability ani dostępu do modułu.
5. Portfel osobisty przynależy do użytkownika i służy do kolorów i podstawowych ubranek zwierzaka; wspólny należy do drużyny i kupuje wyłącznie warianty już istniejących budynków. Brak osobnych dekoracji.
6. Dowolny uprawniony członek swojej jednej drużyny może dokonać dostępnego zakupu bez głosowania i akceptacji innego użytkownika; operacje są atomowe.
7. Użytkownik ma maksymalnie jedno aktywne członkostwo drużynowe. W danej drużynie nie ma dwóch aktywnych awatarów tego samego gatunku, również przy równoległym wyborze/zmianie.
8. Gatunek awatara można zmienić na wolny w drużynie; pula gatunków rozszerza się z potrzebami. **Lis i kruk są niedostępne graczom. Przy każdej zmianie drużyny następuje nowy wybór zwierzątka**; przenoszenie osobistego salda i kosmetyków jeszcze nieustalone.
9. Avatary zalogowanych członków drużyny domyślnie przebywają przy ognisku; Iskra i Szlif pozostają niezależnymi NPC.
10. Scenki są związane z budynkami, zakupami **oraz rzeczywistym korzystaniem z funkcji**, także przy zerowym saldzie/bez zakupów. **Odkrycia fabularne mają oddzielny postęp dla każdego użytkownika**, podczas gdy wariant budynku jest wspólny. Brak scenki nie blokuje funkcji.
11. Zakup wariantu nie podlega cofnięciu/zwrotowi waluty. Zmiana aktywnego wyglądu zakupionego wariantu nie kosztuje nic.
12. Pomysły i własne zadania przyznają Iskry osobiste, a planowanie i realizacja zbiórek — drużynowe; wypłata jest odporna na replay i podwójne naliczanie. Wysokość nagród jest celowo jeszcze nieustalona.
13. Kontrole uprawnień, RLS i stan portfeli pozostają spójne; Supabase/Postgres jest application SSOT. Oglądanie obozów innych drużyn jest wyłączone.
14. Drużynowe zakupy dotyczą tylko 2–3 wariantów istniejących budynków, przy stałych slotach, bez niezależnych obiektów dekoracyjnych.

15. Po otwarciu home rozwinięta kartka pokazuje najbliższą aktywność, status istnienia planu, liczbę pozostałych zadań i materiałów, ich listy oraz kolejne aktywności; można ją minimalizować i otwierać na tym samym ekranie.
16. Na mapie jest sześć punktów z §6, bez osobnej Polany Drużyny, z rozdzieleniem Namiotu Zastępu od Stołu Wypraw oraz z Tablicą Sprawności i Stopni; bez utraty dawnych funkcji.

## 14. Historia ustaleń

- **2026-10-20 (Robot MCP):** dodano stałego robota-przewodnika w obozowisku z instrukcjami podłączenia produktu przez MCP do ChatGPT i Claude, bez wbudowanego AI, nowej lokacji ani fikcyjnych połączeń. TARGET, nie CURRENT.

- **2026-10-20 (Ognisko):** rozszerzono zakres lokacji o pełne zarządzanie członkami, rolami systemowymi i funkcjami organizacyjnymi oraz kod drużyny z prośbą o dołączenie wymagającą akceptacji administratora. TARGET, nie CURRENT.

- **2026-10-19 (Dziennik i MCP):** w obozowisku stały Dziennik Aktywności (robocza nazwa) do czytania minionych i uzupełniania nadchodzących kart, jako rekwizyt przy Stole Wypraw bez siódmej lokacji. AI nie jest wbudowane w produkt; opcjonalnie poza aplikacją przez MCP. Szczegółowy Arc 2 opisany w [[wiki/concepts/arc-02-wyznaczamy-kierunek]]; szczegóły narracji nadal robocze.

- **2026-10-19:** zatwierdzono sześć miejsc: Ognisko, Namiot Zastępu (rzadko aktualizowany kontekst i dane podstawowe, również przez MCP aplikacji), Stół Wypraw (planowanie zamiast drugiego namiotu), Pracownia Iskry, Gniazdo Szlifa, Tablica Sprawności i Stopni. Powstała robocza, jeszcze nieostateczna specyfikacja Arc 1: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]].

- **2026-10-18 (onboarding):** dwa CTA; wczesny zwierzak; dwa prywatne pytania o doświadczenie RR i prowadzenie zbiórek; opcjonalne zaproszenia e-mail po utworzeniu/nazwaniu drużyny. Nowa kolejność setupu, szczegóły: [[wiki/concepts/onboarding]].

- **2026-10-18 (historyczne: układ pięciu miejsc zastąpiony 2026-10-19):** pięć punktów zamiast ośmiu roboczych lokacji; brak Polany Drużyny. Domyślnie rozwinięta kartka przygotowań na głównym panelu pokazuje najbliższą aktywność, status planu, liczniki i listy zadań/materiałów oraz kolejne aktywności; zminimalizowanie odsłania więcej obozowiska.

- **2026-10-14 (pierwszy pakiet):** dwie postacie fabularne, leśna fabuła, obóz jako interfejs, budynki od początku, estetyczne ulepszenia, stałe lokacje, 2–3 warianty, dwie kategorie Iskier, swobodne zakupy.
- **2026-10-14 (drugi pakiet):** gatunki unikalne per drużyna; jedna drużyna na użytkownika (korekta właściciela unieważnia wcześniejszy wariant z wieloma drużynami); niektóre zadania premiują portfel osobisty, inne drużynowy; kosmetyki zwierzaka vs wizualne obozowisko; zakupione warianty permanentne i darmowo przełączalne; objaśniające dialogi tylko za pierwszym wejściem, później na żądanie; fabuła również z korzystania z funkcji bez zakupów; brak refundacji zakupów.

- **2026-10-14 (trzeci pakiet):** pula gatunków rozszerzana według potrzeb; lis i kruk zastrzeżone dla NPC; przy zmianie drużyny nowy wybór zwierzęcia; kolory i podstawowe ubranka; osobiste nagrody za pomysły/własne zadania, drużynowe za planowanie/realizację zbiórek; odkrycia fabularne osobiste, obóz wspólny; dekoracje wyłącznie w ramach wariantów istniejących budynków; zakaz oglądania obozowisk innych drużyn.
