---
name: kompas-qa-context
description: Stały kontrakt akceptacji UI dla Kompas Zbiórek — kryteria, WCAG, mobile, evidence FAIL, współpraca z Engineerem. Always-on dla UI QA.
---

# Kompas QA Context

## QA Contract

- Weryfikuj przypisane kryteria akceptacji. Nie przeprojektowuj produktu w trakcie akceptacji.
- Kanoniczne szerokości mobile: **360, 375, 390, 412, 430**; minimum touch target 44×44 px.
- Sprawdzaj: poziome przepełnienie, touch targets, keyboard/focus, kontrast, responsywny layout, regresję zmienionej ścieżki.
- FAIL wymaga: dokładne kryterium, dowód (screenshot/log), severity (P0/P1/P2), repro.
- FAIL → zwróć pracę do Engineer. Nie naprawiaj sam, nie twórz nowego issue bez wyraźnego polecenia.

## Quality gate (projekt)

- `npm run test:all` w `kompas-ui-plugin` (Playwright desktop + mobile 390×844, axe WCAG A/AA 2.1+2.2, screenshoty `e2e/visual.spec.ts`, cache) + Lighthouse (`lighthouserc.json`: accessibility ≥0.9, best-practices ≥0.9 error; performance ≥0.5 warn).
- `npm run test:lighthouse` sam ustawia `CHROME_PATH` (Chromium z `npm run test:install`); nie uruchamiaj LHCI bez `CHROME_PATH`.
- Responsywność nie może być wyciszana `test.skip` zależnym od viewportu; desktop i mobile obowiązkowe w obu projektach Playwright.
- Lighthouse nie zastępuje testów responsywności; konfiguracji progi nie obniżaj bez uzasadnienia.
- Baseline zrzutów (`npm run test:ui:update`) tylko przy zamierzonej zmianie zaakceptowanej przez użytkownika.
- Naruszenia WCAG `critical`/`serious` blokują zakończenie zadania UI; naprawiaj w kodzie, bez nieuzasadnionych `axe.exclude`.
- Inspekcja produkcyjna przez Playwright MCP (`opencode.json` → `mcp.playwright`).
- Weryfikuj kolejność treści: nagłówek → kontekst → działanie → dane robocze.

## Wdrożenie produkcyjne

- Po deployu potwierdź widok produkcyjny (`https://wtyczka.kompaszbiorek.pl/ui` i `https://interfejs.kompaszbiorek.pl/ui`) i brak regresji — desktop i mobile.
- Audyty read-only nie wykonują commitów.