---
title: Baza aktywności RR — PRD i kontrakt API
type: source
tags: [baza-aktywnosci, api, prd]
sources: [raw/PRD-BAZA-AKTYWNOSCI-RR.md, raw/API-SPRAWNOSCI.md, raw/API-DATA-GODZINA.md]
created: 2026-08-20
updated: 2026-08-27
---

# Baza Aktywności RR i API sprawności

## Baza Aktywności RR — model produktowy

Baza Aktywności RR jest wspólną, ręcznie moderowaną bazą gotowych aktywności. Użytkownicy mogą dodawać aktywności z opisem i kategoriami, m.in. wiekiem, czasem trwania i materiałami. Wpis trafia do wspólnej bazy po akceptacji moderatora; celem moderacji jest odfiltrowanie przypadkowych lub słabych wpisów.

Z zaakceptowanych aktywności można korzystać ręcznie w panelu i przez asystenta w ChatGPT. Aktywność może zostać wpięta do planu konkretnej zbiórki jako element przebiegu, zamiast przepisywania jej od zera.

## Baza Aktywności RR — kontrakt techniczny

Kanał odczytu przez Worker: `zabawy.kompaszbiorek.pl`. Dostępne filtry obejmują `category` (multiselect), `level`, `energy`, `participants`; wynik zwraca wszystkie dopasowania bez paginacji. Brak pola lub danych nie może być uzupełniany zmyśleniem — obowiązuje `Brak danych`.

Kontrakt MVP i walidację opisuje `raw/PRD-BAZA-AKTYWNOSCI-RR.md`.

## Sprawności RR — model produktowy

Instruktor wybiera sprawności realizowane przez drużynę i przypisuje konkretne wymagania do aktywności. Zaplanowane wymaganie nie oznacza wykonania — wykonanie zaznacza się dopiero po aktywności, w podsumowaniu/refleksji. Jedno wymaganie może być realizowane przez kilka aktywności.

Po ukończeniu wszystkich wymagań sprawność zostaje domknięta i system tworzy zadanie wręczenia naszywki.

System może sugerować aktywności lub sprawności na podstawie kontekstu drużyny oraz pomagać zauważyć brak balansu czterech aspektów programu: fizycznego, społecznego, duchowego i intelektualnego.

## Sprawności RR — kontrakt API

`sprawnosci.kompaszbiorek.pl` / `pobierzSprawnosciRR`: jedno wywołanie na odpowiedź, jeden poziom, bez retry. Wymagania muszą pochodzić z oficjalnego źródła RR; nie wolno ich wymyślać.

## Data/godzina

Integracja daty/godziny pozostaje zablokowana: brak bazowego URL i OpenAPI; strefa `Europe/Warsaw`.

## Stopnie RR

Pełna integracja ze stopniami pozostaje poza aktualnym zakresem. Nie obiecywać automatycznej integracji ze stopniami. Jeżeli pojawia się brakujące wymaganie stopnia w materiale roboczym, używać jawnego placeholdera zamiast wymyślania treści.

> Źródła techniczne: `raw/PRD-BAZA-AKTYWNOSCI-RR.md`, `raw/API-SPRAWNOSCI.md`, `raw/API-DATA-GODZINA.md`, `raw/documentation.md`. Model produktowy zsynchronizowany z Docs 2026-08-27.