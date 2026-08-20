---
title: Kompas Zbiórek — durable knowledge
type: project
tags: [kompas-zbiorek, prd, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/PRD-KOMPAS-ZBIOREK.md, raw/MAPA-SYSTEMU.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-20
---

# Kompas Zbiórek — durable knowledge

## Overview

Kompas Zbiórek = wtyczka ChatGPT + interfejs `https://interfejs.kompaszbiorek.pl` dla liderów Royal Rangers Polska. Metoda SENS→DZIAŁANIE→REFLEKSJA; karta zbiórki samowystarczalna; cykl doskonalenia ~2 tyg. (zob. [[wiki/concepts/karta-zbiorki]], [[wiki/concepts/cykl-doskonalenia]]). Repo `https://github.com/miloszspyrka-code/kompas-zbiorek`. Status standup: [[wiki/projects/kompas-zbiorek/standup]].

## Current direction

Uporządkowany zakres v1.7 (PRD), karta zbiórki jako artefakt roboczy z 6 obszarami, integracje odczytowe (baza aktywności, sprawności v14), data/godzina zablokowana, stopnie planowane. Priorytet: jakość decyzji lidera, nie automat.

## Workstreams

- Karta zbiórki i tabele edytowalne (zob. [[wiki/concepts/karta-zbiorki]])
- Baza aktywności RR + sprawności (zob. [[wiki/sources/baza-aktywnosci]])
- Panel Google Sheets jako trwały stan (zob. [[wiki/entities/panel-google-sheets]])
- Worker `wtyczka-rr` i cache dwuwarstwowy (zob. [[wiki/entities/worker-wtyczka-rr]])
- Design system i Quality Gate (zob. [[wiki/concepts/brand-dna]], [[wiki/concepts/bramka-jakosci-ui]])

## Decisions

- CONTEXT-FIRST + STARTUP I/O BUDGET (zob. [[wiki/concepts/context-first-execution]])
- Definition of Done write vs blocked (zob. [[wiki/concepts/definition-of-done]])
- Stan braku danych zamiast wymyślania (zob. [[wiki/concepts/stan-braku-danych]])
- Single source of truth w WSPOLNY_KONTEKST (zob. [[wiki/synthesis/single-source-of-truth]])

## Open risks / blockers

- Zależność od zewnętrznych API sprawności/bazy — brak = `Brak danych`
- Dwie ścieżki wiedzy (external agents vs wiki) — ujednolicone w [[wiki/entities/external-agent-knowledge]]

## References

- PRD: [[wiki/sources/prd-kompas]]
- WSPÓLNY KONTEKST: [[wiki/sources/wspolny-kontekst]]
- Integracje: [[wiki/sources/integracje-mcp]]
- Repo map: [[wiki/entities/repo-map]]

