---
title: Żar i Szlif — durable knowledge (technicznie Kompas Zbiórek)
type: project
tags: [kompas-zbiorek, prd, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/PRD-KOMPAS-ZBIOREK.md, raw/MAPA-SYSTEMU.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-10-19
---

# Żar i Szlif (technicznie Kompas Zbiórek) — durable knowledge

## Jak czytać

Ten dokument przechowuje **trwałe prawdy produktowe i architektoniczne**. Nie jest rejestrem aktualnego wdrożenia.

- **TARGET / MUST-HAVE** — zatwierdzony stan docelowy.
- **CURRENT / AS-IS** — stan potwierdzony kodem/runtime/testem/schema.
- **DELTA** — różnica TARGET ↔ CURRENT.
- **UNAPPROVED / DO NOT ASSUME** — pomysł bez zatwierdzenia.

CURRENT należy weryfikować targeted, a nie wyprowadzać z PRD.

## Najważniejsza prawda o produkcie

Żar i Szlif (nazwa publiczna; technicznie Kompas Zbiórek) pomaga instruktorom Royal Rangers prowadzić powtarzalny proces **Planowanie → Realizacja → Refleksja → Doskonalenie**. Główna wartość to prostsze planowanie, brak pustej kartki i ciągłość pomiędzy aktywnościami. Problem solving, refleksja i eksperymenty są warstwą pogłębiającą. **AI nie jest wbudowane w produkt**; jest tylko opcjonalnym, zewnętrznym interfejsem przez autoryzowane MCP aplikacji. Decyzje pozostają po stronie instruktora.

## Docelowy model pracy — TARGET

1. Plan roczny wyznacza kierunek.
2. Instruktor ustala cel konkretnej aktywności w kontekście dłuższego celu.
3. Dobiera sprawności i konkretne wymagania.
4. Buduje plan z elementów aktywności i czasem; element może wspierać aspekt fizyczny, społeczny, duchowy lub intelektualny.
5. System pomaga zauważyć brak balansu i może podpowiadać aktywności/sprawności na podstawie dostępnego kontekstu.
6. Instruktor dodaje materiały, zadania przygotowawcze i opcjonalny mały eksperyment.
7. Po aktywności zapisuje wynik, opinie/refleksję i faktycznie wykonane wymagania sprawności.
8. W Doskonaleniu wybiera co powtarza, zmienia lub odrzuca i planuje kolejną małą zmianę.

Pełne wymagania i szczegóły: [[wiki/sources/prd-kompas]]. Nie ładuj pełnego PRD, jeśli issue nie dotyczy konkretnego requirementu/coverage.

## Jednostki produktu

- Zbiórka = jedna aktywność.
- Biwak/wyjazd/obóz = sekwencja aktywności.
- Aktywność ma cel główny i plan z elementów.
- Element ma czas i może być powiązany z jednym z czterech aspektów.

## Sprawności

- wymagania pochodzą z oficjalnego źródła RR; nie wolno ich wymyślać;
- zaplanowane wymaganie ≠ wykonane wymaganie;
- jedno wymaganie może być realizowane przez kilka aktywności;
- brak danych = jawny stan `Brak danych`.

## Architektura danych — invariant

**Supabase/Postgres jest jedynym application source of truth. Cloudflare D1 nie jest docelową bazą danych domenowych i nie należy tworzyć nowej warstwy D1.**

Supabase utrzymuje dane użytkowników/drużyn, role, karty aktywności, obecności, sprawności, przygotowanie, eksperymenty, refleksje, plan roczny, kalendarz, zadania, historię, formularze, zgody i metadane załączników. RLS/polityki dostępu są częścią kontraktu danych.

Cloudflare Worker jest warstwą API/integracji i bezpiecznego dostępu do sekretów. Pliki trafiają do Supabase Storage lub R2 zależnie od modułu.

Przed implementacją schema/data layer realny schema trzeba odczytać targeted przez Supabase/MCP.

## Baza Aktywności RR

Wspólna, moderowana baza aktywności dostępna w panelu i przez asystenta. Użytkownicy mogą proponować wpisy, ale publikacja do wspólnej bazy wymaga właściwego kontraktu moderacji. Szczegóły: [[wiki/sources/baza-aktywnosci]].

## Onboarding — TARGET (ostatnia decyzja 2026-10-18)

Trzy osobne procesy:
1. **Start i setup:** dwa CTA („Rozpocznij budowę obozowiska” / „Mam już konto — Zaloguj się”) → Google OAuth → wstępny zwierzak → dwa prywatne pytania: czas w RR i czas samodzielnego prowadzenia zbiórek → imię/nazwisko, szczep → utworzenie/nazwanie lub dołączenie do drużyny → kontrola unikalności gatunku → opcjonalne zaproszenia e-mail współprowadzących → obozowisko. Zbierane doświadczenie nie jest publiczną etykietą i nie blokuje funkcji. Konto gotowe wraca od razu do obozu; przerwany setup wznawia się.
2. **Pierwszy mail powitalny:** niezależny od zaproszeń; informacja o dodaniu nadawcy do ważnych/kontaktów albo odpowiedzi, nie jako zadanie onboardingu.
3. **Pierwsze misje po wejściu:** dodatkowa, nieblokująca checklista zawiera uzupełnienie danych drużyny / zaproszenie osób, plan roczny i pierwszą zbiórkę. **Roboczy Arc 1 po onboardingu** skupia się na Namiocie Zastępu: realia, umiejętności, wspólna historia przerobionych sprawności / wymagań stopni, podsumowanie. Cele rozwojowe i plan roczny później przy Stole Wypraw (Arc 2). Nie segmentować uczestników. Potwierdzenie newslettera jest osobnym zadaniem. Szczegóły: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]] (**WORKING DRAFT**).

Starsza kolejność `Google → imię/nazwisko → szczep → drużyna → panel` jest **superseded** co do etapów. Kanon: [[wiki/concepts/onboarding]]. **TARGET, nie CURRENT.**

## Pozycjonowanie

Hierarchia wartości:
1. prostsze planowanie i brak pustej kartki;
2. ciągłość celów, sprawności, materiałów, zadań i planu;
3. lepsze przygotowanie i bardziej zróżnicowane aktywności;
4. pamięć i historia drużyny;
5. opcjonalne zewnętrzne AI przez MCP, bez wbudowanego AI w UI;
6. refleksja i małe eksperymenty.

Marketing może mówić „działa/możesz/system robi” tylko o elementach potwierdzonych jako CURRENT.

## Żar i Szlif — nowa warstwa świat / gamifikacja (TARGET, 2026-10-14)

Właściciel produktu zatwierdził świat wspólnego obozowiska drużyny: postacie Iskra (lis) i Szlif (kruk), unikalne gatunki awatarów w ramach drużyny z możliwością zmiany oraz **jedno członkostwo drużynowe na użytkownika**. Osobiste Iskry z wybranych zadań finansują wygląd awatara, a drużynowe z innych zadań — wygląd wspólnego obozu; zakupy nie wymagają zatwierdzenia i są bezzwrotne. Wizualne ulepszenia budowli przy stałych lokalizacjach mają 2–3 warianty, zakupione warianty zostają na zawsze i można je za darmo zmieniać. Fabuła jest powiązana z obiektami, lecz scenki występują też podczas używania funkcji bez zakupów. Wszystkie budynki-moduły są dostępne domyślnie i objaśniane dialogiem tylko za pierwszym wejściem (potem na żądanie). **Dalsze decyzje:** gatunki zwierząt rozszerzane według potrzeb, lis i kruk zarezerwowane dla NPC, obowiązkowy nowy wybór zwierzątka po zmianie drużyny, personalizacja tylko kolory i podstawowe ubranka. Pomysły/własne zadania nagradzają portfel osobisty, planowanie i realizacja zbiórek — drużynowy. Historia odkryć jest osobista, choć obozowisko jest wspólne; zakupy obozowe to wyłącznie kosmetyczne warianty istniejących budynków, bez osobnych dekoracji. Nie można oglądać obozów innych drużyn. **Nie jest to dowód wdrożenia.** Źródło szczegółowe i otwarte decyzje: [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]].

## Ekran główny MVP i sześć punktów obozu (TARGET, decyzje 2026-10-18 i 2026-10-19)

Po zalogowaniu **na głównym ekranie** domyślnie rozwinięta **kartka przygotowań** pokazuje najbliższą aktywność i termin, czy jest plan, **liczbę zadań i materiałów pozostałych do przygotowania**, widoczne listy zadań i materiałów oraz listę kolejnych aktywności. Kartkę można **zminimalizować i rozwinąć** bez opuszczania głównego ekranu, aby zwolnić miejsce dla mapy obozu. Informacje z istniejących danych; brak aktywności to jawny pusty stan.

**Dokładnie sześć miejsc mapy:** Ognisko (wspólnota, portfele, awatary, fabuła); Namiot Zastępu (szybki odczyt i rzadka aktualizacja kontekstu i danych zastępu, także przez MCP aplikacji); Stół Wypraw (plan roczny, zbiórki, zadania, materiały i realizacja); Pracownia Iskry (pomysły, Baza Aktywności RR); Gniazdo Szlifa (refleksje, historia, doskonalenie); Tablica Sprawności i Stopni (oficjalne wymagania, planowanie i rzeczywiste postępy). **Brak drugiego namiotu** i osobnej Polany Drużyny. Kontekst i planowanie to różne domeny; Supabase/Postgres pozostaje jedynym application SSOT. Wersja robocza Arc 1: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]]; szczegóły nadal nie są finalnie zatwierdzone.

**Stały Dziennik Aktywności** (nazwa robocza) znajduje się przy Stole Wypraw jako szybki widok i edytor kanonicznych kart minionych oraz nadchodzących aktywności; nie dodaje siódmej lokacji ani równoległej bazy. Planowanie, karty i księga działają bez AI; ewentualne AI poza aplikacją przez MCP.

**Robot Łącznik MCP** (robocza nazwa) stoi w obozowisku przy Ognisku i tłumaczy użytkownikowi, jak dobrowolnie podłączyć **produktowy MCP Żar i Szlif** do ChatGPT lub Claude (instrukcje platform, OAuth, adres endpointu, rozwiązywanie problemów). **Nie jest siódmą lokacją ani wbudowanym AI**. Pokazuje tylko rzeczywiście dostępny endpoint, bez fikcyjnego statusu połączenia; aktualne kroki i źródła w [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]]. TARGET 2026-10-20, nie CURRENT.

**Arc 2 — proste planowanie:** plan roczny zaczyna się od obowiązkowego tematu roku. Cztery horyzonty WRZ–PAŹ–LIS, GRU–STY–LUT, MAR–KWI–MAJ, CZE–LIP–SIE stanowią szkielet, ale szczegółowo planowany jest tylko bieżący 3-miesięczny odcinek: **jeden cel główny z DoD**, opcjonalne **kamienie milowe (podetapy celu z prostymi warunkami ukończenia)** i sprawności, aktywności dodawane bezpośrednio przy miesiącach przez **„+ Dodaj aktywność”**. Nie opierać planowania na metodyce ERP Scout. [[wiki/concepts/arc-02-wyznaczamy-kierunek]].

Detale koncepcji i UX: [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]]. **TARGET — nie dowodzi wdrożenia.**

**Arc 3 (tylko Planowanie):** na rzeczywistej Karcie Zbiórki użytkownik wykonuje trzy krótkie zadania: **„Wybierz cel wyprawy”** (nazwa/data/czas, cel, sprawności, kontekst 3 miesięcy), **„Ułóż trasę zbiórki”** (godzinowy przebieg), **„Spakuj potrzebne rzeczy”** (przygotowanie, materiały i zadania). **Pierwsza zbiórka nie ma poprzedniego eksperymentu**. Szczegóły: [[wiki/concepts/arc-03-przygotujmy-zbiorke]] i kanoniczna mapa pól: [[wiki/concepts/karta-zbiorki]].

**Arc 4 (po realizacji):** **Podsumowanie** — rzeczywisty przebieg elementów, faktycznie wykonane wymagania, potwierdzone kamienie milowe oraz wnioski; jeśli eksperyment naprawdę wykonano, także czy przyniósł poprawę, czego nauczył i czego nadal nie wiadomo. **Problemy** — opcjonalna decyzja co zmienić i ewentualny eksperyment dopiero **na następną zbiórkę**. Otwarte wymagania i kamienie mogą być proponowane w przyszłych kartach, bez automatycznego zaliczania. Szczegóły: [[wiki/concepts/arc-04-co-zabieramy-dalej]]. Fabuła i dokładny UX nadal robocze.

## Główne workstreams

- karta aktywności i planowanie;
- sprawności + Baza Aktywności RR;
- Supabase data layer + API Worker;
- kalendarz, zadania i historia;
- integracje Google/ChatGPT;
- design system i Quality Gate;
- onboarding zgodnie z [[wiki/concepts/onboarding]].

## Decisions

- cykl: Planowanie → Realizacja → Refleksja → Doskonalenie;
- planowanie jest głównym wejściem produktu;
- brak wbudowanego AI w aplikacji; opcjonalne AI wyłącznie poza aplikacją przez MCP;
- TARGET i CURRENT są osobnymi warstwami;
- Supabase/Postgres = application SSOT;
- Cloudflare Worker = API/integrations, nie drugi SSOT;
- onboarding = zatwierdzony TARGET zgodnie z [[wiki/concepts/onboarding]];
- brak danych nie może być zastępowany fikcyjną treścią.

## References

- bootstrap: [[wiki/sources/wspolny-kontekst]]
- decyzje: [[wiki/projects/kompas-zbiorek/decisions]]
- PRD: [[wiki/sources/prd-kompas]]
- onboarding: [[wiki/concepts/onboarding]]
- Arc 1 (working draft): [[wiki/concepts/arc-01-nasz-pierwszy-namiot]]
- Arc 2 (uzgodnione reguły, roboczy scenariusz): [[wiki/concepts/arc-02-wyznaczamy-kierunek]]
- integracje/data: [[wiki/sources/integracje-mcp]]
- repo map: [[wiki/entities/repo-map]]
- execution: [[wiki/concepts/context-first-execution]]