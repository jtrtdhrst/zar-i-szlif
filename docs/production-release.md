# Produkcyjny release

## Kanon

Produkcja jest wydawana wyłącznie z `main` na `panel.kompaszbiorek.pl` przez
`.github/workflows/ci.yml`. Gałęzie `KOMAA-*` bazują na `main` i trafiają do
produkcji dopiero po scaleniu. `alpha`, `beta` i `develop` nie są ścieżkami
release ani deployu; ich ewentualne zdalne istnienie nie jest zmieniane przez
ten workflow.

## Artefakt i bramki

Workflow wykonuje kanoniczny `npm run validate:code` (lint, typecheck i testy),
następnie build. Sprawdza wygenerowane `app/web/dist/index.html` oraz
`app/cloudflare-worker/worker.js`, publikuje je jako artefakt workflow i wykonuje
`wrangler deploy --dry-run` z `wrangler.panel.jsonc`. Tylko push do
`refs/heads/main` może przejść do realnego deployu; workflow ma ten warunek
zarówno w jobie, jak i w kroku shellowym.

Każdy checkout repo po `npm ci` automatycznie ustawia `core.hooksPath=.githooks`.
Hook `.githooks/pre-push` uruchamia `npm run validate:vercel` i blokuje push,
jeśli nie przejdą lint/typecheck/test albo lokalny build Vercela.

`npm run validate:vercel` używa przypiętej wersji Vercel CLI, wykonuje
`vercel pull --environment=preview`, a następnie `vercel build`. Jeśli checkout
nie ma `.vercel/project.json`, wymagane są `VERCEL_ORG_ID` i
`VERCEL_PROJECT_ID`; `VERCEL_TOKEN` powinien być dostarczony w środowiskach
nieinteraktywnych. Gate celowo nie wykonuje automatycznego linkowania do
nieznanego projektu.

Realny deploy wymaga sekretów `CLOUDFLARE_API_TOKEN` i
`CLOUDFLARE_ACCOUNT_ID` w środowisku GitHub `production`. Ten dokument i
workflow nie wykonują deployu produkcyjnego lokalnie.

## Wymagane zmienne środowiskowe Wtyczki / MCP

Wtyczka / MCP (`app/plugin/`) wymaga w produkcji `PLUGIN_PUBLIC_ORIGIN` —
kanonicznego originu w formacie `https://<host>` (bez ścieżki, query i
credentials). Bez niej `/.well-known/oauth-protected-resource` zwraca `400`, bo
serwer odrzuca `Host` i poprawnie nie odbicia go w metadanych; z błędnym
formatem serwer w ogóle nie wstaje (asert przy starcie). Kontrakt zmiennych,
wraz z `QDRANT_URL` / `QDRANT_API_KEY` / `EMBEDDING_ALLOW_LEXICAL`, oraz
zachowanie przy każdej kombinacji: `app/README.md`, sekcja „Zmienne
środowiskowe Wtyczki / MCP”, i `.env.example` w root repo.

## FlutterFlow / generated upstream

Aktualne repo nie zawiera tracked źródeł FlutterFlow ani katalogu FlutterFlow.
Jeśli upstream zostanie podłączony, jego output jest kodem generated/upstream:
agenci nie edytują go ręcznie; zmiany powstają w źródle upstream i są
importowane w osobnym, jawnie zleconym kroku. Obecny workflow nie dodaje
pozornego guardraila dla nieistniejącego katalogu.

## Bezpieczny dry-run lokalny

Walidacja kodu:

```bash
npm ci
npm run validate:code
npm run build
cd app/cloudflare-worker
npx wrangler deploy --dry-run --config wrangler.panel.jsonc
```

Walidacja zgodności z Vercel przed pushem:

```bash
# W CI/agentach ustaw:
# VERCEL_TOKEN
# VERCEL_ORG_ID
# VERCEL_PROJECT_ID

npm run validate:vercel
```
