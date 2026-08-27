# Wiki Maintenance Log

## [2026-08-26] contract | Paperclip MCP Wiki read/write path
- added: [[wiki/concepts/paperclip-wiki-mcp]] — narzędzia, read-before-edit, hash caveat, path safety i concurrency
- updated: [[wiki/index]], [[wiki/sources/integracje-mcp]], root `AGENTS.md`
- evidence: live read path, 35 bezpiecznych stron, SHA-256, `WIKI_PATH_FORBIDDEN`, zarejestrowane skille Wiki
- limitation: pełny write-path E2E z zapisem i przywróceniem oryginału pozostaje do osobnej, jawnie autoryzowanej próby

## 2026-08-20 15:25
- Initialized Kompas Zbiórek LLM Wiki root.
- Root: C:\Kompas Zbiórek\.paperclip-wiki
- Required directory structure created.

## [2026-08-20] ingest | WSPÓLNY KONTEKST i konsolidacja wiedzy rozproszonej
- source: raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md, raw/MAPA-SYSTEMU.md, raw/PRD-KOMPAS-ZBIOREK.md, raw/PRD-BAZA-AKTYWNOSCI-RR.md, raw/documentation.md, raw/API-SPRAWNOSCI.md, raw/API-DATA-GODZINA.md, raw/DOKUMENTACJA-INTEGRACJI.md, raw/PROMPT-SYSTEMOWY.md, raw/00-ANALIZA-PROBLEMU.md…raw/06-CYKL-DOSKONALENIA.md, raw/SZABLON-GOOGLE-DOCS.md, raw/OPENCODE-GLOBAL-AGENTS.md
- new pages: [[wiki/sources/wspolny-kontekst]], [[wiki/sources/agents-operacyjny]], [[wiki/sources/prd-kompas]], [[wiki/sources/baza-aktywnosci]], [[wiki/sources/integracje-mcp]], [[wiki/sources/cykl-doskonalenia]], [[wiki/sources/organizacja-paperclip]]
- new pages: [[wiki/concepts/karta-zbiorki]], [[wiki/concepts/cykl-doskonalenia]], [[wiki/concepts/context-first-execution]], [[wiki/concepts/definition-of-done]], [[wiki/concepts/stan-braku-danych]], [[wiki/concepts/brand-dna]], [[wiki/concepts/bramka-jakosci-ui]]
- new pages: [[wiki/entities/repo-map]], [[wiki/entities/worker-wtyczka-rr]], [[wiki/entities/panel-google-sheets]], [[wiki/entities/integracje-api]], [[wiki/entities/paperclip-organizacja]], [[wiki/entities/external-agent-knowledge]]
- new pages: [[wiki/synthesis/single-source-of-truth]], [[wiki/synthesis/invarianty-i-brand]]
- new pages: [[wiki/projects/kompas-zbiorek/index]], [[wiki/projects/kompas-zbiorek/standup]], [[wiki/projects/kompas-zbiorek/decisions]], [[wiki/projects/kompas-zbiorek/history]]
- updated pages: [[wiki/index]] — pełny katalog by category
- notes: Ujednolicono ścieżkę external agents knowledge source (global opencode .config vs repo WSPOLNY_KONTEKST vs .paperclip-context) → durable wiki root C:\Kompas Zbiórek\.paperclip-wiki (plugin paperclipai.plugin-llm-wiki, company 9894e3c2-...). Raw = niemutowalne kopie kanonu, wiki/sources = synteza. Jedna ścieżka dla wszystkich agentów (Paperclip/Opencode/Codex).

## [2026-08-20] refactor | Scalenie .paperclip-context → .paperclip-wiki (jedna lokalizacja)
- source: .paperclip-context/agents/* + shared/*
- new pages: agents/ceo, coo, cto, engineer, designer, ui-qa, cmo (+ shared/PRODUCT|GOVERNANCE|TEAM|DELIVERY) skopiowane do C:\Kompas Zbiórek\.paperclip-wiki\{agents,shared}
- updated: 7 agentów w DB (adapter_config.instructionsRootPath/instructionsFilePath: .paperclip-context\agents\<slug> → .paperclip-wiki\agents\<slug>), C:\Kompas Zbiórek\.paperclip-context → junction → .paperclip-wiki (backup .paperclip-context.backup), wiki/index.md + README-UNIFIED.md
- notes: Jedna fizyczna lokalizacja: baza wiki = C:\Kompas Zbiórek\.paperclip-wiki, agenci = baza + /agents/<nazwa> (np. ...\agents\designer). Stara ścieżka dalej działa via junction.

## [2026-08-20] refactor | Widoczność agentów w panelu wiki + dostęp Engineer do dokumentacji
- source: agents/*/AGENTS.md (7), shared/*
- new pages: [[wiki/entities/agents-ceo]], [[wiki/entities/agents-coo]], [[wiki/entities/agents-cto]], [[wiki/entities/agents-engineer]], [[wiki/entities/agents-designer]], [[wiki/entities/agents-ui-qa]], [[wiki/entities/agents-cmo]]
- updated pages: [[wiki/index]] — sekcja Agents z klikalnymi wikilinkami + doprecyzowanie że Engineer MA DOSTĘP DO DOKUMENTACJI (INSTRUKCJE-BRANDINGU, tokens, API sprawności/bazy, WSPOLNY_KONTEKST); 7× agents/*/AGENTS.md: `C:\Kompas Zbiórek\.paperclip-context\shared` → `\.paperclip-wiki\shared`
- notes: Wszystkie kluczoe rzeczy w 1 miejscu (wiki + agenci + shared) pod C:\Kompas Zbiórek\.paperclip-wiki; po dopisaniu /agents/<nazwa> jako źródło wiedzy agenta. Panel wiki → Shared Spaces → default → wiki/entities/agents-* klikalne.
