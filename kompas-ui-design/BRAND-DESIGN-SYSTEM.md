


Kompas Zbiórek — UI / Branding / Section System Specification
Wersja specyfikacji: 1.0
Stan implementacji bazowej: kompas-v16-topo-mountains-accent.html
Zakres: header, sekcja 01 AZYMUT, sekcja 02 PRZESZKODY, system CTA, topografia, góry, elementy trasy, responsywność, reguły Gestalt i zasady dalszego developmentu.
Cel dokumentu: utrzymać spójny język wizualny Kompasu Zbiórek i uniemożliwić kolejnym iteracjom przypadkowe dokładanie ozdobników, niespójnych ramek, ikon, odstępów i breakpointów.

1. Założenie projektowe
Kompas Zbiórek ma wyglądać jak cyfrowe narzędzie operacyjne inspirowane kartografią, orientacją w terenie i skautingiem, a nie jak strona „outdoor”, vintage landing page ani generyczny SaaS.

Projekt łączy dwa światy:

świat terenowy / kartograficzny — azymut, topografia, linia trasy, waypointy, góry, oznaczenia kierunkowe, oliwka, papier, złoto i czerwień,

świat cyfrowy / produktowy — klarowny grid, czytelna hierarchia informacji, rzeczywisty podgląd Custom GPT, precyzyjne CTA, responsywny layout i oszczędna interakcja.

Najważniejsza reguła brzmi:

Branding jest systemem prowadzącym wzrok, nie kolekcją dekoracji.

Dlatego każdy element charakterystyczny musi pełnić konkretną rolę:

czerwień = kierunek, aktywność, primary action,

złoto = punkt docelowy, akcent kierunkowy, drugi poziom kontrastu,

oliwka = struktura, środowisko, tło robocze,

papier / ecru = przestrzeń analityczna i spokojna,

topografia = kontekst i głębia tła,

góry = sygnatura terenowa sekcji jasnej,

trasa / waypoint = ciągłość i progres,

offset prawa + dół = charakterystyczne wskazanie „kierunku / warstwy / przesunięcia”, używane tylko przy wybranych elementach wysokiej rangi.

2. Nienaruszalne zasady marki
Poniższe reguły są traktowane jak invariants. Nie powinny być zmieniane przez kolejne iteracje bez świadomej decyzji projektowej.

2.1. Logo
Logo nie dostaje dodatkowego tła.

Logo nie dostaje dodatkowego kółka.

Logo nie dostaje kwadratu, kapsuły, badge'a ani dekoracyjnej obwódki.

Nie należy dokładać pod nim pseudo-emblematów ani ikon.

Logo jest samodzielnym znakiem i ma być wyświetlane na transparentnym tle.

W headerze znak i wordmark tworzą jeden lockup.

2.2. Screenshot / podgląd Custom GPT
Używany jest rzeczywisty screenshot Kompasu Zbiórek RR, nie generowany zamiennik.

Screenshot nie powinien być otaczany klasyczną ramką „picture frame”.

Nie wolno stosować wielokrotnych borderów, medalionów, kół, ornamentów ani symetrycznej pełnej złotej ramki.

Element charakterystyczny to złoty offset tylko po prawej i na dole.

Ten sam typ offsetu jest używany przy czarnym CTA-bandzie w sekcji 02.

2.3. Sekcja 02
Label sekcji to: PRZESZKODY.

Kicker sekcji to: ZNASZ TE WYZWANIA?.

Nie występuje label KIERUNEK.

CTA-band na dole jest cały czarny / niemal czarny.

Wewnętrzny primary CTA pozostaje czerwony, z żółtym / złotym action-capem.

Sekcja musi zawierać topografię oraz element kierunkowy / strzałkę w dół.

2.4. Dekoracje
Nie wolno dodawać elementów tylko po to, aby „nie było pusto”. Dopuszczone elementy to:

topografia,

góry,

linia trasy,

waypointy,

strzałka / grot,

numeracja sekcji,

złoty directional offset.

Jeżeli nowy detal nie należy do tej rodziny, domyślnie należy go odrzucić.

3. Paleta kolorystyczna
Aktualna implementacja korzysta z poniższych tokenów:

:root {
  --forest-950: #162313;
  --forest-900: #1d2d19;
  --forest-800: #2a3d24;

  --paper:   #f5f0df;
  --paper-2: #ece5d1;

  --ink:   #20301e;
  --muted: #485347;

  --red:      #be302a;
  --red-dark: #93221e;

  --gold:      #d6ad2f;
  --gold-soft: #e4c557;

  --black: #070907;
  --white: #ffffff;
}
3.1. Funkcja kolorów
Forest 950 — #162313
Główne ciemne tło marki.

Użycie:

header,

sekcja 02,

action-cap sekundarnego CTA,

ciemne elementy nawigacji.

Forest 900 — #1d2d19
Warstwa pośrednia.

Użycie:

ciemne detale,

action-cap,

stany komponentów.

Paper — #f5f0df
Główne jasne tło.

Ma przypominać papier mapowy, ale bez sztucznego postarzania, tekstur vintage i efektów „brudnego papieru”.

Ink — #20301e
Główny kolor tekstu na jasnym tle.

Muted — #485347
Tekst drugorzędny.

Nie należy obniżać kontrastu bardziej niż w obecnej wartości. Body copy musi pozostać czytelne.

Red — #be302a
Kolor działania i kierunku.

Użycie:

główne CTA,

active state nawigacji,

numer sekcji 01,

route accents,

kicker,

pojedyncze markery.

Gold — #d6ad2f
Kolor celu / akcentu kierunkowego.

Użycie:

action-cap CTA,

aktywna karta 02,

prawy i dolny directional offset,

topografia na ciemnym tle,

numer sekcji 02,

pionowa strzałka sekcji 02.

Black — #070907
Kolor specjalny dla CTA-bandu sekcji 02.

Nie zastępować oliwką. Jego zadaniem jest zbudowanie wyraźnej figury na zielonym tle.

4. Typografia
4.1. Rodzina fontów
Aktualny kod rozdziela typografię na dwa zastosowania:

body {
  font-family: "Noto Sans", Arial, sans-serif;
}

h1,
h2,
h3,
.brand-name,
.section-number,
.next-title {
  font-family: "Noto Sans Display", "Noto Sans", Arial, sans-serif;
}
Rola fontów
Noto Sans Display:

H1,

H2,

tytuły kart,

numery sekcji,

nagłówki CTA,

wordmark.

Noto Sans:

body,

lead,

nawigacja,

CTA labels,

opisy kart,

supporting copy.

W produkcji fonty muszą być faktycznie załadowane. Samo wpisanie nazwy w font-family bez importu lub self-hostingu może zakończyć się fallbackiem do Arial.

5. Skala typograficzna
Projekt bazuje na rytmie 4 px.

5.1. Desktop
Element	Rozmiar	Line-height	Waga	Uwagi
H1	52 px	54 px	900	główny hero headline
H2 sekcji 02	32 px	36 px	900	na dużym desktopie
H3 karta	22 px	26 px	850–900	kontrolować liczbę linii
Lead	20 px	28 px	760	główna obietnica
Body	16 px	24 px	normal	max 520–640 px
Nav	16 px	20 px	700	nie zmniejszać bez potrzeby
CTA	13 px	16 px	850	uppercase
Kicker	12 px	16 px	850	uppercase, tracking
Label sekcji	10 px	12 px	850	uppercase
Numer sekcji	30 px	32 px	900	czerwony / złoty
5.2. Mobile
Element	Rozmiar	Line-height
H1	40 px	42 px
H2	36 px	40 px
Lead	18 px	24 px
Body	16 px	24 px
Numer sekcji	28 px	28 px
Kicker	10 px	12 px
6. Reguły line-height i długości tekstu
Projekt ma unikać dwóch typowych błędów:

zbyt ciasnej interlinii w dużych nagłówkach,

zbyt długich linii w body copy.

6.1. H1
52 / 54 na desktopie,

około 1.04 line-height,

nie kompresować do 0.9–0.95,

nie pozwalać, aby nagłówek tworzył przypadkowy pionowy słup 5–6 linii przy szerokim desktopie.

6.2. Lead
20 / 28,

max-width około 520px,

powinien być czytany jako jedna zwarta grupa pod H1.

6.3. Body
16 / 24,

maksymalna szerokość około 520–640px, zależnie od breakpointu,

nie stosować text-align:center w sekcjach informacyjnych.

7. System spacingu
Podstawą jest 4 px grid.

--s1: 4px;
--s2: 8px;
--s3: 12px;
--s4: 16px;
--s5: 20px;
--s6: 24px;
--s8: 32px;
--s10: 40px;
--s12: 48px;
--s16: 64px;
--s20: 80px;
7.1. Dopuszczone odstępy
Preferowane:

4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 48 / 64 / 80 / 96 / 104 px

28 px i 104 px są stosowane w implementacji jako większe rytmy, mimo że nie mają osobnych custom properties.

7.2. Niedopuszczone podejście
Nie należy projektować odstępów przez ręczne „dokręcanie” pojedynczych wartości:

17 px,

23 px,

37 px,

53 px,

przypadkowe ujemne marginesy,

top: 73px jako naprawa błędnego gridu.

Najpierw poprawiamy strukturę layoutu, potem spacing.

8. Globalny kontener
Desktop:

--shell: 1280px;

.shell {
  width: min(var(--shell), calc(100% - 64px));
  margin-inline: auto;
}
Znaczenie:

maksymalna szerokość 1280 px,

po 32 px bezpiecznego marginesu z obu stron,

treść nie przylega do krawędzi viewportu.

Na mniejszych ekranach:

@media (max-width: 1199px) {
  .shell {
    width: min(1104px, calc(100% - 40px));
  }
}

@media (max-width: 959px) {
  .shell {
    width: calc(100% - 32px);
  }
}

@media (max-width: 599px) {
  .shell {
    width: calc(100% - 24px);
  }
}
Czyli orientacyjnie:

desktop: 32 px marginesu,

kompaktowy desktop / tablet: 20 px,

tablet: 16 px,

mobile: 12 px.

9. Header
9.1. Zadanie headera
Header nie ma być osobną „hero sekcją”. Ma:

identyfikować markę,

umożliwiać nawigację,

zapewniać dostęp do 2 głównych akcji,

wskazywać aktywną sekcję.

9.2. Konstrukcja
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--forest-950);
  color: #fff;
  border-bottom: 1px solid rgba(214,173,47,.12);
}

.header-inner {
  height: 72px;
  display: grid;
  grid-template-columns: max-content minmax(0,1fr) max-content;
  align-items: center;
  gap: 24px;
}
Struktura:

[ LOGO + WORDMARK ]    [ NAV ]    [ CTA PRIMARY ][ CTA GUIDE ]
9.3. Logo
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 172px;
  background: none;
  border: 0;
  box-shadow: none;
}

.brand-logo {
  width: 42px;
  height: 42px;
  object-fit: contain;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
Zakaz:

żadnego koła,

żadnej kapsuły,

żadnego dodatkowego backgroundu,

żadnego pseudo-badge'a.

9.4. Nawigacja
Linki:

16 px,

weight 700,

gap: 20px,

aktywny stan przez czerwony underline.

Underline:

.nav-link::after {
  width: 28px;
  height: 2px;
  background: var(--red);
}
Aktywny underline jest krótszy niż tekst, dzięki czemu działa jak wskaźnik, nie jak typowe podkreślenie hyperlinku.

9.5. Mobile header
Przy max-width: 959px:

desktop nav znika,

header actions znikają,

pojawia się hamburger,

menu rozwija się pionowo pod headerem.

10. System CTA
CTA korzystają z jednego wspólnego DNA:

[ label ................................ ] [ action-cap ]
Całość jest kapsułą, ale action-cap jest własnym okrągłym obiektem.

10.1. Baza
.btn {
  height: 52px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 13px;
  line-height: 16px;
  font-weight: 850;
  text-transform: uppercase;
}
10.2. Action-cap
Finalnie:

.btn-primary .btn-cap,
.btn-guide .btn-cap,
.btn-section2 .btn-cap {
  width: 38px;
  height: 38px;
  border-radius: 999px;
}
Action-cap nie jest prostokątnym segmentem. Ma zachować formę okrągłą.

10.3. Primary CTA
.btn-primary {
  background: var(--red);
  color: #fff;
}

.btn-primary .btn-cap {
  background: var(--gold);
  color: var(--forest-950);
}
Semantyka:

czerwony = główne działanie,

złoty = kierunek / finalizacja ruchu.

10.4. Secondary CTA
.btn-guide {
  background: #eee4c8;
  color: var(--forest-950);
}

.btn-guide .btn-cap {
  background: var(--forest-900);
  color: var(--gold-soft);
}
Secondary CTA powinno być wyraźne, ale nie konkurować z czerwonym primary.

10.5. Desktop hero CTA
Na desktopie oba przyciski są obok siebie:

.hero-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 16px;
  margin-top: 28px;
}
Nie stackować ich na standardowym desktopie.

10.6. Mobile hero CTA
Przy max-width: 599px:

.hero-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
Każdy przycisk ma pełną szerokość.

11. Sekcja 01 — AZYMUT
11.1. Rola sekcji
Sekcja 01 odpowiada na pytanie:

„Czym jest Kompas Zbiórek i jaki problem rozwiązuje?”

To sekcja jasna, informacyjna i produktowa.

Główne grupy Gestalt:

rail 01 / AZYMUT,

kicker,

H1,

lead,

supporting copy,

CTA group,

product preview,

warstwa gór jako dolne domknięcie.

12. Layout sekcji 01
12.1. Grid najwyższego poziomu
.hero-inner {
  display: grid;
  grid-template-columns: 44px minmax(0,1fr);
  gap: 24px;
  padding: 48px 0 104px;
}
Czyli:

[ 44 px rail ] [ główny content ]
Rail nie może przejmować szerokości tekstu.

12.2. Grid treści
.hero-grid {
  display: grid;
  grid-template-columns: minmax(0,1fr) minmax(0,1.04fr);
  grid-template-rows: auto auto;
  column-gap: 40px;
  row-gap: 12px;
  align-items: start;
}
Zasada:

ROW 1: [ kicker             ][                     ]
ROW 2: [ copy + CTA          ][ product screenshot ]
Prawa kolumna jest minimalnie szersza niż lewa.

13. Rail 01 / AZYMUT
Rail jest jednym z głównych elementów charakterystycznych.

Składa się z:

numeru 01,

labelu AZYMUT,

pionowej linii,

2 waypointów,

strzałki na końcu.

.section-number {
  font-size: 30px;
  line-height: 32px;
  font-weight: 900;
  color: var(--red);
}

.section-name {
  margin-top: 8px;
  font-size: 10px;
  line-height: 12px;
  font-weight: 850;
  letter-spacing: .14em;
  text-transform: uppercase;
}
Zasada UX
Waypointów nie dodajemy losowo. Maksymalnie 2–3 na długiej osi. Mają sugerować progres, nie tworzyć ozdobny „sznur koralików”.

14. Kicker sekcji 01
Tekst:

ASYSTENT AI DLA INSTRUKTORÓW RR

Konstrukcja:

.kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--red);
  font-size: 12px;
  line-height: 16px;
  font-weight: 850;
  letter-spacing: .105em;
  text-transform: uppercase;
}

.kicker::before {
  content: "";
  width: 32px;
  height: 2px;
  background: var(--red);
}
Ten pattern jest używany ponownie w sekcji 02 dla ZNASZ TE WYZWANIA?.

To ważne: powtarzalność tego wzorca buduje markę silniej niż dodawanie nowych ikon.

15. H1, lead i supporting copy
15.1. H1
Treść:

Od problemu w drużynie do gotowego planu zbiórki

Aktualnie:

h1 {
  max-width: 584px;
  margin: 0;
  font-size: 52px;
  line-height: 54px;
  font-weight: 900;
  letter-spacing: -.034em;
  text-wrap: balance;
}
15.2. Lead
.lead {
  max-width: 520px;
  margin: 20px 0 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 760;
}
15.3. Body
.copy {
  max-width: 520px;
  margin: 12px 0 0;
  color: #3f4b3e;
  font-size: 16px;
  line-height: 24px;
}
Hierarchia
KICKER
12 px

H1
20 px

LEAD
12 px

BODY
28 px

CTA GROUP
To ma tworzyć jedną zwarta grupę, bez przypadkowych dużych dziur.

16. Product preview / screenshot Custom GPT
16.1. Najważniejsza zasada
Nie ma klasycznej ramki dookoła screena.

Finalny język to:

screenshot,

brak borderu,

brak dodatkowego tła,

brak narożników,

złoty akcent tylko po prawej i na dole.

16.2. Wspólne tokeny akcentu
:root {
  --accent-offset: 7px;
  --accent-stroke: 3px;
  --accent-start-x: 22%;
  --accent-start-y: 20%;
}
16.3. Screenshot
.product-frame {
  position: relative;
  isolation: isolate;
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.product-frame::after {
  content: "";
  position: absolute;
  right: calc(-1 * var(--accent-offset));
  bottom: calc(-1 * var(--accent-offset));
  left: var(--accent-start-x);
  top: var(--accent-start-y);
  border-right: var(--accent-stroke) solid var(--gold);
  border-bottom: var(--accent-stroke) solid var(--gold);
  z-index: -1;
}
To jest directional frame, nie box-shadow.

Charakter
Akcent zaczyna się dopiero od:

22% szerokości od lewej,

20% wysokości od góry.

Dzięki temu nie tworzy pełnej ramki. Jest „częścią prowadzącą w prawo i dół”.

17. Jasne tło sekcji 01
Sekcja 01 nie jest pustym kremowym polem. Ma dwie warstwy:

topografia,

góry.

17.1. Topografia
Finalna wersja v16 zwiększa gęstość:

.hero::before {
  opacity: .11;
  background-size: 430px 280px;
  background-position: 0 0, 215px 140px;
}

.hero-extra-topo {
  width: 300px;
  height: 240px;
  left: 1%;
  top: 23%;
  opacity: .18;
}
Reguła
Topografia ma być widoczna przy drugim spojrzeniu, ale nie może przechodzić przed tekst.

Nie zwiększać opacity do 0.3–0.5 na jasnym tle.

18. Góry sekcji 01
Góry są elementem sygnaturowym jasnego motywu.

Finalnie:

.mountains {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 176px;
  opacity: .36;
  pointer-events: none;
}
Góry składają się z kilku warstw line-art:

dalsze pasmo — cienkie, jaśniejsze,

drugie pasmo — ciemniejsze,

lokalne szczyty — bardziej kontrastowe,

1–2 czerwone route accents / waypointy.

Nie robić
jednego regularnego zig-zaga,

symetrycznych trójkątów,

pełnych ilustracji zdjęciowych,

gradientów imitujących zachód słońca,

mocnych cieni.

Góry mają wyglądać jak kartograficzny line-art / szkic terenowy, nie jak clipart.

19. Sekcja 02 — PRZESZKODY
19.1. Rola sekcji
Sekcja 02 pokazuje trzy sytuacje problemowe, w których Kompas ma zastosowanie.

Główne grupy Gestalt:

rail 02 / PRZESZKODY,

kicker ZNASZ TE WYZWANIA?,

heading + opis,

3 karty,

czarny next-step CTA-band.

20. Tło sekcji 02
Ciemne tło:

.situations {
  position: relative;
  overflow: hidden;
  background: var(--forest-950);
  color: #fff;
}
20.1. Topografia
W v16 jest celowo gęstsza niż wcześniej:

.situations::before {
  opacity: .32;
  background-size: 420px 270px;
  background-position: 0 0, 210px 135px;
}

.situations-topo-extra {
  opacity: .24;
  background-size: 560px 300px;
  background-position: center 0;
}
Na ciemnym tle topografia może być wyraźniejsza niż w sekcji jasnej, bo kontrast nadal pozostaje kontrolowany.

Kolor topografii: złoty / oliwkowo-złoty.

21. Rail sekcji 02
Treść:

02
PRZESZKODY
↓
Numer jest złoty.

.situations .section-number {
  color: var(--gold);
}
W sekcji 02 znajduje się pionowa strzałka w dół:

.section-down-arrow {
  position: absolute;
  left: 50%;
  top: 90px;
  width: 1px;
  height: 226px;
  background: rgba(214,173,47,.34);
}
Zawiera 2 waypointy i grot na końcu.

Znaczenie
To nie jest „kolejny ozdobnik”. Jest kontynuacją motywu nawigacji / kierunku z sekcji 01.

22. Kicker ZNASZ TE WYZWANIA?
Wzorzec identyczny jak kicker hero:

.section-kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--red);
  font-size: 12px;
  line-height: 16px;
  font-weight: 850;
  letter-spacing: .105em;
  text-transform: uppercase;
}

.section-kicker::before {
  content: "";
  width: 32px;
  height: 2px;
  background: var(--red);
}
Kicker jest nad H2, nie koło screena w sekcji 01.

23. Intro sekcji 02
Desktop layout bazowy:

.situations-inner {
  display: grid;
  grid-template-columns: 72px 400px minmax(0,1fr);
  gap: 24px;
  row-gap: 24px;
  padding: 48px 0 52px;
}
Schemat:

[ rail ] [ intro ] [ 3 cards ]
                 [ next-step spans intro + cards ]
Heading:

.sit-intro h2 {
  max-width: 390px;
  font-size: 32px;
  line-height: 36px;
  font-weight: 900;
}
Supporting copy:

.sit-intro p {
  max-width: 360px;
  margin: 16px 0 0;
  color: rgba(255,255,255,.84);
  font-size: 15px;
  line-height: 24px;
  text-align: left;
}
Zakaz: centrowania tego tekstu.

24. Karty problemów
24.1. Grid
.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0,1fr));
  gap: 16px;
  align-items: stretch;
}
24.2. Karta bazowa
Każda karta ma:

numer,

tytuł,

opis,

takeaway.

Finalny rytm:

.card {
  min-height: 264px;
  padding: 20px 20px 16px;
}

.card h3 {
  min-height: 78px;
  font-size: 22px;
  line-height: 26px;
}
Ważne
Na desktopie tytuły kart powinny mieć porównywalną liczbę linii. Wymuszenie min-height pozwala utrzymać wspólny baseline tekstu opisowego i takeaway.

25. Aktywna karta 02
Środkowa karta jest jedyną mocno wyróżnioną kartą.

Nie dodajemy do niej koła, ikon ani dodatkowych badge'y.

Wyróżnienie opiera się na:

jaśniejszej powierzchni,

czerwonym numerze,

złotym directional accent,

subtelnym borderze.

.card.active::after {
  right: -6px;
  bottom: -6px;
  width: 44%;
  height: 44%;
  border-right: 3px solid var(--gold);
  border-bottom: 3px solid var(--gold);
}
To świadomie nawiązuje do screena Custom GPT i CTA-bandu.

26. Route cues w sekcji 02
Sekcja posiada subtelne trasy po bokach.

Zasady:

stroke czerwony,

złote waypointy,

stroke-dasharray,

opacity 20–30%,

nie mogą przecinać tekstu,

nie mogą dominować nad kartami.

.route-path {
  stroke: var(--red);
  stroke-width: 1.4;
  stroke-dasharray: 4 9;
}
Na mobile trasa po prawej jest wyłączana.

27. CTA-band sekcji 02
27.1. Rola
To osobny next-step, nie footer.

Treść:

eyebrow: Masz podobną sytuację?,

heading: Przejdź od obserwacji do sprawdzalnej zmiany,

opis,

CTA.

27.2. Kolor
Cały band ma być czarny.

.next-step {
  background: #050605;
  color: #fff;
}
Nie zmieniać na oliwkowy.

27.3. Layout
.next-step {
  display: grid;
  grid-template-columns: minmax(0,1fr) auto;
  align-items: center;
  gap: 40px;
  min-height: 124px;
  padding: 24px 28px;
}
27.4. Directional accent
CTA-band używa dokładnie tego samego systemu offsetu co screenshot Custom GPT:

.next-step::after {
  right: calc(-1 * var(--accent-offset));
  bottom: calc(-1 * var(--accent-offset));
  left: var(--accent-start-x);
  top: var(--accent-start-y);
  border-right: var(--accent-stroke) solid var(--gold);
  border-bottom: var(--accent-stroke) solid var(--gold);
}
To jest bardzo ważna część języka marki.

Screenshot i CTA-band mają ten sam directional accent.

28. CTA wewnątrz czarnego bandu
Primary action:

.btn-section2 {
  height: 52px;
  background: var(--red);
  color: #fff;
  border: 1px solid rgba(214,173,47,.68);
}

.btn-section2 .btn-cap {
  background: var(--gold);
  color: var(--black);
}
Daje kontrast:

DARK GREEN SECTION
    ↓
BLACK CTA BAND
    ↓
RED PRIMARY BUTTON
    ↓
GOLD ACTION CAP
Każdy poziom ma inną funkcję i nie powinien się zlewać.

29. Wspólny język ramek i akcentów
W systemie nie stosujemy jednego generic border do wszystkiego.

Istnieją 3 poziomy:

29.1. Surface border
Cienki, neutralny, strukturalny.

Przykłady:

karta,

header separator.

29.2. Active border
Złoty, subtelnie mocniejszy.

Przykład:

karta 02.

29.3. Directional offset
Tylko po prawej i na dole.

Przykłady:

screenshot Custom GPT,

CTA-band sekcji 02,

częściowo aktywna karta.

Nie zamieniać directional offsetu na pełną złotą ramkę.

30. Gestalt i hierarchia
30.1. Sekcja 01
Kolejność skanowania:

01 / AZYMUT
↓
ASYSTENT AI DLA INSTRUKTORÓW RR
↓
H1
↓
LEAD
↓
BODY
↓
CTA

równolegle:
PRODUCT PREVIEW
Grouping
kicker + H1 = jedna grupa,

H1 + lead + body = jedna grupa treści,

dwa CTA = jedna grupa działań,

screenshot = jedna powierzchnia produktowa,

góry = wspólna warstwa zamykająca sekcję.

30.2. Sekcja 02
Kolejność:

02 / PRZESZKODY
↓
ZNASZ TE WYZWANIA?
↓
H2 + supporting copy
↓
3 CARDS
↓
BLACK CTA BAND
Najważniejszy focal point w kartach to karta 02.

Najważniejszy next action to czerwony button na czarnym bandzie.

31. Figure / ground
Jasna sekcja:

figure = tekst + screenshot,

ground = topografia + góry.

Ciemna sekcja:

figure = intro + karty + CTA band,

ground = topografia + route cues.

Jeżeli tło staje się czytelniejsze niż body copy, opacity jest za wysokie.

32. Continuity
Continuity budują:

rail sekcji 01,

rail sekcji 02,

waypointy,

strzałka w dół,

dashed route,

wspólny directional gold offset.

Nie należy dodawać osobnych osi timeline do każdej sekcji. Jedna sekcja = jeden czytelny motyw kierunku.

33. Responsywność
Projekt ma kilka realnych zmian layoutu, nie tylko skalowanie fontów.

33.1. Desktop — 1200 px+
pełny header,

2 CTA w headerze,

hero w 2 kolumnach,

CTA hero obok siebie,

sekcja 02: intro + 3 cards w poziomie,

rail i route cues aktywne.

33.2. Compact desktop — max-width: 1199px
Zmiany:

shell do 1104 px,

mniejsze gapy,

secondary CTA w headerze ukryte,

H1 48/50,

section 02 zmienia layout na rail + szeroki content.

33.3. Hero stack — max-width: 1099px
Najważniejszy breakpoint.

Nie ściskamy hero w dwie wąskie kolumny.

@media (max-width: 1099px) {
  .hero-grid { display: block; }
  .hero-product { margin-top: 36px; }
}
Kolejność:

kicker
H1
lead
body
CTA
screenshot
33.4. Tablet / portrait — max-width: 959px
hamburger menu,

header actions ukryte,

rail 01 zmienia się w poziomy label,

hero jest stackiem,

screenshot pełna szerokość contentu,

cards w sekcji 02 przechodzą na 1 kolumnę,

route cues redukowane,

section rail 02 staje się poziomym label.

33.5. Mobile — max-width: 599px
header 64 px,

shell = 100% - 24px,

H1 40/42,

CTA hero jeden pod drugim,

buttons full width,

screenshot bez dodatkowego paddingu,

CTA-band stackuje tekst + button,

boczne trasy ukryte.

34. Interakcje
34.1. Nav active state
Active link jest sterowany przez IntersectionObserver.

Nie jest to wyłącznie hover.

Link aktywnej sekcji:

biały tekst,

czerwony 28×2 px underline.

34.2. Buttons hover
.btn:hover {
  transform: translateY(-1px);
}
Minimalny ruch, bez dużego bounce i bez mocnych cieni.

34.3. Focus
.btn:focus-visible {
  outline: 3px solid rgba(214,173,47,.36);
  outline-offset: 3px;
}
Nie usuwać focus outline bez replacementu.

35. Dostępność
Minimalne wymagania:

wszystkie CTA jako prawdziwe <a> lub <button>,

aria-label dla logo / menu,

SVG icons z aria-hidden="true",

hamburger z aria-expanded,

dekoracje aria-hidden="true",

wystarczający kontrast text/background,

brak tekstu kluczowego zaszytego wyłącznie w obrazie,

tap targets minimum około 40–44 px.

36. HTML anatomy — skrócony wzorzec
36.1. Hero
<section class="hero" id="jak-dziala">
  <div class="hero-extra-topo" aria-hidden="true"></div>

  <div class="shell hero-inner">
    <aside class="section-rail" aria-hidden="true">
      <div class="section-number">01</div>
      <div class="section-name">Azymut</div>
      <div class="rail-line"></div>
      <i class="rail-dot one"></i>
      <i class="rail-dot two"></i>
      <i class="rail-arrow"></i>
    </aside>

    <div class="hero-grid">
      <div class="kicker">Asystent AI dla instruktorów RR</div>

      <div class="hero-copy">
        <h1>...</h1>
        <p class="lead">...</p>
        <p class="copy">...</p>
        <div class="hero-actions">...</div>
      </div>

      <div class="hero-product">
        <div class="product-frame">
          <img src="..." alt="Podgląd Kompasu Zbiórek w ChatGPT">
        </div>
      </div>
    </div>
  </div>

  <div class="mountains" aria-hidden="true">...</div>
</section>
36.2. Sekcja 02
<section class="situations" id="sytuacje">
  <div class="situations-topo-extra" aria-hidden="true"></div>

  <div class="shell situations-inner">
    <aside class="section-rail" aria-hidden="true">
      <div class="section-number">02</div>
      <div class="section-name">PRZESZKODY</div>
      <div class="section-down-arrow"><span></span></div>
    </aside>

    <div class="sit-intro">
      <div class="section-kicker">Znasz te wyzwania?</div>
      <h2>...</h2>
      <p>...</p>
    </div>

    <div class="cards">
      <article class="card">...</article>
      <article class="card active">...</article>
      <article class="card">...</article>
    </div>

    <div class="next-step">
      <div>...</div>
      <a class="btn btn-section2">...</a>
    </div>
  </div>
</section>
37. CSS architecture — zalecana kolejność
Przy dalszym developmentcie CSS należy utrzymywać w tej kolejności:

1. TOKENS
2. RESET / BASE
3. GLOBAL LAYOUT
4. TYPOGRAPHY
5. HEADER
6. BUTTON SYSTEM
7. SECTION RAIL
8. HERO
9. PRODUCT PREVIEW
10. MOUNTAINS / TOPOGRAPHY
11. SECTION 02
12. CARDS
13. CTA BAND
14. INTERACTION STATES
15. RESPONSIVE: 1199
16. RESPONSIVE: 1099
17. RESPONSIVE: 959
18. RESPONSIVE: 599
Nie robić
/* v12 override */
...
/* v13 override */
...
/* v14 override */
...
Wersja produkcyjna powinna zostać skonsolidowana. Każdy selektor powinien mieć jedną główną definicję oraz tylko potrzebne warianty w media queries.

38. Reguły „DO / DON'T”
DO
używaj rzeczywistego screenshotu Custom GPT,

stosuj czerwień do działania,

stosuj złoto do kierunku i akcentu,

używaj topografii jako tła,

używaj gór tylko jako line-art,

utrzymuj 4 px spacing rhythm,

kontroluj max-width tekstu,

utrzymuj CTA obok siebie na desktopie,

stackuj hero przed momentem, w którym H1 zaczyna się łamać na 5 linii,

używaj jednej aktywnej karty w sekcji 02,

stosuj ten sam directional gold accent przy screenie i CTA-bandzie.

DON'T
nie dodawaj tła pod logo,

nie dodawaj koła pod logo,

nie dodawaj badge'a do logo,

nie generuj zamiennika screena,

nie dodawaj pełnej złotej ramki wokół screena,

nie dodawaj czerwonych narożników wokół screena,

nie dodawaj medalionów,

nie używaj KIERUNEK jako labelu w sekcji 02,

nie centrować intro sekcji 02,

nie dodawaj losowych ikon w CTA-bandzie,

nie zamieniaj czarnego CTA-bandu na oliwkowy,

nie dawaj 3–4 konkurujących tras w jednej sekcji,

nie używaj gradients 3D na CTA,

nie zagęszczaj topografii tak, aby obniżała czytelność tekstu,

nie próbuj utrzymać dwóch kolumn hero na siłę przy 1024 px.

39. Definition of Done dla kolejnych sekcji
Nowa sekcja może być uznana za zgodną z brand systemem, jeśli:

Branding
używa maksymalnie 2–3 charakterystycznych motywów jednocześnie,

jej dekoracje należą do języka mapowego,

nie wprowadza nowych przypadkowych ikon / ornamentów,

wykorzystuje istniejące tokeny kolorystyczne.

Typografia
heading ma kontrolowaną liczbę linii,

body ma line-height około 1.5,

line length jest czytelny,

kicker jest wyraźnie podrzędny wobec H2.

Layout
spacing oparty o 4 px,

elementy mają wspólne baseline'y,

brak nachodzenia tekstu,

brak horizontal overflow,

mobile nie jest pomniejszonym desktopem.

CTA
istnieje jeden primary action,

action-cap ma spójny rozmiar,

nie ma przypadkowych shadowów,

focus state jest dostępny.

Responsywność
1440 px,

1280 px,

1024 px,

768 px,

430 px,

390 px.

40. Checklista QA dla sekcji 01
Logo bez tła / badge'a / dodatkowego koła.

Nav linki mają active underline.

H1 nie robi pionowej kolumny na desktopie.

Lead ma max-width około 520 px.

Body ma 16/24.

CTA są obok siebie na desktopie.

Primary CTA jest czerwone.

Secondary CTA jest ecru / guide.

Screenshot jest rzeczywistym assetem.

Screenshot nie ma pełnej ramki.

Jest wyłącznie złoty right+bottom directional accent.

Topografia jest widoczna, ale nie konkuruje z copy.

Góry są wystarczająco obecne.

Góry nie wyglądają jak regularny zig-zag.

Rail zawiera 01 / AZYMUT i maksymalnie 2 waypointy.

41. Checklista QA dla sekcji 02
Label sekcji: PRZESZKODY.

Kicker: ZNASZ TE WYZWANIA?.

Brak KIERUNEK.

Pionowa strzałka w dół jest obecna na dużym desktopie.

Topografia ma większą gęstość niż sekcja 01.

Intro wyrównane do lewej.

3 karty mają wspólne wysokości / baseline'y.

Karta 02 jest jedyną aktywną.

Karta 02 nie ma dodatkowego koła / badge'a.

Czarny CTA-band jest czytelnie oddzielony od zielonego tła.

CTA-band ma złoty right+bottom accent.

CTA wewnątrz bandu jest czerwone.

Action-cap jest złoty.

Na mobile karty przechodzą do stacka.

42. Co jest „charakterystyczne” w tym brandingu
Jeżeli ktoś ma odtworzyć Kompas Zbiórek bez oglądania wcześniejszych iteracji, powinien rozpoznać go po następującym zestawie:

ciemna oliwka + ecru, bez typowego niebieskiego SaaS,

czerwony kierunek / primary action,

złoty punkt docelowy / action-cap,

numerowany rail 01 / 02, inspirowany azymutem,

subtelna topografia, organiczna, liniowa,

line-art gór w jasnej sekcji,

dashed route + waypointy, użyte oszczędnie,

directional gold offset po prawej i na dole jako sygnatura framingu,

kicker z krótką czerwoną kreską,

produkt pokazany jako prawdziwy screenshot, a nie abstrakcyjny mockup.

To jest rdzeń. Nie potrzebujemy kolejnych symboli.

43. Minimalny zestaw design tokens do przeniesienia do Figmy / innego frontendu
colors:
  forest-950: "#162313"
  forest-900: "#1d2d19"
  forest-800: "#2a3d24"
  paper: "#f5f0df"
  paper-2: "#ece5d1"
  ink: "#20301e"
  muted: "#485347"
  red: "#be302a"
  red-dark: "#93221e"
  gold: "#d6ad2f"
  gold-soft: "#e4c557"
  black: "#070907"
  white: "#ffffff"

spacing:
  1: 4
  2: 8
  3: 12
  4: 16
  5: 20
  6: 24
  8: 32
  10: 40
  12: 48
  16: 64
  20: 80

type:
  h1-desktop: "52/54"
  h1-mobile: "40/42"
  h2-desktop: "32/36"
  h2-mobile: "36/40"
  h3-card: "22/26"
  lead: "20/28"
  body: "16/24"
  nav: "16/20"
  kicker: "12/16"
  label: "10/12"

radius:
  button: 999
  product-frame: 0

directional-accent:
  offset: 7
  stroke: 3
  start-x: "22%"
  start-y: "20%"
44. Ostateczna zasada projektowa
Największym ryzykiem dla tego UI jest ponowne wejście w dwa skrajne problemy:

A. przeładowanie
topografia + góry + kompas + mapa + 4 strzałki + 6 waypointów + ramki + ornamenty + badge
B. sterylna pustka
H1 + screenshot + 2 buttony na płaskim tle
Docelowy Kompas Zbiórek znajduje się pomiędzy nimi:

bogaty kontekstowo, oszczędny komponentowo.

W praktyce oznacza to:

mocny produkt,

wyraźna typografia,

kontrolowany rytm 4 px,

2–3 brand motifs na sekcję,

spójna semantyka kolorów,

powtarzalny directional accent,

brak przypadkowych dekoracji.

45. Source of truth
Dla tej wersji podstawą jest:

kompas-v16-topo-mountains-accent.html

Przy kolejnych iteracjach ten dokument powinien być aktualizowany razem z kodem, szczególnie jeśli zmienią się:

tokeny,

typografia,

breakpointy,

geometryczne zasady CTA,

directional accent,

gęstość topografii,

konstrukcja raila,

sposób prezentacji screenshotu.

Nie należy budować kolejnych wersji wyłącznie przez dokładanie override'ów na końcu CSS. Wersja produkcyjna powinna utrzymywać ten dokument jako opis systemu, a kod jako implementację tego samego systemu.