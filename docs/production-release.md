# Produkcyjny release

## Dwa niezależne targety

Repo ma dwa różne targety wdrożeniowe i nie wolno ich łączyć w jeden globalny gate:

1. **Vercel** — frontend/statyczny panel z `app/web/dist`, wdrażany przez integrację Vercel ↔ GitHub według `vercel.json`.
2. **Cloudflare Worker** — API/integracje/OAuth z `app/cloudflare-worker/`, wdrażany osobnym workflow GitHub Actions.

Brak poświadczeń Cloudflare nie oznacza, że frontend Vercel jest niesprawny lub niewdrażalny.

## Core CI

`.github/workflows/ci.yml` jest deployment-target neutralny. Dla każdego PR/pusha do `main`:

- instaluje zależności;
- wykonuje `npm run validate:code`;
- wykonuje `npm run build`;
- sprawdza wygenerowany frontend i Worker;
- publikuje artefakt buildu.

Core CI nie wymaga `CLOUDFLARE_API_TOKEN` ani `CLOUDFLARE_ACCOUNT_ID` i nie wykonuje deployu Cloudflare.

## Wymagane zmienne środowiskowe Wtyczki / MCP

Wtyczka / MCP (`app/plugin/`) wymaga w produkcji `PLUGIN_PUBLIC_ORIGIN` —
kanonicznego originu w formacie `https://<host>` (bez ścieżki, query i
credentials). Bez niej `/.well-known/oauth-protected-resource` zwraca `400`, bo
serwer odrzuca `Host` i poprawnie nie odbicia go w metadanych; z błędnym
formatem serwer w ogóle nie wstaje (asert przy starcie). Kontrakt zmiennych,
wraz z `QDRANT_URL` / `QDRANT_API_KEY` / `EMBEDDING_ALLOW_LEXICAL`, oraz
zachowanie przy każdej kombinacji: `app/README.md`, sekcja „Zmienne
środowiskowe Wtyczki / MCP”, i `.env.example` w root repo.

## Produkcyjny endpoint MCP (Cloudflare)

Kanoniczny serwer MCP z logowaniem Google żyje na Cloudflare Workerze, nie na Vercelu.
Poniższy zestaw to **docelowy** kontrakt — host nie jest jeszcze wolny ani wdrożony,
patrz sekcja niżej:

- **MCP endpoint:** `https://mcp-kompas.kompaszbiorek.pl/mcp` (Streamable HTTP, bezstanowy)
- **Origin authorization servera:** `https://mcp-kompas.kompaszbiorek.pl` — binding `MCP_PUBLIC_ORIGIN`
- **Google OAuth callback:** `https://mcp-kompas.kompaszbiorek.pl/callback`
- **Custom domain:** `mcp-kompas.kompaszbiorek.pl` jako `custom_domain` tego samego Workera co `panel.kompaszbiorek.pl` (oba w `routes`). `panel.kompaszbiorek.pl` nadal obsługuje `/mcp` dla istniejących klientów, ale w metadanych OAuth reklamowany jest wyłącznie `https://mcp-kompas.kompaszbiorek.pl/mcp`. Rekord DNS dla `custom_domain` tworzy samo `wrangler deploy` — nie ma osobnego kroku DNS.
- Workers.dev jest wyłącznie smoke/preview i nie jest adresem produkcyjnym.

### `mcp.kompaszbiorek.pl` jest ZAJĘTY — decyzja właściciela hosta: osobna poddomena

Host nie jest wolny. Stan zweryfikowany na produkcji (2026-09-29, surowe
odpowiedzi): `GET /health` → `200 {"ok":true}`;
`GET /.well-known/oauth-protected-resource` → `200` z
`"resource":"https://mcp.kompaszbiorek.pl/mcp"` i zakresami
`mcp:read mcp:write paperclip:documents:* paperclip:wiki:* offline_access`;
`POST /mcp` bez tokenu → `401` + `WWW-Authenticate`;
`/.well-known/oauth-authorization-server` → `200` z
`registration_endpoint: /oauth/register`. To **działający produkcyjny serwer
MCP z OAuth 2.1 i zarejestrowanymi klientami** (agregat Paperclip), a nie pusty
hostname.

Konsekwencja dla release'u — ścieżka jest w pełni zautomatyzowana i **żadna
bramka tego nie zatrzyma**: `.github/workflows/cloudflare-worker-release.yml`
uruchamia się na każdym pushu do `main` dotykającym `app/cloudflare-worker/**`,
a `deploy-production` wykonuje `wrangler deploy --keep-vars --config
wrangler.panel.jsonc`. `production-preflight` sprawdza tylko, czy
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` są niepuste — **nie sprawdza
własności hosta**. Wdrożenie `routes` z `custom_domain` dla
`mcp.kompaszbiorek.pl` przejmie więc działający endpoint produkcyjny i
przekieruje go na Workera panelowego.

**ROZWIĄZANE (2026-09-30, właściciel hosta odpowiedział na interakcję `6bdf812b`
na KOMAA-447).** Decyzja: `mcp.kompaszbiorek.pl` **zostaje** przypisany do
agregatu Paperclip, a Wtyczka/MCP dostaje **osobną poddomenę**
`mcp-kompas.kompaszbiorek.pl`. Wdrożenie `routes` wskazujących na
`mcp.kompaszbiorek.pl` nadal byłoby przejęciem działającego endpointu i jest
zabronione — `wrangler.jsonc` i `wrangler.panel.jsonc` mają w `routes` wyłącznie
`mcp-kompas.kompaszbiorek.pl` i `panel.kompaszbiorek.pl`. Ścieżka deployu
pozostaje bez zmian: `production-preflight` → `deploy-production` w
`cloudflare-worker-release.yml`.

Host jest w kodzie **wyłącznie konfiguracją**, nie logiką — zmiana hosta po
decyzji to edycja dwóch linii, bez zmian w kodzie:

- `app/cloudflare-worker/wrangler.jsonc` i `wrangler.panel.jsonc`: `routes[].pattern` + `vars.MCP_PUBLIC_ORIGIN`;
- `PLUGIN_PUBLIC_ORIGIN` dla lokalnego stosu Node (`app/plugin/auth.ts`).

**Nie ma żadnego zaszytego defaultu hosta.** `canonicalOrigin()`
(`app/cloudflare-worker/src/mcp.ts`) i `configuredOrigin()`
(`app/plugin/auth.ts`) czytają wyłącznie zmienne środowiskowe i **walidują je
głośnym throwiem**; bez konfiguracji i poza loopbackiem zwracają `null`, czyli
`400`, a nigdy nie odbijają `Host` atakującego. Wzmianki
`https://mcp.kompaszbiorek.pl` w `auth.ts` i `mcp.ts` są wyłącznie
przykładami w komunikatach błędów i komentarzach — nie są źródłem prawdy
o hoście; host pochodzi wyłącznie z `vars.MCP_PUBLIC_ORIGIN` i zmiennych
środowiskowych.

**Vercel nie jest bramką tego MCP.** Brak `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` blokuje `validate:vercel` (frontend), ale nie blokuje wdrożenia ani akceptacji MCP — to celowy podział targetów opisany wyżej.

Wymagane sekrety Workera (nazwy bez wartości): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`; opcjonalnie `GOOGLE_PICKER_API_KEY`. Bindingi: `OAUTH_KV` (KV dla `workers-oauth-provider`), `AI` (Workers AI `bge-m3`).

Wymagane zmienne konfiguracyjne (bez wartości w tym dokumencie, format w
`app/cloudflare-worker/README.md`): `MCP_PUBLIC_ORIGIN` (kanoniczny origin AS) i
`MCP_ALLOWED_REDIRECT_URIS` (allowlist `redirect_uri` dla dynamic client
registration). Druga jest granicą bezpieczeństwa: `POST /register` na produkcyjnym
authorization serverze bez allowlisty przyjmuje klienta z dowolnym
`redirect_uri`, co pozwala przejąć kod autoryzacji — potwierdzone na produkcji
przed fixem (`https://evil.example.com/cb` → `201`). Fail-closed w `src/dcr.ts`;
pusta wartość dopuszcza wyłącznie loopback. Zmiana redirect URI ChatGPT
wymaga dopisania go tutaj, inaczej DCR zwróci `400 invalid_redirect_uri`.

Canonicalny opis protokołu, narzędzi, sekretów i smoke: `app/cloudflare-worker/README.md`.

## Frontend / Vercel

Frontend jest publikowany przez podpiętą integrację Vercel ↔ GitHub.

`vercel.json` definiuje:

- root repozytorium;
- `npm ci`;
- `npm run build`;
- output `app/web/dist`;
- framework = brak / Other.

Lokalny pre-push uruchamia `npm run validate:release`, które jest aliasem frontendowego `validate:vercel`. Ten gate sprawdza kod oraz Vercel-equivalent build; nie wymaga Cloudflare auth.

Po pushu/merge status deploymentu Vercel jest zewnętrznym sygnałem powodzenia wdrożenia frontendu. Jeśli do jednego SHA raportuje kilka projektów Vercel, trzeba ustalić który projekt jest związany z właściwą domeną produkcyjną; nie należy traktować wszystkich jako równoważnych bez potwierdzenia.

## Cloudflare Worker

Worker ma osobny workflow:

`.github/workflows/cloudflare-worker-release.yml`

Automatycznie uruchamia się wyłącznie po zmianach w:

`app/cloudflare-worker/**`

Może też zostać uruchomiony ręcznie przez `workflow_dispatch`.

Pipeline Workera wykonuje:

1. `npm run validate:worker`;
2. fail-closed check `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`;
3. `wrangler whoami`;
4. produkcyjny `wrangler deploy --keep-vars`.

Jeśli Cloudflare secrets są brakujące lub nieważne, blokowany jest wyłącznie release Workera. Nie może to zaczerwienić zwykłego frontendowego Vercel release.

## Lokalne bramki

Frontend:

```bash
npm ci
npm run validate:release
```

Worker:

```bash
npm ci
npm run validate:worker
```

Sekretów produkcyjnych nie zapisujemy w repo, issue ani logach.
