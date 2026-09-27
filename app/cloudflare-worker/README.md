# Kompas Zbiórek — Cloudflare Worker

Ten folder zawiera samowystarczalną wersję zdalnego serwera MCP. Interfejs Kompasu jest już osadzony w pliku `worker.js`.

Serwer MCP jest chroniony OAuth 2.1 (Authorization Code + PKCE S256) przez bibliotekę `@cloudflare/workers-oauth-provider`. Logowanie odbywa się przez Google OpenID Connect (scopes `openid email profile`) w celu identyfikacji użytkownika oraz udostępnienia Google Pickerowi uprawnienia `https://www.googleapis.com/auth/drive.file` (wybór dokumentu docelowego karty zbiórki). Google nie dostaje innych uprawnień (bez `drive`, bez `drive.readonly`).

## Google Picker w interfejsie

Interfejs (widok „Dokument Google”) umożliwia wybór dokumentu Google Docs, do którego trafi karta zbiórki:

- **TRYB 1 — Szablon Kompasu**: `DocsView().setFileIds(TEMPLATE_FILE_ID).setMimeTypes("application/vnd.google-apps.document")` — Picker pokazuje wyłącznie szablon; przed otwarciem Worker (w widget) sprawdza dostęp przez Drive API `files.get` i pokazuje czytelny błąd, gdy Google odmawia dostępu (401 = sesja wygasła, 403/404 = brak dostępu do szablonu). Zapisuje `fileId`.
- **TRYB 2 — Własny dokument**: `DocsView().setMimeTypes("application/vnd.google-apps.document")` — przegląd własnych dokumentów, bez multiselect. Zapisuje `fileId`, `name`, `mimeType`.

Oba tryby używają wyłącznie scopes `openid email profile https://www.googleapis.com/auth/drive.file` i access tokena Google zalogowanego użytkownika.

### Jak token trafia do widgetu

1. `/callback` zapisuje w propsach grantu: `accessToken` + `accessTokenExpiresAt` (grant odświeżany przy każdym Connect; Google token żyje ~1 h, widget pokazuje komunikat o wygaśnięciu i konieczności ponownego połączenia).
2. `resources/read` dla `ui://kompas-zbiorek/workspace.html` wstrzykuje `window.__KOMPAS_OAUTH__` (accessToken, expiresAt, appId, templateFileId, developerKey) — patrz `src/widget-auth.ts` (`injectWidgetAuth`, `getGoogleAppId`).
3. `/preview` wstrzykuje wersję bez tokena (`authenticated:false`).
4. Widget używa tokenu tylko do Google Picker (`setAppId(project number)`, `setOAuthToken`, `setDeveloperKey` opcjonalnie) i pre-checku `files.get` w TRYBIE 1. Token nigdy nie trafia do modelu (safeUserProps wycina go z odpowiedzi tools/call).

`appId` = numer projektu Google (z `GOOGLE_CLOUD_PROJECT_NUMBER`, fallback: część numeryczna `GOOGLE_CLIENT_ID`).

## Architektura OAuth

```text
ChatGPT / MCP client
        ↓  OAuth 2.1 + PKCE
Cloudflare Worker (panel-kompaszbiorek, kanon https://panel.kompaszbiorek.pl)
        ↓  Google OAuth / OpenID Connect (openid email profile)
konto Google użytkownika (identyfikacja przez `sub`)
        ↓
Worker wydaje własny token MCP (scope: kompas.read)
        ↓
ChatGPT wywołuje https://panel.kompaszbiorek.pl/mcp
```

Worker pełni jednocześnie rolę OAuth Servera dla klientów MCP (endpointy `/authorize`, `/token`, `/register`) oraz OAuth Clienta względem Google (`/authorize` → Google → `/callback`). Token Google NIE jest tokenem MCP — do `/mcp` trafia wyłącznie token wydany przez Workera.

## Pliki

- `worker.js` — generowany entrypoint (nie edytować ręcznie; generuje go `build-worker.mjs`);
- `src/oauth.ts` — konfiguracja `OAuthProvider` (endpointy, scopes, metadata resource);
- `src/google-handler.ts` — logowanie Google: `/authorize`, `/callback`, plus publiczne `/health`, `/preview`, `/`; scopes `openid email profile drive.file`;
- `src/widget-auth.ts` — wstrzykiwanie `window.__KOMPAS_OAUTH__` do widgetu (`injectWidgetAuth`, `getGoogleAppId`);
- `src/workers-oauth-utils.ts` — stan OAuth w KV, CSRF, walidacja state (wzorzec Cloudflare `cloudflare/ai` demo `remote-mcp-google-oauth`).

## Zmienne konfiguracyjne (wrangler.jsonc)

- `TEMPLATE_FILE_ID` — ID publicznego szablonu Google Docs używanego w TRYBIE 1 (`183nDdy9kE_DxfoLwPhhAlkboey66QI1QzM64UBXrTLI`); brak wartości = TRYB 1 ukryty w interfejsie.
- `GOOGLE_CLOUD_PROJECT_NUMBER` — numer projektu Google (`setAppId`); fallback: część numeryczna `GOOGLE_CLIENT_ID`.

Opcjonalny sekret: `GOOGLE_PICKER_API_KEY` (klucz API Google → `setDeveloperKey`, włącza podglądy plików w Pickerze).

## Wdrożenie produkcyjne (kolejność stała)

```powershell
# w katalogu kompas-ui-plugin
npm run build
# w katalogu cloudflare-worker
node build-worker.mjs
npx tsc --noEmit
npx wrangler deploy --keep-vars
```

Endpoint produkcyjny: `https://panel.kompaszbiorek.pl/mcp` (Worker `panel-kompaszbiorek`, kanon; `wtyczka.kompaszbiorek.pl/mcp` → `308` → `panel`, `CANONICAL_ORIGIN=https://panel.kompaszbiorek.pl`).

## Sekrety (Cloudflare Workers Secrets)

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
```

Nigdy nie wpisuj sekretów do `src/`, `wrangler.jsonc`, Git ani README.

### Jeden raz ręcznie — klient Google

1. Google Cloud Console → **Google Auth Platform → Clients → Create Client → Web application**.
2. Nazwa: `Kompas Zbiórek`.
3. Authorized redirect URI: `https://panel.kompaszbiorek.pl/callback`.
4. Authorized JavaScript origins (jeśli wymagane): `https://panel.kompaszbiorek.pl`.
5. Consent screen: External, app name `Kompas Zbiórek`, scopes: `openid email profile` oraz `https://www.googleapis.com/auth/drive.file` (tylko te — bez Workspace API, bez `drive`, bez `drive.readonly`). Uwaga: `drive.file` to sensitive scope — bez weryfikacji aplikacji Google liczy 100 logowań.
6. Ustaw wartości: `npx wrangler secret put GOOGLE_CLIENT_ID` i `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
7. Opcjonalnie (podglądy w Google Pickerze): **APIs & Services → Picker API** (i Drive API) włączone, **Credentials → API Key** → `npx wrangler secret put GOOGLE_PICKER_API_KEY`. Numer projektu (`GOOGLE_CLOUD_PROJECT_NUMBER`) jest w nagłówku konsoli Google Cloud.

## Testy po wdrożeniu

```powershell
# TEST A — metadata resource (200 JSON)
curl.exe https://panel.kompaszbiorek.pl/.well-known/oauth-protected-resource
# TEST B — niezalogowane /mcp musi zwracać 401 + WWW-Authenticate
curl.exe -X POST https://panel.kompaszbiorek.pl/mcp -H "content-type: application/json" -d "{}"
# TEST G — OAuth discovery (authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported)
curl.exe https://panel.kompaszbiorek.pl/.well-known/oauth-authorization-server
```

Pełny przepływ (Connect → zgoda → Google → callback → token MCP) zweryfikuj w MCP Inspector:

```powershell
npx @modelcontextprotocol/inspector@latest
```

Połączenie: `https://panel.kompaszbiorek.pl/mcp`.

## Development lokalny

Utwórz `.dev.vars` (wzór w `.dev.vars.example`) z OSOBNYM klientem Google dla `http://localhost:8788/callback`, potem:

```powershell
npx wrangler dev --port 8788
```

## Gdy zmieniasz UI

## Komendy w ChatGPT

Po ponownym wdrożeniu Worker udostępnia też narzędzia odpowiadające komendom:

- `/cofnij` — cofa do poprzedniego etapu w prototypie;
- `/aktualizuj-kontekst` — otwiera kontekst drużyny;
- `/poprzedni-etap` i `/następny-etap` — przesuwają etap cyklu;
- `/filtruj-aktywności` — otwiera filtry czasu, liczby osób, grupy wiekowej i aspektu.

Instrukcja routingu dla modelu znajduje się w `skills/kompas-komendy/SKILL.md`.

## Dokumenty prawne

Workery dokumentów prawnych znajdują się w podfolderach `dokumenty-prawne/`:

- `polityka-prywatnosci/` — polityka prywatności pod adresem `https://polityka.prywatności.kompaszbiorek.pl/` (IDN, punycode: `polityka.xn--prywatnoci-c8b.kompaszbiorek.pl`);
- `warunki-korzystania/` — warunki korzystania pod adresem `https://warunki.korzystania.kompaszbiorek.pl/`;
- `strona-pomocy/` — strona pomocy (Support URL aplikacji) pod adresem `https://pomoc.kompaszbiorek.pl/`.

Każdy folder jest samodzielnym Workerem. Wdrożenie: `wrangler deploy` w danym podfolderze.

Obie strony prawne używają brandingu Kompas Zbiórek 1:1 z `baza-zabaw` (tokeny forest/paper/red/gold, fonty Noto Sans, sticky header z logo `assets/logo.png`), logo prowadzi do `https://kompaszbiorek.pl/`, a `logo.png` jest też faviconem strony. W stopce strony brandują się własnym lockupem i linkują do siebie nawzajem (bez linku kontaktowego). Strona pomocy używa tego samego brandingu i stopki (linki: strona główna, polityka prywatności, warunki korzystania).

Stare wersje stron na domenie `miloszspyrka.pl` (`kompas-polityka-prywatnosci.miloszspyrka.pl` i `kompas-warunki-korzystania.miloszspyrka.pl`) pozostają aktywne i nie są zastępowane przez wtyczkę.
