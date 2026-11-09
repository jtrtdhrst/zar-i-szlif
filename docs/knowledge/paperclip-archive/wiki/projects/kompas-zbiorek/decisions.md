---
title: Żar i Szlif — decyzje (technicznie Kompas Zbiórek)
type: project
tags: [decyzje, adr]
sources: [raw/WSPOLNY_KONTEKST.md, raw/AGENTS.md]
created: 2026-08-20
updated: 2026-10-19
---

# Żar i Szlif — decyzje (historycznie/technicznie Kompas Zbiórek)

Ta strona przechowuje **materialne decyzje**, nie snapshot CURRENT. W obrębie tej samej klasy źródeł nowsza jawna decyzja ma pierwszeństwo nad starszą.

## ACTIVE

| Data | Decyzja | Konsekwencja | Źródło |
|---|---|---|---|
| 2026-10-20 | **Robot-przewodnik MCP w obozowisku — ChatGPT i Claude** | Stały klikalny robot przy Ognisku wyjaśnia podłączenie **produktowego MCP Żar i Szlif** do ChatGPT/Claude: wymagania kont, publiczny HTTPS endpoint, OAuth, test i rozwiązywanie problemów. Nie jest wbudowanym AI/chatem ani siódmą lokacją. Bez wymuszania połączenia; nie pokazywać niezweryfikowanego URL/statusu, sekretów ani admin MCP. Instrukcje zgodne z oficjalnymi dokumentacjami, aktualizowalne. **TARGET / APPROVED, nie CURRENT**. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-20 | **Ognisko: zarządzanie drużyną, rolami i kodem dołączenia** | Ognisko umożliwia przeglądanie i dodawanie/usuwanie uprawnionych członków, zmianę ról systemowych i funkcji organizacyjnych oraz obsługę zaproszeń i próśb. Każda drużyna ma zarządzalny, odnawialny kod. Wpisanie kodu wyłącznie tworzy prośbę; **dopiero akceptacja uprawnionego administratora** oraz sprawdzenie jednej aktywnej drużyny i unikalności awatara pozwalają dołączyć. Zabezpieczenia RBAC/RLS, ostatniego administratora i historii. **TARGET / APPROVED, nie CURRENT**; szczegółowa macierz ról do dopracowania. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]], [[wiki/concepts/onboarding]] |
| 2026-10-19 | **Arc 2: temat roku i jeden cel na 3 miesiące + DoD** | Pierwsze działanie „Dodaj plan roczny” z obowiązkowym tematem rocznym. Rok wrzesień–sierpień, cztery horyzonty po 3 miesiące, ale szczegółowo planowany tylko bieżący. **Jeden cel główny na 3 miesiące i czytelne DoD**; opcjonalne **kamienie milowe jako podetapy tego celu (każdy z prostym warunkiem ukończenia)** oraz sprawności, przy miesiącu **+ Dodaj aktywność** tworzy kartę. Przyszłe horyzonty mogą pozostać puste. Metodyka ERP Scout nie jest podstawą planowania. Bez wbudowanego AI. TARGET; UX fabularny roboczy, nie CURRENT. | [[wiki/concepts/arc-02-wyznaczamy-kierunek]] |
| 2026-10-19 | **Bez AI w aplikacji, opcjonalne AI przez MCP** | Brak wbudowanego AI, chatu/generatora planów, a standardowe funkcje działają bez AI. Opcjonalne zewnętrzne AI ma dostęp wyłącznie przez autoryzowany MCP aplikacji do kanonicznych rekordów Supabase/Postgres. Instruktor podejmuje decyzje. Doprecyzowuje historyczne „AI jako opcjonalny interfejs”. TARGET; nie dowód implementacji. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-19 | **Stały Dziennik Aktywności przy Stole Wypraw** | W obozowisku stale dostępny rekwizyt/widok kart minionych i nadchodzących aktywności; czytanie historii i uzupełnianie nadchodzących kart. Dane wspólne z kartami i kalendarzem, bez siódmej lokacji i bez zależności od AI. Nazwa Dziennik Aktywności ustalona; dokładny UX do dopracowania. TARGET. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]], [[wiki/concepts/karta-zbiorki]] |
| 2026-10-19 | **Żar i Szlif: sześć miejsc — Namiot Zastępu, Stół Wypraw, Tablica Sprawności i Stopni** | Zatwierdzone miejsca: Ognisko; Namiot Zastępu jako szybki, względnie trwały punkt dostępu do kontekstu zastępu i danych podstawowych, aktualizowanych rzadko także przez MCP aplikacji; Stół Wypraw dla planów i realizacji, zamiast drugiego namiotu; Pracownia Iskry; Gniazdo Szlifa; Tablica Sprawności i Stopni. Supabase/Postgres pozostaje SSOT. Zastępuje układ pięciu punktów z 2026-10-18. Szczegółowy przebieg Arc 1 nadal do dopracowania. **TARGET / APPROVED; nie CURRENT.** | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-18 | **Onboarding: zwierzak, prywatne doświadczenie, drużyna, zaproszenia** | Dwa CTA przed Google OAuth; wstępny wybór zwierzaka; dwa oddzielne pytania o staż w RR i samodzielne prowadzenie zbiórek. Odpowiedzi/pochodny tag są prywatne dla edukacji, nigdy publiczne „niedoświadczony instruktor” i bez ograniczeń funkcji. Następnie imię/nazwisko, szczep, utworzenie/nazwanie lub dołączenie do drużyny, kontrola wolnego gatunku, opcjonalne zaproszenia wielu współprowadzących przez e-mail, wejście do obozu. Istniejący wraca, przerwany wznawia. Starsza kolejność setupu zastąpiona; mail powitalny i misje pozostają osobno. TARGET, nie CURRENT. | [[wiki/concepts/onboarding]] |
| 2026-10-14 | **Żar i Szlif: ekran główny MVP = zwijany skrót nad obozowiskiem** | Obozowisko jest głównym ekranem po zalogowaniu. Na górze od razu widoczny zwijany panel: najbliższa aktywność/zbiórka, zadania do wykonania i potrzebne materiały. Pod nim interaktywna mapa obozu. Panel można zamknąć/zwinąć i ponownie otworzyć. Dane z istniejących modułów, bez nowych równoległych źródeł prawdy; pusty stan, gdy brak zaplanowanej zbiórki. TARGET, nie dowód wdrożenia. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-14 | **Żar i Szlif: nowy kanon postaci, nagród i prywatności obozu** | Pula gatunków rozszerzana według potrzeb; lis i kruk zarezerwowane dla NPC. Unikalny gatunek na drużynę i **nowy wybór zwierzęcia przy każdej zmianie drużyny**. Kolory i podstawowe ubranka to jedyny obecny zakres personalizacji postaci. Pomysły i własne zadania → Iskry osobiste; planowanie/realizacja zbiórek → Iskry drużynowe. **Historia odkryć indywidualna, obóz wspólny**. Obóz ulepszany **wyłącznie wariantami istniejących budynków**; bez osobnych dekoracji. **Brak podglądu obozów innych drużyn.** TARGET, nie dowód wdrożenia. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-14 | **Żar i Szlif: uszczegółowienie gamifikacji i członkostwa** | Maksymalnie **jedna drużyna na użytkownika** (korekta zastępuje wariant wielodrużynowy). W obrębie drużyny tylko **jeden awatar każdego gatunku**; możliwa zmiana na wolny gatunek. Osobiste Iskry pochodzą z dedykowanych zadań i kupują kosmetyki zwierzęcia; drużynowe Iskry z innych zadań kupują kosmetykę obozowiska. Brak zatwierdzania zakupów i refundacji. Kupione warianty trwałe, przełączane za darmo. Dialog wprowadzający do budynku tylko przy pierwszej wizycie, potem na żądanie. Scenki fabularne także podczas korzystania z funkcji bez zakupów. Balans później. **TARGET / nie wdrożone**. | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-14 | **Żar i Szlif: kanon koncepcyjny gamifikacji zatwierdzony (TARGET)** | Dwa fabularne NPC: Iskra = lis (Żar), Szlif = kruk (refleksja). Wspólny obóz drużyny; osobiste zwierzęce awatary, możliwość zmiany gatunku, zakaz dublowania w drużynie, domyślne miejsce przy ognisku. Dwa portfele Iskier (osobisty i drużynowy), członkowie mogą kupować bez głosowania i zatwierdzeń. Wszystkie moduły/budynki dostępne od startu, dialog wprowadzający, stałe miejsca budowy i 2–3 zmienialne warianty estetyczne. Kosmetyczne zakupy wiążą się z fabułą, nie z dostępem do funkcji. Otwarte: zasady przyznawania punktów, dokładne źródła wydatków, kolizje awatarów i dialogi. **Nie dowodzi wdrożenia.** | [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] |
| 2026-10-13 | **Publiczna nazwa marki = „Żar i Szlif”** | „Kompas Zbiórek” pozostaje nazwą historyczną/techniczną, nie główną nazwą użytkową; przejście dokumentacji, repo i deploymentu wymaga osobnej weryfikacji stanu. | decyzja właściciela produktu; KOMAA-778/KOMAA-779 |
| 2026-09-09 | **Onboarding TARGET v1 — historyczna kolejność (superseded 2026-10-18)** | Rozdzielamy: (1) post-registration setup: Google → imię i nazwisko → szczep → drużyna → panel; (2) pierwszy mail po rejestracji z komunikatem „dodaj do ważnych/kontaktów lub odpowiedz”; (3) checklistę w aplikacji: dodaj osoby → dodaj plan roczny → zaplanuj pierwszą zbiórkę. „Potwierdź zapis do newslettera” jest osobnym zadaniem komunikacyjnym i nie blokuje produktu. | [[wiki/concepts/onboarding]] |
| 2026-09-08 | **CTO = merge authority dla repo-write** | Implementer nie publikuje własnej zmiany do `main`. Required independent PASS wskazuje exact `candidate_sha`; każdy późniejszy commit unieważnia PASS. CTO merguje wyłącznie bez zmian kodu/rebase/fixów i kończy dopiero po dowodzie `candidate_sha ∈ ancestry(origin/main)`. Merge pozostaje etapem source issue, bez osobnego meta-taska/agenta merge. | `wiki/agents/cto/AGENTS.md`, `wiki/concepts/definition-of-done.md` |
| 2026-09-07 | **MCP Engineer = właściciel MCP + Qdrant/RAG** | Zadania dotyczące MCP servers/plugins/tools/contracts oraz Qdrant, ingestu, indeksowania i retrievalu RAG routuj bezpośrednio do MCP Engineer. Qdrant jest warstwą wiedzy/retrievalu, nie application SSOT. | `wiki/agents/mcp-engineer/AGENTS.md`, [[wiki/entities/mcp-qdrant-hybrid]] |
| 2026-09-09 | **Kanoniczny punkt wejścia UI/API = `https://panel.kompaszbiorek.pl`** | Ten host jest używany do oceny produkcyjnego interfejsu oraz jako publiczny punkt wejścia integracji. | verified Cloudflare CURRENT + bieżące repo |
| 2026-09-07 | **Nowsza jawna wersja wygrywa w obrębie tej samej klasy źródeł** | Starszy dokument nie nadpisuje nowszej decyzji; wyjątek: nowszy materiał oznaczony jako historyczny/superseded lub odsyłający do innego kanonu. | [[wiki/sources/wspolny-kontekst]] |
| 2026-09-04 | **Google Sheets usunięte z produktu** | Brak panelu, trwałego stanu i synchronizacji Sheets. | [[wiki/sources/integracje-mcp]] |
| 2026-09-04 | **Deploy wykonuje Engineer po wymaganym review** | Dotyczy runtime/deploy, nie publication branch → `main`. Merge repo-write jest od 2026-09-08 odpowiedzialnością CTO; CTO = niezależny review techniczny, UI QA = niezależna akceptacja wizualna. Konkretne recipe/nazwy sprawdzaj w CURRENT repo. | [[wiki/sources/integracje-mcp]], `wiki/agents/cto/AGENTS.md` |
| 2026-09-04 | **Jedyny user-facing cykl: Planowanie → Realizacja → Refleksja → Doskonalenie** | Materiały `00–06` są historyczną/metodologiczną warstwą pogłębiającą, nie obowiązkowym flow. | [[wiki/concepts/cykl-doskonalenia]] |
| 2026-09-01 | **Supabase/Postgres = jedyny application source of truth** | Nie twórz nowej domenowej warstwy danych na Cloudflare D1. | [[wiki/sources/integracje-mcp]] |
| 2026-09-01 | **Cloudflare Worker = API/integrations layer** | Worker nie jest drugim SSOT danych domenowych. | [[wiki/sources/integracje-mcp]] |
| 2026-09-01 | **Hierarchia źródeł zamiast jednego ogromnego SSOT** | user/Board → verified CURRENT → durable decisions/product knowledge → PRD/TARGET → domain docs → history/raw. | [[wiki/sources/wspolny-kontekst]] |
| 2026-09-01 | **Role-based lazy loading kontekstu** | Issue/handoff → kontrakt roli → jedna domena → targeted verification. | [[wiki/concepts/context-first-execution]] |
| 2026-08-27 | **Planowanie jest głównym wejściem produktu** | Problem solving i eksperymenty są warstwą pogłębiającą. | [[wiki/projects/kompas-zbiorek/index]] |
| 2026-08-27 | **AI jest opcjonalnym interfejsem** | Decyzje pozostają po stronie instruktora. | [[wiki/projects/kompas-zbiorek/index]] |
| 2026-08-27 | **Plan ≠ wykonanie** | Faktyczne wykonanie potwierdza się po aktywności. | [[wiki/concepts/karta-zbiorki]] |
| 2026-08-27 | **TARGET ≠ CURRENT** | Opis requirementu nie jest dowodem implementacji. | [[wiki/sources/wspolny-kontekst]] |
| 2026-08-27 | **Marketing proof wymaga evidence** | Bez wymyślonych statystyk, testimonials i efektów; pokazuj realny mechanizm. | [[wiki/concepts/brand-dna]] |

**2026-10-19 — mapa jednej Karty Zbiórki / etapów (uzgodniony podział):** Arc 3 = **Planowanie**: cel i sprawności, tabela przebiegu, zadania i materiały w Przygotowaniu, z checklistą ticków. **Pierwsza zbiórka nie ma wcześniejszego eksperymentu.** Arc 4 = po rzeczywistej realizacji: **Podsumowanie** (faktyczny przebieg, wykonane wymagania, osiągnięte kamienie milowe, wnioski i ewentualny wynik eksperymentu) oraz opcjonalnie **Problemy** (decyzja o zmianie / nowy eksperyment na następną zbiórkę). Nieukończone wymagania/kamienie można proponować przy kolejnej karcie, bez automatycznego zaliczenia, bez wbudowanego AI. Szczegółowa mapa: [[wiki/concepts/karta-zbiorki]]. TARGET — nie CURRENT.

## WORKING DRAFTS / DO DOPRACOWANIA

- **2026-10-19 — Arc 3 „Przygotujmy zbiórkę” (working draft):** trzy zadania na jednej karcie w zakładce Planowanie: „Wybierz cel wyprawy”, „Ułóż trasę zbiórki”, „Spakuj potrzebne rzeczy”. Pierwsza zbiórka bez eksperymentu; dalsze mogą pokazywać zaplanowaną wcześniej próbę bez jej oceniania. [[wiki/concepts/arc-03-przygotujmy-zbiorke]].
- **2026-10-19 — Arc 4 „Co zabieramy dalej?” (working draft):** po zbiórce faktyczny przebieg, wykonane wymagania, kamienie, wnioski; opcjonalna praca w Problemach i pierwszy eksperyment na następną. [[wiki/concepts/arc-04-co-zabieramy-dalej]].
- **2026-10-19 — Arc 1 „Nasz pierwszy namiot”:** po onboardingu fabularnie powstaje Namiot Zastępu; cztery robocze kroki obejmują profil/realia zastępu, umiejętności i współpracę, historię **grupowo przerobionych** sprawności i wymagań stopni (bez indywidualnej segmentacji, zaliczeń i nadrabiania nieobecności), a następnie podsumowanie mocnych stron i potencjalnych braków. Cele rozwojowe i plan roczny w Arc 2 przy Stole Wypraw. Pełny roboczy szkic: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]]. **To nie jest final APPROVED ani evidence wdrożenia; wymagane są dalsze decyzje o copy, UX, zaliczeniu i analizie.**

## SUPERSEDED

| Data | Stara decyzja | Zastąpiona przez |
|---|---|---|
| 2026-10-18 | Pięć miejsc: Ognisko, Namiot Wypraw, Pracownia Iskry, Gniazdo Szlifa, Tablica Sprawności | Zastąpione decyzją 2026-10-19 o sześciu miejscach, Namiocie Zastępu, Stole Wypraw i Tablicy Sprawności i Stopni. Kartka przygotowań na home pozostaje bez zmian. |
| 2026-09-09 | Kolejność Google → imię/nazwisko → szczep → drużyna → panel | Nowy kanon z 2026-10-18: [[wiki/concepts/onboarding]] |
| 2026-08-27 | **Onboarding = UNAPPROVED / DO NOT ASSUME** | onboarding TARGET v1 z 2026-09-09: [[wiki/concepts/onboarding]] |
| 2026-08-20 | Jeden ogromny `WSPOLNY_KONTEKST.md` jako pojedynczy SSOT | hierarchię źródeł z 2026-09-01 |
| 2026-08-20 | Panel Google Sheets jako trwały stan | Supabase/Postgres SSOT + usunięcie Sheets |
| 2026-08-20 | Sztywny Worker `wtyczka-rr` jako wieczny cel deploya | CURRENT-verified repo/deploy contract |
| wcześniejsze | `Analiza → Decyzja` / obowiązkowy routing `00–06` | cykl 4 etapów z 2026-09-04 |

## Status funkcji

- **TARGET / MUST-HAVE** — zatwierdzony stan docelowy.
- **CURRENT / AS-IS** — stan potwierdzony aktualnym evidence.
- **DELTA** — brakujący zakres TARGET minus CURRENT.
- **UNAPPROVED / DO NOT ASSUME** — brak zatwierdzenia.

Konflikt implementation ↔ requirement nie upoważnia do automatycznego przepisywania PRD pod kod.

Powiązania: [[wiki/projects/kompas-zbiorek/index]], [[wiki/sources/wspolny-kontekst]], [[wiki/sources/integracje-mcp]], [[wiki/concepts/context-first-execution]], [[wiki/concepts/onboarding]].