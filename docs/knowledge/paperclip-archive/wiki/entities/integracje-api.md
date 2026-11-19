---
title: Integracje zewnętrzne — status i zasady
type: entity
tags: [api, integracje, baza-aktywnosci, sprawnosci]
sources: [raw/WSPOLNY_KONTEKST.md, raw/API-SPRAWNOSCI.md, raw/PRD-BAZA-AKTYWNOSCI-RR.md]
created: 2026-08-20
updated: 2026-09-01
---

# Integracje zewnętrzne

Ta strona przechowuje **reguły**, nie zamrożony status runtime. Nazwy endpointów, wersje i dostępność tooli należy potwierdzać targeted w aktualnym kodzie/runtime przed użyciem jako CURRENT.

| Integracja | Reguła trwała |
|---|---|
| Baza Aktywności RR | używaj oficjalnego źródła/kontraktu; przy braku danych nie generuj fikcyjnych aktywności jako wynik API |
| Sprawności RR | wymagania muszą pochodzić z oficjalnego źródła RR; nie wymyślaj wymagań |
| Data/godzina | użyj dostępnego źródła czasu; bez źródła nie zgaduj wartości zależnych od czasu |
| Stopnie RR | nie zakładaj kontraktu bez zatwierdzonego źródła produktowego/API |
| Supabase | application SSOT; schema sprawdzaj przez targeted Supabase/MCP przed zmianami |
| Google | minimalne OAuth scopes adekwatne do konkretnej funkcji |

## CURRENT verification

Przed stwierdzeniem „integracja działa” sprawdź co najmniej jedno aktualne evidence: runtime/tool health, bieżący endpoint, test albo kod z aktywnym kontraktem. Historyczna nazwa narzędzia czy wersja API nie jest dowodem dostępności dziś.

## Brak danych

Niedostępna integracja → jawny `Brak danych` / konkretny błąd i bezpieczny fallback produktu. Nie maskuj braku API wygenerowaną treścią wyglądającą jak dane źródłowe.

Powiązane: [[wiki/sources/integracje-mcp]], [[wiki/sources/baza-aktywnosci]], [[wiki/concepts/stan-braku-danych]].