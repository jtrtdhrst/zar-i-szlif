# Instrukcje dla agentów

## Wykonanie kontraktowe (CONTEXT-FIRST)

Wspólny projektowy kontekst i stałe invarianty: `WSPÓLNY KONTEKST.md` (sekcja „Project context”, „Mapa systemu (REPO MAP)”, „Wykonanie kontraktowe”, „STARTUP I/O BUDGET”).

- Python-startuj od dostarczonego kontekstu: `PAPERCLIP_WAKE_PAYLOAD_JSON` → `PAPERCLIP_TASK_ID` → `heartbeat-context` → inkrementalne komentarze. Nie odkrywaj ponownie stanu, który Paperclip już podaje (bez listowania całego boarda, goals, agentów, bez `git worktree list`, `git remote -v`, szerokich skanów repo na starcie taska).
- Minimalny git preflight: `git branch --show-current` + `git status --short` (+ opcjonalnie `git rev-parse --show-toplevel`). Diagnostykę pogłębiaj tylko przy anomalii względem currentExecutionWorkspace.
- Po udanej mutacji nie wykonuj potwierdzającego GET — odpowiedź mutacji jest wiążąca, chyba że świeży stan jest potrzebny do kolejnej decyzji.
- Lokalizacje plików znajdziesz w REPO MAP (sekcja „Mapa systemu” w `WSPÓLNY KONTEKST.md`), a nie przez przeszukiwanie repo od zera.

## Realizacja zadań wykonawczych

### Tryb Advanced UI

- Komenda `/ui`, `/advanced-ui` lub polecenie „Advanced UI” uruchamia `skills/advanced-ui/SKILL.md`.
- W iteracji stosuj zakres zadaniowy z tego skilla; pełny audyt, SEO i Lighthouse wykonuj tylko na żądanie albo jako końcową bramkę release.

### Status przez MCP Paperclip

- Komenda `/status` lub polecenie „status”, „jaki jest stan” uruchamia `skills/status/SKILL.md` — szybki przegląd stanu faktycznego i sprawdzenie, czy system czeka na decyzję.


## ChatGPT Apps / MCP development

For tasks involving OpenAI Apps SDK, ChatGPT Apps, MCP Apps, MCP tools/resources, ChatGPT-rendered UI, authentication or app submission, load and follow the `chatgpt-apps` skill before modifying implementation.

Do not guess OpenAI/MCP behavior. Verify unstable or undocumented behavior against current official documentation, SDK types, repository code, tests or runtime debugging.

- Gdy użytkownik zleca zadanie wykonawcze, realizuj je end-to-end.
- Nie kończ pracy na planie, nie pytaj o potwierdzenie między krokami i nie opisuj niepotrzebnie procesu.
- Przy zadaniach UI/HTML zawsze dostarcz finalny kod oraz screenshot efektu.
- Przed zmianą UI potwierdź kanoniczny katalog projektu oraz aktualny widok produkcyjny; nie przenoś kodu z klona, starej wersji ani innego Workera.
- Przy zadaniu brandingowym zachowaj istniejące sekcje, kolejność, timeline, listy zadań i zachowania. Zmieniaj wyłącznie tokeny, typografię i detale wizualne, chyba że użytkownik wyraźnie zleci zmianę struktury.
- Nie dodawaj dekoracji, których nie ma w kanonicznym systemie marki. W szczególności nie używaj poziomic, koncentrycznych kół, gradientów, offsetowych cieni ani pasków w dwóch kolorach jako ozdobników kart.
- Najpierw oceń hierarchię informacji na widoku: działanie główne musi być łatwe do zauważenia i wygodne do kliknięcia, a data, godzina, etykiety oraz pola formularza nie mogą konkurować z tytułem.
- Motywy ilustracyjne stosuj wyłącznie wtedy, gdy mają udokumentowane zastosowanie, właściwą skalę i nie zabierają miejsca treści. Na ciemnych panelach preferuj czyste tło oraz kontrast tekstu.
- Przed wdrożeniem UI porównaj wszystkie dostępne podstrony i breakpoint mobilny; usuń niespójne efekty globalnie, zamiast maskować je na jednym widoku.
- Gdy istnieje kanoniczny komponent referencyjny (np. CTA), odwzoruj jego proporcje, kolory i podział elementów; nie twórz luźnej wariacji na jego temat.
- Nie wymuszaj minimalnej wysokości karty, jeśli tworzy pustą przestrzeń. Wysokość ma wynikać z hierarchii treści i odstępów.
- Nie dodawaj w interfejsie adnotacji o źródle danych ani technicznych objaśnień, jeśli użytkownik ich nie zlecił; źródło opisuj wyłącznie w dokumentacji projektu.
- Dla widoków z tabelą sprawdź mobilny breakpoint bez poziomego przewijania: informacje i działania muszą pozostać dostępne w jednej kolumnie.
- Gdy katalog wyklucza pozycje już wybrane lub ukończone, filtr stosuj zarówno przy pierwszym renderze, jak i podczas wpisywania wyszukiwania.

## Zakres edycji

- Edytuj, twórz, przenoś i usuwaj wyłącznie pliki znajdujące się w katalogu `C:\Kompas Zbiórek` lub jego podkatalogach.
- Nie modyfikuj plików poza `C:\Kompas Zbiórek`.
- Nie przenoś plików poza `C:\Kompas Zbiórek`.
- Nie twórz kopii tego projektu w innym katalogu.
- Przed edycją sprawdź, czy ścieżka docelowa zaczyna się od `C:\Kompas Zbiórek\`.

## Zasady projektu

- Zachowuj język polski i istniejące nazwy plików.
- Używaj `apply_patch` do ręcznej edycji plików.
- Nie usuwaj istniejących treści ani plików bez wyraźnego polecenia użytkownika.
- Po zmianach sprawdź linki wikilink, strukturę Markdown i spójność dokumentacji.
- Przy zmianach prompta, PRD lub dokumentacji API zaktualizuj powiązane odwołania w tym samym katalogu.

## Stały sposób pracy

Przy każdej zmianie produktu wykonaj tę kolejność:

1. Przeczytaj aktualne PRD oraz dokumentację API dotyczącą zmienianego obszaru.
2. Porównaj wymagania z istniejącą implementacją i zapisz brakujące lub niespójne funkcje.
3. Wprowadź najmniejszą kompletną zmianę, która realizuje wymaganie i nie udaje działania niedostępnej integracji.
4. Uruchom właściwe testy, kontrolę składni oraz build; dla zmian UI sprawdź również widok desktopowy i mobilny.
5. Uzupełnij `documentation.md` w katalogu głównym: opisz funkcję, sposób użycia, źródła danych, ograniczenia i wykonane testy. Jeżeli plik nie istnieje, utwórz go.

Nie oznaczaj funkcji jako gotowej, jeśli test, build, wdrożenie albo wymagany zapis do dokumentacji nie został wykonany.

## Zasady UX i danych

- Nie zastępuj wymaganych danych roboczych tekstem typu „uzupełnij gdzie indziej”. Jeżeli dane są potrzebne w karcie, pokaż edytowalne pole albo jawny, nieblokujący stan braku danych.
- Karta zbiórki jest samowystarczalnym artefaktem roboczym: zawiera dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy oraz refleksję.
- Dla powtarzalnych danych stosuj czytelne tabele z nagłówkami i wierszami edytowalnymi: zadania, plan, wymagania sprawności, plan roczny, kalendarz, funkcje i historia eksperymentów.
- Nie wymyślaj wymagań sprawności ani danych z integracji. Gdy API nie jest podłączone, pokaż jasny stan braku danych i pozwól wyłącznie na roboczy opis użytkownika.
- Przed zmianą UI porównaj widoki z aktualnym PRD, szablonem dokumentu drużyny i dokumentacją API. Nie redukuj wymaganych pól do demonstracyjnych skrótów bez wyraźnej zgody użytkownika.
- Po zmianach UI sprawdź build, składnię oraz czytelność desktopową i mobilną; weryfikuj kolejność: nagłówek, kontekst, działanie, dane robocze.

## Obowiązkowe wdrożenie Cloudflare

- Docelowym Workerem produkcyjnym jest `wtyczka-rr`, z powiązaną domeną interfejsu `interfejs.kompaszbiorek.pl`. Nie wdrażaj tego projektu na `kompas-zbiorek` ani nie twórz zastępczych Workerów.
- Po każdej zmianie w `kompas-ui-plugin` zbuduj całość i wdroż aktualną wersję produkcyjną Workera `wtyczka-rr` na Cloudflare przed zgłoszeniem zadania jako ukończonego.
- Kolejność jest stała: `npm run build` w `kompas-ui-plugin`, `node build-worker.mjs` w `kompas-ui-plugin\cloudflare-worker`, `npx wrangler deploy --dry-run` (walidacja), a następnie `npx wrangler deploy --keep-vars` w katalogu Workera. Wrangler jest lokalną devDependency wersji w `kompas-ui-plugin\cloudflare-worker\package.json`; nie używaj globalnego wranglera.
- Po wdrożeniu podaj użytkownikowi adres produkcyjny oraz identyfikator wersji zwrócony przez Wrangler.
- Jeśli wdrożenie jest zablokowane, nie przedstawiaj zmiany jako wdrożonej; podaj dokładną przyczynę i gotowy krok potrzebny do wznowienia.

## Plik bazy aktywności

Kanoniczny plik PRD i dokumentacji API bazy aktywności znajduje się tutaj:

`C:\Kompas Zbiórek\PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md`

Przy pracy nad Bazą Aktywności RR edytuj ten plik oraz powiązane pliki wyłącznie w katalogu `C:\Kompas Zbiórek`.

## Bramka jakości UI (Quality Gate)

Automatyczne testy UI znajdują się w `kompas-ui-plugin\e2e` i są uruchamiane komendą `npm run test:all` w katalogu `kompas-ui-plugin` (Playwright + Lighthouse). Szczegóły w `kompas-ui-plugin\documentation.md`.

- Nie uznawaj zmiany UI za zakończoną wyłącznie na podstawie poprawności kodu. Po zmianie UI uruchom `npm run test:all` w `kompas-ui-plugin`, sprawdź że wszystkie testy przeszły, i potwierdź render (widok desktopowy i mobilny) w kontekście produkcyjnym.
- Testy responsywności nie mogą być wyciszane przez `test.skip` zależne od viewportu. Każdy test desktopowy i mobilny ma wykonać się w obu projektach Playwright; jeśli zachowanie różni się między breakpointami, test ma użyć warunku i sprawdzić właściwy kontrakt dla danego viewportu. Raport końcowy nie powinien zawierać pominiętych testów z powodu rozmiaru ekranu.
- Lighthouse nie zastępuje testów responsywności i nie jest testem SEO. Przy zmianach mobilnych wymagany jest osobny test DOM/CSS dla projektu `mobile` oraz ręczna kontrola widoku produkcyjnego przy 390×844 px.
- Inspekcję działającego interfejsu wykonuj automatycznie przez Playwright MCP (skonfigurowany w `opencode.json` w katalogu głównym jako `mcp.playwright`). Do ręcznej weryfikacji widoku użyj narzędzi Playwright MCP zamiast polegania wyłącznie na screenshotach z testów.
- Accessibility: reguły WCAG A/AA (2.1 + 2.2), poziom `critical` i `serious` blokują zakończenie zadania dotyczącego UI. Naruszenia napraw w kodzie; bez nieuzasadnionych `axe.exclude`/ignorów.
- Wizualne regresje sprawdzaj przez testy screenshotowe (`e2e\visual.spec.ts`). Baseline zrzutów aktualizuj komendą `npm run test:ui:update` tylko gdy zmiana wizualna jest zamierzona i zaakceptowana przez użytkownika.
- Lighthouse (LHCI) ma twarde progi asercji w `kompas-ui-plugin\lighthouserc.json` (accessibility ≥ 0.9, best-practices ≥ 0.9 jako error; performance ≥ 0.5 jako warn). Nie obniżaj progów bez uzasadnienia; w razie regresji napraw przyczynę.
- Stan środowiska: Lighthouse wymaga Chrome/Chromium. Skrypt `npm run test:lighthouse` ustawia `CHROME_PATH` automatycznie (wskazuje na Chromium zainstalowane przez `npm run test:install`); nie uruchamiaj LHCI bez `CHROME_PATH`, bo healthcheck nie przejdzie.
