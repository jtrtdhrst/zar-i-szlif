# Produkcyjny release

## Kanon

Produkcja jest wydawana wyłącznie z `main` na `panel.kompaszbiorek.pl` przez
`.github/workflows/ci.yml`. Gałęzie `KOMAA-*` i inne gałęzie robocze bazują na
`main` i trafiają do produkcji dopiero po scaleniu PR. Bezpośredni lokalny push
na `main` jest blokowany przez `.githooks/pre-push`.

## Bramki przed pushem

Każdy checkout repo po `npm ci` automatycznie ustawia
`core.hooksPath=.githooks`. Hook `.githooks/pre-push`:

1. odrzuca bezpośredni push do `refs/heads/main`,
2. uruchamia `npm run validate:release`.

`validate:release` jest wspólną bramką release i obejmuje:

- `validate:vercel`: lint, typecheck, testy oraz build zgodny z konfiguracją Vercel,
- `validate:cloudflare`: produkcyjny build aplikacji i `wrangler deploy --dry-run`
  z `app/cloudflare-worker/wrangler.panel.jsonc`.

Dzięki temu lokalna walidacja nie sprawdza już wyłącznie Vercela, gdy realny
produkcyjny deploy panelu jest wykonywany przez Cloudflare.

## CI i artefakt

Workflow najpierw wykonuje `npm run validate:code`, build oraz sprawdzenie
wygenerowanych artefaktów:

- `app/web/dist/index.html`,
- `app/cloudflare-worker/worker.js`.

Następnie publikuje artefakt workflow i wykonuje
`wrangler deploy --dry-run --config wrangler.panel.jsonc`.

Dry-run sprawdza poprawność bundle/config, ale sam w sobie nie potwierdza
gotowości poświadczeń produkcyjnych. Dlatego realny deploy ma oddzielny job
`production-preflight`.

## Production preflight

Przed uruchomieniem `deploy-production` workflow wymaga, aby środowisko GitHub
`production` udostępniało:

- `CLOUDFLARE_API_TOKEN`,
- `CLOUDFLARE_ACCOUNT_ID`.

`production-preflight` najpierw fail-closed sprawdza, że oba sekrety są
niepuste, a następnie uruchamia `wrangler whoami` z tym samym kontekstem
autoryzacji. Dopiero po PASS job `deploy-production` może wystartować.

To rozdziela trzy różne klasy błędów:

1. błąd kodu/builda — zatrzymany przed pushem lub w pierwszym CI,
2. błąd konfiguracji Cloudflare — zatrzymany przez dry-run,
3. brak/nieważne poświadczenia produkcyjne — zatrzymany w
   `production-preflight`, zanim rozpocznie się deploy.

## Vercel

`npm run validate:vercel` używa przypiętej wersji Vercel CLI, wykonuje
`vercel pull --environment=preview`, a następnie `vercel build`. Jeśli checkout
nie ma `.vercel/project.json`, wymagane są `VERCEL_ORG_ID` i
`VERCEL_PROJECT_ID`; `VERCEL_TOKEN` powinien być dostarczony w środowiskach
nieinteraktywnych. Gate nie wykonuje automatycznego linkowania do nieznanego
projektu.

## Bezpieczny dry-run lokalny

```bash
npm ci
npm run validate:release
```

Do produkcyjnego deployu nadal używane są wyłącznie sekrety środowiska GitHub
`production`; nie należy kopiować tokenu Cloudflare do repo ani do logów.
