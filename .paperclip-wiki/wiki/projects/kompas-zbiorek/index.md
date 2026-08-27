---
title: Kompas Zbiórek — durable knowledge
type: project
tags: [kompas-zbiorek, prd, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/PRD-KOMPAS-ZBIOREK.md, raw/MAPA-SYSTEMU.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-27
---

# Kompas Zbiórek — durable knowledge

## Jak czytać ten dokument

Ten dokument opisuje przede wszystkim **docelową wizję produktu**. Element wymieniony w wizji jest **must-have’em docelowego Kompasu**, ale samo umieszczenie go tutaj **nie oznacza, że funkcja jest już wdrożona**.

Dla agentów obowiązuje rozdzielenie trzech warstw:

1. **TARGET / MUST-HAVE** — zatwierdzona funkcja lub zachowanie docelowego produktu; ma istnieć w produkcie.
2. **CURRENT / AS-IS** — funkcja potwierdzona jako działająca w aktualnym systemie przez kod, integrację, standup lub inny aktualny dowód wykonania.
3. **DELTA** — różnica między TARGET a CURRENT; zakres do zaprojektowania, zbudowania albo dokończenia.

Agent nie może zmienić statusu TARGET na CURRENT tylko dlatego, że funkcja jest szczegółowo opisana lub skonceptualizowana.

## Wizja produktu — TARGET / MUST-HAVE

Kompas Zbiórek to system dla instruktorów Royal Rangers Polska, który obniża próg wejścia do dobrego, powtarzalnego planowania i spina kolejne aktywności w jeden proces. Docelowo łączy planowanie, sprawności, przygotowanie, Bazę Aktywności RR, pamięć drużyny, refleksję i małe eksperymenty doskonalące.

Docelowy proces można przejść ręcznie w panelu `https://panel.kompaszbiorek.pl` albo przez asystenta w ChatGPT. AI jest opcjonalnym sposobem obsługi tego samego procesu, nie warunkiem używania produktu i nie podejmuje decyzji za instruktora.

Docelowy cykl user-facing: **Planowanie → Realizacja → Refleksja → Doskonalenie**.

Repo: `https://github.com/miloszspyrka-code/kompas-zbiorek`. Stan bieżący należy weryfikować w aktualnym kodzie, integracjach i [[wiki/projects/kompas-zbiorek/standup]].

## Najważniejsza prawda o produkcie

Kompas nie jest przede wszystkim generatorem planów ani narzędziem do problem solvingu. Główna wartość to prostsze, bardziej konsekwentne planowanie i ciągłość między kolejnymi aktywnościami. Doskonalenie przez refleksję i małe eksperymenty jest drugą warstwą wartości.

Realnym konkurentem produktu jest często improwizacja: jedna główna rzecz na zbiórkę, reszta dobierana na szybko, przypadkowy progres sprawności, późne przygotowanie i brak regularnego podsumowania po aktywności.

## Docelowy model pracy — TARGET / MUST-HAVE

1. Plan roczny wyznacza kierunek; instruktor może wpisać cele sam albo przejść assessment drużyny z asystentem.
2. Przed aktywnością instruktor widzi cel na około 3 miesiące i ustala cel główny konkretnej aktywności.
3. Dobiera aktywne sprawności i konkretne wymagania do realizacji.
4. Buduje plan z elementów aktywności i przypisuje im czas; element może realizować aspekt fizyczny, społeczny, duchowy lub intelektualny.
5. System pomaga zauważyć brak balansu między czterema aspektami i może sugerować aktywności lub sprawności z kontekstu.
6. Instruktor dodaje materiały, oznacza co trzeba pozyskać, zadania przygotowawcze i — jeśli ma sens — mały eksperyment.
7. Po aktywności zapisuje wynik, opinie uczestników i własną refleksję oraz oznacza, które wymagania sprawności faktycznie zostały wykonane.
8. W Doskonaleniu wybiera co powtarza, co zmienia, a co odrzuca, i planuje małą zmianę do sprawdzenia przy kolejnej aktywności.

Wszystkie powyższe elementy są elementami zatwierdzonej wizji docelowej. Ich obecność w tym modelu nie jest deklaracją ukończenia implementacji.

## Jednostki produktu — TARGET / MUST-HAVE

- Zbiórka = jedna aktywność.
- Biwak, wyjazd lub obóz = kilka aktywności następujących po sobie.
- Aktywność ma cel główny i plan z elementów aktywności.
- Element aktywności ma czas trwania i może być powiązany z jednym z czterech aspektów.

## Sprawności i progres — TARGET / MUST-HAVE

Instruktor wybiera sprawności realizowane przez drużynę i przypisuje konkretne wymagania do aktywności. Zaplanowane wymaganie nie oznacza wykonania — realizację zaznacza się dopiero w podsumowaniu po aktywności. Jedno wymaganie może być realizowane przez kilka aktywności. Po ukończeniu wszystkich wymagań sprawność zostaje domknięta i system tworzy zadanie wręczenia naszywki.

Wymagania muszą pochodzić z oficjalnego źródła RR; nie wolno ich wymyślać. Przy braku danych obowiązuje jawny stan `Brak danych`.

## Baza Aktywności RR — TARGET / MUST-HAVE

Baza Aktywności RR jest wspólną, moderowaną bazą gotowych aktywności. Użytkownicy mogą dodawać aktywności z opisem i kategoriami, a wpis trafia do wspólnej bazy po ręcznej moderacji. Z zaakceptowanych aktywności można korzystać w panelu i przez asystenta. Szczegóły kontraktów i bieżących integracji: [[wiki/sources/baza-aktywnosci]].

## Pamięć drużyny i Google Sheets — TARGET / MUST-HAVE

Dokument drużyny w Google Sheets jest trwałym stanem i pamięcią drużyny, może stanowić wspólny kontekst kilku liderów oraz pozostaje czytelny poza panelem. Zapisy wymagające utrwalenia są wykonywane po podglądzie i potwierdzeniu użytkownika. Szczegóły bieżącej integracji: [[wiki/entities/panel-google-sheets]].

## Onboarding

**Brak zatwierdzonego kontraktu onboardingu.** Poprzednie wersje z Docs i wcześniejsze propozycje Wiki nie mają obecnie akredytacji produktowej i nie mogą być traktowane przez agentów jako wymaganie, aktualny flow ani podstawa implementacji.

Do czasu zatwierdzenia nowego onboardingu agent ma oznaczać ten obszar jako `UNAPPROVED / DO NOT ASSUME`.

## Pozycjonowanie i komunikacja

Hierarchia przekazu dla wizji produktu:
1. prostsze planowanie i brak pustej kartki;
2. ciągłość: sprawności, cele, materiały, zadania i plan w jednym procesie;
3. lepsze przygotowanie i bardziej zróżnicowane aktywności;
4. wspólna pamięć drużyny;
5. AI jako opcjonalny, wygodny interfejs rozmowy;
6. refleksja, małe eksperymenty i poprawa działania między aktywnościami.

Nie zaczynać komunikacji od problem solvingu. Nie używać wymyślonych statystyk, testimoniali ani efektów procentowych.

**Granica obietnicy:** agent marketingowy może przedstawiać jako dostępne dziś wyłącznie funkcje potwierdzone jako CURRENT. TARGET opisuje kierunek i wymagania docelowego produktu, ale nie może być przedstawiany użytkownikowi jako już działający bez potwierdzenia stanu bieżącego.

## Grupa docelowa

Główna grupa to każdy czynny instruktor Royal Rangers, który planuje i prowadzi aktywności dla drużyny lub zastępu. Młodsi i mniej doświadczeni instruktorzy są ważniejszą grupą komunikacyjnie, bo częściej potrzebują prowadzenia krok po kroku i niższego progu wejścia do planowania.

Komunikacja ma pokazywać obszar wpływu instruktora bez moralizowania.

## Workstreams

- Karta zbiórki i tabele edytowalne (zob. [[wiki/concepts/karta-zbiorki]])
- Baza Aktywności RR + sprawności (zob. [[wiki/sources/baza-aktywnosci]])
- Panel Google Sheets jako trwały stan (zob. [[wiki/entities/panel-google-sheets]])
- Worker `wtyczka-rr` i cache dwuwarstwowy (zob. [[wiki/entities/worker-wtyczka-rr]])
- Design system i Quality Gate (zob. [[wiki/concepts/brand-dna]], [[wiki/concepts/bramka-jakosci-ui]])

## Decisions

- Docelowy cykl: Planowanie → Realizacja → Refleksja → Doskonalenie (zob. [[wiki/concepts/cykl-doskonalenia]]).
- Planowanie jest głównym wejściem produktu; eksperymenty i problem solving są warstwą pogłębiającą.
- AI jest opcjonalnym interfejsem do procesu, nie warunkiem użycia produktu.
- TARGET / MUST-HAVE i CURRENT / AS-IS są osobnymi warstwami wiedzy.
- Opis funkcji docelowej nie jest dowodem jej wdrożenia.
- Onboarding pozostaje niezatwierdzony do czasu nowej decyzji produktowej.
- CONTEXT-FIRST + STARTUP I/O BUDGET (zob. [[wiki/concepts/context-first-execution]]).
- Definition of Done write vs blocked (zob. [[wiki/concepts/definition-of-done]]).
- Stan braku danych zamiast wymyślania (zob. [[wiki/concepts/stan-braku-danych]]).

## Open risks / blockers

- Każdy agent musi rozróżniać wizję docelową od potwierdzonego stanu wdrożenia.
- Zależność od zewnętrznych API sprawności/bazy — brak = `Brak danych`.
- Stopnie RR pozostają poza aktualnie zatwierdzonym zakresem integracji, dopóki nie zapadnie inna decyzja.

## References

- PRD i zakres: [[wiki/sources/prd-kompas]]
- WSPÓLNY KONTEKST: [[wiki/sources/wspolny-kontekst]]
- Integracje: [[wiki/sources/integracje-mcp]]
- Repo map: [[wiki/entities/repo-map]]