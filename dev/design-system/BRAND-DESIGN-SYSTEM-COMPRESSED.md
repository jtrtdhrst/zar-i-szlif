# Kompas Zbiórek — UI / Branding Spec (kompresja)

Wersja: 1.0. Implementacja bazowa: `kompas-v16-topo-mountains-accent.html`.
Dokument źródłowy: `BRAND-DESIGN-SYSTEM.md` (pełna wersja, Source of Truth).

---

## 1. Założenie

Cyfrowe narzędzie operacyjne inspirowane kartografią / orientacją w terenie / skautingiem. Dwa światy: terenowo-kartograficzny (azymut, topografia, trasa, waypointy, góry, oliwka, papier, złoto, czerwień) + cyfrowo-produktowy (grid, hierarchia, realny screenshot Custom GPT, precyzyjne CTA, responsywność).

**Branding prowadzi wzrok, nie zdobi.** Funkcja kolorów:
- czerwień = kierunek, aktywność, primary action
- złoto = punkt docelowy, akcent kierunkowy, 2. poziom kontrastu
- oliwka = struktura, środowisko, tło robocze
- papier/ecru = przestrzeń analityczna
- topografia = kontekst i głębia tła
- góry = sygnatura terenowa sekcji jasnej
- trasa/waypoint = ciągłość i progres
- offset prawo+dół = wskazanie kierunku/warstwy/przesunięcia (tylko elementy wysokiej rangi)

## 2. Invariants (nie zmieniać bez świadomej decyzji)

**Logo:** bez tła, koła, kwadratu, kapsuły, badge'a, obwódki, pseudo-emblematów. Samodzielny znak na transparentnym tle. Header: znak + wordmark jako jeden lockup.

**Screenshot Custom GPT:** wyłącznie realny screenshot, nigdy generowany zamiennik. Bez „picture frame", wielokrotnych borderów, medalionów, kół, ornamentów, pełnej złotej ramki. Sygnatura = złoty offset TYLKO prawo+dół. Ten sam offset przy czarnym CTA-bandzie sekcji 02.

**Sekcja 02:** label `PRZESZKODY`, kicker `ZNASZ TE WYZWANIA?`, NIGDY label `KIERUNEK`. CTA-band cały czarny/niemal czarny. Wewnętrzny primary CTA czerwony z żółtym/złotym action-capem. Sekcja musi mieć topografię + element kierunkowy (strzałka w dół).

**Dekoracje — dozwolone wyłącznie:** topografia, góry, linia trasy, waypointy, strzałka/grot, numeracja sekcji, złoty directional offset. Nowy detal spoza rodziny = domyślnie odrzuć.

## 3. Paleta

```css
:root {
  --forest-950: #162313;  /* główne ciemne tło marki: header, sekcja 02, action-cap secondary */
  --forest-900: #1d2d19;  /* warstwa pośrednia: ciemne detale, action-cap, stany */
  --forest-800: #2a3d24;
  --paper:   #f5f0df;     /* główne jasne tło, "papier mapowy", bez postarzania */
  --paper-2: #ece5d1;
  --ink:   #20301e;       /* tekst na jasnym tle */
  --muted: #485347;       /* tekst drugorzędny; nie obniżać kontrastu, body czytelne */
  --red:      #be302a;    /* działanie/kierunek: CTA, active nav, numer sekcji 01, route accents, kicker, markery */
  --red-dark: #93221e;
  --gold:      #d6ad2f;   /* cel/akcent: action-cap, aktywna karta 02, prawy+dolny offset, topografia na ciemnym, numer 02, strzałka 02 */
  --gold-soft: #e4c557;
  --black: #070907;       /* tylko CTA-band sekcji 02; nie zastępować oliwką (figura na zielonym tle) */
  --white: #ffffff;
}
```

## 4. Typografia

```css
body { font-family: "Noto Sans", Arial, sans-serif; }
h1, h2, h3, .brand-name, .section-number, .next-title { font-family: "Noto Sans Display", "Noto Sans", Arial, sans-serif; }
```

- Display: H1, H2, tytuły kart, numery sekcji, nagłówki CTA, wordmark.
- Sans: body, lead, nawigacja, CTA labels, opisy kart, supporting copy.
- Fonty muszą być faktycznie załadowane (import/self-host), inaczej fallback Arial.

## 5. Skala typograficzna (rytm 4 px)

| Element | Desktop | Line-h | Waga | Uwagi |
|---|---|---|---|---|
| H1 | 52 | 54 | 900 | hero headline |
| H2 sekcji 02 | 32 | 36 | 900 | duży desktop |
| H3 karta | 22 | 26 | 850–900 | kontrolować liczbę linii |
| Lead | 20 | 28 | 760 | główna obietnica |
| Body | 16 | 24 | normal | max 520–640 px |
| Nav | 16 | 20 | 700 | nie zmniejszać |
| CTA | 13 | 16 | 850 | uppercase |
| Kicker | 12 | 16 | 850 | uppercase, tracking |
| Label sekcji | 10 | 12 | 850 | uppercase |
| Numer sekcji | 30 | 32 | 900 | czerwony/złoty |

Mobile: H1 40/42, H2 36/40, Lead 18/24, Body 16/24, Numer 28/28, Kicker 10/12.

## 6. Line-height / długość tekstu

- H1: 52/54 ≈ 1.04, nie kompresować do 0.9–0.95, nie pozwalać na pionowy słup 5–6 linii na szerokim desktopie.
- Lead: 20/28, max-width ~520 px, jedna zwarta grupa pod H1.
- Body: 16/24, max-width 520–640 px, NIE `text-align:center` w sekcjach informacyjnych.

## 7. Spacing (4 px grid)

`--s1:4px --s2:8px --s3:12px --s4:16px --s5:20px --s6:24px --s8:32px --s10:40px --s12:48px --s16:64px --s20:80px`

Dopuszczone: 4/8/12/16/20/24/28/32/40/48/64/80/96/104 px (28 i 104 bez custom properties).
Zakaz ręcznego „dokręcania": 17/23/37/53 px, przypadkowe ujemne marginesy, `top:73px` jako łatka. Najpierw struktura, potem spacing.

## 8. Globalny kontener

```css
--shell: 1280px;
.shell { width: min(var(--shell), calc(100% - 64px)); margin-inline: auto; }
@media (max-width:1199px){ .shell{ width: min(1104px, calc(100% - 40px)); } }
@media (max-width:959px) { .shell{ width: calc(100% - 32px); } }
@media (max-width:599px) { .shell{ width: calc(100% - 24px); } }
```

Marginesy: desktop 32, kompakt 20, tablet 16, mobile 12.

## 9. Header

Zadanie: identyfikacja marki, nawigacja, 2 główne akcje, wskazanie aktywnej sekcji. Nie jest hero.

```css
.site-header { position: sticky; top:0; z-index:100; background:var(--forest-950); color:#fff; border-bottom:1px solid rgba(214,173,47,.12); }
.header-inner { height:72px; display:grid; grid-template-columns:max-content minmax(0,1fr) max-content; align-items:center; gap:24px; }
```

Struktura: `[LOGO+WORDMARK] [NAV] [CTA PRIMARY][CTA GUIDE]`

```css
.brand { display:inline-flex; align-items:center; gap:10px; min-width:172px; background:none; border:0; box-shadow:none; }
.brand-logo { width:42px; height:42px; object-fit:contain; background:transparent; border:0; border-radius:0; box-shadow:none; }
```

Nav: 16px/700, gap 20px, active = czerwony underline `width:28px; height:2px; background:var(--red)` — krótszy niż tekst (wskaźnik, nie hyperlink underline).
Mobile (max-959px): nav i header actions znikają, hamburger, menu pionowo pod headerem.

## 10. System CTA

DNA: `[label ......][action-cap]` — kapsuła, ale action-cap to osobny okrągły obiekt.

```css
.btn { height:52px; display:inline-flex; align-items:center; border-radius:999px; font-size:13px; line-height:16px; font-weight:850; text-transform:uppercase; }
.btn-primary .btn-cap, .btn-guide .btn-cap, .btn-section2 .btn-cap { width:38px; height:38px; border-radius:999px; }

.btn-primary { background:var(--red); color:#fff; }
.btn-primary .btn-cap { background:var(--gold); color:var(--forest-950); }          /* czerwony=działanie, złoty=kierunek */

.btn-guide { background:#eee4c8; color:var(--forest-950); }                          /* wyraźne, nie konkuruje z red */
.btn-guide .btn-cap { background:var(--forest-900); color:var(--gold-soft); }
```

Hero: desktop `display:flex; gap:16px; margin-top:28px`, nie stackować. Mobile (max-599px): grid 1 kolumna, gap 12, full width.

## 11–18. Sekcja 01 — AZYMUT

Rola: „Czym jest Kompas Zbiórek?" — jasna, informacyjna, produktowa.

**Grid:**
```css
.hero-inner { display:grid; grid-template-columns:44px minmax(0,1fr); gap:24px; padding:48px 0 104px; }  /* rail nie przejmuje szerokości tekstu */
.hero-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.04fr); grid-template-rows:auto auto; column-gap:40px; row-gap:12px; align-items:start; }
```
ROW1: kicker | — | ROW2: copy+CTA | screenshot. Prawa kolumna minimalnie szersza.

**Rail:** numer 01, label AZYMUT, pionowa linia, max 2–3 waypointy (progres, nie „sznur koralików"), strzałka na końcu.
```css
.section-number { font-size:30px; line-height:32px; font-weight:900; color:var(--red); }
.section-name { margin-top:8px; font-size:10px; line-height:12px; font-weight:850; letter-spacing:.14em; text-transform:uppercase; }
```

**Kicker:** `ASYSTENT AI DLA INSTRUKTORÓW RR` — czerwony, 12/16, 850, tracking .105em, uppercase, `::before` 32×2px czerwona kreska. Ten sam wzorzec w sekcji 02 (`ZNASZ TE WYZWANIA?`). Powtarzalność buduje markę — nie dodawać ikon.

**Hierarchia treści (zwarta grupa):**
```css
h1 { max-width:584px; margin:0; font-size:52px; line-height:54px; font-weight:900; letter-spacing:-.034em; text-wrap:balance; }
.lead { max-width:520px; margin:20px 0 0; font-size:20px; line-height:28px; font-weight:760; }
.copy { max-width:520px; margin:12px 0 0; color:#3f4b3e; font-size:16px; line-height:24px; }
```
Odstępy: KICKER→H1 20px, H1→LEAD 12px, LEAD→BODY 28px, BODY→CTA group.

**Product preview:** bez ramki, borderu, tła, narożników; złoty akcent TYLKO prawo+dół.
```css
:root { --accent-offset:7px; --accent-stroke:3px; --accent-start-x:22%; --accent-start-y:20%; }
.product-frame { position:relative; isolation:isolate; margin:0; padding:0; background:transparent; border:0; border-radius:0; box-shadow:none; }
.product-frame::after { content:""; position:absolute; right:calc(-1*var(--accent-offset)); bottom:calc(-1*var(--accent-offset)); left:var(--accent-start-x); top:var(--accent-start-y); border-right:var(--accent-stroke) solid var(--gold); border-bottom:var(--accent-stroke) solid var(--gold); z-index:-1; }
```
To directional frame (część prowadząca w prawo i dół), nie box-shadow.

**Tło sekcji 01** (nie puste pole): topografia + góry.
```css
.hero::before { opacity:.11; background-size:430px 280px; background-position:0 0, 215px 140px; }
.hero-extra-topo { width:300px; height:240px; left:1%; top:23%; opacity:.18; }
.mountains { position:absolute; left:0; right:0; bottom:0; height:176px; opacity:.36; pointer-events:none; }
```
Góry = line-art kartograficzny: dalsze pasmo cienkie/jasne, drugie ciemniejsze, lokalne szczyty kontrastowe, 1–2 czerwone route accents/waypointy. ZAKAZ: regularny zig-zag, symetryczne trójkąty, fotografie, gradienty zachodu słońca, mocne cienie. Topografia widoczna przy 2. spojrzeniu, nie przechodzi przed tekst; na jasnym tle nie zwiększać opacity do 0.3–0.5.

## 19–28. Sekcja 02 — PRZESZKODY

Rola: 3 sytuacje problemowe. Gestalt: rail 02, kicker, heading+opis, 3 karty, czarny next-step CTA-band.

**Tło:** `background:var(--forest-950); color:#fff`. Topografia gęstsza niż w 01: `.situations::before{opacity:.32; background-size:420px 270px; background-position:0 0, 210px 135px;}`, `.situations-topo-extra{opacity:.24; background-size:560px 300px; background-position:center 0;}`. Kolor topografii: złoty/oliwkowo-złoty.

**Rail:** numer 02 złoty (`.situations .section-number{color:var(--gold)}`), label PRZESZKODY, pionowa strzałka w dół: `left:50%; top:90px; width:1px; height:226px; background:rgba(214,173,47,.34);` + 2 waypointy + grot. Kontynuacja motywu kierunku z sekcji 01.

**Kicker** `ZNASZ TE WYZWANIA?`: identyczny wzorzec jak hero, nad H2, nie koło screena.

**Intro:**
```css
.situations-inner { display:grid; grid-template-columns:72px 400px minmax(0,1fr); gap:24px; row-gap:24px; padding:48px 0 52px; }
/* [rail][intro][3 cards] ; [next-step spans intro+cards] */
.sit-intro h2 { max-width:390px; font-size:32px; line-height:36px; font-weight:900; }
.sit-intro p { max-width:360px; margin:16px 0 0; color:rgba(255,255,255,.84); font-size:15px; line-height:24px; text-align:left; }
```
ZAKAZ centrowania.

**Karty:**
```css
.cards { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:16px; align-items:stretch; }
.card { min-height:264px; padding:20px 20px 16px; }
.card h3 { min-height:78px; font-size:22px; line-height:26px; }  /* wspólny baseline opisów i takeaway */
```
Karta ma: numer, tytuł, opis, takeaway.

**Aktywna karta 02** (jedyna wyróżniona, bez koła/ikon/badge'ów): jaśniejsza powierzchnia, czerwony numer, złoty directional accent, subtelny border.
```css
.card.active::after { right:-6px; bottom:-6px; width:44%; height:44%; border-right:3px solid var(--gold); border-bottom:3px solid var(--gold); }
```
Świadomie nawiązuje do screena i CTA-bandu.

**Route cues po bokach:** stroke czerwony, złote waypointy, `stroke-dasharray:4 9`, stroke-width 1.4, opacity 20–30%, nie przecinają tekstu, nie dominują nad kartami. Na mobile prawa trasa wyłączona.

**CTA-band (next-step, nie footer):**
```css
.next-step { background:#050605; color:#fff; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:40px; min-height:124px; padding:24px 28px; }
.next-step::after { /* dokładnie ten sam offset co screenshot */ }
```
Treść: eyebrow `Masz podobną sytuację?`, heading `Przejdź od obserwacji do sprawdzalnej zmiany`, opis, CTA. Cały band czarny — nie zmieniać na oliwkowy. Screenshot i CTA-band mają ten sam directional accent.

**CTA w bandzie:**
```css
.btn-section2 { height:52px; background:var(--red); color:#fff; border:1px solid rgba(214,173,47,.68); }
.btn-section2 .btn-cap { background:var(--gold); color:var(--black); }
```
Kontrast poziomów: DARK GREEN → BLACK BAND → RED BUTTON → GOLD CAP — nie zlewać.

## 29. Język ramek (3 poziomy)

1. **Surface border** — cienki, neutralny, strukturalny (karta, header separator).
2. **Active border** — złoty, subtelnie mocniejszy (karta 02).
3. **Directional offset** — tylko prawo+dół (screenshot, CTA-band, częściowo aktywna karta). Nie zamieniać na pełną złotą ramkę.

## 30. Gestalt i hierarchia

Sekcja 01 (kolejność skanowania): 01/AZYMUT → kicker → H1 → LEAD → BODY → CTA, równolegle PRODUCT PREVIEW. Grouping: kicker+H1; H1+lead+body; 2 CTA; screenshot; góry = warstwa zamykająca.
Sekcja 02: 02/PRZESZKODY → ZNASZ TE WYZWANIA? → H2+opis → 3 CARDS → BLACK CTA BAND. Focal point: karta 02; next action: czerwony button na czarnym bandzie.

## 31. Figure/ground

Jasna: figure = tekst+screenshot, ground = topografia+góry. Ciemna: figure = intro+karty+CTA band, ground = topografia+route cues. Jeśli tło czytelniejsze niż body copy — opacity za wysokie.

## 32. Continuity

Budują: rail 01, rail 02, waypointy, strzałka w dół, dashed route, wspólny złoty directional offset. Jedna sekcja = jeden motyw kierunku; bez osobnych osi timeline.

## 33. Responsywność

- **1200px+:** pełny header, 2 CTA header, hero 2 kolumny, CTA hero obok siebie, sekcja 02: intro+3 karty w poziomie, rail i route cues aktywne.
- **max-1199px:** shell 1104, mniejsze gapy, secondary CTA header ukryte, H1 48/50, sekcja 02 na rail+szeroki content.
- **max-1099px (kluczowy):** `@media(max-width:1099px){ .hero-grid{display:block;} .hero-product{margin-top:36px;} }` — nie ściskać hero w 2 wąskie kolumny. Kolejność: kicker→H1→lead→body→CTA→screenshot.
- **max-959px:** hamburger, header actions ukryte, rail 01 poziomy label, hero stack, screenshot pełna szerokość, karty 02 → 1 kolumna, route cues redukowane, rail 02 poziomy label.
- **max-599px:** header 64, shell −24, H1 40/42, CTA hero jeden pod drugim, buttons full width, screenshot bez paddingu, CTA-band stackuje, boczne trasy ukryte.

## 34. Interakcje

- Nav active: IntersectionObserver (nie sam hover). Aktywny: biały tekst + czerwony 28×2 underline.
- `.btn:hover{transform:translateY(-1px)}` — minimalny ruch, bez bounce i mocnych cieni.
- `.btn:focus-visible{outline:3px solid rgba(214,173,47,.36); outline-offset:3px;}` — nie usuwać bez replacementu.

## 35. Dostępność

Prawdziwe `<a>`/`<button>` dla CTA, aria-label logo/menu, SVG aria-hidden, hamburger z aria-expanded, dekoracje aria-hidden, kontrast text/background, brak kluczowego tekstu tylko w obrazie, tap targets 40–44px.

## 36. Anatomia HTML

**Hero:** `<section class="hero" id="jak-dziala">` → `.hero-extra-topo[aria-hidden]` → `.shell.hero-inner` → `aside.section-rail[aria-hidden]` (`.section-number` 01, `.section-name` Azymut, `.rail-line`, `.rail-dot.one/.two`, `.rail-arrow`) + `.hero-grid` (`.kicker` → `.hero-copy` [h1, p.lead, p.copy, .hero-actions] → `.hero-product > .product-frame > img[alt]`) → `.mountains[aria-hidden]`.

**Sekcja 02:** `<section class="situations" id="sytuacje">` → `.situations-topo-extra` → `.shell.situations-inner` → `aside.section-rail` (02, PRZESZKODY, `.section-down-arrow > span`) + `.sit-intro` (.section-kicker Znasz te wyzwania?, h2, p) + `.cards` (3× `article.card`, środkowa `.active`) + `.next-step` (div + `a.btn.btn-section2`).

## 37. Kolejność CSS

TOKENS → RESET/BASE → GLOBAL LAYOUT → TYPOGRAPHY → HEADER → BUTTON SYSTEM → SECTION RAIL → HERO → PRODUCT PREVIEW → MOUNTAINS/TOPOGRAPHY → SECTION 02 → CARDS → CTA BAND → INTERACTION STATES → R:1199 → R:1099 → R:959 → R:599.
ZAKAZ: `/* v12 override */...` — wersja produkcyjna skonsolidowana; jeden selektor = jedna główna definicja + warianty w media queries.

## 38. DO / DON'T

**DO:** realny screenshot Custom GPT; czerwień=działanie; złoto=kierunek/akcent; topografia jako tło; góry tylko line-art; 4px rytm; kontrola max-width tekstu; CTA obok siebie na desktopie; stackuj hero zanim H1 złamie się na 5 linii; jedna aktywna karta; ten sam directional gold accent przy screenie i CTA-bandzie.
**DON'T:** tło/koło/badge pod logo; generowany zamiennik screena; pełna złota ramka lub czerwone narożniki koło screena; medaliony; label KIERUNEK; centrowanie intro 02; losowe ikony w CTA-bandzie; czarny band na oliwkowy; 3–4 konkurujące trasy; gradients 3D na CTA; topografia obniżająca czytelność; 2 kolumny hero na siłę przy 1024px.

## 39. Definition of Done (nowa sekcja)

- **Branding:** max 2–3 charakterystyczne motywy; dekoracje z języka mapowego; bez nowych ikon/ornamentów; istniejące tokeny.
- **Typografia:** heading kontrolowany liczbowo; body line-height ~1.5; czytelna długość linii; kicker podrzędny wobec H2.
- **Layout:** spacing 4px; wspólne baseline'y; brak nachodzenia tekstu; brak horizontal overflow; mobile ≠ pomniejszony desktop.
- **CTA:** jeden primary; spójny action-cap; bez przypadkowych shadowów; dostępny focus.
- **Responsywność:** 1440, 1280, 1024, 768, 430, 390 px.

## 40. QA sekcji 01

Logo bez tła/badge'a/koła. Active underline w nav. H1 bez pionowej kolumny. Lead ~520px. Body 16/24. CTA obok siebie. Primary czerwony, secondary ecru/guide. Screenshot realny, bez pełnej ramki, tylko złoty prawo+dół accent. Topografia widoczna, nie konkuruje z copy. Góry obecne, nie zig-zag. Rail: 01/AZYMUT + max 2 waypointy.

## 41. QA sekcji 02

Label PRZESZKODY. Kicker ZNASZ TE WYZWANIA?. Brak KIERUNEK. Strzałka w dół na dużym desktopie. Topografia gęstsza niż w 01. Intro lewa. 3 karty wspólne wysokości. Tylko karta 02 aktywna, bez koła/badge'a. Czarny band czytelnie oddzielony. Złoty prawo+dół accent na bandzie. CTA w bandzie czerwone, action-cap złoty. Mobile: karty w stack.

## 42. Charakterystyczne elementy (rdzeń rozpoznawalności)

Ciemna oliwka+ecru (bez niebieskiego SaaS). Czerwony kierunek/primary. Złoty cel/action-cap. Numerowany rail 01/02. Subtelna organiczna liniowa topografia. Line-art gór w sekcji jasnej. Dashed route+waypointy (oszczędnie). Directional gold offset prawo+dół. Kicker z czerwoną kreską. Produkt = prawdziwy screenshot. **Nie potrzeba kolejnych symboli.**

## 43. Design tokens

```yaml
colors:
  forest-950: "#162313"   forest-900: "#1d2d19"   forest-800: "#2a3d24"
  paper: "#f5f0df"        paper-2: "#ece5d1"
  ink: "#20301e"          muted: "#485347"
  red: "#be302a"          red-dark: "#93221e"
  gold: "#d6ad2f"         gold-soft: "#e4c557"
  black: "#070907"        white: "#ffffff"
spacing: 4,8,12,16,20,24,32,40,48,64,80
type:
  h1: "52/54 (mob 40/42)"  h2: "32/36 (mob 36/40)"  h3-card: "22/26"
  lead: "20/28"  body: "16/24"  nav: "16/20"  kicker: "12/16"  label: "10/12"
radius: button 999, product-frame 0
directional-accent: offset 7, stroke 3, start-x 22%, start-y 20%
```

## 44. Zasada ostateczna

Dwa skrajne ryzyka: **A. przeładowanie** (topografia+góry+kompas+mapa+4 strzałki+6 waypointów+ramki+ornamenty+badge) i **B. sterylna pustka** (H1+screenshot+2 buttony na płaskim tle). Cel: **bogaty kontekstowo, oszczędny komponentowo** — mocny produkt, wyraźna typografia, kontrolowany rytm 4px, 2–3 brand motifs na sekcję, spójna semantyka kolorów, powtarzalny directional accent, zero przypadkowych dekoracji.

## 45. Source of truth

Baza: `kompas-v16-topo-mountains-accent.html`. Dokument aktualizować razem z kodem, gdy zmienią się: tokeny, typografia, breakpointy, geometria CTA, directional accent, gęstość topografii, konstrukcja raila, sposób prezentacji screenshotu. Nie budować wersji przez nakładanie override'ów — dokument = opis systemu, kod = jego implementacja.
