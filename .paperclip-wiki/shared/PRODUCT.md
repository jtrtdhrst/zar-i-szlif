# Produkt — Kompas Zbiórek

Wtyczka ChatGPT (https://wtyczka.kompaszbiorek.pl/ui) + własny interfejs (https://interfejs.kompaszbiorek.pl) dla liderów Royal Rangers Polska — cyfrowy przewodnik dla drużyny harcerskiej (ZHR/ZHP, instruktorzy, drużynowi). Rdzeń: SENS → DZIAŁANIE → REFLEKSJA. Cykl doskonalenia 4 etapy: **02 Planowanie → 03 Realizacja (aktualny) → 04 Analiza → Decyzja** ~2 tygodnie.

Karta zbiórki to samowystarczalny artefakt: dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja.

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
