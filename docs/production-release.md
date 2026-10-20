# Produkcyjny release

## Dwa niezależne targety

Repo ma dwa różne targety wdrożeniowe i nie wolno ich łączyć w jeden globalny gate:

1. **Frontend** — statyczny panel z `app/web/dist`, hostowany self-hosted przez Coolify (patrz „Frontend / Coolify (self-hosted)").
2. **Cloudflare Worker** — API/integracje/OAuth z `app/cloudflare-worker/`, wdrażany osobnym workflow GitHub Actions.

Brak poświadczeń Cloudflare nie oznacza, że frontend jest niesprawny lub niewdrażalny.

## Core CI

`.github/workflows/ci.yml` jest deployment-target neutralny. Dla każdego PR/pusha do `main`:

- instaluje zależności;
- wykonuje `npm run validate:code`;
- wykonuje `npm run build`;
- sprawdza wygenerowany frontend i Worker;
- publikuje artefakt buildu.

Core CI nie wymaga `CLOUDFLARE_API_TOKEN` ani `CLOUDFLARE_ACCOUNT_ID` i nie wykonuje deployu Cloudflare.

CI pozostaje źródłem prawdy. Lokalny hook pre-push jest defense-in-depth: może
zablokować push, ale nigdy nie zastępuje `CI` ani target-specific gate'ów.

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

Kanoniczny serwer MCP z logowaniem Google żyje na Cloudflare Workerze, nie na frontendzie self-hosted.
Poniższy zestaw to kontrakt **wdrożony na produkcji** 2026-10-01 (worker
`panel-kompaszbiorek`, kandydat `e3c6ba6`, release run 36789230919 zielony):

- **MCP endpoint:** `https://mcp-kompas.kompaszbiorek.pl/mcp` (Streamable HTTP, bezstanowy)
- **Origin authorization servera:** `https://mcp-kompas.kompaszbiorek.pl` — binding `MCP_PUBLIC_ORIGIN`
- **Google OAuth callback:** `https://mcp-kompas.kompaszbiorek.pl/callback`
- **Custom domain:** `mcp-kompas.kompaszbiorek.pl` jako `custom_domain` tego samego Workera co `panel.kompaszbiorek.pl` (oba w `routes`). `panel.kompaszbiorek.pl` nadal obsługuje `/mcp` dla istniejących klientów, ale w metadanych OAuth reklamowany jest wyłącznie `https://mcp-kompas.kompaszbiorek.pl/mcp`. Rekord DNS dla `custom_domain` tworzy samo `wrangler deploy` — nie ma osobnego kroku DNS.
- Workers.dev jest wyłącznie smoke/preview i nie jest adresem produkcyjnym.

Zweryfikowane na żywo 2026-10-01 i ponownie 2026-10-02 — skrypt poniżej jest
reprodukowalnym dowodem (`node scripts/mcp-oauth-smoke.mjs`, 6/6 PASS; `/health`
200 sprawdzany osobno): `/mcp` bez tokenu 401 + `WWW-Authenticate`, metadane
RFC 9728/8414 spójne, DCR loopback ściśle wiąże `resource` (obcy `resource`
-> 400), DCR fail-closed dla `redirect_uri` spoza allowlisty oraz 302 na
`accounts.google.com` z `redirect_uri=https://mcp-kompas.kompaszbiorek.pl/callback`
— czyli `OAUTH_KV`, `COOKIE_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID` i
`GOOGLE_CLIENT_SECRET` są realnie ustawione w produkcyjnym Workerze. **Nie
potwierdza to jeszcze**: akceptacji `redirect_uri` przez Google oraz bindingów
`QDRANT_URL` / `QDRANT_API_KEY` i tożsamości Supabase — te są widoczne dopiero
po uwierzytelnionym wywołaniu `search_knowledge`, czyli w akceptacji KOMAA-446.

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
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` są niepuste i czy token może
odczytać `Workers Routes` strefy (`scripts/assert-cloudflare-route-access.mjs`,
KOMAA-466) — **nie sprawdza
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

**Frontend nie jest bramką tego MCP.** Brak poświadczeń platformy nie blokuje candidate gate'u brancha ani wdrożenia ani akceptacji MCP — to celowy podział targetów opisany wyżej.

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

## Lokalna bramka jest target-aware

`npm run validate:release` **nie jest** aliasem `validate:frontend`. To dispatcher
`scripts/release-targets.mjs`, który klasyfikuje zmienione ścieżki względem
`origin/main` i uruchamia wyłącznie gate'y właścicielów touched targetów:

| Zmienione ścieżki | Gate |
| --- | --- |
| `app/cloudflare-worker/**` | `validate:worker` |
| `app/web/**`, `ops/coolify/**` | `validate:frontend` |
| `app/plugin/**`, `package.json`, `package-lock.json`, `scripts/**`, `tests/**`, `.githooks/**`, `.github/workflows/**` | oba |
| tylko dokumentacja / non-release | `validate:code` (minimum) |

`app/plugin/**` jest celowo wspólne: `tsc -p plugin/tsconfig.json` wchodzi do
buildu frontendu, a `src/mcp.ts` -> `../../plugin/server.js` do bundla Workera.

Zasady:

- **Fail closed.** Niezklasyfikowana ścieżka blokuje push (`exit 2`) zamiast
  cicho pominąć walidację. Klasyfikujesz ją w `RELEASE_RULES` /
  `NON_RELEASE_RULES` w `scripts/release-targets.mjs`.
- **Prawdziwe commity mają kanoniczną tożsamość.** `scripts/assert-git-identity.mjs`
  odrzuca syntetyczne identity autora/committer (`gate@example.invalid`,
  domeny `example.*` / `.invalid` / `.local`, konta role-only jak
  `Engineer <engineer@paperclip.local>`) — patrz sekcja niżej.
- Brakujący base ref też blokuje — najpierw `git fetch origin main`.
- Gate brudnego working tree nie działa: walidowany content musi być
  pushowanym content.
- **Zwykła ścieżka Cloudflare nie używa `--no-verify`.** Push zmiany
  Workera przechodzi `validate:worker` bez gate'u frontendu; push zmiany
  frontendu przechodzi `validate:frontend` bez `CLOUDFLARE_*`. `--no-verify` nie jest
  normalną ścieżką żadnego z targetów.

Podgląd planu bez uruchamiania gate'ów (używany do smoke):

```bash
node scripts/release-targets.mjs --plan HEAD
```

## Tożsamość autora/commiterów (fail-closed)

Prawdziwa historia repo niesie wyłącznie kanoniczną ludzką tożsamość.
`scripts/assert-git-identity.mjs` odrzuca syntetyczne identity — fixture
`gate@example.invalid`, domeny `example.*` / `.invalid` / `.local` /
`.test`, konta role-only (`gate`, `Engineer`, `CTO (Paperclip)`,
`MCP Engineer`, `Harness Agent`, ... jako nazwa lub local-part adresu).
Wyjątek: committer `GitHub <noreply@github.com>` przy merge-commitach z PR.

Egzekucja na zwykłej ścieżce (ten sam moduł, więc nie mogą się rozejść):

1. `.githooks/pre-commit` — `--check-config` (efektywne `user.name` / `user.email`);
2. `.githooks/pre-push` — obiekty commitów z pushowanego zakresu, **przed**
   gate'em target-aware (czyli przed pushem produkcyjnym);
3. `CI` — `--base/--head` na zakresie PR/pusha, więc `--no-verify` nie jest
   normalną ścieżką, tylko obejściem łapanym serwerowo.

Tożsamości fixture (`gate@example.invalid`, role-only) zostają w izolowanych
tymczasowych repo testowych z lokalnym configiem i nigdy nie mutują
globalnego ani workspace'owego configu gita. Guard tylko odrzuca — nie
przypisuje ani nie naprawia tożsamości; projekcja tożsamości runtime należy
do Harnessa.

## Provenance produkcji

Produkcja (frontend i Cloudflare) wdraża **jeden dokładny zweryfikowany SHA na
`origin/main`**. `scripts/assert-release-provenance.mjs` jest jedynym
fail-closed asercją używaną lokalnie i w CI, więc ścieżki nie mogą się rozejść.
Sprawdza:

- ref == `refs/heads/main` (non-main nigdy nie mutuje produkcji);
- wyrenderowany HEAD == kandydat SHA (artifact provenance);
- SHA jest osiągalny z `origin/main`;
- przy `push` SHA jest tipem `origin/main` (przy `workflow_dispatch` ancestor
  jest dozwolony).

Mutacja produkcyjna z lokalnego, zmiennego checkoutu Paperclip jest
niemożliwa: brak SHA == brak refu.

## Release: branch -> PR -> CI -> main

1. branch z `origin/main`;
2. `validate:release` lokalnie (target-aware);
3. push brancha — **push do `main` jest zablokowany** przez `.githooks/pre-push`;
4. PR + `CI` PASS na tym samym SHA;
5. merge do `main`;
6. target-specific release: `Cloudflare Worker Release` dla Workera,
   auto-deploy Coolify (webhook push) dla frontendu.

`Cloudflare Worker Release` jest zserializowany per repo
(`concurrency: cloudflare-worker-production`, `cancel-in-progress: false`), więc
dwa runy `main` nie race'ują i nie publikują poza kolejnością. Anulowanie
trwającej mutacji produkcyjnej jest wyłączone. Build jest robiony raz, w jobie
`verify-worker`, a `deploy-production` konsumuje ten sam artefakt z tego samego
SHA zamiast przebudowywać z późniejszego stanu workspace.

## Frontend / Coolify (self-hosted)

Frontend jest hostowany **self-hosted przez Coolify**, z `main`. Lokalny checkout
nigdy nie deployuje produkcji; deploy dzieje się po merge do `main` przez
webhook GitHub App, nie z worktree dewelopera.

- Build: `build_pack: dockerfile`, `dockerfile_location: /ops/coolify/Dockerfile`
  (kontekst = root repozytorium) — Node 24, `npm ci --include=dev`,
  `npm --prefix app run build` -> `app/web/dist`.
- Runtime: nginx z `ops/coolify/nginx.conf` — SPA fallback i przekierowanie
  `/panel` na host panelu (Worker).
- Source: GitHub App (`coolify-zar-i-szlif`, zainstalowana **wyłącznie** na tym
  repozytorium). Klon idzie tokenem instalacji, webhook zdarzeń `push`
  zarejestrował App. Deploy key SSH nie jest używany.
- API/OAuth/MCP **pozostają** na Cloudflare Worker — ten target nie przenosi
  backendu.

Gate frontendu to **candidate validation** (`npm run validate:frontend`): sprawdza
kod (`validate:code`), buduje statyczny frontend (`npm --prefix app run build`),
asertuje niepusty `app/web/dist/index.html`, obecność `kompas-logo.png` i zgodność
publish directory z `ops/coolify/Dockerfile`. Zero platformy, zero API, zero
sekretów — ścieżka brancha/PR i hooka pre-push.

`--no-verify` nie jest normalną ścieżką żadnego targetu; zielony push
przechodzi hooka bez niego.

Po pushu/merge status aplikacji Coolify (obraz oznaczony SHA) jest zewnętrznym
sygnałem powodzenia wdrożenia frontendu.

## Cloudflare Worker

Worker ma osobny workflow:

`.github/workflows/cloudflare-worker-release.yml`

Automatycznie uruchamia się wyłącznie po zmianach w:

`app/cloudflare-worker/**`

Może też zostać uruchomiony ręcznie przez `workflow_dispatch`.

Pipeline Workera wykonuje:

1. `npm run validate:worker` + upload artefaktu `cloudflare-worker-<sha>`;
2. fail-closed asercja provenance (`GITHUB_SHA`, `refs/heads/main`);
3. fail-closed check `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`;
4. `wrangler whoami`;
5. produkcyjny `wrangler deploy --keep-vars` na pobranym artefakcie.

Jeśli Cloudflare secrets są brakujące lub nieważne, blokowany jest wyłącznie release Workera. Nie może to zaczerwienić zwykłego frontendowego release.

## Lokalne bramki

Target-aware (domyślna ścieżka pre-push):

```bash
npm ci
npm run validate:release
```

Ręcznie, jeden target:

```bash
npm run validate:frontend          # frontend (candidate: build + artefakty dist)
npm run validate:worker            # Cloudflare Worker
```

Sekretów produkcyjnych nie zapisujemy w repo, issue ani logach.
