---
title: External agents knowledge source — ujednolicenie ścieżek
type: entity
tags: [knowledge-source, agents, wiki, governance]
sources: [raw/OPENCODE-GLOBAL-AGENTS.md, raw/WSPOLNY_KONTEKST.md]
created: 2026-08-20
updated: 2026-08-20
---

# External agents knowledge source — ujednolicenie

**Problem**: wiedza rozproszona między `C:\Kompas Zbiórek\WSPOLNY_KONTEKST.md` (kanon repo), `C:\Users\milos\.config\opencode\AGENTS.md` (global opencode), `C:\Kompas Zbiórek\AGENTS.md`, `.paperclip-context/`, a wiki `C:\Kompas Zbiórek\.paperclip-wiki`.

**Rozstrzygnięcie**:

1. **Single source of truth**: `raw/WSPOLNY_KONTEKST.md` w repo + jego synteza w `wiki/sources/wspolny-kontekst.md` i pojęcia w `wiki/concepts/`. To nadrzędne względem sprzecznych źródeł (zasada z WSPOLNY_KONTEKST).
2. **Wiki jako warstwa trwała**: `C:\Kompas Zbiórek\.paperclip-wiki` (plugin `paperclipai.plugin-llm-wiki`, folder `wiki-root` → `C:\Kompas Zbiórek\.paperclip-wiki`) jest durable knowledge layer dla wszystkich agentów (Paperclip, Opencode, Codex). External agents powinni czytać `wiki/index.md` + `wiki/sources/*` + `wiki/concepts/*` zamiast osobnych AGENTS.md.
3. **Konfiguracja**:
   - Paperclip: `plugin_config.settings_json.localFolders.wiki-root.path = C:\Kompas Zbiórek\.paperclip-wiki` (ustawione 2026-08-20).
   - Opencode: `C:\Users\milos\.config\opencode\opencode.jsonc` → `instructions: ["C:\\Users\\milos\\.config\\opencode\\AGENTS.md"]` — pozostawia global minimalny, a projektowy `C:\Kompas Zbiórek\opencode.json` wskazuje na Paperclip MCP. Zalecane: dodać `C:\Kompas Zbiórek\.paperclip-wiki\AGENTS.md` jako `instructions` dla spójności lub symlink `C:\Kompas Zbiórek\.paperclip-wiki\raw\OPENCODE-GLOBAL-AGENTS.md`.
   - `.paperclip-context/` — legacy, traktować jako read-only; kanon przeniesiony do wiki.

**Cytowanie**: źródła w `raw/` są niemutowalne (kopie kanonu), strony w `wiki/` są utrzymywane i cytują `raw/...` i `wiki/sources/...` (zob. [[wiki/sources/wspolny-kontekst]]).

