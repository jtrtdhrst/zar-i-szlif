---
title: Kompas Zbiórek — decyzje
type: project
tags: [decyzje, adr]
sources: [raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md]
created: 2026-08-20
updated: 2026-08-20
---

# Kompas Zbiórek — decyzje

| Data | Decyzja | Uzasadnienie | Źródło |
|---|---|---|---|
| 2026-08-20 | Single source of truth = WSPOLNY_KONTEKST.md | rozproszenie między repo/AGENTS/global | [[wiki/synthesis/single-source-of-truth]] |
| 2026-08-20 | Wiki `C:\Kompas Zbiórek\.paperclip-wiki` jako durable layer | ujednolicenie external agents knowledge source | [[wiki/entities/external-agent-knowledge]] |
| 2026-08-20 | `isolated_workspace`+`git_worktree` tylko | uniknięcie write do `main` | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-20 | Panel Google Sheets jako trwały stan | brak D1 per-drużyna, arkusz jako źródło | [[wiki/entities/panel-google-sheets]] |
| 2026-08-20 | Worker `wtyczka-rr` jedyny cel deploya | domeny `interfejs.kompaszbiorek.pl` | [[wiki/entities/worker-wtyczka-rr]] |

