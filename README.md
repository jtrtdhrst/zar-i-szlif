# Żar i Szlif — integracje MCP i infrastruktura

To repozytorium pozostaje przeznaczone dla infrastruktury, niezależnych serwerów MCP, narzędzi developerskich oraz dokumentacji agentów.

**Kod aplikacji został przeniesiony do prywatnego [kompaszbiorek-archiwum](https://github.com/miloszspyrka-code/kompaszbiorek-archiwum)** (katalog `app/`). Zachowano tam także rejestr UI, dane źródłowe RAG, migrację Supabase i konfigurację frontendu Coolify.

## Główne katalogi

- `mcp/`: samodzielne integracje i serwery MCP
- `dev/`: warsztat developerski oraz integracje agentów
- `ops/`: infrastruktura z wyłączeniem wdrożenia frontendu produktu
- `.paperclip-wiki/`: mirror dokumentacji agentów
- `scripts/`: narzędzia operacyjne

Produkcyjne wdrożenia aplikacji wymagają przekierowania GitHub Actions, Coolify oraz odpowiednich webhooków do nowego repozytorium. Usunięcie kodu z tego repozytorium samo tego nie konfiguruje.
