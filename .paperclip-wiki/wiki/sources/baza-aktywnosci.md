---
title: Baza aktywności RR — PRD i kontrakt API
type: source
tags: [baza-aktywnosci, api, prd]
sources: [raw/PRD-BAZA-AKTYWNOSCI-RR.md, raw/API-SPRAWNOSCI.md, raw/API-DATA-GODZINA.md]
created: 2026-08-20
updated: 2026-08-20
---

# Baza aktywności RR i API sprawności

**Baza aktywności RR** (`zabawy.kompaszbiorek.pl`) — kanał odczytu przez Worker. Filtry `category` (multiselect), `level`, `energy`, `participants`; zwraca wszystkie dopasowania bez paginacji; brak pola → `Brak danych`. Osobne OpenAPI Action (kontrakt MVP w `raw/PRD-BAZA-AKTYWNOSCI-RR.md`: model danych, walidacja).

**Sprawności RR** (`sprawnosci.kompaszbiorek.pl`) — `pobierzSprawnosciRR` jedno wywołanie na odpowiedź, jeden poziom, bez retry; nie wymyślać wymagań (raw/API-SPRAWNOSCI.md v14).

**Data/godzina** — zablokowana: brak bazowego URL i OpenAPI, strefa `Europe/Warsaw` (raw/API-DATA-GODZINA.md).

**Stopnie RR** — planowane, źródło prawdą oficjalny dokument lub placeholder `Wymaganie stopnia: do uzupełnienia`.

> Źródła: `raw/PRD-BAZA-AKTYWNOSCI-RR.md`, `raw/API-SPRAWNOSCI.md`, `raw/API-DATA-GODZINA.md`, `raw/documentation.md`.

