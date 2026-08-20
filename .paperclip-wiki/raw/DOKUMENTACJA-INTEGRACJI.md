# Kompas Zbiórek RR

## Dokumentacja techniczna integracji ChatGPT (MCP), Cloudflare Worker, Google OAuth i Google Sheets

**Stan opisany w dokumencie:** 18 sierpnia 2026
**Wersja produkcyjna Workera `wtyczka-rr`:** `3d4d0ac5-0844-4d4b-842c-171fe26e7afc` (cache HTTP assetów)
**Domena produkcyjna:** `https://wtyczka.kompaszbiorek.pl` (fallback `/ui`); panel: `https://panel.kompaszbiorek.pl` (dedykowany Worker `panel-kompaszbiorek`); docelowa `https://interfejs.kompaszbiorek.pl` (niepotwierdzona w testach)
**Model integracji:** jeden Worker, jeden OAuth, trwały stan drużyny w Google Sheets

---

## 1. Zakres dokumentacji

Ta dokumentacja opisuje aktualną architekturę systemu Kompas Zbiórek RR, w której ChatGPT:

1. łączy się z serwerem MCP Workera przez własny serwer OAuth 2.1 (Authorization Code + PKCE S256) z biblioteki `@cloudflare/workers-oauth-provider`,
2. otwiera interaktywny widget (HTML serwowany statycznie) przez narzędzie MCP `pokaż_kompas_zbiórek`,
3. loguje użytkownika przez Google OpenID Connect — Google służy wyłącznie do identyfikacji, nie udostępnia operacji na dokumentach,
4. zapisuje dane robocze w `localStorage` widgetu (szkic `kompas-zbiorek-draft-v1`) oraz przez narzędzie MCP `zapisz_dane_kompasu` (whitelist pól, dwuetapowe potwierdzenie),
5. pozwala na trwały zapis karty zbiórki do **Google Sheets** przez panel `/panel` (niezależny OAuth Google w przeglądarce, PKCE S256, `access_type=offline`),
6. proxyzuje katalogi aktywności i sprawności z dwuwarstwowym cache (Cloudflare Cache API + IndexedDB).

Dokumentacja nie opisuje wycofanego wariantu opartego na Google Docs: starego Custom GPT Action, operacjach Google Docs API, eksporcie DOCX, bazie D1, `document_id` ani trybach `created`/`joined`. Te warianty nie są częścią aktualnej architektury (obecnie: wtyczka ChatGPT + interfejs https://interfejs.kompaszbiorek.pl + 4-etapowy cykl) — trwałość danych realizuje panel Google Sheets.

---

## 2. Komponenty

| Komponent | Lokalizacja | Rola |
|---|---|---|
| Worker `wtyczka-rr` | `kompas-ui-plugin/cloudflare-worker` | Serwer MCP + OAuth, logowanie Google, panel `/panel`, proxy katalogów, serwowanie UI i assetów |
| Widget | `kompas-ui-plugin/web` (build → `web/dist`) | Interfejs renderowany statycznie w ChatGPT; dane robocze w `localStorage` |
| Serwer MCP (lokalny podgląd) | `kompas-ui-plugin/server` | Express + StreamableHTTP: `POST /mcp`, `GET /health`, statyczne `web/dist` (testy UI) |
| Baza aktywności RR | `https://zabawy.kompaszbiorek.pl/api/activities` | Upstream proxy `GET /api/activities` |
| API sprawności | `https://sprawnosci.kompaszbiorek.pl/` | Upstream proxy `GET /api/skills` |

---

## 3. Endpointy Workera `wtyczka-rr`

| Ścieżka | Metoda | Opis |
|---|---|---|
| `/mcp` | POST | Główny endpoint MCP (StreamableHTTP) za OAuth 2.1 |
| `/authorize` | GET / POST | Start zgody OAuth (GET = formularz zgody, POST = akceptacja klienta) |
| `/token` | POST | Wymiana kodu autoryzacyjnego na token MCP (PKCE) |
| `/register` | POST | Rejestracja klienta MCP (dynamic client registration) |
| `/.well-known/oauth-authorization-server` | GET | Metadata serwera autoryzacji |
| `/.well-known/oauth-protected-resource` | GET | Metadata chronionego zasobu |
| `/callback` | GET | Powrót z Google OIDC; zakończenie autoryzacji MCP |
| `/ui` | GET | Podgląd widgetu z wstrzykniętą konfiguracją OAuth (`authenticated:false`) |
| `/preview`, `/` | GET | Przekierowania 308 na `/ui` |
| `/health` | GET | `{ ok: true, name: "Kompas Zbiórek" }` |
| `/api/activities` | GET | Proxy bazy aktywności (cache 1 h świeżości / 6 h grace) |
| `/api/skills` | GET | Proxy sprawności (cache 6 h / 24 h grace) |
| `/panel` | GET | Landing panelu (2 opcje: istniejący arkusz / nowy z szablonu) |
| `/panel/login` | GET | Start OAuth Google panelu (PKCE S256, `access_type=offline`) |
| `/panel/callback` | GET | Powrót OAuth panelu; utworzenie sesji w KV |
| `/panel/logout` | GET | Wylogowanie; czyszczenie cookie i sesji |
| `/panel/app` | GET | Widget panelu (Sheets-only) z wstrzykniętą konfiguracją |
| `/panel/choose` | GET | Wybór arkusza: `?mode=existing` (link) / `?mode=new` (kopia szablonu) |
| `/panel/save` | POST | Zapis karty zbiórki do wybranego arkusza (Sheets API) |
| `/panel/context` | GET / POST | Kontekst zastępu sesji panelu (KV `panel:context:*`) |
| `/panel/documents` | GET | Lista ostatnich plików (KV `panel:file:*`) |
| `/assets/*` | GET | Wersjonowane assety widgetu (CSS/JS) z cache HTTP (ETag/304, `immutable`) |
| inna ścieżka | — | 404 |

---

## 4. Autoryzacja MCP (dla ChatGPT)

- **Przepływ:** OAuth 2.1 Authorization Code + PKCE S256 (`@cloudflare/workers-oauth-provider`).
- **Scope:** `kompas.read`.
- **Dane tożsamości w tokenie MCP** (`AuthProps`): `googleSub`, `email`, `emailVerified`, `name` oraz Google access token z `drive.file` (`accessToken`, `accessTokenExpiresAt`) — wykorzystywany wyłącznie przez Google Picker w widgetcie. Google access token **nie jest nigdy tokenem MCP**.
- **Logowanie Google:** OpenID Connect (`/callback`), scopes `openid email profile https://www.googleapis.com/auth/drive.file`, bez `access_type=offline`, bez refresh tokena Google. Trwały identyfikator użytkownika: `sub`.
- **Zgoda klienta:** pierwsza autoryzacja wymaga formularza zgody (CSRF), akceptacja zapisuje klienta w cookie (`addApprovedClient`) i dalej przechodzi automatycznie.
- **Stan OAuth:** KV `OAUTH_KV` (stan `state`, wiązanie stanu z sesją przez cookie).

## 5. Panel `/panel` (Google Sheets)

Panel jest aplikacją **wyłącznie dla Google Sheets** (faza 2). Niezależny od MCP przepływ OAuth Google w przeglądarce:

- **Scopes:** `openid email profile drive.file` — celowo **bez** `drive.readonly` i **bez** `spreadsheets` (od 19.08.2026). Sam `drive.file` (non-sensitive) wystarcza dla całego zapisu karty (Sheets API `spreadsheets.get`/`values.get`/`values.append`, Drive `files.copy`, Google Picker) — brak weryfikacji aplikacji, brak limitu 100 logowań.
- **Przepływ:** Authorization Code + PKCE S256, `access_type=offline`, `prompt=consent`; refresh token w sesji.
- **Sesje:** KV `panel:*` (klucz `panel:session:<googleSub>`), TTL 30 dni; cookie `__Host-PANEL_SESSION` i `__Host-PANEL_STATE` (stan PKCE, TTL 600 s), HMAC-SHA256 z `COOKIE_ENCRYPTION_KEY`.
- **Wybór pliku docelowego:** zapisywany na backendzie (KV, klucz `panel:file:<googleSub>`).
  - TRYB 3: Google Picker pokazuje **wszystkie arkusze użytkownika** (dostęp do wybranego pliku dopiero po wyborze — `drive.file`) albo wklejenie linku do istniejącego arkusza (walidacja przez Drive API).
  - TRYB 4: Google Picker pokazuje **1 pozycję — szablon** `SHEETS_TEMPLATE_FILE_ID` (`DocsView.setFileIds`); po wyborze kopia szablonu przez Drive API `files.copy` (klient widgetu; wymaga `GOOGLE_PICKER_API_KEY`).
- **Zapis karty (`POST /panel/save`):**
  1. Wymaga sesji panelu (`requireAuth`) i wybranego pliku (`panel:file:*`).
  2. Walidacja: wybrany plik musi mieć mime `spreadsheet`.
  3. Odczyt metadanych arkusza (tytuł, pierwszy arkusz) i wiersza nagłówków `A1:ZZ1`.
  4. Dopasowanie kolumn po znormalizowanych nagłówkach (NFKD, lower, non-alnum → spacja) do `SHEET_FIELDS` (23 pola, aliasy polskie).
  5. Przy pustym arkuszu zapis najpierw domyślnych nagłówków (`PUT` na `A1`, `USER_ENTERED`).
  6. Dopisanie wiersza karty: `POST .../values/{Arkusz}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`.
  7. Odpowiedź: `{ ok, message }` z zaktualizowanym zakresem lub czytelny błąd (brak pliku, brak dostępu, nie-sheet).

**Mapowanie pól karty na kolumny arkusza (`SHEET_FIELDS`):**

| Klucz | Domyślna etykieta | Aliasy |
|---|---|---|
| `meta.zapisano` | Zapisano | timestamp, data zapisu |
| `activity.number` | Numer | nr, nr zbiorki |
| `activity.title` | Tytuł / Temat | tytul zbiorki, temat, nazwa, nazwa zbiorki |
| `activity.date` | Data i godzina | data zbiorki, kiedy, termin |
| `activity.attendance` | Obecność | frekwencja, liczba osob |
| `activity.goal` | Cel | cel zbiorki |
| `activity.experiment` | Eksperyment | doswiadczenie |
| `activity.result` | Wynik | rezultat |
| `activity.scouts` | Obserwacje | spostrzezenia |
| `activity.reflection` | Refleksja | podsumowanie |
| `activity.goalEval` | Czy cel osiągnięty | ocena celu |
| `activity.strongestProof` | Najsilniejszy dowód | dowod, najlepszy dowod |
| `activity.whatHappened` | Co się wydarzyło | co sie wydarzylo, wydarzenia, przebieg |
| `activity.trial` | Próba | obserwacja proby |
| `activity.takeaway` | Wniosek | wnioski, lekcja |
| `activity.nextStep` | Następny krok | kolejny krok, nastepne dzialanie |
| `problem.statement` | Problem | problem zbiorki |
| `problem.hypothesis` | Hipoteza | hipoteza przyczyny |
| `problem.test` | Test | test eksperymentu, co zmieniamy |
| `problem.expectation` | Oczekiwanie | czego sie spodziewamy |
| `problem.hypothesisEval` | Ocena hipotezy | weryfikacja, czy hipoteza sie potwierdzila |
| `problem.conclusion` | Wniosek eksperymentu | konkluzja |
| `problem.decision` | Decyzja | decyzja eksperymentu |

## 6. Proxy katalogów i cache

- `CATALOG_PROXIES` w `google-handler.ts`: kluczowane kanonicznym URL upstreamu z posortowanymi parametrami (równoważne filtry współdzielą wpis).
- **activities:** `https://zabawy.kompaszbiorek.pl/api/activities`, świeżość 1 h, grace 6 h; klucze query: `category` (multiselect), `level`, `energy`, `participants`.
- **skills:** `https://sprawnosci.kompaszbiorek.pl/`, świeżość 6 h, grace 24 h; klucze query: `poziom`, `aspekt`.
- Dwuwarstwowy cache: Cloudflare `caches.default` (Worker) + IndexedDB po stronie widgetu (`kompas-catalog-v1`). Wewnętrzny `max-age` = fresh + grace; świeżość oceniana po `X-Cached-At`.
- W oknie grace przy awarii upstreamu zwracany jest ostatni wpis; bez wpisu — jawny JSON 502 („Katalog jest chwilowo niedostępny").
- Cache nie synchronizuje się między urządzeniami.

## 7. Cache HTTP assetów

- Build (`web/scripts/build-static.mjs`) dzieli widget na wersjonowane assety: `web/dist/assets/kompas-<sha256:12>.css|js`; `web/dist/index.html` jest lekką skorupą (1096 B) z względnymi URL-ami `/assets/...`.
- `cloudflare-worker/build-worker.mjs` osadza w Workerze mapę `STATIC_ASSETS` (body, `content-type`, `etag`), przepisuje URL-e assetów na absolutne `https://wtyczka.kompaszbiorek.pl/assets/...` (wymóg MCP `ui://`) i dodaje handler `serveStaticAsset()`.
- Nagłówki produkcji: `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"` (304 przy `If-None-Match`), `x-content-type-options: nosniff`, `access-control-allow-origin: *`.
- HTML (`/ui`, `/panel/*`) pozostaje `no-store` (zawiera konfigurację OAuth i tokeny wstrzykiwane przez `injectWidgetAuth`).
- Aktualne assety produkcyjne: `kompas-30a4ffa56cc5.css` (134 933 B), `kompas-77a1fa798138.js` (935 959 B).

## 8. Widget i wstrzykiwanie konfiguracji

- `injectWidgetAuth(html, { authenticated, appId, templateFileId, developerKey, sheetsTemplateFileId })` wstrzykuje `__KOMPAS_OAUTH__` (JSON) przed `</head>`; bez poprawnego JSON tokenu widget działa w trybie nieuwierzytelnionym.
- `getGoogleAppId(env)` — id aplikacji Google (z `GOOGLE_CLOUD_PROJECT_NUMBER`) używane przez Picker.
- `TEMPLATE_FILE_ID` (Google Docs) jest przekazywany do widgetu, ale tryby Docs (TRYB 1/2) zostały usunięte z interfejsu — zmienna nie jest używana w widokach. Arkusz tworzony jest z `SHEETS_TEMPLATE_FILE_ID`.
- Serwer MCP (lokalny podgląd) serwuje `web/dist/index.html` jako zasób `ui://kompas-zbiorek/workspace.html` z `_meta.ui.prefersBorder: false`.

## 9. Bezpieczeństwo

- Google access token nigdy nie jest tokenem MCP; ChatGPT otrzymuje wyłącznie tokeny wydane przez Worker.
- Walidacja stanu OAuth (`validateOAuthState`), CSRF przy akceptacji zgody, cookie `__Host-` z HMAC i sanitize URL (`sanitizeUrl`).
- Sesje panelu: losowe tokeny HMAC, TTL 30 dni, czyszczenie przy logout.
- Treści HTML renderowane przez `sanitizeText`; nagłówki `nosniff` i `no-store` dla stron OAuth.
- Proxy katalogów: tylko GET, lista dozwolonych kluczy query (bez passthrough), brak cookie/poświadczeń do upstreamu.

## 10. Wdrożenie

Kolejność (stała, w `kompas-ui-plugin`):

1. `npm run build` (build widgetu + assety),
2. `cd cloudflare-worker && node build-worker.mjs` (generuje `worker.js` z `STATIC_ASSETS`), `npx tsc --noEmit`,
3. `npx wrangler deploy --dry-run` (walidacja),
4. `npx wrangler deploy --keep-vars` (wrangler lokalny, devDependency).

Wdrożenie panelu pod `panel.kompaszbiorek.pl` używa osobnego configu (`wrangler.panel.jsonc`, Worker `panel-kompaszbiorek`, custom domain, to samo KV `OAUTH_KV` i vars). Ten sam `worker.js` obsługuje obie domeny; routing hostowy w `google-handler.ts` kieruje root subdomeny `/` → `/panel`, a na `wtyczka.kompaszbiorek.pl` pozostaje `/ui`. Sekrety OAuth na `panel-kompaszbiorek` ustawia się przez `npx wrangler secret put <NAZWA> --config wrangler.panel.jsonc`.

**Zmienne środowiskowe (vars):** `OAUTH_KV` = `2a0acb7d28e249a989ca9ca8ffeca24e`, `TEMPLATE_FILE_ID` = `183nDdy9kE_DxfoLwPhhAlkboey66QI1QzM64UBXrTLI`, `SHEETS_TEMPLATE_FILE_ID` = `13jV1YPEh8G2-e7xKH3lsTxu9gY0ckvveaYQxxc6rzFs`, `GOOGLE_CLOUD_PROJECT_NUMBER` = `450955230972`.

**Sekrety (wrangler secret put):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`.

Po wdrożeniu: adres produkcyjny + ID wersji z Wranglera.

## 11. Testy

- `npm run test:all` w `kompas-ui-plugin`: build + Playwright (projekty desktop i mobile 390×844, axe WCAG A/AA 2.1+2.2, screenshoty `e2e/visual.spec.ts`, cache) + Lighthouse.
- Stan: **92/92 testów Playwright zielonych** (w tym 14 testów panelu × desktop + mobile; cache.spec.ts; visual bez regresji).
- Lighthouse: progi `lighthouserc.json` (accessibility ≥0.9, best-practices ≥0.9 jako error; performance ≥0.5 warn); w tym środowisku LHCI potrafi kończyć się `EPERM` przy sprzątaniu katalogu `lighthouse.*` (ograniczenie Windows; audyty wykonują się poprawnie, progi nie zmieniane).
- Weryfikacja produkcji po wdrożeniu: `/ui` zawiera `__KOMPAS_OAUTH__`; `/assets/*` zwraca `immutable` + ETag i 304 dla poprawnego `If-None-Match`; `/panel` → 302 `/panel/login`; `/panel/save` bez sesji → 401; URL logowania panelu zawiera wyłącznie `openid email profile drive.file`, nie zawiera `spreadsheets` ani `drive.readonly` (od 19.08.2026; wersje Workerów: `wtyczka-rr` `32664e07-200f-469f-bf16-331684a8e905`, `panel-kompaszbiorek` `03e4638b-845a-4db8-8a1a-ba44acb61a9f`).
