# Produkt — Kompas Zbiórek (TARGET / MUST-HAVE)

> Ten plik opisuje **cel / wymagania** produktu (TARGET). Stan obecny z dowodem: `shared/STATE.md`. Kontrakt ról: `shared/KONTRAKT-WIEDZY.md`.

Wtyczka ChatGPT (https://wtyczka.kompaszbiorek.pl/ui) + własny interfejs (https://interfejs.kompaszbiorek.pl) dla liderów Royal Rangers Polska — cyfrowy przewodnik dla drużyny harcerskiej (ZHR/ZHP, instruktorzy, drużynowi).

**Docelowy cykl user-facing (TARGET): Planowanie → Realizacja → Refleksja → Doskonalenie.** (Bieżący stan: `STATE.md`; DELTA: [KOMAA-48](/KOMAA/issues/KOMAA-48).)

**Repozytorium:** https://github.com/miloszspyrka-code/kompas-zbiorek
**Workspace Paperclip:** `isolated_workspace` + `git_worktree`, `baseRef = main`, worktree parent `C:\Kompas Zbiórek\.paperclip-worktrees`
**Produkcja:** https://kompaszbiorek.pl, UI https://wtyczka.kompaszbiorek.pl/ui, Worker `wtyczka-rr`, domena docelowa `interfejs.kompaszbiorek.pl`

**Invarianty techniczne (nie zmieniaj bez upoważnienia):**
- MCP endpoint `/mcp`
- Google OAuth scope `drive.file`
- Cloudflare D1
- Struktura domen produkcyjnych
- Brak wdrożenia bez scoped zlecenia
- Brak bezpośredniego write do `main`

**Architektura:**
- Widget `kompas-ui-plugin/web` (`static-app-v2.js`) — render statyczny, dane w `localStorage` (`kompas-zbiorek-draft-v1`)
- Worker `wtyczka-rr` (`kompas-ui-plugin/cloudflare-worker`) — serwuje UI, proxy katalogów (`/api/activities`, `/api/skills`) z cache (Worker `caches.default` + IndexedDB), narzędzie MCP `zapisz_dane_kompasu`
- Serwer MCP `kompas-ui-plugin/server` — most ChatGPT

Cache nie synchronizuje się między urządzeniami. Bez sieci i wpisu w cache — jawny stan braku danych, nigdy wymyślona treść.
