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

Kanoniczny serwer MCP z logowaniem Google żyje na Cloudflare Workerze, nie na Vercelu:

- **MCP endpoint:** `https://mcp.kompaszbiorek.pl/mcp` (Streamable HTTP, bezstanowy)
- **Origin authorization servera:** `https://mcp.kompaszbiorek.pl` — binding `MCP_PUBLIC_ORIGIN`
- **Google OAuth callback:** `https://mcp.kompaszbiorek.pl/callback`
- **Custom domain:** `mcp.kompaszbiorek.pl` jako `custom_domain` tego samego Workera co `panel.kompaszbiorek.pl` (oba w `routes`). `panel.kompaszbiorek.pl` nadal obsługuje `/mcp` dla istniejących klientów, ale w metadanych OAuth reklamowany jest wyłącznie `https://mcp.kompaszbiorek.pl/mcp`.
- Workers.dev jest wyłącznie smoke/preview i nie jest adresem produkcyjnym.

**Vercel nie jest bramką tego MCP.** Brak `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` blokuje `validate:vercel` (frontend), ale nie blokuje wdrożenia ani akceptacji MCP — to celowy podział targetów opisany wyżej.

Wymagane sekrety Workera (nazwy bez wartości): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`; opcjonalnie `GOOGLE_PICKER_API_KEY`. Bindingi: `OAUTH_KV` (KV dla `workers-oauth-provider`), `AI` (Workers AI `bge-m3`).

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
