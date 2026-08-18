# Dokumentacja Kompasu Zbiórek

## Produkt

Wtyczka UI (widget + Worker + serwer MCP) dla ChatGPT. Karta zbiórki jest samowystarczalnym artefaktem roboczym: dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja. Dane robocze w `localStorage` (szkic `kompas-zbiorek-draft-v1`).

## Stan funkcji (aktualny)

- **Strona główna**: karta najbliższej aktywności, trasa rozwoju (etapy planowanie→realizacja→analiza→decyzja, punkty milowe stałe, wyliczane z danych), lista zadań użytkownika (edytowalna, "Powiąż ze zbiórką"), lista nadchodzących aktywności. Lista zadań i trasa to dwa odrębne elementy.
- **Karta aktywności**: zakładki Planowanie (cel, sprawności i wymagania, przebieg z aspektami i kategoriami, przygotowanie, zadania), Realizacja (zablokowana do godziny startu), Analiza, Decyzja. Plan godzinowy: wiersze z godziną, aktywnością, aspektem (Fizyczny→Intelektualny→Duchowy→Społeczny→Gry i zabawy→brak), osobą, materiałami; przeliczanie kolejnych godzin; zmiana kolejności (góra/dół, drag).
- **Baza aktywności**: przycisk "Znajdź w bazie" — popup wyszukiwania; dla aspektu "Gry i zabawy" popup "Baza gier i zabaw" (proxy Workera). Wybór przepisuje nazwę, opis, czas trwania do wiersza planu.
- **Sprawności**: katalog z `sprawnosci.kompaszbiorek.pl` przez Worker; ukrywa pozycje wybrane i ukończone (grupy/poziomy); kryteria w tabeli, statusy kolorystyczne; ukończenie grupy dodaje ją do historii. Nazwy zawsze jednoliniowe.
- **Eksperymenty**: osobny widok (lista + szczegóły: kontekst, zmiana, przygotowanie, próby, ocena i decyzja) oraz kafelki na karcie aktywności. Status wyliczany z danych. Lista nie może być pusta.
- **Plan roczny**: wiele planów (zakładki), temat roczny, horyzonty miesięcy z "Dodaj aktywność", przełącznik "Plan / Kalendarz" (miesięczny kalendarz, drag na inny dzień, "Dzisiaj", Miesiąc/Lista), usuwanie planu z potwierdzeniem. Wrzesień–grudzień → rok start, styczeń–sierpień → rok koniec.
- **Kontekst zastępu**: frekwencja + czas aktywności (bez lokalizacji i pogody — moduł usunięty), styl prowadzenia, samodzielność.
- **Zapis przez AI (MCP)**: narzędzie `zapisz_dane_kompasu` (whitelist pól, sekcje: aktywność, problem, kontekst, zadanie, wiersz planu, aktywność planu rocznego). Dwuetapowy: `confirm:false` → propozycja, `confirm:true` po jednoznacznej zgodzie. Po utworzeniu/edycji aktywności komunikat "Odśwież stronę, aby zobaczyć aktualne dane w Kompasie Zbiórek."
- **Pełny ekran w ChatGPT**: `requestDisplayMode({mode:"fullscreen"})`; `_meta.ui.prefersBorder`; widget wersjonowany skrótem SHA-256 (`workspace-<hash>.html`).
- **Tryb Advanced UI** (skill `/ui`): iteracyjny audyt zmienionego widoku; SEO/Lighthouse pełne tylko na żądanie lub jako bramkę release.

## Architektura

- **Widget**: `kompas-ui-plugin/web` (serwowany statycznie z `web/dist`), logika w `web/src/static-app-v2.js`.
- **Worker `wtyczka-rr`**: `kompas-ui-plugin/cloudflare-worker`; serwuje UI, proxy katalogów, MCP zapis.
- **Cache katalogów**: Worker proxy `GET /api/activities` (baza zabaw, świeżość 1 h / awaria 6 h) i `GET /api/skills` (świeżość 6 h / awaria 24 h) w `caches.default`; dodatkowa kopia w IndexedDB (`kompas-catalog-v1`, TTL odpowiednio 6 h / 24 h). Nie synchronizuje się między urządzeniami.
- **Serwer MCP**: `kompas-ui-plugin/server`.
- **Publiczny MCP Paperclip**: `paperclip-mcp/public-mcp-proxy.mjs` — stateless POST na `/mcp` do gatewaya `127.0.0.1:3101`, dodaje `PAPERCLIP_GATEWAY_TOKEN`; endpoint `https://paperclip-mcp.kompaszbiorek.pl/mcp` (Cloudflare Tunnel, port 3102). Nie dodawać narzędzi z nieodwracalnymi operacjami bez autoryzacji.

## Testy i bramka jakości

- `npm run test:all` w `kompas-ui-plugin` = build + Playwright (projekty desktop i mobile, axe WCAG A/AA, screenshoty, cache) + Lighthouse. Wymaga bazy: `npm run test:install` (Chromium).
- Playwright: `e2e/ui.spec.ts` (funkcje, overflow), `a11y.spec.ts` (axe, tab), `visual.spec.ts` (baseline), `cache.spec.ts` (brak lokalizacji/pogody, cache sprawności).
- Lighthouse (`lighthouserc.json`): accessibility ≥0.9, best-practices ≥0.9 jako error; performance ≥0.5 warn. `npm run test:lighthouse` ustawia `CHROME_PATH` automatycznie.
- Responsywność: desktop i mobile obowiązkowe, bez skipów zależnych od viewportu.
- Stan ostatniej bramki: 86/86 testów Playwright zielonych; Lighthouse potrafi kończyć się `EPERM` przy sprzątaniu katalogu tymczasowego Chrome (ograniczenie środowiska; progi nie zmieniane).
- Baseline screenshotów: `npm run test:ui:update` (tylko zamierzone zmiany).

## Wdrożenie (kolejność stała)

`npm run build` (kompas-ui-plugin) → `node build-worker.mjs` (cloudflare-worker) → `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars`. Wrangler = lokalna devDependency. Docelowy Worker `wtyczka-rr`. Po wdrożeniu: adres + ID wersji.

## Ograniczenia / znane luki

- `/panel` (aplikacja online z logowaniem Google, sesje w KV, TRYB 3/4 wyboru pliku, kopia szablonu z `SHEETS_TEMPLATE_FILE_ID`) — **wdrożone na `wtyczka.kompaszbiorek.pl`** (faza 1). Faza 2 (zapis danych do arkusza przez Sheets API) pozostaje zaplanowana w `PLAN-WDROZENIA-PANEL.md`.
- Trwałość danych: tylko `localStorage`/IndexedDB; brak współdzielenia między urządzeniami i brak operacji Google Docs (kontrakt szablonu gotowy, integracja do zaimplementowania — patrz `AUDYT-ZGODNOSCI-PRD.md`).
- Katalog aktywności nie przekazuje filtra `place` (usunięty z UI); domena docelowa `interfejs.kompaszbiorek.pl` nie potwierdzona w Playwright (DNS); fallback `wtyczka.kompaszbiorek.pl/ui` działa.
- Brak pełnych bramek etapów cyklu w UI (możliwa równoległa edycja eksperymentów).
- `prompt systemowy` i kontrakt MCP nie wymuszają routingu źródeł wiedzy (etap 00-06).

## Rejestr zmian (skrót)

- 18.08.2026: audyt UX/UI zakładki Sprawności (KOMAA-25) — 3 P0 (martwe dane `S.sprawnosci`/`S.skills.note`/`S.history.rows`, brak potwierdzenia usunięcia sprawności, mylące CTA „Dodaj sprawność" w obu zakładkach), 5 P1 (3-stopniowy cycle status redundantny, dwa flow dodawania w Historii, niespójne puste stany, brak info w modalu), 6 P2 (branding niespójności, hardcoded katalog w Historii). Dokument: `audyt-ui/AUDYT-SPRAWNOSCI-KOMAA-25.md`. Rekomendacje: usunięcie martwych danych, 2-stopniowy toggle statusu, rozróżnienie etykiet CTA, potwierdzenie usunięcia, automatyczne dodawanie do Historii po 100% grupy. - 18.08.2026: wdrożenie `/panel` (faza 1) — `panel-handler.ts` (przeglądarkowy OAuth PKCE S256, scopes `openid email profile drive.file drive.readonly`, sesje w KV, refresh token; `/panel/login`, `/panel/callback`, `/panel/logout`, `/panel/context`, `/panel/documents`), TRYB 3 (Google Picker, istniejący arkusz) i TRYB 4 (kopia szablonu arkusza przez Drive API, bez Pickera) w widgetcie, nav-link „Plik Google" tylko dla sesji panelu. Wdrożone na `wtyczka.kompaszbiorek.pl`, wersja `cf46a694-0012-4231-af67-7b861c3fa7b8`; testy `e2e/panel.spec.ts` (8) zielone; weryfikacja produkcyjna: `/panel` → 302 `/panel/login` → 302 Google OAuth (poprawne scopes + PKCE + cookie stanu), `/ui` wstrzykuje `sheetsTemplateFileId`. Faza 2 (zapis do arkusza) zaplanowana.
- 17.08.2026: audyty (UI/UX `AUDYT-UX-UI.md`, zgodność z PRD `AUDYT-ZGODNOSCI-PRD.md`); publiczny MCP Paperclip; konfiguracja Paperclip+MCP (3100/3101, tunel); narzędzia MCP (playwright 8931, git 8941, magicui 8942, npm 8943, Clarity 8944, Sender 8945); BYO MCP OAuth + DCR.
- 16.08.2026: plan roczny — przełączany kalendarz; zadania użytkownika na stronie głównej; przebudowa modułu eksperymentów (widok + sekcje A-E); ticki podzadań i zachowanie scrolla; układ strony głównej wg referencji (dwie kolumny).
- 15.08.2026: usunięcie lokalizacji i pogody; dwuwarstwowy cache katalogów; wiele planów rocznych; Zapis danych przez AI w rozmowie ChatGPT; pełny ekran i przewijanie widoku w ChatGPT; wiele eksperymentów na aktywności; naprawa pustego widoku `/ui` (błąd `String.replace` w build-worker.mjs).
- 14.08.2026: audyt zgodności z brandingiem i poprawki (logo, wordmark, header, nav); responsywność popupów; plan roczny — dodawanie aktywności; widoczny scroll i jednoliniowe nazwy sprawności.
