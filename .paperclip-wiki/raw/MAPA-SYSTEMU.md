# Mapa systemu Kompas Zbiórek

## Pliki produktu

| Plik | Rola | Użycie w systemie (Wtyczka ChatGPT + Interfejs) |
|---|---|---|
| `PRD Kompas Zbiórek.md` | Zakres, wymagania i kryteria akceptacji | Aktualny kontrakt 4 etapów; AS-IS/TO-BE/DELTA: [KOMAA-48](/KOMAA/issues/KOMAA-48) |
| `Prompt systemowy.md` | Zachowanie, routing, tryby i narzędzia | Instrukcje dla wtyczki ChatGPT |
| `00_ANALIZA_PROBLEMU.md` … `06_CYKL_DOSKONALENIA.md` | Dawne opisy metodyki | **HISTORYCZNE/METODOLOGICZNE** traceability; nie definiują bieżącego user-facing flow |
| `SZABLON GOOGLE DOCS.md` | Kontrakt i treść dokumentu zastępu (podstawa szablonu arkusza Google Sheets) | Struktura realizowana przez panel `/panel` (kopia szablonu arkusza) |
| `Dokumentacja API SPRAWNOŚCI.md` | Parametry i użycie `pobierzSprawnosciRR` | Wiedza wtyczki + OpenAPI Action |
| `Dokumentacja API DATY I GODZINY.md` | Oczekiwany kontrakt czasu | Nie podłączać przed uzupełnieniem bazowego URL i OpenAPI |
| `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md` | PRD, model danych, walidacja i kontrakt bazy zabaw | Wiedza wtyczki + osobne OpenAPI Action |

Pliki `.obsidian` są lokalną konfiguracją edytora i nie należą do pakietu wtyczki.

## Aktualny cykl produktu (4 etapy)

```text
Planowanie -> Realizacja -> Analiza -> Decyzja

Planowanie: Cel i sprawności -> Przebieg -> Przygotowanie
```

Są to jedyne zatwierdzone checkpointy. Dla Realizacji, Analizy i Decyzji nie zdefiniowano podzadań ani bramek. Stan AS-IS, TO-BE i DELTA prowadzi [KOMAA-48](/KOMAA/issues/KOMAA-48).

## Materiał historyczny / metodologiczny

Pliki `00`–`06` oraz model 9 kroków zachowano dla traceability. Nie są aktualnym kontraktem produktu i nie stanowią zatwierdzonego mapowania na cztery etapy.

## Status integracji

| Integracja | Status | Zasada do czasu uruchomienia |
|---|---|---|
| Google Sheets (panel `/panel`) | Wdrożone (faza 1+2) | Trwały zapis karty zbiórki do wybranego arkusza; zapis tylko po podglądzie i potwierdzeniu; bez sesji panelu brak zapisu |
| Data i czas | Zablokowana: brak bazowego URL i OpenAPI | Strefa `Europe/Warsaw`; dokładną datę potwierdzić, gdy wpływa na decyzję |
| Sprawności RR | OpenAPI v14 zweryfikowane; Action do podłączenia | Używać `pobierzSprawnosciRR` najwyżej raz na odpowiedź |
| Stopnie RR | Planowane | Nie wymyślać wymagań; użyć aktualnego oficjalnego dokumentu albo oznaczyć brak |
| Baza aktywności RR | Kontrakt MVP opisany; API odczytu do implementacji | Tylko odczyt i filtrowanie wszystkich dopasowanych aktywności |
| ChatGPT Canvas | Zależny od interfejsu | Używać do jawnego artefaktu; w razie braku zwrócić Markdown |

## Podłączenie narzędzi programu RR

Po podłączeniu Action sprawności trzeba wykonać testy scenariuszy z dokumentacji API. Po przygotowaniu osobnego Action stopni trzeba zaktualizować trzy miejsca:

1. W `Prompt systemowy.md` dodać nazwę operacji stopni, wymagane parametry i zachowanie przy błędzie.
2. W `PRD Kompas Zbiórek.md` przenieść stopnie z integracji planowanej do bieżącego zakresu.
3. W `05_PLANOWANIE_ZBIORKI_I_WYJAZDU.md` dodać wejście i format przekazania wyniku stopnia.

Nie kopiować pełnej, zmiennej listy stopni i sprawności do pozostałych źródeł. Właściwe API lub aktualny oficjalny dokument ma pozostać źródłem prawdy.

## Kontrola wersji

Po zmianie granicy etapu lub formatu wyjścia zwiększ `wersja` w metadanych odpowiedniego źródła. Zmiana samej redakcji nie wymaga nowej wersji kontraktu.
