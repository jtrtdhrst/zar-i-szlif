# Audyt zgodności kompas-ui-plugin z PRD 1.1

**Data audytu:** 17.08.2026  
**Zakres:** `kompas-ui-plugin` (widget, serwer MCP i Worker `wtyczka-rr`) wobec `PRD Kompas Zbiórek.md`, wersja 1.1.  
**Metoda:** analiza kodu źródłowego, konfiguracji wdrożenia, testów E2E i bieżącej dokumentacji. Audyt nie potwierdza wdrożenia ani działania zewnętrznych usług.

## Werdykt

**Częściowa zgodność, niegotowe do uznania pełnej zgodności z PRD.**

Widget poprawnie obsługuje znaczną część pracy lokalnej: karty aktywności, problemu, kontekstu i planu rocznego, zadania użytkownika, pięć pytań „dlaczego?”, eksperymenty, próby i podstawową ocenę. Główne rozbieżności dotyczą trwałości danych, kontrolowanego zapisu, katalogu aktywności i docelowej domeny produkcyjnej.

## Dowody zgodności

| Obszar PRD | Status | Dowód |
| --- | --- | --- |
| Samowystarczalna karta aktywności, przygotowanie i plan godzinowy | zgodne częściowo | `web/src/static-app-v2.js`: pola celu, obecności, sprawności, planu, materiałów, przygotowania oraz podsumowania. |
| Karta problemu i praprzyczyna | zgodne częściowo | `problemCardView` renderuje problem, pięć pól „dlaczego?” i hipotezę przyczyny. |
| Eksperymenty, próby, ocena i decyzja | zgodne częściowo | `experimentView` zawiera kontekst, zmianę, kryteria, próby, ocenę hipotezy, regułę i datę przeglądu. Ocena używa stanów „Wsparta”, „Osłabiona”, „Nierozstrzygnięta”. |
| Lista zadań użytkownika oddzielona od kroków cyklu | zgodne | `homeV2` renderuje edytowalne `S.tasks`; `syncDodProgress` wylicza odrębną trasę etapów. Pokrycie: `e2e/ui.spec.ts`, test „strona główna pokazuje zadania...”. |
| Plan roczny i kalendarz | zgodne częściowo | `annualV2` i `annualCalendar` obsługują plan, miesiące, aktywności oraz kalendarz. |
| Sprawności bez konfabulacji | zgodne częściowo | Worker proxyzuje `/api/skills`, a UI pokazuje stan błędu przy braku katalogu; wymagania nie są generowane lokalnie. |
| Daty względne w `Europe/Warsaw` | zgodne częściowo | `warsawDateKey()` używa `Intl.DateTimeFormat` ze strefą `Europe/Warsaw`; nie ma kontraktu narzędzia czasu dla rozmowy MCP. |
| Testy UI i dostępność | zgodne częściowo | `npm ci --ignore-scripts` zakończyło się poprawnie; Playwright 78/78 zakończony poprawnie (desktop/mobile, axe i screenshoty). Lighthouse uruchomił Chrome, lecz zakończył się błędem `EPERM` podczas czyszczenia katalogu tymczasowego po pierwszym przebiegu. |

## Luki i ryzyka

| Priorytet | Rozbieżność z PRD | Dowód | Skutek | Naprawa |
| --- | --- | --- | --- | --- |
| P0 | Brak jednego dokumentu Google Docs jako trwałego stanu drużyny i brak odczytu kontrolnego po zapisie | `saveDraft()` zapisuje wyłącznie `localStorage`; `google-handler.ts` obsługuje OAuth i Picker, lecz nie zawiera operacji Google Docs | Dane nie są współdzielone między urządzeniami; nie jest spełniony rozdz. 3, 6 i 7 PRD | Zaimplementować odczyt konkretnej karty, podgląd, potwierdzenie, zapis i ponowny odczyt przez Google Docs API. |
| P0 | Potwierdzona mutacja MCP zmienia tylko lokalny widget, nie dokument drużyny | `applyAiMutation()` przyjmuje `mutation.confirmed` i wywołuje `saveDraft()` | Interfejs może sugerować wykonanie zapisu mimo braku trwałego rezultatu w Google Docs | Ujednolicić narzędzie MCP z operacją Docs; zwracać sukces wyłącznie po kontrolnym odczycie. |
| P0 | Konfiguracja produkcyjna wskazuje `wtyczka.kompaszbiorek.pl`, a wymaganie operacyjne wskazuje `interfejs.kompaszbiorek.pl` | `cloudflare-worker/wrangler.jsonc`, wiersze 7-9 | Wdrożenie nie potwierdza docelowego adresu produktu | Skonfigurować i zweryfikować trasę/domenę `interfejs.kompaszbiorek.pl` dla Workera `wtyczka-rr`. |
| P1 | Katalog aktywności nie przekazuje filtra `place` | `CATALOG_PROXIES.activities.queryKeys` zawiera `category`, `level`, `energy`, `participants`; UI buduje ten sam zestaw query | Wyszukiwanie nie może spełnić warunków zbiórki obejmujących miejsce | Dodać filtr `place` od UI przez Worker do API oraz test kontraktowy. |
| P1 | Brak pełnej bramki etapów: UI umożliwia równoległą edycję danych i wielu eksperymentów | `normalizeExperiments()` utrzymuje listę eksperymentów; widoki nie egzekwują jednego wyniku i bramki akceptacji na etap | Nie spełnia zasady PRD 5.67, że system nie wykonuje kilku etapów naraz | Wprowadzić model aktywnego etapu z wymaganymi wejściami, wynikiem i jawną akceptacją przed przejściem dalej. |
| P1 | Zapis lokalny nie ma mechanizmu minimalizacji danych wrażliwych ani walidacji treści | Stan `team`, role i pola robocze są serializowane bez klasyfikacji do `localStorage` | Ryzyko zapisania danych, których PRD zakazuje w kartach | Dodać walidację/ostrzeżenie dla danych zdrowotnych, kontaktowych i opiekuńczych oraz testy. |
| P2 | Karta problemu zawiera więcej niż jedną równoległą ścieżkę eksperymentu | UI pozwala na `+ Nowy eksperyment` | Rozbieżność z celem jednego priorytetowego problemu i małej zmiany | Ograniczyć aktywny cykl do jednego eksperymentu lub wyraźnie wprowadzić sekwencję po zamknięciu poprzedniego. |
| P2 | Bramka Lighthouse nie kończy się w tym środowisku | `npm run test:lighthouse` uruchamia Chrome i pierwszy przebieg, potem kończy się `EPERM` przy usuwaniu katalogu `lighthouse.*` | Nie ma pełnego potwierdzenia progów Lighthouse z bieżącego uruchomienia | Ustabilizować katalog tymczasowy i sprzątanie procesu Chrome, następnie wykonać trzy przebiegi LHCI. |

## Kryteria akceptacji PRD

| Nr | Kryterium | Ocena |
| --- | --- | --- |
| 1 | Chaotyczny opis kieruje do etapu `00` | brak dowodu: brak routingu źródeł wiedzy w MCP. |
| 2 | Gotowy opis problemu kieruje do `01` | brak dowodu. |
| 3 | Znany mechanizm prowadzi do hipotezy | częściowo: karta pozwala wpisać hipotezę, bez routingu etapów. |
| 4 | Eksperyment ma wersję, kontrolę, sukces i przerwanie | częściowo: są kryteria i próby, brak pola/egzekwowania kryterium przerwania oraz zamrożonej wersji. |
| 5 | Wynik: wsparcie, osłabienie lub nierozstrzygnięcie | zgodne: trzy stany `hypothesisEval`. |
| 6 | Plan zbiórki wynika z celu, kontekstu, bezpieczeństwa i zasobów | częściowo: cel, kontekst i materiały istnieją; brak bramki bezpieczeństwa. |
| 7 | Plan wyjazdu obejmuje logistykę, role, ryzyka, komunikację i wariant awaryjny | niezgodne: brak dedykowanego modelu wyjazdu. |
| 8 | Względne daty używają `Europe/Warsaw` | częściowo: data UI używa strefy; brak narzędzia czasu w MCP. |
| 9 | Zapis Docs wyłącznie po podglądzie i potwierdzeniu | niezgodne: brak operacji Docs. |
| 10 | Po zapisie jest odczyt kontrolny | niezgodne: brak operacji Docs. |
| 11 | Sprawności zgodne z kontraktem, stopnie bez konfabulacji | częściowo: proxy sprawności istnieje; kontrakt `pobierzSprawnosciRR` nie jest wykazany. |
| 12 | Niebezpieczny lub poniżający eksperyment jest blokowany | niezgodne: brak walidacji bezpieczeństwa eksperymentu. |
| 13 | Zamknięty cykl ma decyzję, regułę i termin przeglądu | częściowo: pola istnieją w szczegółach eksperymentu, brak bramki zamknięcia. |

## Kolejność napraw

1. Zbudować rzeczywisty kontrolowany zapis Google Docs: podgląd, jednoznaczne potwierdzenie, aktualizacja wskazanej karty, odczyt kontrolny i obsługa błędu.
2. Powiązać wynik narzędzia MCP wyłącznie z potwierdzonym zapisem Docs; lokalny szkic zachować jako roboczy cache, nie źródło prawdy.
3. Skonfigurować oraz zweryfikować `interfejs.kompaszbiorek.pl` dla istniejącego Workera `wtyczka-rr`.
4. Uzupełnić filtry katalogu o `place`, dodać bramki etapów i walidację bezpieczeństwa/poufności.
5. Ustabilizować LHCI, aby trzy przebiegi zakończyły się bez błędu `EPERM`.
6. Dodać kontraktowe testy MCP/Google Docs, filtra `place`, bramek etapów, warunku przerwania eksperymentu oraz planu wyjazdu.

## Ograniczenia audytu

- Nie wykonano wdrożenia Cloudflare; audyt nie zmienia runtime produktu.
- `npm ci --ignore-scripts` oraz Playwright 78/78 przeszły. `npm run test:all` nie zakończył się sukcesem, ponieważ jego faza Lighthouse przerwała się błędem `EPERM` podczas sprzątania katalogu tymczasowego Chrome.
- W tej sesji nie udostępniono integracji Paperclip do dołączenia dokumentu i komentarza do zgłoszenia.
