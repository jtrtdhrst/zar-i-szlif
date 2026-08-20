# Plan wdrożenia `/panel` — aplikacja online Kompasu Zbiórek z logowaniem Google

Status: **faza 1 i 2 wdrożone na `panel.kompaszbiorek.pl`** — `wtyczka.kompaszbiorek.pl/*` → `308` → `panel.kompaszbiorek.pl/*` (kanon `panel`, `CANONICAL_ORIGIN=https://panel.kompaszbiorek.pl`), wersje `wtyczka-rr 0054de38` + `panel-kompaszbiorek 1b2e2737` (wcześniej `ea25dbdc…` na wtyczce).

Produkcyjny Worker: `panel-kompaszbiorek` (domena `panel.kompaszbiorek.pl`, UI `/ui` publiczny bez logowania) + `wtyczka-rr` (API/MCP na `wtyczka` jako redirect alias).

## 1. Cel

`https://wtyczka.kompaszbiorek.pl/panel` staje się pełną aplikacją online
**wyłącznie dla Google Sheets**: użytkownik loguje się kontem Google bezpośrednio
w przeglądarce, dostaje landing z dwiema opcjami i zapisuje kartę Kompasu Zbiórek
do wybranego arkusza jako kolejny wiersz (Sheets API):

- „Mam już arkusz” — wklejenie linku do istniejącego pliku Google Sheets albo
  wybór z listy plików w zasięgu aplikacji (TRYB 3),
- „Tworzę nowy arkusz” — kopia szablonu arkusza Kompasu na koncie Google (TRYB 4).

Tryby dokumentów Google Docs (dotychczasowe TRYB 1/2) zostały **usunięte** — panel
nie obsługuje już dokumentów.

## 2. Stan obecny (potwierdzony)

- `/panel` → landing (ważna sesja) albo 302 na `/panel/login`. `/ui` → publiczny widget z `authenticated:false`.
- Logowanie istnieje w przepływie MCP (`/authorize` → zgoda → Google → `/callback`) oraz niezależnie w panelu (PKCE S256, `access_type=offline`, `prompt=consent`).
- Token Google (panel): scopes `openid email profile drive.file`,
  **bez** `drive.readonly`, z refresh tokenem (odświeżanie na backendzie przez `/token`).
- Wybór pliku zapisywany na backendzie (KV `panel:file:<googleSub>`) oraz w
  `localStorage` (`kompas-picked-doc`, warstwa offline/odczytu).
- Dane karty trzymane w `localStorage` (`kompas-zbiorek-draft-v1`); zapis do arkusza
  następuje przez `POST /panel/save` (Sheets API `spreadsheets.values.append`).

## 3. Architektura

Niezależny, przeglądarkowy przepływ OAuth Google (PKCE S256) obsługiwany przez
`src/panel-handler.ts`, serwowany z tego samego Workera:

- Sesja panelu: rekord w KV `OAUTH_KV` pod kluczem `panel:session:<sessionId>`
  (googleSub, email, name, accessToken, accessTokenExpiresAt, refreshToken).
  Cookie sesyjne podpisane HMAC-SHA256 kluczem `COOKIE_ENCRYPTION_KEY`.
- `window.__KOMPAS_OAUTH__` wstrzykiwane istniejącym `injectWidgetAuth` z
  `authenticated:true` i żywym `accessToken` — Google Picker i Drive API działają bez zmian.

### Endpointy (`panel-handler.ts`)

| Endpoint | Metoda | Zachowanie |
|---|---|---|
| `/panel` | GET | Ważna sesja → landing (2 opcje + wybrany arkusz + wyloguj); brak sesji → redirect na `/panel/login` |
| `/panel/login` | GET | PKCE: state+code_verifier do KV, redirect na Google (`access_type=offline`, `prompt=consent`) |
| `/panel/callback` | GET | Walidacja state, wymiana kodu (z `refresh_token`), zapis sesji, cookie, redirect na `/panel` |
| `/panel/choose?mode=existing` | GET | Redirect na `/panel/app?view=picker` (wybór arkusza w widgetcie) |
| `/panel/choose?mode=new` | GET | Kopia szablonu `SHEETS_TEMPLATE_FILE_ID` przez Drive API `files.copy` na konto użytkownika, zapis jako wybrany plik, redirect na `/panel/app?view=picker` |
| `/panel/app` | GET | Widget w trybie zalogowanym (dawny `/panel`) |
| `/panel/save` | POST | Zapis karty do arkusza (Sheets API): odczyt nagłówków, mapowanie kolumn po nazwach, `values.append` (INSERT_ROWS, USER_ENTERED), przy pustym arkuszu najpierw wiersz nagłówków |
| `/panel/logout` | GET | Usunięcie sesji i cookie |
| `/panel/context` | GET | Pobranie zapisanego wyboru pliku (fileId, mimeType, name) dla użytkownika |
| `/panel/context` | POST | Zapis wyboru pliku (wymaga sesji panelu) |
| `/panel/documents` | GET | Lista własnych arkuszy (Drive API `files.list`, MIME spreadsheet) |

## 4. Zmiany w widgetcie (`web/src/static-app-v2.js`)

1. `pickerView()` — wyłącznie arkusze:
   - **TRYB 3 — Arkusz Google (istniejący)**: wklejenie linku do Google Sheets
     (walidacja `/d/<id>` albo ID ≥ 20 znaków, opcjonalne pobranie nazwy przez
     Drive API `files.get`) albo Google Picker z MIME spreadsheet (zakres `drive.file`).
   - **TRYB 4 — Nowy arkusz z szablonu**: `POST drive/v3/files/<SHEETS_TEMPLATE_FILE_ID>/copy`
     z nazwą `Kompas Zbiórek — DD.MM.RRRR`.
   - Karty TRYB 1 (szablon Docs) i TRYB 2 (własny dokument) usunięte.
2. Po wyborze/utworzeniu: zapis `{ fileId, name, mimeType, mode }` **na backend**
   (`POST /panel/context`) — trwały, powiązany z kontem, nie tylko `localStorage`.
3. Przy wybranym arkuszu przycisk **„Zapisz kartę do arkusza”** (`saveToSheet`):
   `POST /panel/save` z `{activity, problem, team}`; potwierdzenie z zakresem
   dopisanego wiersza albo czytelny błąd.
4. Link „Otwórz” prowadzi zawsze do `docs.google.com/spreadsheets/d/<id>/edit`.
5. Sekcja „POŁĄCZENIE” pokazuje stan sesji panelu (aktywna/brak).

## 5. Konfiguracja Google Cloud (wykonana, poza kodem)

1. Włączone API: **Google Drive API**, **Google Sheets API**, **Google Picker API** (projekt `450955230972`).
2. W OAuth consent screen dodane redirect URIs (klient web „Kompas Zbiórek RR wtyczka”):
   - `https://panel.kompaszbiorek.pl/panel/callback` (panel login — kanon)
   - `https://panel.kompaszbiorek.pl/callback` (MCP OAuth — kanon `panel`)
   - Legacy (redirect `wtyczka` → `panel`, zostaw do wygaszenia): `https://wtyczka.kompaszbiorek.pl/panel/callback`, `https://wtyczka.kompaszbiorek.pl/callback`
3. Scopes panelu: tylko non-sensitive `openid email profile drive.file` —
   `spreadsheets` (sensitive) **usunięty 19.08.2026** z `PANEL_SCOPES`. Wszystkie
   metody używane przez backend (Sheets API: `spreadsheets.get`, `values.get`,
   `values.append`; Drive API: `files.copy`; Google Picker) działają w zasięgu
   `drive.file` — dlatego panel nie wymaga weryfikacji aplikacji Google ani nie
   wlicza się do limitu 100 logowań w trybie Testing.
4. **Weryfikacja aplikacji**: niepotrzebna — `drive.file` to non-sensitive scope
   (brak ekranu „aplikacja niezweryfikowana” przy logowaniu).

## 6. Refresh token i zapis w tle

- `access_type=offline` + `prompt=consent` daje refresh token przy pierwszym logowaniu
  w panelu. `panel-handler` trzyma go w KV i używa do odświeżenia `accessToken`
  gdy token wygasł (endpoint `/token`, `grant_type=refresh_token`).
- `POST /panel/save` wykonuje zapis po stronie Workera, więc działa niezależnie od
  przeglądarki użytkownika.

## 7. Struktura arkusza (wdrożone)

- Arkusz docelowy: wybrany TRYBEM 3/4; wiersz nagłówków to kolumny karty Kompasu
  (`SHEET_FIELDS` w `panel-handler.ts`): Zapisano, Numer, Tytuł/Temat, Data i godzina,
  Obecność, Cel, Eksperyment, Wynik, Obserwacje, Refleksja, Czy cel osiągnięty,
  Najsilniejszy dowód, Co się wydarzyło, Próba, Wniosek, Następny krok, Problem,
  Hipoteza, Test, Oczekiwanie, Ocena hipotezy, Wniosek eksperymentu, Decyzja.
- Mapowanie pól: dopasowanie kolumn istniejącego arkusza po znormalizowanych nazwach
  nagłówków (bez polskich znaków); przy pustym arkuszu najpierw zapisywany jest
  wiersz nagłówków, potem dane.
- Wersjonowanie: timestamp zapisu w kolumnie „Zapisano”.
- Zapis do arkusza z własnym układem kolumn uzupełnia tylko kolumny, które da się
  dopasować do nagłówków — pozostałych pól nie nadpisuje.

## 8. Kolejność wdrożenia (zrealizowana)

**Faza 1 — `/panel` + wybór pliku:**
1. `panel-handler.ts` + routing `/panel*` + sesje w KV + cookie.
2. Widget: TRYB 3/4, zapis wyboru przez `/panel/context`, `/panel/documents`.
3. Konfiguracja Google Cloud (sekcja 5).
4. Build + deploy (kolejność stała):
   `npm run build` w `kompas-ui-plugin`,
   `node build-worker.mjs` w `cloudflare-worker`,
   `npx wrangler deploy --dry-run`,
   `npx wrangler deploy --keep-vars`.
5. Testy E2E Playwright (`npm run test:all`): 92/92 zielone (14 testów panelu ×
   desktop + mobile), a11y WCAG A/AA, regresje wizualne; Lighthouse — progi bez
   obniżania (na tej maszynie pomiar kończy się znanym `EPERM` przy sprzątaniu
   katalogu temp Chrome, bez oceny progów).

**Faza 2 — zapis danych do arkusza:**
- `POST /panel/save` przez Sheets API, struktura arkusza
  (sekcja 7), landing z dwiema opcjami (`/panel/choose?mode=new|existing`).
- 19.08.2026: scope `spreadsheets` usunięty z `PANEL_SCOPES` (zostaje wyłącznie
  non-sensitive `drive.file`); redeploy obu Workerów.
- 19.08.2026: **naprawa walidacji stanu logowania** — cookie `__Host-PANEL_STATE`
  było podpisywane SHA-256 (`sha256Hex`), a callback weryfikował HMAC-SHA256
  (`verifyValue` z `COOKIE_ENCRYPTION_KEY`) → każdy realny login kończył się
  „Stan logowania nie pasuje do sesji przeglądarki" (testy e2e mockują callback,
  więc błąd nie był wykryty). Poprawka: cookie = `signValue(stateToken, secret)`,
  usunięto nieużywaną `sha256Hex`; weryfikacja produkcyjna: cookie == HMAC(state).
  Wersje: `wtyczka-rr` `6205ccb5-0da2-4381-8be9-c4c3de1ec769`,
  `panel-kompaszbiorek` `e48981be-b214-414c-9f3c-67c3fc634752`.

## 9. Ryzyka i ograniczenia

- **`wrangler deploy --keep-vars`**: utrzymuje sekrety i zmienne; `worker.js`
  generowany przez build — nie edytować ręcznie.
- **Czas życia tokena**: aktywny Picker korzysta z tokena wstrzykniętego do HTML —
  przy wygaśnięciu wymaga przeładowania `/panel`; zapis przez `/panel/save` odświeża
  token po stronie Workera.
- **Scope panelu**: wyłącznie non-sensitive `drive.file` — zgoda Google nie wymaga
  weryfikacji aplikacji (brak ekranu „niezweryfikowana”, brak limitu 100 logowań).
- **Wklejony link do cudzego arkusza**: zapis zakończy się czytelnym błędem
  (brak dostępu), dopóki właściciel nie udostępni pliku użytkownikowi.
- **Istniejący arkusz bez nagłówków**: Worker najpierw zapisuje standardowe
  nagłówki `SHEET_FIELDS` — własny układ kolumn pojawi się dopiero po tym kroku.