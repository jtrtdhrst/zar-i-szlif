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
Cloudflare Worker (panel-kompaszbiorek, kanon https://mcp-kompas.kompaszbiorek.pl)
        ↓  Google OAuth / OpenID Connect (openid email profile)
konto Google użytkownika (identyfikacja przez `sub`)
        ↓
Worker wydaje własny token MCP (scope: kompas.read)
        ↓
ChatGPT wywołuje https://mcp-kompas.kompaszbiorek.pl/mcp
```

Worker pełni jednocześnie rolę OAuth Servera dla klientów MCP (endpointy `/authorize`, `/token`, `/register`) oraz OAuth Clienta względem Google (`/authorize` → Google → `/callback`). Token Google NIE jest tokenem MCP — do `/mcp` trafia wyłącznie token wydany przez Workera.

## Tożsamość i izolacja scope

- Kanonicznym kluczem scope jest **zweryfikowany subject Google (`sub`)** w propsach grantu, nigdy `email`. `src/identity.ts` jest jedynym miejscem, w którym powstaje `userId`, więc izolacja nie ma dwóch ścieżek. Brak `sub` = fail-closed (rzucamy), nie pusty/wspólny scope.
- `userId` to **goły `sub`**, bo tak indexed `payload.user_id` w Qdrant i tak go porównuje `buildAuthFilter` w `app/plugin/knowledge/schema.ts`.
- `tenant` / `workspaceIds` pochodzą wyłącznie z grantu serwerowego. Argumenty klienta nie mogą ich narzucić — `assertNoClientScope` w `app/plugin/knowledge/mcp-tools.ts` odrzuca `tenant`, `userId`, `user_id`, `workspaceIds`, `workspace_id`, `workspaces`.
- Allowlista źródeł `ALLOWED_SOURCES` jest zbudowana na `Object.create(null)`. Na zwykłym obiekcie literału `ALLOWED_SOURCES["__proto__"]` / `["constructor"]` / `["toString"]` zwraca `Object.prototype`, czyli wartość trutą — allowlista przepuszczałaby klucze obiektowe od klienta.
- Nie ma drugiego systemu kont: Supabase/Postgres pozostaje SSOT aplikacji. Dopóki `supabase/` nie ma migracji tabeli auth, kanoniczną tożsamością jest provider-subject — tak samo, jak Supabase Auth wiąże konto Google.

## Narzędzia MCP

Wszystkie narzędzia wiedzy wołają **ten sam rdzeń retrieval** (`app/plugin/knowledge` → `retrieve` → Qdrant `kompas-knowledge-v1`). `src/mcp.ts` nie ma własnej implementacji wyszukiwania.

| Narzędzie | Auth | Wejście | Wyjście |
| --- | --- | --- | --- |
| `search_knowledge` | OAuth 2.1 | `query` (max 500 znaków), opcjonalnie `topK` 1–20, `minScore` 0–1, `sourceIds` | fragmenty z `source_id`/`document_id` i score |
| `get_knowledge_source` | OAuth 2.1 | `source_id` (allowlista V1), `document_id`, `limit` ≤ 50 | pełne chunki dokumentu |
| `search` | OAuth 2.1 | `query`, opcjonalnie `topK`, `minScore`, `sourceIds` | `{ results: [{ id, title, url }] }`, `id` = `<source_id>/<document_id>` |
| `fetch` | OAuth 2.1 | `id` (uchwyt z `search`) | `{ id, title, text, url, metadata }` |
| `pokaz_kompas_zbiorek`, komendy UI, `filtruj_aktywnosci` | bez auth (demo interfejsu) | patrz niżej | `structuredContent` + tekst |

`search` / `fetch` to cienka warstwa zgodności Company Knowledge (ChatGPT deep research) na tym samym rdzeniu — nie duplikują `search_knowledge` / `get_knowledge_source`, tylko zwracają uchwyt dokumentu zamiast fragmentów. `url` pochodzi wyłącznie z `PUBLIC_DOCUMENT_URLS` w `app/plugin/knowledge/pipeline.ts`; dokument bez zweryfikowanego publicznego adresu wraca z `url: ""` (brak cytowania), nigdy z zmyślonym linkiem.

Każde narzędzie wiedzy ma w `_meta.securitySchemes` Bearer OAuth 2.1 z issuer = `MCP_PUBLIC_ORIGIN`, a `annotations.readOnlyHint` / `destructiveHint` / `idempotentHint`. Prywatny wynik bez ważnego tokenu nigdy nie dochodzi do zapytania Qdrant (401 z providera OAuth przed `fetch()` handlera).

## Pliki

- `worker.js` — generowany entrypoint (nie edytować ręcznie; generuje go `build-worker.mjs`);
- `src/oauth.ts` — konfiguracja `OAuthProvider` (endpointy, scopes, metadata resource);
- `src/mcp.ts` — produkcyjny handler MCP: Streamable HTTP bezstanowy, ten sam `createPluginServer` i ten sam rdzeń retrieval co lokalna Wtyczka, fail-closed scope z grantu, walidacja `MCP_PUBLIC_ORIGIN` i ochrona `Host`;
- `src/identity.ts` — jedyne miejsce powstania `userId`/`workspaceIds` retrievalu: zweryfikowany subject Google (nigdy email), fail-closed;
- `src/google-handler.ts` — logowanie Google: `/authorize`, `/callback`, plus publiczne `/health`, `/preview`, `/`; scopes `openid email profile drive.file`;
- `src/widget-auth.ts` — wstrzykiwanie `window.__KOMPAS_OAUTH__` do widgetu (`injectWidgetAuth`, `getGoogleAppId`);
- `src/workers-oauth-utils.ts` — stan OAuth w KV, CSRF, walidacja state (wzorzec Cloudflare `cloudflare/ai` demo `remote-mcp-google-oauth`).

## Zmienne konfiguracyjne (wrangler.jsonc)

- `MCP_PUBLIC_ORIGIN` — **wymagany**. Kanoniczny origin authorization servera (`https://<host>`, bez ścieżki/query/credentials). Trafia verbatim do `resource` w `/.well-known/oauth-protected-resource`, więc walidowany twardo w `src/mcp.ts: canonicalOrigin()`. Pusty lub źle sformatowany = Worker nie wstaje.
- `TEMPLATE_FILE_ID` — ID publicznego szablonu Google Docs używanego w TRYBIE 1 (`183nDdy9kE_DxfoLwPhhAlkboey66QI1QzM64UBXrTLI`); brak wartości = TRYB 1 ukryty w interfejsie.
- `GOOGLE_CLOUD_PROJECT_NUMBER` — numer projektu Google (`setAppId`); fallback: część numeryczna `GOOGLE_CLIENT_ID`.
- `EMBEDDING_ALLOW_LEXICAL` — tylko `1` pozwala zastąpić Workers AI deterministycznym embedderem (nie wolno nim zapisywać wektorów leksykalnych do kolekcji bge-m3).

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

Endpoint produkcyjny: `https://mcp-kompas.kompaszbiorek.pl/mcp` (Worker `panel-kompaszbiorek`; kanon `MCP_PUBLIC_ORIGIN=https://mcp-kompas.kompaszbiorek.pl`). Drugi `custom_domain` tego samego Workera, `panel.kompaszbiorek.pl`, nadal obsługuje `/mcp` (host widgetu), ale w metadanych OAuth reklamowany jest wyłącznie jeden zasób: `https://mcp-kompas.kompaszbiorek.pl/mcp`. Workers.dev służy wyłącznie do smoke, nie jest adresem produkcyjnym.

> **Uwaga — host `mcp.kompaszbiorek.pl` jest zajęty i pozostaje przypisany do aggregatu Paperclip.** Decyzja właściciela hosta (2026-09-30, interakcja `6bdf812b` na KOMAA-447): Wtyczka/MCP dostaje osobną poddomenę `mcp-kompas.kompaszbiorek.pl`. `routes` **nie mogą** wskazywać na `mcp.kompaszbiorek.pl` — `cloudflare-worker-release.yml` wdraża je automatycznie na każdym pushu do `main` dotykającym `app/cloudflare-worker/**`, a `production-preflight` sprawdza tylko obecność poświadczeń Cloudflare, nie własność hosta. Rekord DNS dla `mcp-kompas.kompaszbiorek.pl` tworzy samo `wrangler deploy`. Szczegóły: `docs/production-release.md`.

## Sekrety (Cloudflare Workers Secrets)

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_API_KEY
```

`QDRANT_URL` wskazuje na istniejącą chmurę Qdrant Cloud i kolekcję `kompas-knowledge-v1` — bez niego narzędzia wiedzy zwracają `knowledge backend unavailable` (fail-closed, zero sekretów w kodzie). Embeddingiem jest binding Workers AI (`bge-m3`); `QDRANT_URL` bez bindingu AI i bez `EMBEDDING_ALLOW_LEXICAL=1` nie konstruuje backendu.

Nigdy nie wpisuj sekretów do `src/`, `wrangler.jsonc`, Git ani README.

### Jeden raz ręcznie — klient Google

1. Google Cloud Console → **Google Auth Platform → Clients → Create Client → Web application**.
2. Nazwa: `Kompas Zbiórek`.
3. Authorized redirect URI: `https://mcp-kompas.kompaszbiorek.pl/callback` (`redirect_uri` w `src/google-handler.ts` jest wyprowadzany z hostu requestu, więc ten sam Worker obsługuje też `/callback` na `panel.kompaszbiorek.pl` — dodaj oba URI, jeśli klient jest rejestrowany ręcznie).
4. Authorized JavaScript origins (jeśli wymagane): `https://mcp-kompas.kompaszbiorek.pl`.
5. Consent screen: External, app name `Kompas Zbiórek`, scopes: `openid email profile` oraz `https://www.googleapis.com/auth/drive.file` (tylko te — bez Workspace API, bez `drive`, bez `drive.readonly`). Uwaga: `drive.file` to sensitive scope — bez weryfikacji aplikacji Google liczy 100 logowań.
6. Ustaw wartości: `npx wrangler secret put GOOGLE_CLIENT_ID` i `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
7. Opcjonalnie (podglądy w Google Pickerze): **APIs & Services → Picker API** (i Drive API) włączone, **Credentials → API Key** → `npx wrangler secret put GOOGLE_PICKER_API_KEY`. Numer projektu (`GOOGLE_CLOUD_PROJECT_NUMBER`) jest w nagłówku konsoli Google Cloud.

## Testy po wdrożeniu

```powershell
# TEST A — metadata resource (200 JSON)
curl.exe https://mcp-kompas.kompaszbiorek.pl/.well-known/oauth-protected-resource
# TEST B — niezalogowane /mcp musi zwracać 401 + WWW-Authenticate
curl.exe -X POST https://mcp-kompas.kompaszbiorek.pl/mcp -H "content-type: application/json" -d "{}"
# TEST G — OAuth discovery (authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported)
curl.exe https://mcp-kompas.kompaszbiorek.pl/.well-known/oauth-authorization-server
```

Pełny przepływ (Connect → zgoda → Google → callback → token MCP) zweryfikuj w MCP Inspector:

```powershell
npx @modelcontextprotocol/inspector@latest
```

Połączenie: `https://mcp-kompas.kompaszbiorek.pl/mcp`.

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
