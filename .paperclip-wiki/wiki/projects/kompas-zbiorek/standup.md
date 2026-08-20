---
title: Kompas Zbiórek — standup (executive)
type: project
tags: [standup, status, kompas-zbiorek]
sources: [raw/WSPOLNY_KONTEKST.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-20
---

# Kompas Zbiórek — standup

## Executive readout

Projekt w fazie realizacji cyklu doskonalenia; trwałe repo i produkcja `wtyczka-rr` ustabilizowane. Wiedza wcześniej rozproszona między repo/AGENTS/global opencode — teraz skonsolidowana w wiki (`raw/` + `wiki/sources|concepts|entities`) i zalinkowana w [[wiki/projects/kompas-zbiorek/index]].

## What changed

- 2026-08-20: Zbudowano `@paperclipai/plugin-workspace-diff` i `@paperclipai/plugin-llm-wiki` (fix Windows `pathToFileURL` dla `--import`), oba `ready`. Wiki-root `C:\Kompas Zbiórek\.paperclip-wiki` skonfigurowany dla `9894e3c2-...` (Kompas Zbiorek). Wypełniono `raw/` 19 źródłami + `wiki/sources` 6 streszczeń, `wiki/concepts` 7 pojęć, `wiki/entities` 6 encji, `wiki/synthesis` 2 syntezy.
- Ujednolicono ścieżkę external agents knowledge source → wiki (zob. [[wiki/entities/external-agent-knowledge]]).

## Decisions

- WSPOLNY_KONTEKST nadrzędny względem sprzecznych źródeł.
- Wiki jako durable layer dla wszystkich agentów (Paperclip/Opencode/Codex).

## Blockers / risks

- Weryfikacja endpointów bazy aktywności i sprawności wymaga testów e2e (zob. [[wiki/entities/integracje-api]]).
- `test:all` i Lighthouse nie były uruchomione w tym runie — do weryfikacji przy zmianach UI.

## Next actions

- Utrzymywać `raw/` jako snapshot kanonu przy każdej zmianie PRD/WSPOLNY_KONTEKST/AGENTS.
- Przy nowych integracjach aktualizować [[wiki/entities/integracje-api]] i [[wiki/sources/baza-aktywnosci]].
- Przegląd trwałości za ~2 tyg. (cykl `06`).

## Links

- Durable: [[wiki/projects/kompas-zbiorek/index]]
- Index: [[wiki/index]]
- Log: [[wiki/log]]

