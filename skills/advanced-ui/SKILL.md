---
name: advanced-ui
description: Szybki, zadaniowy audyt i implementacja UI dla projektu Kompas Zbiórek. Używaj po komendach `/ui`, `/advanced-ui`, „Advanced UI” oraz przy iteracyjnych zmianach widoku, komponentu, breakpointu, interakcji, dostępności lub brandingu, gdy nie jest potrzebny pełny audyt całej aplikacji. Domyślnie pomija SEO, Lighthouse i niezmienione podstrony; uruchamia pełny release gate tylko na żądanie albo przed finalnym zamknięciem zmiany UI.
---

# Advanced UI

## Overview

Wykonuj mały, dowodowy audyt UI ograniczony do tego, co użytkownik zmienił lub zlecił. Nie przeprowadzaj za każdym razem wysokopoziomowego przeglądu wszystkich podstron, pełnego audytu brandingu ani SEO.

## Zasada zakresu

Najpierw ustal zakres z ostatniej prośby, diffu i aktualnej implementacji:

**1. Workflow-Based** (best for sequential processes)
- Works well when there are clear step-by-step procedures
- Example: DOCX skill with "Workflow Decision Tree" -> "Reading" -> "Creating" -> "Editing"
- Structure: ## Overview -> ## Workflow Decision Tree -> ## Step 1 -> ## Step 2...

**2. Task-Based** (best for tool collections)
- Works well when the skill offers different operations/capabilities
- Example: PDF skill with "Quick Start" -> "Merge PDFs" -> "Split PDFs" -> "Extract Text"
- Structure: ## Overview -> ## Quick Start -> ## Task Category 1 -> ## Task Category 2...

**3. Reference/Guidelines** (best for standards or specifications)
- Works well for brand guidelines, coding standards, or requirements
- Example: Brand styling with "Brand Guidelines" -> "Colors" -> "Typography" -> "Features"
- Structure: ## Overview -> ## Guidelines -> ## Specifications -> ## Usage...

**4. Capabilities-Based** (best for integrated systems)
- Works well when the skill provides multiple interrelated features
- Example: Product Management with "Core Capabilities" -> numbered capability list
- Structure: ## Overview -> ## Core Capabilities -> ### 1. Feature -> ### 2. Feature...

Patterns can be mixed and matched as needed. Most skills combine patterns (e.g., start with task-based, add workflow for complex operations).

- widok lub komponent, którego dotyczy zmiana;
- zachowanie/akcja, którą trzeba sprawdzić;
- jeden reprezentatywny breakpoint (desktop albo mobile), a drugi tylko gdy zmiana dotyczy responsywności;
- wymagane dane, kontrakty i istniejące testy dla tego obszaru.

Jeżeli zakres nie jest jasny, przyjmij najwęższy bezpieczny zakres wynikający z diffu. Nie rozszerzaj audytu na SEO, metadane, indeksowanie, Lighthouse ani niezmienione widoki tylko dlatego, że narzędzia je oferują.

## Pamięć projektu bez kosztownego rereadingu

Przed działaniem przeczytaj tylko potrzebne fragmenty:

1. `C:\Kompas Zbiórek\AGENTS.md` — nadrzędne zasady i końcowa bramka jakości.
2. `skills/advanced-ui/references/kompas-ui-context.md` — kanoniczne ścieżki i decyzje projektu.
3. `documentation.md`, `PRD Kompas Zbiórek.md`, `AUDYT-UX-UI.md` lub dokumentację API tylko przez wyszukanie terminów związanych z aktualnym zakresem.

Nie streszczaj całej historii projektu w kontekście. Użyj `rg` dla nazwy widoku, klasy, akcji lub endpointu, a wnioski ogranicz do faktów potrzebnych do tej zmiany.

## Tryb iteracyjny — domyślny

W trybie iteracyjnym:

1. Sprawdź kanoniczny katalog `C:\Kompas Zbiórek\kompas-ui-plugin` i aktualny widok produkcyjny, jeśli zmiana dotyczy wdrożonego UI.
2. Zbadaj tylko dotknięty DOM/CSS i przepływ użytkownika. Przy zmianie mobilnej użyj 390×844; przy desktopowej 1280×900; przy zmianie wspólnej sprawdź oba.
3. Wykonaj targeted test lub pojedynczy test Playwright dotyczący zmiany. Przy zmianie dostępności uruchom axe dla dotkniętego widoku i otwartych modali.
4. Zastosuj najmniejszą poprawkę, sprawdź brak regresji w sąsiednim komponencie i zakończ krótkim wynikiem.

Nie uruchamiaj automatycznie `npm run test:all`, pełnego Lighthouse ani audytu SEO po każdej małej iteracji. Nie usuwaj z aplikacji tytułów, opisów, `lang`, metadanych ani innych elementów produktu SEO — pomijaj jedynie SEO jako kategorię audytu, jeśli nie jest przedmiotem zadania.

## Tryb release

Przełącz się na pełny tryb tylko gdy użytkownik prosi o „pełny audyt”, „release gate”, „sprawdź całość”, SEO/Lighthouse, albo gdy zmiana jest globalna i może dotknąć wszystkie widoki. W tym repozytorium przed uznaniem zmiany UI za ukończoną obowiązują instrukcje `AGENTS.md`:

- `npm run build`;
- `npm run test:all` w `kompas-ui-plugin`;
- inspekcja produkcji przez Playwright MCP na desktopie i 390×844;
- przy zmianie w `kompas-ui-plugin`: build Workera, `node build-worker.mjs`, `npx wrangler deploy --dry-run`, a następnie `npx wrangler deploy --keep-vars` dla Workera `wtyczka-rr`;
- aktualizacja `documentation.md` z funkcją, ograniczeniami, źródłami danych i testami.

SEO nie jest częścią obecnego Lighthouse gate (`lighthouserc.json` zawiera accessibility, best-practices i performance). Dodaj SEO tylko wtedy, gdy użytkownik wyraźnie tego chce lub zmiana dotyczy publicznej strony indeksowanej.

## Raport wyniku

Raportuj wyłącznie zakres, testy i viewporty, poprawki, świadomie pominięte obszary oraz status release/deployment. Nie oznaczaj zmiany jako wdrożonej bez potwierdzonego deployu.

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

**Examples from other skills:**
- PDF skill: `fill_fillable_fields.py`, `extract_form_field_info.py` - utilities for PDF manipulation
- DOCX skill: `document.py`, `utilities.py` - Python modules for document processing

**Appropriate for:** Python scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Codex for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Codex's process and thinking.

**Examples from other skills:**
- Product management: `communication.md`, `context_building.md` - detailed workflow guides
- BigQuery: API reference documentation and query examples
- Finance: Schema documentation, company policies

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Codex should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Codex produces.

**Examples from other skills:**
- Brand styling: PowerPoint template files (.pptx), logo files
- Frontend builder: HTML/React boilerplate project directories
- Typography: Font files (.ttf, .woff2)

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Not every skill requires all three types of resources.**
