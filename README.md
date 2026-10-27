# Żar i Szlif — MCP i infrastruktura

Repozytorium źródeł serwerów MCP, adapterów, narzędzi developerskich, automatyzacji GitHub i self-hosted Plasmic.

**Aplikacji WWW nie ma na gałęzi `main` tego repo.** Jej poprzedni kod został przeniesiony do prywatnego [kompaszbiorek-archiwum](https://github.com/miloszspyrka-code/kompaszbiorek-archiwum) (katalog `app/`). Samo przeniesienie plików nie przestawia webhooków GitHub ani źródeł wdrożenia w Coolify — to należy potwierdzić na żywo.

## Mapa repozytorium

- `mcp/` — samodzielne serwery MCP: implementacja, obrazy i testy. Zobacz `mcp/README.md`.
- `plasmic/` — źródła i Compose self-hosted Plasmic Studio/WAB. Zobacz `plasmic/SELFHOST.md`; katalog może być zależnością produkcyjnego builda.
- `ops/` — infrastruktura i design stack.
- `dev/` — narzędzia developerskie i design system.
- `.paperclip-wiki/` — mirror wiedzy Paperclip (nie dowód bieżącego stanu produkcji).
- `scripts/`, `tests/`, `.githooks/` i `.github/workflows/` — testy, kontrola Git i workflowy.
- `skills/`, `opencode.json` — kontekst agentów.
- `branding/` — źródła brandingu.

## Minimalna weryfikacja

```sh
npm ci --ignore-scripts
npm run validate:code
```

Testy i preflight poszczególnych MCP wykonuj zgodnie z ich README. Zmiany w repo przechodzą przez PR, CI i niezależne review; produkcyjny deploy i readback są osobnymi etapami.

Instrukcje: [AGENTS.md](AGENTS.md).
