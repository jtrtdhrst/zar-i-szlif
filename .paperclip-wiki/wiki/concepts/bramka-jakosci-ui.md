---
title: Bramka jakości UI — Quality Gate
type: concept
tags: [qa, ui, testy, a11y]
sources: [raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md]
created: 2026-08-20
updated: 2026-08-20
---

# Bramka jakości UI

`npm run test:all` w `kompas-ui-plugin`: Playwright desktop+mobile (390×844), axe WCAG A/AA 2.1+2.2 — `critical`/`serious` blokuje zakończenie zadania (napraw w kodzie, bez nieuzasadnionego `axe.exclude`), screenshoty `e2e/visual.spec.ts` (`test:ui:update` tylko przy zamierzonej zmianie), cache. Lighthouse `lighthouserc.json`: `accessibility ≥0.9` i `best-practices ≥0.9` jako error, `performance ≥0.5` warn; `CHROME_PATH` ustawiany automatycznie przez `test:lighthouse`. Responsywność: oba viewporty obowiązkowe, bez `test.skip` zależnego od viewportu. Inspekcja via Playwright MCP (`opencode.json` → `mcp.playwright`).

