# Dokumentacja — kompas-ui-plugin

## Sprawności — model działania (KOMAA-24)

### Reguły

1. Samo dodanie/przydzielenie sprawności NIE tworzy wpisu Historii.
2. Osiągnięcie 100% ukończenia wszystkich wymagań automatycznie przenosi grupę sprawności do Historii (na poziomie: poziom harcerski + grupa sprawności).
3. Jeżeli grupa jest ukończona i znajduje się w Historii na danym poziomie, żadna sprawność z tej grupy na tym poziomie nie jest dostępna w „Dodaj sprawność" ani w sugestiach.
4. Wykluczenie wynika z logiki danych/stanu (`skillCatalogAllowed`), nie tylko z ukrycia w UI.
5. Obsługuje istniejące dane historyczne i nie tworzy duplikatów.

### Zmiany (KOMAA-24)

#### `cycle-skill-requirement` (handler click)
- **Przed:** Handler tylko normalizował `record.level` — nie zmieniał statusu wymagania.
- **Po:** Cykluje status wymagania: `Do realizacji` → `W trakcie` → `Ukończono` → `Do realizacji`. Wywołuje `completeActivitySkillPoint` w celu obsługi auto-historii.

#### `add-predefined-skill` (handler click)
- **Przed:** Brak sprawdzenia czy grupa jest już ukończona w `skillRecords`.
- **Po:** Dodano sprawdzenie `alreadyCompleted` — jeśli grupa jest ukończona w `skillRecords`, dodanie do historii jest zablokowane komunikatem `S.toast`.

### Istniejąca logika (zweryfikowana)

- **`completeActivitySkillPoint`** (linia 78): Automatycznie tworzy/usuwa wpis Historii gdy wszystkie wymagania mają status `Ukończono`. Klucz historii: `sourceSkillId` = identyfikator rekordu sprawności.
- **`skillCatalogAllowed`** (linia 52): Buduje `completedGroups` z `skillHistoryRecords` ORAZ w pełni ukończonych `skillRecords`. Blokuje katalog na poziomie `poziom|grupa`.
- **`remove-current-skill`** (linia 345): Usuwa sprawność z `skillRecords`, czyści powiązania z Historii i Aktywności.

### Źródła danych

- Katalog sprawności: `https://wtyczka.kompaszbiorek.pl/api/skills?poziom=...&aspekt=...`
- Stan trwały: `localStorage["kompas-zbiorek-draft-v1"]` (pole `team.skillRecords`, `team.skillHistoryRecords`)
- Cache katalogu: IndexedDB `kompas-catalog-v1` (TTL 24h dla sprawności)

### Ograniczenia

- Brak NocoBase — cały stan jest w `localStorage`.
- Historia operates na poziomie `(level, group)`, nie pojedynczej sprawności.
- Lighthouse nie przechodzi z powodu błędu środowiskowego Windows (EPERM na temp dir).

### Testy

- Build: `npm run build` — OK
- Playwright: `npm run test:all` — 92/92 passed (desktop + mobile)
- Dostępność: WCAG A/AA (2.1 + 2.2) — przeszło na obu viewportach
- Lighthouse: EPERM — problem środowiskowy, niezwiązany ze zmianami kodu
