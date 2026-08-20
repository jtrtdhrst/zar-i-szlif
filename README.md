# Kompas Zbiórek

**Wtyczka ChatGPT + interfejs dla instruktorów Royal Rangers Polska** — cyfrowy przewodnik drużyny: karta zbiórki jako samowystarczalny artefakt (SENS → DZIAŁANIE → REFLEKSJA), 4-etapowy cykl doskonalenia, sprawności, baza aktywności, Google Sheets jako trwały stan.

> **Punkt 0 development (2026-08-20)** — baseline po scaleniu wiedzy do `\.paperclip-wiki` i przeniesieniu UI na `panel.kompaszbiorek.pl`. Custom GPT (`Prompt systemowy.md`) zarchiwizowany do `archiwum/custom-gpt/` — punkt wyjścia do wtyczki, nie źródło prawdy. Waga plików: im starszy, tym mniej ważny.

## Szybki start

```powershell
# 1. Zależności
npm install
cd kompas-ui-plugin && npm install && cd ..

# 2. Dev — widget lokalnie
npm run build            # kompas-ui-plugin: web + tsc server
npm run dev              # lub: cd kompas-ui-plugin && npm run dev

# 3. Worker lokalnie
cd kompas-ui-plugin/cloudflare-worker
npx wrangler dev --port 8788

# 4. Testy + Lighthouse
cd kompas-ui-plugin
npm run test:all          # Playwright desktop+mobile 390×844, axe WCAG A/AA, Lighthouse (access≥0.9, best-practices≥0.9)
```

## Architektura — jedno miejsce wiedzy

```
C:\Kompas Zbiórek\.paperclip-wiki\     # baza = wiki-root (LLM Wiki) + agenci
├── AGENTS.md / IDEA.md               # schema wiki
├── raw/                               # niemutowalne kopie kanonu (WSPOLNY_KONTEKST, PRD, docs)
├── wiki/                              # trwała wiedza (sources/concepts/entities/synthesis/projects)
│   ├── index.md                       # katalog wszystkiego + Agents
│   └── log.md
├── agents/<slug>/AGENTS.md            # 7 agentów (ceo/coo/cto/engineer/designer/ui-qa/cmo) — po dopisaniu /agents/<nazwa>
└── shared/                            # PRODUCT.md / GOVERNANCE.md / TEAM.md / DELIVERY.md

C:\Kompas Zbiórek\.paperclip-context → junction → .paperclip-wiki  # kompatybilność wsteczna
```

*Po dopisaniu `/agents/<nazwa>` do bazy `C:\Kompas Zbiórek\.paperclip-wiki` dostajesz źródło wiedzy danego agenta.* Wiki panel: `Shared Spaces → default → wiki/entities/agents-*` — każdy agent ma `Required context` z listą źródeł (Engineer ma dostęp do dokumentacji: `INSTRUKCJE-BRANDINGU`, `tokens`, `Dokumentacja_API_SPRAWNOSCI`, `PRD_BAZA_AKTYWNOSCI`).

## Cloudflare — panel jako kanon

| Worker | Domena | Rola |
|---|---|---|
| `panel-kompaszbiorek` | `https://panel.kompaszbiorek.pl` (`/ui` publiczny podgląd bez logowania, `/panel` aplikacja Sheets) | UI kanon |
| `wtyczka-rr` | `https://wtyczka.kompaszbiorek.pl` → `308` → `panel.kompaszbiorek.pl` | MCP/API (`/mcp`, `/api/*`, `/.well-known/*`) — `CANONICAL_ORIGIN=https://panel.kompaszbiorek.pl` |

Domeny bez zmian, tylko `wtyczka/*/ui` przeniesione na `panel`. Google Cloud (projekt `450955230972`): Authorized redirect URIs `https://panel.kompaszbiorek.pl/panel/callback` + `https://panel.kompaszbiorek.pl/callback` (zostaw `wtyczka` do wygaszenia), MCP URL w ChatGPT: `https://panel.kompaszbiorek.pl/mcp`.

Deploy (kolejność stała, lokalny `wrangler`):
```powershell
npm run build                         # kompas-ui-plugin
node .\cloudflare-worker\build-worker.mjs
npx wrangler deploy --dry-run
npx wrangler deploy --keep-vars                 # wtyczka-rr
npx wrangler deploy --keep-vars --config wrangler.panel.jsonc  # panel-kompaszbiorek
```

D1 `baza-zabaw`/`kompas-zbiorek-oauth` puste (0 tabel) — OAuth via `OAUTH_KV` (`2a0acb7d28e249a989ca9ca8ffeca24e`). Stare workery `kompas-zbiorek` + `ancient|miloszspyrka` do `wrangler delete`.

## Branche i synchronizacja

* `main` — punkt 0 baseline (ten README, `archiwum/`, scalony `\.paperclip-wiki`)
* Feature branche `KOMAA-*` — 1 branch = 1 deliverable, `isolated_workspace` + `git_worktree` (`.paperclip-worktrees/`), `baseRef=main`, push + SHA + `paperclipUpdateIssue`
* Stare remote `KOMAA-24..74` — zarchiwizowane lokalnie, do usunięcia po merge `KOMAA-80` (bramki 02-03-04-Decyzja)

```powershell
git branch --show-current; git status --short   # minimalny preflight (CONTEXT-FIRST)
git fetch --prune
git checkout main; git merge KOMAA-80-bramki-etapow-02-03-04-decyzja --no-ff
git push origin main
```

## Komendy i sposób pracy agentów

* **CEO** (`kompas-governance`) — strategia, `NEW ISSUE GATE` (nowy issue = deliverable), retro `ceo-retro`
* **COO** (`issue-triage`, `kompas-team-map`) — triage, jeden owner/zakres, `BLOCKER/OWNER/ACTION`
* **CTO** (`kompas-technical-context`) — preflight architektoniczny, walidacja `GET /api/activities|skills`
* **Engineer** (`kompas-technical-context`) — implementacja `kompas-ui-plugin/web`, `playwright` only, czyta `WSPOLNY_KONTEKST` + `PRD` + API docs przed kodem
* **Designer** (`kompas-design-context`) — `kompas-rrp` tokens, live `panel.kompaszbiorek.pl/ui`
* **UI QA** (`kompas-qa-context`) — `npm run test:all`, `critical/serious` blokuje, `DATA DIAGNOSTIC CONTRACT`
* **CMO** (`kompas-brand-email`) — Sender.net (`newsletter.kompaszbiorek.pl`)

Po każdej zmianie domen/routingu **zaktualizuj**: `WSPOLNY_KONTEKST.md`, `documentation.md`, `dokumentacja-integracji-kompas-zbiorek.md`, `PLAN-WDROZENIA-PANEL.md`, `kompas-ui-plugin/cloudflare-worker/README.md` i `agents/*/AGENTS.md` — reguła dopisana do `AGENTS.md` każdego agenta.

## Archiwizacja

```
archiwum/
├── custom-gpt/Prompt-systemowy-ARCHIWUM-2026-08-20.md
├── audyty-2026-08/AUDYT-*-ARCHIWUM.md
└── snapshoty-komaa/KOMAA-29-*.json
```

Waga plików: im starszy `LastWriteTime`, tym mniej ważny — nowsze nadpisują starsze. Cron `Garbage Context Cleanup` (COO, `0 4 * * 1` UTC weekly) skanuje `raw/` + root po dacie, archiwizuje do `archiwum/` z datą, czyści `test-results`/`playwright-report`/`*.yml>30d`, odświeża `wiki/index.md`.

## Repo i Cloudflare

Repo: `https://github.com/miloszspyrka-code/kompas-zbiorek` (default `main`), `.gitignore` ignoruje `node_modules/`, `.wrangler/`, `.paperclip-worktrees/`, `test-results/`. Cloudflare Git integration: `panel-kompaszbiorek` build OK (66 req), `wtyczka-rr` ostatni Git build failed (`fix(a11y) KOMAA-58`) — nadpisany `wrangler deploy` (`0054de38`).

## Dokumentacja

* Kanon: `WSPOLNY_KONTEKST.md` (nadrzędny), `PRD_Kompas_Zbiorek.md` v1.7, `MAPA SYSTEMU.md`, `documentation.md`
* API: `Dokumentacja_API_SPRAWNOSCI.md` v14, `PRD_I_DOKUMENTACJA_API_BAZY_AKTYWNOSCI_RR.md`, `Dokumentacja API DATY I GODZINY.md` (zablokowane)
* Wiki: `C:\Kompas Zbiórek\.paperclip-wiki` — `wiki/index.md` kataloguje wszystko
