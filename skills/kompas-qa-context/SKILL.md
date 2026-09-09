---
name: kompas-qa-context
description: Stały kontrakt akceptacji UI dla Kompas Zbiórek — kryteria, WCAG, mobile, evidence FAIL i współpraca z Engineerem. Always-on dla UI QA.
---

# Kompas QA Context

## QA Contract

- Weryfikuj przypisane kryteria akceptacji. Nie przeprojektowuj produktu w trakcie akceptacji.
- Runtime aplikacji jest w `app/`; UI w `app/web/`.
- Kanoniczne szerokości mobile: **360, 375, 390, 412, 430**; minimum touch target 44×44 px.
- Sprawdzaj: poziome przepełnienie, touch targets, keyboard/focus, kontrast, responsywny layout i regresję zmienionej ścieżki.
- FAIL wymaga: dokładne kryterium, dowód (screenshot/log), severity (P0/P1/P2), repro.
- FAIL → zwróć pracę do Engineer. Nie naprawiaj sam i nie twórz nowego issue bez wyraźnego polecenia.

## Aktualny quality surface

- `npm run test:all` uruchamiaj w `app/`.
- Obecny repo-tracked `test:all` wykonuje build + typecheck + targeted test logiki `app/web/scripts/skill-completion-task-test.mjs`.
- **Repo nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`.** Nie raportuj Playwright/Lighthouse PASS tylko dlatego, że stare dokumenty je wymieniają.
- Niezależną walidację browser/UI wykonuj task-scoped przez Playwright MCP lub inne jawnie udostępnione narzędzie browserowe, zgodnie z acceptance.
- Jeśli acceptance wymaga konkretnego automatycznego E2E/Lighthouse, którego repo nie zawiera, oznacz ten element jako brak pokrycia zamiast symulować wynik.

## Browser acceptance

- Desktop i mobile sprawdzaj wtedy, gdy zmiana może wpływać na oba breakpointy.
- Dla mobile reprezentatywny viewport to 390×844; przy regresji responsywności rozszerz na kanoniczne szerokości.
- Responsywności nie omijaj warunkowym `skip`.
- WCAG `critical`/`serious` blokuje zakończenie zadania UI, gdy skan dostępności jest częścią acceptance.
- Weryfikuj kolejność treści: nagłówek → kontekst → działanie → dane robocze.
- Baseline/screenshot traktuj jako evidence tylko wtedy, gdy został wykonany na aktualnym runtime/deliverable SHA.

## Wdrożenie produkcyjne

- QA nie wykonuje deployu bez scoped zadania.
- Po deployu weryfikuj aktualny adres produkcyjny wynikający z bieżącej konfiguracji/routingu; nie zakładaj historycznego URL na podstawie starego promptu.
- Audyty read-only nie wykonują commitów.
