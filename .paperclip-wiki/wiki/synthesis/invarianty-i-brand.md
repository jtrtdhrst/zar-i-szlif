---
title: Invarianty techniczne i Brand DNA — synteza
type: synthesis
tags: [invarianty, brand, synteza]
sources: [raw/WSPOLNY_KONTEKST.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-08-27
---

# Invarianty techniczne i Brand DNA

## Invarianty techniczne

Nie zmieniać bez upoważnienia: publiczny system `https://panel.kompaszbiorek.pl`, UI `/ui`, MCP `/mcp`, OAuth `drive.file`, Cloudflare D1, domena `kompaszbiorek.pl`, Worker `panel-kompaszbiorek` jako cel deploya, brak write do `main` bez worktree, `isolated_workspace` tylko.

## Brand DNA UI

Mapa/topografia jako metafora; żółto-złoty akcent oszczędnie; serif display + sans geometryczny; hierarchia > dekoracja. Zakaz poziomic, koncentrycznych kół, gradientów i offsetowych cieni. Tokeny kanoniczne w `kompas-ui-design/opendesign`. Szczegóły: [[wiki/concepts/brand-dna]].

Konsekwencja UI: działanie główne ma być widoczne, data/godzina nie konkuruje z tytułem, karty mają czyste tło, a mobile nie może wymagać poziomego scrolla.

## Pozycjonowanie produktu — TARGET / MUST-HAVE

Kompas nie jest przede wszystkim generatorem planów ani narzędziem do problem solvingu. Główna wartość docelowego produktu to obniżenie progu wejścia do dobrego, powtarzalnego planowania i połączenie kolejnych aktywności w jeden proces.

Hierarchia przekazu wizji:
1. prostsze planowanie i brak pustej kartki;
2. ciągłość: sprawności, cele, materiały, zadania i plan w jednym procesie;
3. lepsze przygotowanie i bardziej zróżnicowane aktywności;
4. wspólna pamięć drużyny;
5. AI jako opcjonalny, wygodny interfejs rozmowy;
6. refleksja, małe eksperymenty i poprawa działania między aktywnościami.

Problem solving, systematyczne doskonalenie i eksperymenty są ważne, ale są drugą warstwą wartości. Nie zaczynać od nich automatycznie w komunikacji.

## Głos marki

Mówić jak doświadczony instruktor do instruktora: po polsku, konkretnie, bez zadęcia i bez udawania kumpla na siłę.

Zasady:
- pisać do jednej osoby: „ty”, „twoja drużyna”, „sprawdź”, „zaplanuj”, „wybierz”;
- zaczynać od sytuacji, którą instruktor rozpoznaje, a dopiero potem pokazywać funkcję;
- pokazywać proces, nie magię;
- przedstawiać AI jako opcjonalny sposób przejścia tego samego procesu;
- zawsze odróżniać plan od wykonania;
- nie moralizować i nie przypisywać instruktorowi winy za każdy problem uczestników;
- używać konkretnej korzyści zamiast pustych obietnic.

## Język produktu

Preferowane terminy: aktywność, element aktywności, cel główny aktywności, plan roczny, cel na około 3 miesiące, sprawność, wymaganie sprawności, aspekt fizyczny/społeczny/duchowy/intelektualny, materiały, zadania przygotowawcze, eksperyment, podsumowanie, refleksja, Kontekst, Archiwum, Baza Aktywności RR, asystent w ChatGPT / wtyczka do ChatGPT.

W komunikacji zewnętrznej nie używać technicznego żargonu typu MCP, skills, tools ani języka SaaS typu enterprise, synergy, workflow engine. Nie zamieniać „elementu aktywności” na własne terminy bez potrzeby.

## Audience

Główna grupa: każdy czynny instruktor Royal Rangers, który planuje i prowadzi aktywności dla drużyny lub zastępu.

Nie zawężać marki wyłącznie do nowych instruktorów. Młodsi i mniej doświadczeni instruktorzy są jednak ważniejszą grupą komunikacyjnie, bo częściej potrzebują prowadzenia krok po kroku i niższego progu wejścia do planowania.

Najważniejszy insight: instruktor rzadko myśli „mam słaby proces planowania”. Częściej widzi skutki — brak zaangażowania, powtarzalność aktywności, przypadkowy progres, późne przygotowanie albo brak refleksji. Komunikacja ma pokazać obszar wpływu bez oskarżania.

Realnym konkurentem Kompasu jest często brak procesu i improwizacja, nie inna aplikacja.

## Proof i wiarygodność

Na obecnym etapie nie ma wystarczających danych użytkowników, testimoniali ani wyników, by budować komunikację na social proofie.

Dlatego:
- pokazywać mechanizm produktu krok po kroku;
- używać realnych ekranów, przepływów i przykładów demonstracyjnych;
- jasno oddzielać przykład od wyniku osiągniętego przez użytkownika;
- nie używać wymyślonych opinii, statystyk, procentowych efektów ani liczby zadowolonych użytkowników;
- nie używać sformułowań typu „sprawdzone na drużynach”, dopóki nie ma na to danych.

## Reguła statusu przed publikacją

Przed napisaniem komunikatu agent marketingowy ma ustalić status opisywanej funkcji:

- **CURRENT / AS-IS** — można mówić o funkcji jako dostępnej dziś: „możesz”, „system robi”, „w panelu znajdziesz”.
- **TARGET / MUST-HAVE** — funkcja należy do zatwierdzonej wizji i ma powstać, ale bez potwierdzenia CURRENT nie wolno przedstawiać jej jako dostępnej dziś.
- **UNAPPROVED / DO NOT ASSUME** — nie komunikować jako funkcji ani planu produktu.

Szczegóły statusów: [[wiki/sources/wspolny-kontekst]].

## Docelowe obietnice produktu — TARGET / MUST-HAVE

W zatwierdzonej wizji produktu znajdują się m.in.:
- prowadzenie przez planowanie krok po kroku;
- ręcznie moderowana Baza Aktywności RR;
- sugestie aktywności i sprawności na podstawie kontekstu;
- pilnowanie balansu czterech aspektów;
- śledzenie faktycznego wykonania wymagań sprawności;
- zadanie wręczenia naszywki po ukończeniu sprawności;
- trwała i współdzielona pamięć drużyny w Google Sheets;
- AI jako opcjonalny interfejs do tego samego procesu.

Ta lista definiuje **docelową wartość produktu**, a nie automatycznie listę funkcji dostępnych dziś.

## Ograniczenia komunikacji niezależne od statusu

Nie można obiecywać:
- że AI podejmuje decyzje za instruktora;
- że każda sugestia będzie dobra;
- idealnych efektów wychowawczych;
- funkcji jako dostępnej dziś bez potwierdzenia CURRENT;
- wymyślonych rezultatów, liczb i testimoniali.

Onboarding nie ma obecnie zatwierdzonego kontraktu i nie może być używany jako element obietnicy ani flow produktu do czasu nowej decyzji.

Aktualna wizja i statusy: [[wiki/projects/kompas-zbiorek/index]], [[wiki/sources/wspolny-kontekst]], [[wiki/concepts/cykl-doskonalenia]].

> Zasady komunikacji, audience i proof zsynchronizowane z decyzjami 2026-08-27; techniczne invarianty i UI zachowują traceability do istniejących źródeł repo.