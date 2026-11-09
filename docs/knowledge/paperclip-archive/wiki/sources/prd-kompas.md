---
title: PRD Kompas Zbiórek v1.7 — zakres produktu
type: source
tags: [prd, produkt, wymagania]
sources: [raw/PRD-KOMPAS-ZBIOREK.md]
created: 2026-08-20
updated: 2026-09-12
---

# PRD Kompas Zbiórek v1.7

**Obecna nazwa publiczna produktu: Żar i Szlif.** Nazwa „Kompas Zbiórek” w tytule tego źródłowego PRD jest historyczna i zachowana dla traceability; nie stanowi drugiej aktywnej marki ani dowodu zmiany nazw technicznych. Kanoniczna decyzja: [[wiki/projects/kompas-zbiorek/decisions]].

Ta strona opisuje **TARGET / MUST-HAVE** i zachowuje traceability do historycznego `raw/PRD-KOMPAS-ZBIOREK.md`. Nie jest raportem wykonania. CURRENT / AS-IS wymaga aktualnego dowodu z kodu, runtime, schema lub testów.

## Cel produktu — TARGET

Pomóc instruktorowi Royal Rangers przejść od improwizowanego planowania do prostego, powtarzalnego procesu łączącego cele, sprawności, aktywności, przygotowanie, realizację, refleksję i poprawę kolejnej aktywności.

AI jest opcjonalnym interfejsem do tego samego procesu; decyzje pozostają po stronie instruktora.

Docelowy cykl: **Planowanie → Realizacja → Refleksja → Doskonalenie**.

Starszy model `obserwacje → problem → praprzyczyna → hipoteza → próby → wnioski → reguła` pozostaje materiałem metodologicznym, nie głównym onboardingiem ani podstawowym flow produktu.

## Karta aktywności — TARGET

Docelowy artefakt obejmuje:
- dane aktywności i obecność;
- sprawności i wymagania;
- cel główny;
- plan z elementów i czasem;
- cztery aspekty: fizyczny, społeczny, duchowy, intelektualny;
- materiały i zadania przygotowawcze;
- opcjonalny mały eksperyment;
- refleksję i decyzję co poprawić dalej.

### Wymagane zadania w etapach

- elementy, które trzeba wykonać w ramach danego etapu Karty aktywności, mają widoczny tick/checkbox zaliczenia;
- jeśli wymagane zadanie polega na wpisaniu treści do pola, wpisanie dowolnej niepustej treści automatycznie oznacza zadanie jako zaliczone;
- wyczyszczenie pola ponownie ustawia zadanie jako niezaliczone;
- stan tych zadań wlicza się do kompletności etapu i jego bramki przejścia dalej.

Plan roczny wyznacza kierunek; instruktor widzi również kontekst celu średnioterminowego.

## Sprawności — TARGET

- wymagania pochodzą z oficjalnego katalogu RR;
- zaplanowane wymaganie nie oznacza wykonania;
- wykonanie potwierdza się po aktywności;
- jedno wymaganie może być realizowane przez kilka aktywności;
- po ukończeniu wszystkich wymagań sprawność może zostać domknięta i system tworzy zadanie wręczenia naszywki;
- brak danych = `Brak danych`, bez wymyślania treści.

## Baza Aktywności RR — TARGET

Wspólna, ręcznie moderowana baza aktywności. Użytkownicy mogą proponować wpisy z opisem i kategoriami; zaakceptowane wpisy są dostępne w panelu i przez asystenta oraz mogą być użyte w planie bez przepisywania od zera.

## Pamięć i dane drużyny — TARGET

**Kanoniczna pamięć aplikacji znajduje się w Supabase/Postgres.** Obejmuje dane drużyny, historię, karty aktywności, obecności, sprawności, przygotowanie, eksperymenty, refleksje, plany, kalendarz i zadania.

Cloudflare Worker jest warstwą API/integracji pomiędzy klientem, Supabase i usługami zewnętrznymi.

## Onboarding — TARGET

Zatwierdzony flow rozdziela setup po rejestracji, pierwszy mail oraz zadania onboardingowe.

### Post-registration setup — kontrakt historyczny i nowsza decyzja

**Historyczna kolejność PRD: Google → imię i nazwisko → szczep → drużyna → panel aplikacji.**

**Nadrzędna decyzja użytkownika z 2026-10-18:** dwa CTA → Google OAuth → wstępny wybór zwierzaka → dwa prywatne pytania o staż RR i samodzielne prowadzenie zbiórek → imię/nazwisko i szczep → utworzenie/nazwanie lub dołączenie do drużyny → potwierdzenie wolnego gatunku → opcjonalne zaproszenia e-mail współprowadzących → obóz. Odpowiedzi służą prywatnemu wsparciu edukacyjnemu, nie publicznemu tagowaniu kompetencji. Pełny bieżący kanon TARGET: [[wiki/concepts/onboarding]]. Historyczną linię PRD zachowano dla traceability.

Zapraszanie współprowadzących, plan roczny, pierwsza zbiórka i newsletter nie blokują wejścia do aplikacji.

### Pierwszy mail po rejestracji

Pierwszy mail ma zawierać informację, aby użytkownik **dodał nadawcę do ważnych/kontaktów albo odpowiedział na wiadomość dowolną treścią**. Jest to element treści maila, nie pozycja checklisty onboardingu.

### Onboarding po wejściu do aplikacji

Rekomendowana kolejność zadań produktowych:

1. dodaj osoby do drużyny;
2. dodaj plan roczny;
3. zaplanuj pierwszą zbiórkę.

Osobnym zadaniem komunikacyjnym jest **potwierdzenie zapisu do newslettera**. Nie może ono blokować dostępu do konta ani właściwego produktu.

Pełny kontrakt i invarianty: [[wiki/concepts/onboarding]].

## CURRENT / AS-IS

Dla pytania „czy to działa?” użyj targeted evidence:
- aktualny kod/runtime/schema/test;
- [[wiki/sources/integracje-mcp]];
- właściwa strona domenowa;
- aktualny issue/review evidence.

Standup i stare snapshoty są pomocnicze, ale nie mogą nadpisać nowszego runtime.

Brak potwierdzenia = `niepotwierdzony stan bieżący`.

## Ograniczenia komunikacyjne

- nie przedstawiać TARGET jako CURRENT;
- nie obiecywać automatycznych idealnych rezultatów;
- nie wymyślać statystyk, testimonials ani efektów procentowych;
- marketing claims wymagają CURRENT evidence.

## Powiązania

- durable product knowledge: [[wiki/projects/kompas-zbiorek/index]]
- decyzje: [[wiki/projects/kompas-zbiorek/decisions]]
- onboarding: [[wiki/concepts/onboarding]]
- architektura danych/integracje: [[wiki/sources/integracje-mcp]]
- kontekst wykonawczy: [[wiki/concepts/context-first-execution]]