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
