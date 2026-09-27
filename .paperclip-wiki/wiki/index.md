# Kompas Zbiórek — Wiki Index

## Sources (znormalizowane źródła z raw/)

- [[wiki/sources/wspolny-kontekst]] — kanon WSPÓLNEGO KONTEKSTU (Project context, REPO MAP, kontrakty)
- [[wiki/sources/agents-operacyjny]] — AGENTS.md + MAPA SYSTEMU (zasady wykonawcze)
- [[wiki/sources/prd-kompas]] — PRD Kompas Zbiórek v1.7 (zakres i karta zbiórki)
- [[wiki/sources/baza-aktywnosci]] — Baza aktywności RR + API sprawności + data/godzina
- [[wiki/sources/integracje-mcp]] — Integracje, MCP, OAuth, produkcja Worker
- [[wiki/sources/cykl-doskonalenia]] — Cykl 00–06 → 4 etapy
- [[wiki/sources/organizacja-paperclip]] — Organizacja Paperclip, agenci, rutyny

## Concepts (pojęcia i kontrakty)

- [[wiki/concepts/karta-zbiorki]] — karta zbiórki jako artefakt
- [[wiki/concepts/cykl-doskonalenia]] — 4 etapy i bramki
- [[wiki/concepts/context-first-execution]] — CONTEXT-FIRST + STARTUP I/O BUDGET
- [[wiki/concepts/definition-of-done]] — DoD write vs blocked
- [[wiki/concepts/stan-braku-danych]] — zasada UX przy braku API
- [[wiki/concepts/brand-dna]] — Brand DNA mapa/topografia
- [[wiki/concepts/bramka-jakosci-ui]] — Quality Gate (Playwright + Lighthouse)
- [[wiki/concepts/paperclip-wiki-mcp]] — read path, proposal/apply i kontrola hash

## Entities (systemy i integracje)

- [[wiki/entities/repo-map]] — kanoniczne lokalizacje (REPO MAP)
- [[wiki/entities/worker-wtyczka-rr]] — Worker `wtyczka-rr` runtime
- [[wiki/entities/panel-google-sheets]] — Panel Google Sheets (trwały stan)
- [[wiki/entities/integracje-api]] — Status integracji zewnętrznych
- [[wiki/entities/paperclip-organizacja]] — Paperclip workspace i agenci
- [[wiki/entities/external-agent-knowledge]] — Ujednolicenie ścieżek wiedzy (external agents vs wiki)

## Synthesis (syntezy cross-cutting)

- [[wiki/synthesis/single-source-of-truth]] — synteza rozproszenia → single source
- [[wiki/synthesis/invarianty-i-brand]] — invarianty techniczne + Brand DNA

## Projects

- [[wiki/projects/kompas-zbiorek/index]] — Kompas Zbiórek (durable knowledge)
- [[wiki/projects/kompas-zbiorek/standup]] — Standup wykonawczy (link z index)
- [[wiki/projects/kompas-zbiorek/decisions]] — Rejestr decyzji
- [[wiki/projects/kompas-zbiorek/history]] — Historia projektowa (skrót)

## Log

- [[wiki/log]]

## Agents (jedna lokalizacja — po dopisaniu /agents/<nazwa> jako źródło wiedzy)

- [[wiki/entities/agents-ceo]] — CEO (`agents/ceo/AGENTS.md` + `SOUL/CONTEXT/TOOLS`) — lazy-load `../../shared/*`
- [[wiki/entities/agents-coo]] — COO
- [[wiki/entities/agents-cto]] — CTO — dodatkowo API sprawności + baza aktywności (v14)
- [[wiki/entities/agents-engineer]] — **Engineer — MA DOSTĘP DO DOKUMENTACJI** (`kompas-ui-design/INSTRUKCJE-BRANDINGU`, `tokens`, `Dokumentacja_API_SPRAWNOSCI`, `PRD_BAZA_AKTYWNOSCI`, `dokumentacja-integracji` + `WSPOLNY_KONTEKST`)
- [[wiki/entities/agents-designer]] — Designer — branding + tokeny + live `https://panel.kompaszbiorek.pl/ui` + `PRD §7.1`
- [[wiki/entities/agents-ui-qa]] — UI QA — `INSTRUKCJE-BRANDINGU` + `qa-acceptance`, `DATA DIAGNOSTIC CONTRACT`
- [[wiki/entities/agents-cmo]] — CMO — `kompas-brand-email`, Sender.net

Wiedza wspólna (lazy-load `../../shared/`): `shared/PRODUCT.md`, `shared/GOVERNANCE.md`, `shared/TEAM.md`, `shared/DELIVERY.md`

Baza: `C:\Kompas Zbiórek\.paperclip-wiki` — wiki (`wiki/`, `raw/`) + agenci (`agents/<nazwa>`). Stara ścieżka `C:\Kompas Zbiórek\.paperclip-context` to junction → `\.paperclip-wiki` (backup w `.paperclip-context.backup`).

## Raw (niemutowalne kopie kanonu)

- `raw/WSPOLNY_KONTEKST.md`, `raw/AGENTS.md`, `raw/MAPA-SYSTEMU.md`, `raw/PRD-KOMPAS-ZBIOREK.md`, `raw/PRD-BAZA-AKTYWNOSCI-RR.md`, `raw/documentation.md`, `raw/API-*.md`, `raw/DOKUMENTACJA-INTEGRACJI.md`, `raw/PROMPT-SYSTEMOWY.md`, `raw/00-*.md`…`06-*.md`, `raw/SZABLON-GOOGLE-DOCS.md`, `raw/OPENCODE-GLOBAL-AGENTS.md`
