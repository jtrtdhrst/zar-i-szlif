---
name: advanced-ui
description: Zadaniowy audyt i implementacja UI Kompas Zbiórek. Używaj przy iteracyjnych zmianach widoku, komponentu, breakpointu, interakcji, dostępności lub brandingu. Domyślnie pracuje na najwęższym zakresie i nie udaje nieistniejącego E2E/Lighthouse gate.
---

# Advanced UI

## Zakres

Pracuj wyłącznie na widoku, komponencie lub zachowaniu wskazanym w tasku/diffie. Nie rozszerzaj automatycznie pracy na pełny audyt aplikacji, SEO, wszystkie breakpointy ani niezmienione podstrony.

Jeżeli zakres nie jest wprost podany, przyjmij najwęższy bezpieczny zakres wynikający z bieżącej zmiany.

## Kanoniczne źródła

- Runtime UI: `app/web/`.
- Główny render: `app/web/src/static-app-v2.js`.
- Style: `app/web/src/styles.css`, `app/web/src/extended.css`.
- Dokumentacja runtime: `app/documentation.md`.
- Skrócony brand system: `dev/design-system/BRAND-DESIGN-SYSTEM-COMPRESSED.md`.
- Pełny brand system: `dev/design-system/BRAND-DESIGN-SYSTEM.md`.
- Tokeny: `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css`.
- Registry UI: `registry/`, `registry.json`.

Nie używaj `archive/` jako CURRENT i nie kopiuj UI ze starego snapshotu/brancha bez potwierdzenia.

## Iteracja — domyślna

1. Potwierdź, że zmiana dotyczy `app/web/` albo jawnie wskazanego elementu `dev/design-system/`.
2. Sprawdź istniejący `@kompas` registry przed stworzeniem nowego reusable UI.
3. Zbadaj tylko dotknięty DOM/CSS i przepływ użytkownika.
4. Dla mobile użyj reprezentatywnie 390×844; dla desktop 1280×900; sprawdź oba tylko gdy zmiana może wpływać na oba.
5. Wprowadź najmniejszą kompletną poprawkę.
6. Z `app/` uruchom `npm run build`, `npm run typecheck` oraz właściwy istniejący targeted test. `npm run test:all` jest dozwolonym skrótem obecnego tracked gate.
7. Dla realnego browser acceptance użyj task-scoped Playwright/browser tool, jeśli acceptance tego wymaga.

## Aktualny test contract

- Repo nie zawiera obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`.
- Nie raportuj Playwright, axe ani Lighthouse PASS bez rzeczywistego uruchomienia odpowiedniego narzędzia/testu.
- Brak repo-tracked suite nie oznacza, że UI można uznać za poprawne wizualnie; niezależną walidację browserową prowadzi UI QA.
- Nie twórz ad hoc fałszywego testu tylko po to, aby zamknąć acceptance.

## Reguły UI

- Hierarchia informacji > dekoracja.
- Główne działanie ma być najbardziej widoczne i łatwe do kliknięcia.
- Minimum touch target: 44×44 px.
- Bez poziomego scrolla na mobile.
- Nie dodawaj dekoracji sprzecznych z kanonicznym brand systemem.
- Nie zmieniaj struktury produktu, jeśli task dotyczy wyłącznie warstwy wizualnej.
- Nie promuj logiki biznesowej aplikacji do registry/design systemu.

## Release

Pełny release/deploy wykonuj tylko na jawne zlecenie. Dla Cloudflare:

1. `npm run build` w `app/`.
2. `node build-worker.mjs` w `app/cloudflare-worker/`.
3. `npx wrangler deploy --dry-run`.
4. `npx wrangler deploy --keep-vars` tylko przy autoryzowanym deployu.

Nie oznaczaj zmiany jako wdrożonej bez dowodu deployu.

## Raport

Raportuj krótko: zakres, zmienione pliki, wykonane testy/viewporty, wynik browser validation, świadomie pominięte obszary oraz status deployu.
