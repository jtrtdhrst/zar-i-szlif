# AGENTS.md — Żar i Szlif MCP / infrastruktura

## Repozytorium na gałęzi main

To repo zawiera źródła MCP, self-hosted Plasmic oraz narzędzia infrastrukturalne. Nie zawiera już kodu aplikacji WWW w `app/`. Aktualny `.github/workflows/ci.yml` egzekwuje nieobecność `app/`, `registry/`, `content/`, `supabase/` i `ops/coolify/` na `main`. Nie odtwarzaj tutaj dawnych ścieżek aplikacji.

- `mcp/`: samodzielne serwery i adaptery, każdy z własnymi testami i ścieżką wdrożenia; patrz `mcp/README.md` i README usługi.
- `plasmic/`: self-hosted Plasmic Studio/WAB, vendored upstream, źródła buildów i Compose; patrz `plasmic/SELFHOST.md`. NIE usuwaj bez udowodnienia, że produkcyjny Coolify nie korzysta z tych źródeł.
- `ops/`: konfiguracja infrastruktury i design stack.
- `dev/`: tooling developerski i design system.
- `scripts/`, `tests/`, `.githooks/`: narzędzia kontroli Git i testy; aktywny test root to `npm test`.
- `.github/workflows/`: produkcyjne i weryfikacyjne GitHub Actions; nie usuwaj bez sprawdzenia zależności.
- `skills/`, `opencode.json`: kontekst agenta.
- `.paperclip-wiki/`: mirror instrukcji; nie zastępuje bieżącej dokumentacji upstream ani odczytu żywego Paperclip.
- `branding/`: katalog docelowych źródeł brandingu.

Aplikacja WWW została przeniesiona do osobnego repozytorium opisanego w `README.md`. Repozytorium produktu i konfiguracja produkcji muszą być weryfikowane osobno — obecność kodu lub PR nie dowodzi wdrożenia.

## Realizacja zmian

1. Przeczytaj aktualne `README.md`, `package.json`, README odpowiedniej usługi, właściwą dokumentację upstream i stan rzeczywistego środowiska. Archiwalne opisy `app/**` i starych flow Cloudflare nie są źródłem prawdy dla tego checkoutu.
2. Pracuj na gałęzi utworzonej z aktualnego `main`; nie pushuj bezpośrednio do `main`. Upewnij się, że workspace i base SHA są właściwe.
3. Wykonaj najmniejszą kompletną poprawkę. Weryfikacja root: `npm run validate:code`; dla serwisów także testy/preflight z ich README.
4. Otwórz PR. Dopuszczaj merge dopiero po zielonym właściwym CI i niezależnym review. Sprawdź commit SHA, którego dotyczy review.
5. Sam merge, zielony CI, aktywny run i status issue nie są sukcesem. Produkcyjny sukces wymaga deployu, testu działania, readback i zamknięcia zadania z dowodami.

Nie umieszczaj sekretów w Git. Nie zmieniaj bez polecenia przypisań modeli ani kodu Paperclip Core. Nie wycinaj aktywnych adapterów, hostów i pipeline'ów tylko dlatego, że wyglądają na stare; najpierw potwierdź rzeczywiste powiązania wdrożeniowe.
