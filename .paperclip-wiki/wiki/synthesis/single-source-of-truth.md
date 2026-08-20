---
title: Single source of truth — synteza rozproszenia wiedzy
type: synthesis
tags: [synteza, governance, wiedza]
sources: [raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md, raw/MAPA-SYSTEMU.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-20
---

# Single source of truth

**Przed**: wymagania i kontrakty rozproszone między `WSPOLNY_KONTEKST.md`, `AGENTS.md`, `MAPA SYSTEMU.md`, `PRD`, `documentation.md`, `prompt systemowy`, `00–06`, `SZABLON GOOGLE DOCS`, API docs, opencode global `AGENTS.md`, `.paperclip-context/`, `.paperclip-wiki/` — różne ścieżki dla external agents vs wiki.

**Po**: hierarchia źródeł zapisana w [[wiki/sources/wspolny-kontekst]] i [[wiki/entities/external-agent-knowledge]]: 1) aktualny stan produktu/runtime, 2) decyzje użytkownika, 3) dokumenty kanoniczne (product-as-is/target, prd-coverage, workflow-control) — czyli `raw/WSPOLNY_KONTEKST.md`, `raw/PRD-KOMPAS-ZBIOREK.md`, `raw/MAPA-SYSTEMU.md`, 4) `raw/documentation.md` + implementacja, 5) historia issues.

**Mechanizm**: `raw/` = niemutowalne kopie kanonu (snapshot repo), `wiki/sources/` = znormalizowane streszczenia, `wiki/concepts/` + `wiki/entities/` = trwała wiedza, `wiki/synthesis/` = ten plik. `wiki/index.md` kataloguje, `wiki/log.md` loguje ingest. Agent najpierw czyta `AGENTS.md` w wiki root, potem `wiki/index.md` — nie odtwarza kontekstu szerokim skanem.

**Ryzyko**: historyczna informacja nie może nadpisać nowszego zweryfikowanego stanu; IDE → PRD → implementacja to jedna linia, nie dwie równoległe.

