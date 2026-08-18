# Audyt UX/UI — Zakładka Sprawności (KOMAA-25)

Data: 18.08.2026 · Zakres: `kompas-ui-plugin/web/src/static-app-v2.js` + `styles.css` · Kontekst: zastęp (team), zakładka Sprawności, widok „Dodaj sprawność", Historia.
Wzorzec: `BRAND-DESIGN-SYSTEM v1.0`, `PRD Kompas Zbiórek`, `AUDYT-UX-UI.md`.

---

## 1. Struktura zakładek Sprawności

### Obecna architektura
Zakładka „Sprawności" znajduje się w widoku **Kontekst zastępu** → sekcja „01 Sprawności". Dwie podzakładki:

| Zakładka | Funkcja | Źródło danych |
|---|---|---|
| **Aktualne** | Tabela sprawności z kryteriami i statusami | `S.team.skillRecords` |
| **Historia** | Katalog grup sprawności (4 aspekty × 3 poziomy) | `S.team.skillHistoryRecords` + `SKILL_CATALOG` (hardcoded) |

### Znalezione problemy

#### P0 — Krytyczne

**S-01: „Dodaj sprawność" w zakładce Aktualne otwiera ten sam modal co w zakładce Historia**
- `data-action="open-skill-picker"` w obu zakładkach → ten sam `skillPickerPopup()`
- W zakładce Aktualne: „Dodaj sprawność" dodaje do `S.team.skillRecords` (kryteria + statusy)
- W zakładce Historia: „Dodaj sprawność" dodaje do `S.team.skillHistoryRecords` (tylko nazwa + aspekt)
- **Ryzyko**: Użytkownik nie rozumie, dlaczego ten sam przycisk robi coś innego w zależności od zakładki. Brak wskazówki kontekstowej.

**S-02: Przycisk „Dodaj sprawność" w zakładce Aktualne jest secondary, choć to główne działanie**
- W `skillsCurrent`: `btn("Dodaj sprawność","open-skill-picker","secondary")`
- Gdy brak sprawności: `btn("Dodaj sprawność","open-skill-picker")` (primary)
- **Niespójność**: Gdy są już jakieś sprawności, przycisk „Dodaj kolejną" jest secondary — ale to jedyne wejście do katalogu. Powinien pozostać wyraźny.

**S-03: Brak potwierdzenia usunięcia sprawności z realizowanych**
- `data-action="remove-current-skill"` natychmiast usuwa z `S.team.skillRecords` i cascade'uje: usuwa z `S.activity.skillIds`, `S.activity.skillPoints`, `S.team.skillHistoryRecords`
- Brak `<details>`/pop-over jak przy usuwaniu zadań (`task-delete-confirm`)
- **Ryzyko**: Nieodwracalne usunięcie wielu powiązanych rekordów jednym kliknięciem.

#### P1 — Ważne

**S-04: Status wymagania cycle nie jest czytelny na mobile**
- `requirement-status` to przycisk z `status-token` + strzałka `⌄`
- Na mobile (< 699px) tabela się rozbija na karty, ale przycisk statusu ma `justify-self:end` — bywa obcięty przy długim tekście kryterium
- Brak etykiety „Status" nad przyciskiem (jest w `<td data-skill-cell="Status">` ale ukryty w mobile via `thead{display:none}`)

**S-05: Historia — przycisk „Dodaj sprawność" w karcie aspektu otwiera modal katalogowy, ale dodaje do `S.team.skillHistoryRecords`**
- W `aspectCard`: `data-action="add-predefined-skill"` — dodaje predefined skill z `SKILL_CATALOG`
- Ale w `skillsHistory` header: `btn("Dodaj sprawność","open-skill-picker","secondary")` — otwiera modal API katalogu
- **Dwa różne flow dodawania**: predefined (hardcoded 6 pozycji na aspekt) vs API (pełny katalog)
- Użytkownik nie wie, which button does what.

**S-06: Karty aspektów w Historii — brak wskazania poziomu nad listą**
- `skill-aspect-card` header zawiera `Aspekt · Nazwa · Liczba`
- Ale poziom (Odkrywcy/Zwiadowcy/Wędrownicy) jest w sliderze powyżej — nie w karcie
- Przy przełączaniu poziomu karty się zmieniają, ale nagłówek slidera nie jest powiązany wizualnie z kartami

**S-07: Puste stany nie mają spójnej kompozycji**
- Aktualne (brak): `skill-empty-action` z h3 + opis + btn — layout flex z przyciskiem obok
- Aktualne (są): `skill-current-list` z tabelą + btn na dole
- Historia (brak): `context-empty` — jeden wiersz tekstu
- Historia (są): karty aspektów + btn w headerze
- **Różne wzorce kompozycji** w zależności od stanu i zakładki.

**S-08: Skill picker modal — brak informacji,Which view triggered it**
- Modal zawsze pokazuje: „Dodaj sprawność · Poziom z profilu: Zwiadowcy"
- Nie informuje, czy dodajemy do Aktualnych czy do Historii
- Po dodaniu: toast genericzny — nie wskazuje,Where the skill went

#### P2 — Kosmetyczne / Branding

**S-09: `.skill-aspect-card` ma `border-top:4px solid var(--gold)` — odstęp od brand systemu**
- Brand system przewiduje `border-top:3px solid var(--gold)` dla `.mode` i `.top-data`
- 4px vs 3px — niekrytyczna rozbieżność, ale niespójna.

**S-10: Skill record icon — `border-radius:50%` na okrągłym elemencie z `overflow:hidden`**
- `.skill-record-icon` i `.skill-catalog-icon` mają `border-radius:50%` + `overflow:hidden`
- Ale `.skill-history-icon` ma `border-radius:50%` z `!important` — wymuszenie sugeruje problem z cascade

**S-11: Tablica `SKILL_CATALOG` jest hardcoded i nie aktualizuje się z API**
- `SKILL_CATALOG={Fizyczny:["Puszczaństwo","Alarm",...],...}` — 6 pozycji na aspekt
- API katalogowe (`/api/skills`) zwraca pełną listę
- W Historii używane jest hardcoded, w Aktualnych — API
- **Rozbieżność danych**: jeśli API ma nowe sprawności, Historia ich nie zobaczy

**S-12: `.skill-history-list article` — prosty layout bez wizualnej hierarchii**
- `<div><b>Poziom</b><span>Aspekt ...</span></div><p>Nazwa aktywności</p>`
- Brak ikony, brak koloru aspektu, brak wyróżnienia wizualnego
- Porównanie z `.skill-records` (tabela z ikoną, rowspan, kolorowym statusem) — duża różnica w jakości prezentacji

**S-13: Focus outline na `.skill-catalog-options button` nie jest zdefiniowany**
- Przyciski katalogu nie mają显式 `:focus-visible` — domyślny browser outline
- Brand system wymaga: `outline: 3px solid rgba(214,173,47,.36); outline-offset: 3px`

**S-14: `.skill-level-slider button.active` ma `box-shadow:0 3px 0 var(--gold)` — niespójne z innymi sliderami**
- `.annual-view-toggle button.active` — bez shadow
- `.context-tabs button.active` — bez shadow (after fix: `box-shadow:none`)
- `.skill-level-slider` jako jedyny używает gold shadow

---

## 2. Docelowy model ekranu i hierarchii informacji

### Zakładka Aktualne — drzewo informacji

```
Kontekst zastępu
└── 01 Sprawności
    ├── [Aktualne] [Historia]  ← tabs (pill-like)
    │
    ├── (brak sprawności)
    │   ├── Dashboard kicker: "Aktualne sprawności"
    │   ├── H3: "Dobierz sprawność dla zastępu"
    │   ├── Opis: "Katalog jest automatycznie dopasowany do poziomu {group}"
    │   └── [CTA primary: "Dodaj sprawność"]
    │
    └── (są sprawności)
        ├── Section label: "Wybrane sprawności"
        ├── Skill record ×N
        │   ├── Ikona grupy (okrągła, 40×40)
        │   ├── Meta: "{aspekt} · {grupa}" (small, muted)
        │   ├── Tytuł: "{nazwa sprawności}" (h3, Display, 20px)
        │   ├── Poziom: "{Odkrywcy/Zwiadowcy/Wędrownicy}" (small, muted)
        │   ├── Tabela kryteriów
        │   │   ├── Kryterium (text)
        │   │   └── Status (cycle button: Do realizacji → W trakcie → Ukończono)
        │   └── [Usuń] (× button, brak potwierdzenia)
        └── [CTA secondary: "Dodaj sprawność"]
```

### Zakładka Historia — drzewo informacji

```
Kontekst zastępu
└── 01 Sprawności
    ├── [Aktualne] [Historia]
    │
    ├── Skill history head
    │   ├── Slider: [Odkrywcy] [Zwiadowcy] [Wędrownicy]
    │   └── [CTA secondary: "Dodaj sprawność"]  ← otwiera API picker
    │
    └── Aspect grid (2×2)
        ├── Fizyczny
        │   ├── Header: "Aspekt · Fizyczny · {count}"
        │   ├── Selected pills (jeśli są)
        │   └── Catalog options (6 predefined buttons)
        │       └── Each: [ikona 52×50] [nazwa] [✓ if added]
        ├── Intelektualny
        ├── Duchowy
        └── Społeczny
```

### Rekomendowany model po zmianach

```
Kontekst zastępu
└── 01 Sprawności
    ├── [Aktualne] [Historia]
    │
    ├── Aktualne
    │   ├── (brak) → centrowany empty state + primary CTA
    │   └── (są) → lista kart (nie tabela!) z:
    │       ├── Ikona + tytuł + poziom + aspekt
    │       ├── Progres bar (0% / częściowo / 100%)
    │       ├── Kryteria jako checklist (nie tabela!)
    │       ├── Status: toggle Do realizacji ↔ Ukończono (nie 3-stopniowy cycle!)
    │       └── Usuń → confirmation popover
    │
    └── Historia
        ├── Slider poziomów
        ├── 4 karty aspektów (2×2 grid)
        │   ├── Ikona + nazwa aspektu + count
        │   └── Lista zrealizowanych (pill-like, z datą?)
        └── [CTA: "Oznacz jako zrealizowaną"] → picker predefined
```

---

## 3. Lista elementów do usunięcia / scalenia / przeniesienia

### Usuń (zbędne / mylące)

| Element | Lokalizacja | Powód |
|---|---|---|
| `sprawnosci` array w S | `static-app-v2.js:12` | Martwe dane — 3 puste obiekty, nigdy nie wyświetlane, nie synchronizowane z `skillRecords` |
| `skills.note` w S | `static-app-v2.js:12` | Martwe pole — nigdy nie wyświetlane |
| `history.rows` w S | `static-app-v2.js:12` | Martwe dane — 1 pusty obiekt, nieużywane |
| `skillHistoryMeta` | `static-app-v2.js:56` | Martwe pole — nigdy nie wyświetlane |
| Dwa `dodCompact` functions | `static-app-v2.js:144` + `static-app-v2.js:146` | Duplikat — drugi nadpisuje pierwszy (readonly vs edit) |

### Scal / Uprość

| Element | Zmiana | Powód |
|---|---|---|
| Dwa „Dodaj sprawność" CTA (Aktualne + Historia) | Rozróżnij etykiety: „Dodaj z katalogu" (Aktualne) / „Oznacz zrealizowaną" (Historia) | Użytkownik nie wie,which button does what |
| 3-stopniowy cycle status (Do realizacji → W trakcie → Ukończono) | Zmień na 2-stopniowy toggle: Do realizacji ↔ Ukończono | „W trakcie" jest redundantne — nie ma oddzielnej akcji dla tego stanu |
| Tabela kryteriów + osobna lista kryteriów w podsumowaniu | Scal do jednej checklisty | Dwa różne widoki tych samych danych |

### Przenieś

| Element | Z | Do | Powód |
|---|---|---|---|
| Usuń sprawność (×) | Bez potwierdzenia | `<details>` popover jak task-delete | Nieodwracalne usunięcie cascade |
| Ikona sprawności w Historii | `skill-history-icon` (52×50) | Zmień na 40×40 jak w Aktualnych | Spójność rozmiaru |

---

## 4. Kryteria akceptacyjne implementacji

### Funkcjonalne
- [ ] Usunięcie sprawności wymaga potwierdzenia (popover z „Tak, usuń")
- [ ] Toast po dodaniu wskazuje,Where the skill went: „Dodano do aktualnych sprawności" / „Oznaczono jako zrealizowaną w Historii"
- [ ] Przycisk „Dodaj sprawność" w Aktualnych ma etykietę „Dodaj z katalogu"
- [ ] Przycisk „Dodaj sprawność" w Historii ma etykietę „Oznacz zrealizowaną"
- [ ] Status wymagania: toggle 2-stopniowy (Do realizacji ↔ Ukończono) zamiast 3-stopniowego cycle
- [ ] Usunięte: `S.sprawnosci`, `S.skills.note`, `S.history.rows`, `S.skillHistoryMeta`

### Wizualne
- [ ] Puste stany mają spójny wzorzec: centrowany tekst + primary CTA
- [ ] Focus-visible na wszystkich interaktywnych elementach katalogu sprawności
- [ ] `.skill-aspect-card` border-top: 3px (nie 4px) — zgodne z brand system
- [ ] `.skill-level-slider button.active` bez gold shadow (spójne z innymi sliderami)
- [ ] Skill record icon: 40×40 w obu zakładkach

### Responsywne
- [ ] Na mobile (< 699px): przycisk statusu kryterium ma pełną szerokość (nie `justify-self:end`)
- [ ] Na mobile: przycisk „Usuń sprawność" jest czytelnie oddzielony od treści
- [ ] Na mobile: slider poziomów w Historii nie overflowuje (min-width: 0)

### Dostępność
- [ ] `aria-label` na przycisku usuwania wskazuje nazwę sprawności
- [ ] Status kryterium ma `aria-live="polite"` po zmianie
- [ ] Przyciski katalogu mają显式 focus-visible outline

---

## 5. Zmiany konieczne w Historii po ukończeniu grupy 100%

### Obecne zachowanie
Gdy wszystkie kryteria sprawności mają status „Ukończono":
1. `completeActivitySkillPoint()` sprawdza `allDone`
2. Dodaje rekord do `S.team.skillHistoryRecords` z: `{level, aspect, activity, sourceSkillId}`
3. Usuwa z `S.team.skillHistoryRecords` gdy cofniemy status

### Problemy
1. **Historia nie prezentuje grup sprawności na poziomie** — prezentuje pojedyncze sprawności (nazwa + aspekt). Wymaganie: „Historia ma prezentować grupy sprawności na poziomie, a nie umożliwiać wybór pojedynczych sprawności"
2. **Brak automatycznego dodawania po ukończeniu 100% w kontekście zastępu** — dodawanie jest ręczne (predefined) lub przez API picker
3. **Brak informacji o dacie ukończenia** — `skillHistoryRecords` nie ma pola `completedAt`
4. **Brak wizualnego wyróżnienia ukończonych grup** — brak progresu, brak podsumowania

### Rekomendowane zmiany
1. Automatyczne dodawanie do Historii po ukończeniu wszystkich kryteriów sprawności (już działa w `completeActivitySkillPoint`)
2. Dodanie pola `completedAt` (ISO date) do `skillHistoryRecords`
3. W Historii: pokazuj tylko nazwę grupy (nie pojedyncze sprawności) + poziom + aspekt + data
4. Na karcie aspektu w Historii: pokaż liczbę ukończonych sprawności / łączną liczbę (np. „3/6")
5. Po ukończeniu 100% grupy: toast „Grupa {nazwa} dodana do historii sprawności"

---

## Podsumowanie priorytetów

| Priorytet | Liczba | Opis |
|---|---|---|
| P0 | 3 | Martwe dane, brak potwierdzenia usunięcia, mylące CTA |
| P1 | 5 | Status cycle, dwa flow dodawania, puste stany, brak info w modalu |
| P2 | 6 | Branding niespójności, hardcoded katalog, jakość prezentacji historii |
