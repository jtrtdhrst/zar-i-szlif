# Operacje

- Deploy: obraz z GitHub Actions tagowany SHA (`ghcr.io/.../mcp:<sha>`), na VPS
  `docker compose -f docker-compose.mcp.yml pull && up -d`. Limity: 256 MiB / 0.5 CPU,
  restart unless-stopped, healthchecki, rotacja logów, read-only fs.
- Rollback: zmiana `IMAGE_TAG` na poprzednie SHA + `up -d`.
- `IMAGE_TAG` jest WYMAGANE: compose używa `${IMAGE_TAG:?...}`, więc brak (lub pusta)
  zmienna przerywa deploy zamiast ciągnąć pływający tag `latest`. Wartość = SHA
  commita z `main`, na którym CI zbudował obraz (tag `sha` + `latest`).
  `IMAGE_TAG=<sha>` w `.env` przed `pull && up -d`.
- Oba serwery (`plasmic-mcp`, `opendesign-bridge-mcp`) startują z tego samego obrazu CI
  `ghcr.io/miloszspyrka-code/kompas-zbiorek-opendesign-mcp:<sha>`; serwer wybiera
  `command` w compose. `IMAGE_TAG` = SHA commita z `main`.
- Budowanie lokalne z `/root/design-stack` (checkout bez remote) jest wycofane: ten
  katalog jest poza kontrolą wersji repo, a deploy z niego utrzymywał manifest 18
  narzędzi (`plasmic_import_html`), podczas gdy repo ma 17 (`plasmic_*`).
- Rotacja credentiali: nowy token w `.env` → `up -d` (bez przebudowy).
- Re-auth Plasmic: nowa sesja po restarcie usługi (login przy starcie klienta);
  przy team token wystarczy rotacja tokenu w Studio + `.env`.
- Restart sesji: `docker compose -f docker-compose.mcp.yml restart`.
- Wyłączenie: `docker compose -f docker-compose.mcp.yml stop plasmic-mcp`
  (lub `opendesign-bridge-mcp`).
- Observability: ślad Paperclip issue → run → OpenCode run → MCP request → operacja →
  commit/PR przez istniejące logi OpenCode/Paperclip + `audit.jsonl` (plasmic-mcp,
  design-sync). Bez równoległego systemu.
- Zakaz na VPS: `pnpm dev`, `plasmic watch`, watch mode, dev-serwery — tylko `pull`/`up -d`.
