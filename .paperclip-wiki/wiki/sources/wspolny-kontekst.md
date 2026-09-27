---
title: WSPÓLNY KONTEKST — kanon wiedzy Kompas Zbiórek
type: source
tags: [kontekst, kontrakt, governance]
sources: [raw/WSPOLNY_KONTEKST.md]
created: 2026-08-20
updated: 2026-08-27
---

# WSPÓLNY KONTEKST — streszczenie

Ta strona jest syntetycznym kanonem dla agentów. Łączy kontrakty techniczne z późniejszymi decyzjami produktowymi. Kluczowa zasada: **wizja docelowa i stan bieżący są osobnymi warstwami wiedzy**.

## Model statusu funkcji dla agentów

Każdą funkcję, zachowanie lub przepływ należy przypisać do jednej z warstw:

### TARGET / MUST-HAVE
Zatwierdzona część docelowej wizji produktu. Funkcja ma istnieć w finalnym produkcie. Może być szczegółowo skonceptualizowana, ale opis koncepcji nie oznacza wdrożenia.

### CURRENT / AS-IS
Stan potwierdzony jako działający teraz. Status CURRENT wymaga aktualnego dowodu: kodu, działającej integracji, testu, standupu, bieżącej dokumentacji wykonania albo innego źródła opisującego faktyczny stan systemu.

### DELTA
Różnica pomiędzy TARGET i CURRENT. To zakres potrzebny do dojścia od stanu bieżącego do docelowego.

### UNAPPROVED / DO NOT ASSUME
Pomysł lub flow bez zatwierdzenia produktowego. Nie może być traktowany jako wymaganie, aktualny stan ani podstawa implementacji.

**Reguła nadrzędna:** agent nie może uznać funkcji za CURRENT wyłącznie dlatego, że jest opisana w wizji, Docs lub Wiki jako przyszły model produktu.

## Wizja produktu — TARGET / MUST-HAVE

- Produkt: Kompas Zbiórek — system dla instruktorów Royal Rangers Polska do prostszego, powtarzalnego planowania i łączenia kolejnych aktywności w jeden proces.
- Główna wartość: obniżenie progu wejścia do dobrego planowania; problem solving i eksperymenty są warstwą pogłębiającą, nie głównym wejściem produktu.
- Docelowo proces można przejść ręcznie w panelu `https://panel.kompaszbiorek.pl` albo przez asystenta w ChatGPT. AI jest opcjonalne i nie podejmuje decyzji za instruktora.
- Docelowy cykl user-facing: **Planowanie → Realizacja → Refleksja → Doskonalenie**.
- Docelowa karta zbiórki pozostaje samowystarczalnym artefaktem roboczym: dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja.

## Docelowy model produktu — TARGET / MUST-HAVE

1. Plan roczny wyznacza kierunek; instruktor może wpisać cele sam albo przejść assessment drużyny z asystentem.
2. Przed aktywnością widzi cel na około 3 miesiące i ustala cel główny konkretnej aktywności.
3. Dobiera aktywne sprawności i konkretne wymagania.
4. Buduje plan z elementów aktywności i przypisuje im czas; element może realizować aspekt fizyczny, społeczny, duchowy lub intelektualny.
5. System pomaga zauważyć brak balansu czterech aspektów i może sugerować aktywności lub sprawności na podstawie kontekstu.
6. Instruktor dodaje materiały, oznacza co trzeba pozyskać, zadania przygotowawcze i opcjonalny mały eksperyment.
7. Po aktywności zapisuje wynik, opinie uczestników i refleksję oraz oznacza faktycznie wykonane wymagania sprawności.
8. W Doskonaleniu wybiera co powtarza, co zmienia, a co odrzuca; w razie potrzeby planuje małą zmianę do sprawdzenia przy kolejnej aktywności.

Te elementy są **wymaganiami docelowej wizji**, nie deklaracją stanu implementacji.

## Sprawności — TARGET / MUST-HAVE

- Wymagania sprawności pochodzą z oficjalnego katalogu RR; nie wolno ich wymyślać.
- Zaplanowane wymaganie nie oznacza wykonania. Realizację oznacza się dopiero po aktywności.
- Jedno wymaganie może być realizowane przez kilka aktywności.
- Po ukończeniu wszystkich wymagań sprawność zostaje domknięta i system tworzy zadanie wręczenia naszywki.

## Baza Aktywności RR — TARGET / MUST-HAVE

Baza Aktywności RR jest wspólną, ręcznie moderowaną bazą aktywności. Użytkownicy mogą dodawać wpisy z opisem i kategoriami; zaakceptowane aktywności są dostępne w panelu i przez asystenta.

## Google Sheets — pamięć drużyny — TARGET / MUST-HAVE

Dokument drużyny w Google Sheets jest trwałym stanem i pamięcią pracy drużyny. Arkusz może być wspólnym kontekstem kilku liderów i pozostaje czytelny poza panelem. Zapisy utrwalające dane wymagają podglądu i potwierdzenia użytkownika.

## Onboarding

**Brak zatwierdzonego kontraktu.** Wcześniejszy onboarding z Docs i Wiki ma status `UNAPPROVED / DO NOT ASSUME` i nie może być używany jako wymaganie ani bieżący flow. Nowy onboarding zostanie wpisany dopiero po zatwierdzeniu produktowym.

## Pozycjonowanie i komunikacja

Hierarchia wartości docelowego produktu:
1. prostsze planowanie i brak pustej kartki;
2. ciągłość: sprawności, cele, materiały, zadania i plan w jednym procesie;
3. lepsze przygotowanie i bardziej zróżnicowane aktywności;
4. wspólna pamięć drużyny;
5. AI jako opcjonalny interfejs rozmowy;
6. refleksja, małe eksperymenty i poprawa działania między aktywnościami.

Nie zaczynać od problem solvingu. Nie używać wymyślonych statystyk, testimoniali ani efektów procentowych.

**Granica obietnicy:** marketing może mówić „działa”, „możesz”, „system robi” tylko o elementach potwierdzonych jako CURRENT. TARGET służy do opisu wizji, projektowania i planowania rozwoju, ale nie jest dowodem dostępności funkcji dziś.

## Odbiorca

Główna grupa to każdy czynny instruktor Royal Rangers, który planuje i prowadzi aktywności dla drużyny lub zastępu. Młodsi i mniej doświadczeni instruktorzy są ważniejszą grupą komunikacyjnie ze względu na większą potrzebę prowadzenia krok po kroku i niższy próg wejścia do planowania.

## CURRENT / AS-IS — źródła stanu bieżącego

Stan bieżący nie jest utrzymywany przez samą wizję. Agenci mają go ustalać na podstawie:
- aktualnego kodu i kontraktów integracji;
- [[wiki/projects/kompas-zbiorek/standup]];
- [[wiki/sources/integracje-mcp]];
- [[wiki/entities/panel-google-sheets]];
- [[wiki/sources/baza-aktywnosci]];
- testów i Definition of Done, jeśli dotyczą sprawdzanej funkcji.

Jeżeli stan funkcji nie jest potwierdzony, agent ma powiedzieć `niepotwierdzony stan bieżący`, zamiast przenosić ją automatycznie z TARGET do CURRENT.

## Warstwa techniczna

- Repo: `https://github.com/miloszspyrka-code/kompas-zbiorek`, workspace `isolated_workspace` + `git_worktree` (`baseRef=main`, parent `.paperclip-worktrees`).
- Produkcja: `kompaszbiorek.pl`, publiczny system `https://panel.kompaszbiorek.pl` (`/ui` dla UI, `/mcp` dla MCP), Worker `panel-kompaszbiorek`.
- Invarianty techniczne: MCP `/mcp`, OAuth `drive.file`, Cloudflare D1, brak write do `main` bez worktree.
- Delivery: Engineer→QA→Done, max 2 aktywne deliverable, `BLOCKER/OWNER/ACTION` dla zablokowanych.

## Sekcje i routing ról

Lazy-load: CEO/COO/CTO/Engineer/UI QA/Designer/CMO ładują różne sekcje. `docs/AI-REPO-MAP.md` pozostaje routing table dla warstwy technicznej.

## Mapa systemu — skrót REPO MAP

Kanoniczne lokalizacje: `kompas-ui-plugin/web/src/static-app-v2.js` (render), `styles.css`, `cloudflare-worker/src/public-ui.ts` (MCP), `oauth.ts`/`panel-handler.ts`, `server/index.ts`, `e2e/`, `lighthouserc.json`, `kompas-ui-design/opendesign`, `onboarding-emails/`. Komendy: `npm run build`, `npm run test:all`.

## Cykl, Design, Produkcja

Docelowe 4 etapy: **Planowanie → Realizacja → Refleksja → Doskonalenie**. Materiały `00`–`06` i model 9 kroków są historyczne/metodologiczne. Brand DNA: mapa/topografia, bez poziomic/gradientów. Produkcja: Worker `wtyczka-rr`, kolejność `build → build-worker.mjs → wrangler deploy --dry-run → deploy --keep-vars`.

## Wykonanie kontraktowe

CONTEXT-FIRST: `PAPERCLIP_WAKE_PAYLOAD_JSON`→HANDOFF→REPO MAP→targeted reads→code. STARTUP I/O BUDGET: 1 odczyt heartbeat, git `branch --show-current`+`status --short`, bez szerokiego discovery, autorytatywność mutacji bez potwierdzającego GET.

> Techniczna baza źródłowa: `raw/WSPOLNY_KONTEKST.md`. Aktualna wizja produktowa zsynchronizowana z decyzjami z 2026-08-27; status implementacji wymaga osobnej weryfikacji CURRENT / AS-IS.