---
title: PRD Kompas Zbiórek v1.7 — zakres produktu
type: source
tags: [prd, produkt, wymagania]
sources: [raw/PRD-KOMPAS-ZBIOREK.md]
created: 2026-08-20
updated: 2026-08-27
---

# PRD Kompas Zbiórek v1.7

Ta strona zachowuje traceability do `raw/PRD-KOMPAS-ZBIOREK.md` i opisuje wymagania produktu. **Nie jest raportem wykonania i nie może być używana jako dowód, że dana funkcja została już wdrożona.**

Status implementacji należy ustalać osobno jako CURRENT / AS-IS na podstawie aktualnego kodu, integracji, testów i standupu.

Docelowy model produktu jest opisany jako **TARGET / MUST-HAVE**: elementy tej warstwy są wymagane w wizji finalnego Kompasu, nawet jeśli nie są jeszcze ukończone.

## Cel produktu — TARGET / MUST-HAVE

Pomóc instruktorowi Royal Rangers przejść od improwizowanego planowania do prostego, powtarzalnego procesu, który łączy cele, sprawności, aktywności, przygotowanie, realizację, refleksję i poprawę następnej aktywności.

Produkt poprawia jakość procesu i decyzji, ale nie decyduje za lidera. Docelowo AI jest opcjonalnym interfejsem do tego samego procesu; cały proces ma być możliwy także ręcznie w panelu.

Docelowy cykl user-facing: **Planowanie → Realizacja → Refleksja → Doskonalenie**.

Starszy opis ~2-tygodniowego cyklu `obserwacje → problem → praprzyczyna → hipoteza → próby → wnioski → reguła` pozostaje materiałem metodologicznym, ale nie jest głównym kontraktem produktu ani pierwszym wejściem komunikacyjnym.

## Karta zbiórki / aktywności — TARGET / MUST-HAVE

Docelowy samowystarczalny artefakt roboczy obejmuje dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy i refleksję. Powtarzalne dane mają być edytowalne w tabelach.

Docelowy model planowania obejmuje:
- plan roczny jako kierunek;
- cel na około 3 miesiące;
- cel główny konkretnej aktywności;
- elementy aktywności z czasem trwania;
- cztery aspekty: fizyczny, społeczny, duchowy, intelektualny;
- materiały i zadania przygotowawcze;
- opcjonalny mały eksperyment;
- refleksję po realizacji i decyzję, co poprawić dalej.

Wszystkie powyższe elementy są zatwierdzonymi must-have’ami wizji. Ta lista nie deklaruje ich bieżącego stopnia implementacji.

## Sprawności — TARGET / MUST-HAVE

- wymagania sprawności pochodzą z oficjalnego katalogu RR;
- zaplanowane wymaganie nie oznacza wykonania;
- wykonanie potwierdza się po aktywności;
- jedno wymaganie może być realizowane przez kilka aktywności;
- po ukończeniu wszystkich wymagań sprawność zostaje domknięta;
- system docelowo tworzy zadanie wręczenia naszywki;
- przy braku danych obowiązuje `Brak danych`, bez wymyślania wymagań.

## Baza Aktywności RR — TARGET / MUST-HAVE

Docelowo Baza Aktywności RR jest wspólną, ręcznie moderowaną bazą. Użytkownicy mogą dodawać aktywności z opisem i kategoriami; zaakceptowane wpisy są dostępne w panelu i przez asystenta. Aktywność można wpiąć do planu bez przepisywania jej od zera.

## Pamięć drużyny — TARGET / MUST-HAVE

Google Sheets jest docelową trwałą pamięcią i stanem drużyny. Arkusz może być wspólnym kontekstem kilku liderów. Istotny zapis następuje po podglądzie i potwierdzeniu użytkownika.

## Onboarding

**Brak zatwierdzonego kontraktu.** Poprzednie wersje onboardingu nie mają obecnie akredytacji produktowej i nie należą do obowiązującego PRD ani wizji do czasu nowej decyzji.

## Stan bieżący / CURRENT

Ta strona nie utrzymuje listy funkcji wykonanych. Dla pytania „czy to już działa?” agent ma sprawdzić aktualny stan w:
- [[wiki/projects/kompas-zbiorek/standup]];
- [[wiki/sources/integracje-mcp]];
- odpowiedniej stronie encji lub integracji;
- kodzie i testach, jeżeli są dostępne.

Brak potwierdzenia oznacza `niepotwierdzony stan bieżący`, a nie automatyczne `działa`.

## Ograniczenia obowiązujące w komunikacji

- decyzje pozostają po stronie instruktora;
- nie obiecywać idealnych rezultatów ani automatycznego przygotowania idealnej zbiórki;
- nie przedstawiać TARGET jako CURRENT;
- nie wymyślać statystyk, liczby użytkowników ani efektów procentowych.

> Źródło historyczne wymagań: `raw/PRD-KOMPAS-ZBIOREK.md`. Aktualna wizja TARGET / MUST-HAVE zsynchronizowana z decyzjami produktowymi 2026-08-27. Stan wykonania jest osobną warstwą CURRENT / AS-IS.