# Mapa systemu Kompas Zbiórek

## Pliki produktu

| Plik | Rola | Użycie w Custom GPT |
|---|---|---|
| `PRD Kompas Zbiórek.md` | Zakres, wymagania i kryteria akceptacji | Dokument projektowy, nie jest potrzebny jako wiedza modelu |
| `Prompt systemowy.md` | Zachowanie, routing, tryby i narzędzia | Wkleić do pola Instructions |
| `00_ANALIZA_PROBLEMU.md` | Fakty, stan oczekiwany i wybór problemu | Wgrać jako Knowledge |
| `01_PRAPRZYCZYNA_OPERACYJNA.md` | Mechanizm, 5 Why i granica analizy | Wgrać jako Knowledge |
| `02_HIPOTEZA_I_EKSPERYMENT.md` | Hipoteza, warunek docelowy i projekt próby | Wgrać jako Knowledge |
| `03_OCENA_I_PROWADZENIE_EKSPERYMENTU.md` | Ocena bezpieczeństwa i rejestr prób | Wgrać jako Knowledge |
| `04_WNIOSKI_I_WIEDZA.md` | Interpretacja, decyzja i reguła operacyjna | Wgrać jako Knowledge |
| `05_PLANOWANIE_ZBIORKI_I_WYJAZDU.md` | Planowanie programu, logistyki i bezpieczeństwa | Wgrać jako Knowledge |
| `06_CYKL_DOSKONALENIA.md` | Stany, bramki i rytm całego cyklu | Wgrać jako Knowledge |
| `SZABLON GOOGLE DOCS.md` | Kontrakt i treść dokumentu zastępu | Skopiować do Google Docs; opcjonalnie wgrać jako Knowledge |
| `Dokumentacja API SPRAWNOŚCI.md` | Parametry i użycie `pobierzSprawnosciRR` | Wgrać jako Knowledge razem z podłączeniem OpenAPI |
| `Dokumentacja API DATY I GODZINY.md` | Oczekiwany kontrakt czasu | Nie podłączać przed uzupełnieniem bazowego URL i OpenAPI |
| `PRD I DOKUMENTACJA API BAZY AKTYWNOŚCI RR.md` | PRD, model danych, walidacja i kontrakt bazy zabaw | Wgrać jako Knowledge; po implementacji podłączyć osobne OpenAPI jako Action |

Pliki `.obsidian` są lokalną konfiguracją edytora i nie należą do pakietu Custom GPT.

## Kolejność etapów

```text
Kontekst i ostatnie działanie
  -> 00 Problem priorytetowy
  -> 01 Praprzyczyna operacyjna
  -> 02 Hipoteza, warunek docelowy i projekt
  -> 03 Ocena, zamrożenie i próby
  -> 04 Wnioski, decyzja i wiedza
  -> wdrożenie / kolejna wersja / zamknięcie
  -> przegląd trwałości

05 Planowanie zbiórki lub wyjazdu korzysta z kontekstu i aktualnego stanu cyklu.
06 Koordynuje przejścia, ale nie zastępuje źródła właściwego etapu.
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
| Google Docs | Kontrakt treści gotowy, Action do podłączenia | System przygotowuje podgląd, ale nie deklaruje zapisu bez wyniku Action i odczytu kontrolnego |
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
