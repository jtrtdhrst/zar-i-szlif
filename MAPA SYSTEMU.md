# Mapa systemu Kompas Zbiórek

## Pliki produktu

| Plik | Rola | Użycie w systemie (Wtyczka ChatGPT + Interfejs) |
|---|---|---|
| `PRD Kompas Zbiórek.md` | Zakres, wymagania i kryteria akceptacji | Dokument projektowy, źródło dla 4 etapów cyklu |
| `Prompt systemowy.md` | Zachowanie, routing, tryby i narzędzia | Instrukcje dla wtyczki ChatGPT |
| `00_ANALIZA_PROBLEMU.md` | Fakty, stan oczekiwany i wybór problemu | **Etap 1 Diagnoza** — wiedza wtyczki |
| `01_PRAPRZYCZYNA_OPERACYJNA.md` | Mechanizm, 5 Why i granica analizy | **Etap 1 Diagnoza** — wiedza wtyczki |
| `02_HIPOTEZA_I_EKSPERYMENT.md` | Hipoteza, warunek docelowy i projekt próby | **Etap 2 Plan** — wiedza wtyczki |
| `03_OCENA_I_PROWADZENIE_EKSPERYMENTU.md` | Ocena bezpieczeństwa i rejestr prób | **Etap 3 Działanie** — wiedza wtyczki |
| `04_WNIOSKI_I_WIEDZA.md` | Interpretacja, decyzja i reguła operacyjna | **Etap 4 Refleksja** — wiedza wtyczki |
| `05_PLANOWANIE_ZBIORKI_I_WYJAZDU.md` | Planowanie programu, logistyki i bezpieczeństwa | **Etap 4 Refleksja / Planowanie** — wiedza wtyczki |
| `06_CYKL_DOSKONALENIA.md` | Stany, bramki i rytm całego cyklu (koordynacja 4 etapów) | Wiedza wtyczki — koordynacja etapów |
| `SZABLON GOOGLE DOCS.md` | Kontrakt i treść dokumentu zastępu (podstawa szablonu arkusza Google Sheets) | Struktura realizowana przez panel `/panel` (kopia szablonu arkusza) |
| `Dokumentacja API SPRAWNOŚCI.md` | Parametry i użycie `pobierzSprawnosciRR` | Wiedza wtyczki + OpenAPI Action |
| `Dokumentacja API DATY I GODZINY.md` | Oczekiwany kontrakt czasu | Nie podłączać przed uzupełnieniem bazowego URL i OpenAPI |
| `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md` | PRD, model danych, walidacja i kontrakt bazy zabaw | Wiedza wtyczki + osobne OpenAPI Action |

Pliki `.obsidian` są lokalną konfiguracją edytora i nie należą do pakietu wtyczki.

## Kolejność etapów (4 etapy)

```text
Kontekst i ostatnie działanie
  -> [1] Diagnoza (00 Problem priorytetowy + 01 Praprzyczyna)
  -> [2] Plan (02 Hipoteza, warunek docelowy i projekt)
  -> [3] Działanie (03 Próby — rejestr wykonania)
  -> [4] Refleksja (04 Wnioski/decyzja/wiedza + 05 Planowanie + 06 Koordynacja)
  -> wdrożenie / kolejna wersja / zamknięcie
  -> przegląd trwałości (~2 tyg.)

Szczegóły: 00/01 → Etap 1, 02 → Etap 2, 03 → Etap 3, 04/05/06 → Etap 4.
05 Planowanie zbiórki korzysta z kontekstu i stanu cyklu (w Etapie 4).
06 Koordynuje przejścia 4 etapów, nie zastępuje źródła właściwego etapu.
```

## Reguła jednego przejścia

Każdy plik `00-05` przekształca jedno określone wejście w jeden artefakt. Po akceptacji przekazuje wskazane pola do następnego pliku. `06` wybiera tylko jeden kolejny etap. Nie należy pobierać kilku źródeł po to, aby w jednej odpowiedzi wykonać cały cykl.

## Granice źródeł

- `00` kończy się przed analizą przyczyn.
- `01` kończy się przed projektowaniem rozwiązania.
- `02` kończy się zamrożonym projektem eksperymentu.
- `03` kończy się kompletem rekordów prób, bez końcowej interpretacji.
- `04` odpowiada za interpretację, decyzję i zapis wiedzy.
- `05` odpowiada za plan działania, nie za oficjalne treści programu RR.
- `06` odpowiada za stan i przejścia całego cyklu.

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
