# Audyt UX i UI — Kompas Zbiórek (interfejs wtyczki)

Data: 10.08.2026

Zakres: `kompas-ui-plugin` (web/src/static-app-v2.js, web/src/styles.css, wygenerowany web/dist/index.html, cloudflare-worker) porównany z `PRD Kompas Zbiórek.md` (v1.1), `MAPA SYSTEMU.md` i `BRAND-DESIGN-SYSTEM.md` (v1.0). Wersja produkcyjna: https://wtyczka-rr.milosz-spyrka.workers.dev

Metoda: pełny odczyt widoków i stylów, weryfikacja w kodzie istnienia sekcji, klas CSS i punktów wejścia nawigacji; bez testów manualnych w przeglądarce.

---

## 1. Znaleziska krytyczne (P0)

### 1.1 Karta zbiórki jest niekompletna — w aktywnym widoku nie istnieją wymagane sekcje

- W `static-app-v2.js` są **dwie definicje `function activity()`** (linie 22 i 28). W JavaScript wygrywa druga (karta z listą zadań); pierwsza — z sekcjami sprawności, eksperymentu i planu godzinowego — jest martwym kodem.
- Aktywna karta zawiera tylko: data i obecność, cel, zadania, podsumowanie (wynik eksperymentu, opinia skautów), wnioski.
- Zgodnie z PRD §7.1 i AGENTS.md karta ma zawierać: dane i obecność, sprawności i wymagania, eksperyment, cel, przygotowanie, plan godzinowy, refleksję. **Brakuje 3 z 8 elementów: sprawności, eksperyment, plan godzinowy (godzina/aktywność/aspekt/osoba/materiały).**

### 1.2 Zepsute połączenia z ekranu głównego — 7 z 10 targetów nie działa

Etapy cyklu i zadania z ekranu głównego wskazują `data-target="plan|experiment|reflection"`. W aktywnej karcie zbiórki nie istnieją sekcje o tych identyfikatorach (jest tylko `id="preparation"`), a zakładka „Wnioski" nie jest renderowana domyślnie. Kliknięcie nie przewija niczego i nie przełącza zakładki.

| Target z ekranu głównego | Działa? |
|---|---|
| `activity → preparation` (Przygotuj zadania) | Tak |
| `activity → plan` (Plan godzinowy; etapy Plan i Działanie) | Nie |
| `activity → experiment` (Sprawdź eksperyment; etap Eksperyment) | Nie |
| `activity → reflection` (Zapisz wynik po zbiórce; etap Analiza) | Nie |
| `problem → experiment` (Otwórz eksperyment) | Tak |
| `problem → result` (etap Ocena) | Tak |
| `problem → conclusion` (etap Wniosek) | Tak |

### 1.3 Trzy widoki nie mają punktu wejścia w nawigacji

Plan roczny (`annual`), Sprawności i historia (`skills`) i Baza aktywności RR (`finder`) istnieją w kodzie, ale żaden przycisk ani link w interfejsie do nich nie prowadzi (sidebar: tylko Aktywności, Problemy, Kontekst zastępu; ekran główny: karta zbiórki i eksperyment). Widoki są nieosiągalne dla użytkownika.

### 1.4 Deklarowany tryb zapisu nie istnieje w UI

Pasek trybu analizy komunikuje: „Zapis do dokumentu nastąpi wyłącznie po podglądzie i Twoim potwierdzeniu" (PRD §6). W interfejsie nie ma jednak żadnej akcji zapisu, podglądu ani potwierdzenia — `save-bar` w karcie problemu zawiera tylko przycisk „Wróć do zbiórki".

---

## 2. Błędy i niezgodności (P1)

### 2.1 „5 razy Dlaczego?" bez stylów

Klasy `.why-list` i `.why-row` nie mają żadnych reguł w `styles.css`. Wiersze renderują się jako pionowy stos pełnowymiarowych pól bez siatki; numeracja i strzałka nie układają się w poziomie. To jedyny aktywny komponent bez stylowania.

### 2.2 Plan roczny: nagłówek zapowiada kalendarz, którego widok nie ma

`pageHead` mówi: „Kierunek roczny, okresy pracy i kalendarz w jednym widoku". Widok zawiera tylko temat roczny i tabelę okresów. Kalendarza zbiórek i wydarzeń (wymaganego w PRD) brak.

### 2.3 Sprawności i historia: brak sekcji historii

Widok `skills` pokazuje wyłącznie tabelę wymagań. PRD wymaga historii z aspektami programu oraz tabeli problemów/hipotez/rezultatów/wniosków. Tytuł widoku („Sprawności i historia") obiecuje więcej, niż dostarcza.

### 2.4 Kontekst zastępu: brak dwóch pól z PRD

Jest: nazwa, grupa programowa, liczba zapisanych, typowa frekwencja, osoby do zadań, cel długoterminowy, charakter zastępu, podział funkcji. **Brak: styl prowadzenia oraz poziom samodzielności i współpracy.**

### 2.5 Dane robocze giną po odświeżeniu

Stan aplikacji jest wyłącznie w pamięci JS (`S`), bez `localStorage`. Samowystarczalna karta robocza (zgodnie z AGENTS.md) jest ulotna — przypadkowe odświeżenie kasuje całą pracę. Zalecenie: autozapis draftu do `localStorage` z wersjonowaniem.

### 2.6 Martwy kod

Dwie definicje `activity()`, klasy `.prep-row`, `.prep-list`, `.member-select` używane tylko w martwej wersji karty, nieistniejące targety `plan`/`reflection` w danych ekranu głównego. Ryzyko: przyszłe edycje stylów trafiają w sekcje, których użytkownik nie widzi, albo rozjeżdżają się wersje karty. Wymaga usunięcia.

---

## 3. Zgodność z brandingiem (P2)

Poprawne i spójne: `.section-label`, złote akcenty offsetowe (`.btn`, `.next-step`), topografia, breadcrumb, tryb analizy, karty paper z gold top-border (po ostatniej korekcie), toast, nawigacja 15px, rytm 4px, tokeny kolorów w task-status.

Świadome odstępstwa do decyzji:
- **home-hero**: ciemny (forest-950) z kompasem; spec sekcji 01 przewiduje jasny hero z górami. Kompas jest w §44 wymieniony w antyprzykładzie przeciążenia dekoracjami, ale AGENTS.md nakazuje utrzymać język kompasu — kompas zostaje, rozważyć jasny wariant hero z górami.
- **font-weight**: `.eyebrow` i `.btn` 900 zamiast 850 w spec. Marginalne; ujednolicić przy najbliższej edycji typografii.
- Przy naprawie 2.1 i nowych sekcjach (1.1, 2.2) utrzymać: siatkę 4px, złote top-border (nie lewe paski), directional offset wyłącznie w CTA.

---

## 4. Pozytywy do utrzymania

- `aria-label` na wszystkich polach, focus outline, toast z `role="status"`.
- Spójna paleta tokenów po korekcie task-status.
- Baza aktywności: uczciwy stan braku danych API (zamiast fałszywych wyników), filtry kategorii z licznikiem zaznaczeń.
- Komunikat o źródle wymagań sprawności z API (tryb „własny opis roboczy").
- Responsywność: breakpointy 959/599, cele dotykowe ≥44px.

---

## 5. Rekomendowana kolejność napraw

1. **P0** — Scal kartę zbiórki: przenieść sekcje sprawności, eksperymentu i planu godzinowego z martwej definicji do aktywnej, zachowując układ zakładek. (`static-app-v2.js`)
2. **P0** — Naprawić targety z ekranu głównego: przełączać aktywną zakładkę i przewijać do sekcji (`plan`, `experiment`, `reflection`).
3. **P0** — Dodać punkty wejścia do widoków Plan roczny, Sprawności, Baza aktywności (sidebar lub home-grid).
4. **P0** — Dodać akcję „Podgląd i zapisz" (wzorzec potwierdzenia z PRD §6) do karty zbiórki i problemu.
5. **P1** — Style `.why-list`/`.why-row`; kalendarz w planie rocznym; historia w sprawnościach; pola stylu prowadzenia i samodzielności; autozapis `localStorage`; usunięcie martwego kodu.
6. Po każdej zmianie: `npm run build` → `node build-worker.mjs` → `wrangler deploy --keep-vars` (Worker `wtyczka-rr`).

---

## 6. Metryki

| Metryka | Wynik |
|---|---|
| Widoki z punktem wejścia w nawigacji | 4/7 (brak: annual, skills, finder) |
| Elementy karty zbiórki wg PRD §7.1 w aktywnym widoku | 5/8 (brak: sprawności, eksperyment, plan godzinowy) |
| Działające targety z ekranu głównego | 3/10 |
| Aktywne klasy bez reguł CSS | 2 (`.why-list`, `.why-row`) |

---

## 7. Status napraw (aktualizacja po wdrożeniu, 10.08.2026)

Wdrożono wersję: https://wtyczka-rr.milosz-spyrka.workers.dev (Version ID `ab10cc78-a5aa-412c-84d8-0a7ab6bac92a`).

### Zrealizowane (P0)
- **1.1 Karta zbiórki** — scalona: aktywna karta zawiera sprawności (tabela z bindowaniem `sprawnosci.*`), eksperyment (`id="experiment"`), przygotowanie (cel + zadania, `id="preparation"`) i plan godzinowy (`id="plan"`, tabela z bindowaniem `plan.*`). Usunięto martwą definicję `activity()` (została jedna).
- **1.2 Targety z ekranu głównego** — `openView` przełącza aktywną zakładkę (reflection → Wnioski, pozostałe → Planowanie) i przewija do sekcji. Wszystkie 10 targetów działa.
- **1.3 Nawigacja** — sidebar ma punkty wejścia: Plan roczny, Sprawności, Baza aktywności. Wszystkie 7 widoków osiągalne.
- **1.4 Tryb zapisu** — przycisk „Podgląd i zapisz" w kartach zbiórki i problemu otwiera modal podglądu; „Potwierdź zapis" zamyka i pokazuje toast (zapis bez fałszywego komunikatu o integracji).
- Bonus: karta problemu miała martwe pola (brak `S.problem` — wpisywanie wywalało `setByPath`); dodano pełny stan + bindowanie „5 razy Dlaczego" i oceny hipotezy; naprawiono znak cudzysłowu w podpowiedzi; sekcja Wnioski ma `id="conclusion"`.
- Style: `.why-list`/`.why-row` (siatka z numeracją i złotą strzałką), modal podglądu, time input w planie, warianty mobilne.

### Zrealizowane (P1)
- 2.2 Kalendarz w planie rocznym — zrealizowane, patrz „Zrealizowane (P1, 10.08.2026)" niżej.
- 2.3 Historia w „Sprawnościach" — zrealizowane, patrz niżej.
- 2.4 Pola stylu prowadzenia oraz poziomu samodzielności i współpracy — zrealizowane, patrz niżej.
- 2.5 Autozapis draftu do `localStorage` — zrealizowane, patrz niżej.

### Metryki po naprawie (stan po drugiej łatce, P1)

| Metryka | Przed | Po |
|---|---|---|
| Widoki z punktem wejścia | 4/7 | 7/7 |
| Elementy karty zbiórki wg PRD §7.1 | 5/8 | 8/8 |
| Działające targety z ekranu głównego | 3/10 | 10/10 |
| Aktywne klasy bez reguł CSS | 2 | 0 |
| Plan roczny z kalendarzem (PRD §10) | brak | tak |
| Historia: aspekty + tabela eksperymentów | brak | tak |
| Pola stylu prowadzenia i samodzielności | brak | tak |
| Autozapis danych roboczych | brak | tak |

### Zrealizowane (P1, 10.08.2026)

- **2.2 Kalendarz w planie rocznym** — sekcja „Kalendarz zbiórek i wydarzeń" z tabelą (data, rodzaj, opis), przycisk „Dodaj wydarzenie" (`add-calendar`), wiersze bindowane `annual.calendar.*`.
- **2.3 Historia w „Sprawnościach"** — chipy aspektów programu (Fizyczny/Intelektualny/Duchowy/Społeczny) liczone z `S.plan`, tabela problem/hipoteza/rezultat/wniosek (`history.rows.*`), przyciski „Dodaj wpis" (`add-history`) i „Dodaj bieżący eksperyment" (`save-history` — kopiuje kartę problemu, blokada gdy problem pusty). Wymagania sprawności nadal pokazują stan „API nie podłączone" + robocza notatka (`skills.note`).
- **2.4 Kontekst zastępu** — pola: cel długoterminowy, charakter, styl prowadzenia, poziom samodzielności i współpracy (`team.style`, `team.autonomy`); tabela podziału ról generowana z `team.roles` (4 wiersze, osoba/funkcja/zakres).
- **2.5 Autozapis** — `localStorage` klucz `kompas-zbiorek-draft-v1`; zapis `saveDraft()` z `render()`, listenerów input/change oraz akcji zadań; przywracanie przy starcie z try-catch (stan domyślny przy błędzie).
- Style: `.row-actions`, `.aspect-chips`/`.aspect-chip` (użyty ze złotym topem, pusty dashed), `.work-section h2`, textarea w tabelach annual/history.

Wdrożono (druga łatka): https://wtyczka-rr.milosz-spyrka.workers.dev (Version ID `709382ba-c0b2-460e-89df-a50b155dc402`).

### Zrealizowane (trzecia łatka, 10.08.2026)

- **Ekran główny** — cykl doskonalenia (bieżący etap) przeniesiony nad sekcję „Co przygotować teraz"; poniżej listy zadań dodany przycisk „Edytuj" otwierający kartę zbiórki; pod przyciskiem sekcja „Lista aktywności" (przebieg zbiórki z `plan.*`: godzina, aktywność, aspekt, osoba) z jawnym stanem pustym.
- **Realizowane elementy** — status wymagań zmieniony z selecta na kółko z ptaszkiem: zielony kafelek + zielone kółko z ✓ = zrealizowane, złote = w trakcie, czerwone = do realizacji; kliknięcie cykluje status (`skill-status`); nota objaśniająca pod tabelą.
- **Menu górne** — usunięto pozycje „Plan roczny", „Sprawności" i „Baza aktywności"; „Problemy i eksperymenty" przemianowane na „Eksperymenty" (widoki `annual`, `skills`, `finder` pozostają w kodzie, ale bez punktu wejścia w nawigacji).
- Style: `.home-agenda`, `.agenda-list`/`.agenda-row`/`.agenda-empty`, `.home-grid-single`, `.skill-row` (kolory statusu), `.skill-status` (44 px, warianty mobilne 599 px).

Wdrożono (trzecia łatka): https://wtyczka-rr.milosz-spyrka.workers.dev (Version ID `673de7e5-1f59-4978-8591-db979f5538e9`).

### Zrealizowane (czwarta łatka — branding v16, 10.08.2026)

- **Szyny sekcji (rail)** — nagłówki stron (`pageHead`) otrzymały lewy numerowany rail 01–04 (Azymut): numer sekcji 30/32, 900, czerwony; nazwa sekcji 10/12, 850, uppercase, tracking .14em; linia z dwoma złotymi waypointami i czerwoną strzałką. Na ≤959 px rail przechodzi w poziomy label (numer + nazwa, linia/waypointy/strzałka ukryte).
- **Góry w hero** — hero ekranu głównego otrzymał line-art SVG (3 pasma o malejącej kontrastowości, czerwona przerywana trasa i 2 czerwone waypointy, `vector-effect: non-scaling-stroke`); na ≤599 px wysokość 110 px.
- **Brand lockup** — wordmark `.brand-name` (17 px, 850, uppercase, tracking .02em).
- **Nawigacja** — przyciski menu z klasą `nav-link`; podkreślenie 28×2 czerwone animowane `scaleX` (0→1) na hover i stanie aktywnym.
- **Karty (work-section)** — licznik `sec` dodaje złoty numer (Noto Sans Display 900) w prawym górnym rogu; lewa krawędź 5 px: czerwona dla standardowych sekcji, złota dla `accent-section`.
- Style: `.page-head`, `.section-rail`, `.section-number`, `.section-name`, `.rail-line`, `.rail-dot`, `.rail-arrow`, `.brand-name`, `.mountains`, `header .sidebar button:after` (animacja), `.work-section:before`/`:after` + media 959/599.

Wdrożono (czwarta łatka): https://wtyczka-rr.milosz-spyrka.workers.dev (Version ID `6b500d92-0f09-4eb7-85e8-279e45c0da0b`).
