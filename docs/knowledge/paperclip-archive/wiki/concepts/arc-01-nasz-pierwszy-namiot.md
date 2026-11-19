---
title: Żar i Szlif — Arc 1: Nasz pierwszy namiot (robocza specyfikacja)
type: concept
tags: [zar-i-szlif, arc-1, fabula, misje, namiot-zastepu, kontekst-zastepu, sprawnosci, stopnie, onboarding, working-draft]
created: 2026-10-19
updated: 2026-10-19
---

# Arc 1 — „Nasz pierwszy namiot”

**Status: WORKING DRAFT / PROPOZYCJA ROBOCZA zaakceptowana jako materiał do dalszej pracy 2026-10-19. Nie jest to FINAL APPROVED, CURRENT ani dowód wdrożenia.** Właściciel uznał kierunek za „roboczo nadający się”; treści dialogów, dokładny układ ekranów, wymagania zaliczenia, nagrody i mechanizm analizy pozostają otwarte.

**Cel opowieści:** powstaje Namiot Zastępu — symbol poznania tego, z kim wyruszamy na wyprawę. Gracz poznaje Iskrę (lis, inicjatywa) i Szlifa (kruk, refleksja) oraz pomaga zapełnić namiot pierwszymi informacjami.

**Cel użytkowy:** powstaje użyteczny, później rzadko aktualizowany **profil i kontekst zastępu**, umożliwiający lepsze rekomendacje aktywności i wskazanie **potencjalnych** obszarów braków w wiedzy o zastępie. Profil nie jest rocznym planem działania ani oceną dzieci.

**Sukces produktu:** podstawowe fakty zebrane raz i dostępne ponownie przez UI / uprawnione MCP aplikacji, bez konieczności powtarzania w każdej rozmowie lub planie.

## 0. Ustalone granice / rozdzielenie domen

- **Post-registration onboarding** (OAuth, zwierzak, doświadczenie instruktora, szczep/drużyna, zaproszenia) zakończył się wcześniej. Arc 1 zaczyna się **po wejściu do obozowiska**; nie jest kolejną bramką rejestracyjną.
- **Namiot Zastępu** = trwały kontekst, wiedza i szybki wgląd. **Stół Wypraw** = cele, plan roczny, zbiórki, zadania, materiały, realizacja. **Tablica Sprawności i Stopni** = kanoniczne katalogi i historia wymagań/osiągnięć. Nie dublować źródeł danych między tymi miejscami.
- Obóz ma **sześć** zatwierdzonych miejsc: Ognisko, Namiot Zastępu, Stół Wypraw, Pracownia Iskry, Gniazdo Szlifa, Tablica Sprawności i Stopni. Wszystkie dostępne od początku. Powstanie namiotu w fabule to **prezentacja narracyjna**, nie system odblokowania funkcji i nie zakup kosmetyki.
- **Arc 1 = diagnoza stanu („Gdzie jesteśmy?”)**. **Arc 2 przy Stole Wypraw = wybór celów rozwojowych i plan roczny („Dokąd chcemy dojść?”)**. W Arc 1 nie wymagamy od instruktora przyjęcia celu rocznego ani stworzenia zbiórki.
- **Zastęp jest jednostką profilowania**, nie poszczególni uczestnicy. Na tym etapie **bez segmentacji uczestników, indywidualnych kart zdobycia i śledzenia, kto był nieobecny**. Historyczne działania zastępu są informacją do doboru kolejnych aktywności; nie należy automatycznie powtarzać zajęć całej grupie dla nieobecnych.
- „Przerobiliśmy wspólnie wymagania / program” **nie równa się formalnemu zdobyciu sprawności lub stopnia przez konkretną osobę**. Nie przyznawać automatycznie indywidualnych osiągnięć ani odznak RR.
- Supabase/Postgres pozostaje jedynym application SSOT. **Brak wbudowanego AI**: natywny UI prezentuje zapisane fakty i braki danych, a ewentualne AI działa tylko zewnętrznie przez autoryzowane MCP. AI nie jest arbitrem kompetencji.

## 1. Prolog fabularny — „Mamy miejsce na obóz!”

**Wyzwalacz (propozycja):** pierwsze wejście nowego użytkownika po ukończeniu onboardingu. W przypadku dołączenia do istniejącego obozowiska nie wolno resetować wspólnego stanu ani nadpisywać istniejącego profilu; potrzebny wariant sceny dla już istniejącego namiotu.

**Scena:** Iskra próbuje rozstawić namiot, Szlif trzyma plan. W krótkiej animacji pojawia się bazowy **Namiot Zastępu** z tabliczką nazwy (jeśli nazwa zastępu jest znana; bez wymyślania). Animację i dialog można pominąć. Bazowe miejsce istnieje od początku także bez przejścia przez opowieść.

**Robocze dialogi (copy niezatwierdzone):**
- **Iskra:** „No i jesteśmy! Znalazłem idealne miejsce na nasz namiot. Teraz tylko trzeba go rozstawić!”
- **Szlif:** „Namiot to dobry początek. Ale co powinniśmy w nim przechowywać?”
- **Iskra:** „Wszystko, co pomoże nam lepiej poznać nasz zastęp!”

**CTA / zaproszenie:** „Poznaj swój zastęp” / „Zacznij od namiotu”; możliwość „Później” bez utraty dostępu do obozu.

## 2. Rytuał misji — cztery krótkie kroki

Kolejne kroki służą **wytworzeniu realnego artefaktu danych**, nie klikaniu dla nagrody. Formularze powinny być krótkie, podzielone na logiczne części, z możliwością wznowienia i podglądem postępu. Poniższa kolejność i copy to **robocza propozycja UX**.

### Krok 1/4 — „Kim jesteśmy?” (profil i realia)

**Scena:** Szlif pyta, jak i w jakich warunkach działa zastęp.

**Zawartość:**
- Nazwa zastępu i kontekst szczepu/drużyny **z onboardingu, bez ponownego wpisywania**.
- Pion / poziom metodyczny (gdy brak danych), przybliżona liczebność, częstotliwość spotkań.
- Dostępne zasoby i miejsca spotkań, realia pracy, istotne ograniczenia organizacyjne.
- Podawanie dodatkowych informacji tylko wtedy, gdy rzeczywiście poprawiają jakość planowania; nie zbierać nadmiarowych danych o dzieciach.

**Rezultat:** podstawowe warunki funkcjonowania zastępu są czytelne i możliwe do edycji później w Namiocie Zastępu.

### Krok 2/4 — „Co już potrafimy?” (obserwacje o zastępie)

**Scena:** Iskra chce ruszać na wyprawę; Szlif proponuje sprawdzić samodzielność i to, gdzie pomoc jest nadal potrzebna.

**Trzy grupy danych (zachować model wcześniejszego „Kontekstu zastępu”):**
1. **Samodzielnie potrafią** — konkretne zachowania i umiejętności wykonane bez pomocy.
2. **Potrafią z pomocą** — czynności wykonalne po instrukcji, przypomnieniu lub wsparciu.
3. **Jeszcze nie potrafią** — obszary wymagające uczenia się / sprawdzenia.

**Pola uzupełniające:** współpraca, sposób podejmowania decyzji, podział funkcji i odpowiedzialności, dodatkowe informacje istotne dla planowania. Bez obowiązku listy nazwisk, przypisywania umiejętności dzieciom i budowania rankingu.

**UX:** gotowe przykłady / podpowiedzi dla mniej doświadczonych instruktorów, możliwość wpisania własnych obserwacji, krótkie pola zamiast długiego raportu. Wykorzystać prywatne preferencje poziomu podpowiedzi z onboardingu, ale nie ujawniać etykiet kompetencji.

**Wniosek analityczny:** brak deklaracji umiejętności ≠ brak umiejętności. Nie zamieniać niewypełnionej sekcji w automatyczne „jeszcze nie potrafią”.

### Krok 3/4 — „Ślady dawnych wypraw” (historia grupowych doświadczeń)

**Cel:** gracz wskazuje, **co zastęp już wspólnie robił**, żeby przyszłe sugestie nie polegały na powtarzaniu przerobionych tematów bez potrzeby.

**Źródło wyboru:** oficjalne katalogi **sprawności i stopni RR**, przez istniejącą / docelową **Tablicę Sprawności i Stopni**. W Namiocie Zastępu wyświetla się tylko powiązane podsumowanie; nie tworzymy drugiego katalogu ani osobnych rekordów historycznych.

**Wariant dodawania grupowego (bez segmentacji):**
- Zaznaczenie sprawności / obszarów wymagań stopni, nad którymi zastęp pracował.
- Dla każdej pozycji status znaczący dla **historii grupy**, np. `zrealizowaliśmy wspólnie`, `pracowaliśmy częściowo`, `nie pamiętam dokładnie`. Wybór „nie mamy jeszcze takich doświadczeń” albo „uzupełnię później” jest dozwolony.
- Brak wymagania przypisania osiągnięcia do osób, wpisania obecności, indywidualnych zaliczeń czy odtwarzania historii wszystkich uczestników.
- Rozdzielić historyczny opis wykonanych działań od formalnego statusu stopnia/sprawności. Stopni **nie oznaczać** jako formalnie zdobytych „przez zastęp”; można zapisać, że zastęp **przerobił określone wymagania**.
- W rekomendacjach historycznie zrealizowane wspólnie zagadnienie nie jest sugerowane automatycznie ponownie wyłącznie z powodu nieobecności pojedynczych osób. **Nie zakazywać dobrowolnego powrotu do zagadnienia**, jeśli jest pedagogicznie sensowny.
- Przypisanie katalogowe, historia przerobienia wymagań i faktyczne formalne zaliczenie to osobne semantyki danych; tam, gdzie brak oficjalnych pozycji lub mapowania, prezentować `Brak danych`, bez wymyślonych stopni czy wymagań.

**Roboczy dialog Szlifa:** „Nie musimy zaczynać wszystkiego od początku. Zobaczmy, jakie wyzwania Wasz zastęp ma już za sobą”.

### Krok 4/4 — „Pierwszy portret zastępu” (podsumowanie i korekta)

**Scena:** Szlif układa notatki, Iskra przypina pierwszy arkusz wewnątrz namiotu. Gra prezentuje **oparte na zapisanych danych** podsumowanie:
- **Mocne strony** — wyłącznie z faktycznych obserwacji / historii, bez wymyślania dowodów.
- **Potencjalne obszary rozwoju** — ostrożne hipotezy i luki, bez oceniania dzieci i bez przedstawiania ich jako formalnego celu rocznego.
- **Co już robiliśmy** — sprawności i wymagania stopni przepracowane przez grupę, ze statusem ukończone/częściowe/niepewne.
- **Czego jeszcze nie wiemy** — nieuzupełnione dane przedstawione neutralnie, a nie jako braki kompetencji.

Instruktor może poprawić błędne lub zbyt daleko idące wnioski. **Wbudowany interfejs nie generuje diagnoz AI**; przedstawia fakty, deklaracje grupy i brakujące informacje. Opcjonalny **zewnętrzny klient AI przez MCP** może zasugerować interpretację, ale nie nadpisuje faktów bez autoryzowanej operacji. Zapis profilu nie oznacza automatycznie formalnego zaliczenia żadnej sprawności/stopnia.

**Robocza końcowa scena:**
- **Iskra:** „Czyli mamy już całkiem sporo za sobą! To dokąd ruszamy teraz?”
- **Szlif:** „Najpierw sprawdźmy, w jakim kierunku chcemy się rozwijać. Teraz możemy to zaplanować z sensem.”
- **Iskra:** „No to rozkładaj mapę!”

**Następny rozdział:** Stół Wypraw i Arc 2 — plan roczny z obowiązkowym tematem, jeden cel z DoD na najbliższe 3 miesiące i opcjonalne aktywności. Zob. [[wiki/concepts/arc-02-wyznaczamy-kierunek]].

## 3. Rytuał wizualny, nagroda i brak blokad

| Faza | Efekt fabularny | Realny efekt |
|---|---|---|
| Prolog | Bazowy Namiot Zastępu rozstawia się, pojawia się nazwa | Przejście do profilu |
| Realia | Pojawiają się pierwsze notatki | Zapis podstawowego kontekstu |
| Umiejętności | Kolejne kartki w namiocie | Zapis obserwacji o całej grupie |
| Historia | Szlif porządkuje ślady dawnych wypraw | Powiązanie historii grupy z Tablicą Sprawności i Stopni |
| Finał | Tabliczka/arkusz wiedzy, komentarz NPC | Zrozumiałe podsumowanie gotowe do późniejszego planowania |

- Namiot nie jest funkcją do kupienia. Narracyjne drobiazgi / tabliczka nie stanowią nowej płatnej dekoracji ani osobnego slotu. Zakupy wyglądu miejsc nadal tylko według kanonu kosmetycznych wariantów za drużynowe Iskry.
- **Nie ustanowiono jeszcze** konkretnej liczby Iskier, zdarzenia nagrody, formalnego `completed` ani minimalnej liczby pól potrzebnej do ukończenia. Unikać dopisywania tych wartości przez domysł.
- Można pominąć historię, wznowić pracę, powrócić do edycji; opuszczenie arcu nie zamyka innych lokacji, modułów ani codziennych zadań.
- Odkrycia scen fabularnych są **osobiste**, natomiast faktyczny profil zastępu i wizualny stan wspólnego obozu są dzielone zgodnie z uprawnieniami.

## 4. Dane i MCP — kontrakt kierunkowy

1. **SSOT:** Supabase/Postgres; nie trzymać kontekstu w oddzielnym repozytorium AI, dodatkowej „pamięci” MCP lub dublowanej tabeli tylko na potrzeby fabuły.
2. **Dostęp:** Namiot Zastępu zapewnia szybki odczyt i okazjonalną edycję profilu; docelowy MCP aplikacji ma obsługiwać ten sam model przez właściwe autoryzowane operacje odczytu/zapisu. Samo istnienie tego kontraktu **nie potwierdza wdrożenia MCP**.
3. **Spójność:** zmiany UI i MCP muszą widzieć te same rekordy; readback po aktualizacji; autoryzacja/RLS według organizacji/drużyny i właściwego zastępu.
4. **Pochodzenie:** data/czas, kto/co dokonało zapisu, wersja/źródło obserwacji; rozdzielić deklaracje instruktora od analizy AI i od rzeczywistych formalnych zaliczeń RR.
5. **Relacje:** profil zastępu = względnie trwałe dane, Stół Wypraw = planowanie i wykonanie, Tablica Sprawności i Stopni = katalogi i historia działań/wymagań. Widoki mogą prezentować powiązane dane, ale nie dublują ich.
6. **Zakres prywatności:** nie wymagać listy dzieci, nazwisk, obecności, indywidualnych stopni ani wrażliwych opisów; dostęp tylko dla uprawnionych osób. Dotychczasowe prywatne pytania o doświadczenie instruktora są doborami pomocy UI, nie częścią publicznego profilu zastępu.
7. **Analiza:** rekomendacje powinny rozróżniać `potwierdzony zapis historyczny`, `deklaracja grupowa`, `hipoteza`, `brak danych`. Nigdy nie wnioskować „dziecko nie potrafi” z nieobecności czy pustego pola.
8. **Wiele zastępów:** należy oddzielić kontekst konkretnego zastępu od nadrzędnych danych drużyny; szczegóły struktury identyfikatorów, uprawnień i przepływu w wielu zastępach pozostają do zaprojektowania.

## 5. Scenariusze brzegowe do zaprojektowania

- **Istniejąca drużyna / zastęp z zapisanymi danymi:** nie odtwarzać „powstania” wspólnego namiotu ani nie resetować profilu przy dołączeniu drugiej osoby; potrzebny osobisty wariant wprowadzenia.
- **Brak historii sprawności i stopni:** jawne „jeszcze nie realizowaliśmy” albo „uzupełnię później”; brak negatywnej oceny.
- **Niepełny kontekst:** zapis roboczy i późniejsze uzupełnianie; żadnego wymyślania liczb, dat, kompetencji ani celów.
- **Równoległe aktualizacje przez UI/MCP:** respektowanie uprawnień, kontroli wersji i zapobieganie nadpisaniu nowszego profilu.
- **Powrót do ukończonego arcu:** profil zawsze dostępny, fabularna scena pierwszego wejścia nie wymusza powtórzenia; indywidualny postęp historii oddzielony od danych grupy.
- **Już zaplanowane aktywności:** poznanie kontekstu nie usuwa ani nie zmienia istniejących planów bez działania instruktora.
- **Inny poziom RR / katalog niedostępny:** nie zgadywać wymagań, stosować neutralny stan braku danych.

## 6. Przyszłe kryteria akceptacji (NIE dowody CURRENT)

- Arc 1 można rozpocząć z obozu po onboardingu, pominąć i wznowić bez blokowania pracy.
- Po pierwszym zapisie dane zastępu są widoczne w Namiocie i mogą zostać odczytane/zmienione przez odpowiednio autoryzowaną ścieżkę aplikacyjną/MCP, jeśli jest wdrożona.
- Profil wstępnie uzupełnia dane już znane z onboardingu i nie pyta ponownie o nie bez powodu.
- Krok umiejętności utrzymuje trzy rozłączne kategorie samodzielność / z pomocą / jeszcze nie, odrębne od `brak danych`.
- Historia sprawności i stopni dotyczy grupy i **nie tworzy indywidualnych zaliczeń** ani operacji naprawiania nieobecności; zachowuje rozróżnienie plan / doświadczenie / formalne wykonanie.
- Braki danych są oznaczone; ewentualne sugestie zewnętrznego AI przez MCP są wyraźnie odrębne od faktów. Podsumowanie można poprawić bez AI.
- Po zmianach w kontekście nie zmieniają się same z siebie cele czy plany roczne.
- Fabuła i kosmetyka nie zmieniają dostępu do sześciu lokacji. Nie ma obowiązkowego zakupu, automatycznego przydziału stopni ani samoczynnego naliczania nieuzgodnionej nagrody.

## 7. Otwarte decyzje — do dopracowania przy dalszej rozmowie

1. Docelowe **copy/dialogi**, liczba scen, długość animacji i sposób pomijania.
2. Dokładny **układ ekranów** (formularz vs karty), przykłady do wyboru, liczba pól i walidacja.
3. Definicja **ukończenia pierwszego arcu** i zasady checkpointów: pełny profil czy minimalny podzbiór, jak obsłużyć „nie wiem”.
4. Docelowa **semantyka statusów historii grupowej**, mapowanie oficjalnych sprawności i wymagań stopni (bez formalnych stopni indywidualnych).
5. Jaki ma być **zakres i sposób prezentacji analizy luk**: automatyczny lub na żądanie, kiedy wymaga weryfikacji instruktora.
6. **Nagroda / Iskry** za ukończenie i relacja do wizualnych wariantów namiotu; brak zatwierdzonego balansu.
7. Wariant nowego użytkownika dołączającego do **już istniejącego obozowiska**.
8. Ostateczna granica danych **zastęp vs drużyna** i uprawnienia edycji kontekstu w wielu zastępach.
9. Dokładne API/MCP, schemat bazy, wersjonowanie i implementacja — do potwierdzenia przez prawdziwy CURRENT i testy.

## Powiązania i status nadrzędny

- [[wiki/concepts/onboarding]] — zatwierdzona kolejność wejścia do obozu.
- [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] — sześć miejsc, fabuła, Iskry, granice odblokowań i SSOT.
- [[wiki/projects/kompas-zbiorek/decisions]] — zatwierdzone decyzje; ten **Arc 1 jest na razie working draft**, nie nowym zaakceptowanym kontraktem implementacyjnym.
- [[wiki/projects/kompas-zbiorek/index]] — zwięzły opis produktu i jego funkcji.
- [[wiki/concepts/karta-zbiorki]] — rozdzielenie planu i faktycznego wykonania.
