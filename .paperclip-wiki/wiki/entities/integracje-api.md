---
title: Integracje zewnętrzne — status i zasady
type: entity
tags: [api, integracje, baza-aktywnosci, sprawnosci]
sources: [raw/WSPOLNY_KONTEKST.md, raw/API-SPRAWNOSCI.md, raw/PRD-BAZA-AKTYWNOSCI-RR.md]
created: 2026-08-20
updated: 2026-08-20
---

# Integracje zewnętrzne

| Integracja | Status | Zasada |
|---|---|---|
| Baza aktywności RR (`zabawy.kompaszbiorek.pl`) | odczyt przez Worker | filtry `category`/`level`/`energy`/`participants`, wszystkie dopasowania, brak paginacji |
| Sprawności RR (`sprawnosci.kompaszbiorek.pl`) | odczyt `pobierzSprawnosciRR` v14 | 1 poziom, 1 call/odpowiedź, bez retry |
| Data/godzina | zablokowane | `Europe/Warsaw`, bez narzędzia nie zgadywać |
| Stopnie RR | planowane | oficjalny dokument lub placeholder |
| Canvas | zależny | tylko jawny artefakt, inaczej Markdown |

Nie podłączać ani nie udawać niedostępnej integracji; przy braku — `Brak danych` + edytowalny opis.

