---
id: API_SPRAWNOSCI_RR
status: ready
openapi_version: 3.1.0
api_version: 14.0.0
zweryfikowano: 2026-08-05
---

# API sprawności Royal Rangers

## Kontrakt narzędzia

| Element | Wymaganie |
|---|---|
| Start | Użytkownik chce znaleźć sprawność lub poznać jej wymagania |
| Wymagane wejście | Dokładnie jeden `poziom`; brakujący poziom trzeba ustalić przed wywołaniem |
| Wynik | Odpowiedź z katalogu i liczba znalezionych sprawności |
| Dalej | Wybrane sprawności i wymagania przekaż do [[05_PLANOWANIE_ZBIORKI_I_WYJAZDU]] |
| Ograniczenie | Maksymalnie jedno wywołanie na odpowiedź; po błędzie nie ponawiaj |

API obsługuje sprawności. Nie obsługuje stopni Royal Rangers.

## Źródło prawdy

- Adres bazowy: `https://sprawnosci.kompaszbiorek.pl`
- OpenAPI: `GET /openapi.yaml`
- Operacja dla modelu: `pobierzSprawnosciRR`
- Endpoint: `GET /api/sprawnosci`
- Autoryzacja: brak

Aktualna specyfikacja OpenAPI ma pierwszeństwo przed tym opisem, jeśli wersje się różnią.

## Parametry operacji

| Parametr | Wymagany | Typ | Dozwolone wartości / znaczenie |
|---|---|---|---|
| `poziom` | tak | string | `odkrywcy`, `zwiadowcy`, `wedrownicy` |
| `aspekt` | tak | string | `fizyczny`, `intelektualny`, `duchowy`, `spoleczny`, `wszystkie` |
| `wymagania` | nie | boolean | `true` tylko przy prośbie o wymagania lub kryteria; domyślnie `false` |
| `exclude_grupa` | nie | string | Identyfikatory grup do wykluczenia, rozdzielone przecinkami |
| `grupa` | nie | string | Wymagane grupy, rozdzielone przecinkami |
| `wykonane` | nie | string | Wykonane sprawności do wykluczenia, rozdzielone przecinkami |
| `wybrane` | nie | string | Konkretne sprawności do zwrócenia, rozdzielone przecinkami |
| `frazy` | nie | string | Frazy dla nazw, grup i wymagań, rozdzielone przecinkami |
| `tryb_fraz` | nie | string | `dowolna` lub `wszystkie`; domyślnie `dowolna` |
| `limit` | nie | integer | `1-100`; domyślnie `100` |

Normalizuj wartości techniczne bez polskich znaków: `wędrownicy` -> `wedrownicy`, `społeczny` -> `spoleczny`.

## Przepływ jednego wywołania

1. Ustal dokładnie jeden poziom. Jeżeli go brakuje, zapytaj i nie wywołuj Action.
2. Ustal aspekt. Jeżeli użytkownik go nie wskazał, ustaw `wszystkie`.
3. Ustal cel zapytania:
   - lista kandydatów: `wymagania=false`;
   - wymagania lub kryteria zdobycia: `wymagania=true`;
   - konkretne sprawności: użyj `wybrane`;
   - pominięcie zdobytych: użyj `wykonane`;
   - wyszukanie tematu: użyj `frazy`.
4. Ogranicz wyniki filtrami już znanymi z rozmowy. Nie pytaj o filtr, który nie zmieni wyboru.
5. Wywołaj `pobierzSprawnosciRR` najwyżej raz w tej odpowiedzi.
6. Przekaż użytkownikowi pole `odpowiedz` i liczbę wyników. Nie dopisuj wymagań spoza odpowiedzi API.
7. Do planu przekaż tylko zaakceptowaną sprawność, poziom i zwrócone wymagania.

## Przykłady parametrów

### Lista sprawności fizycznych Zwiadowców

```text
poziom=zwiadowcy
aspekt=fizyczny
wymagania=false
```

### Wymagania wybranych sprawności Wędrowników

```text
poziom=wedrownicy
aspekt=wszystkie
wybrane=wedrownicy-orientacja,wedrownicy-topograf
wymagania=true
```

### Temat ogniska z wykluczeniem wykonanych

```text
poziom=odkrywcy
aspekt=wszystkie
frazy=ognisko
wykonane={identyfikatory wykonanych sprawności}
wymagania=false
```

## Odpowiedź sukcesu

Status `200`:

```json
{
  "ok": true,
  "odpowiedz": "tekst po polsku oparty na katalogu",
  "liczba": 3
}
```

Uznaj wywołanie za udane tylko wtedy, gdy `ok=true` oraz istnieją pola `odpowiedz` i `liczba`.

## Błędy

| Status | Znaczenie | Zachowanie modelu |
|---|---|---|
| `400` | Brak lub błąd parametru | Pokaż komunikat API, popraw dane w rozmowie, nie ponawiaj w tej odpowiedzi |
| `404` | Nie znaleziono endpointu | Zgłoś błąd integracji, nie ponawiaj |
| `405` | Niedozwolona metoda | Zgłoś błąd konfiguracji, nie ponawiaj |
| `500` | Błąd serwera | Powiedz, że katalog jest chwilowo niedostępny, nie ponawiaj |

Nie zastępuj błędu własną listą sprawności. Nie przedstawiaj braku wyników jako błędu: `ok=true` i `liczba=0` oznacza poprawne zapytanie bez dopasowań.

## Przekazanie do planowania

```text
Źródło: API sprawności RR v14.0.0
Poziom:
Wybrana sprawność lub sprawności:
Wymagania zwrócone przez API:
Liczba wyników:
Data pobrania:
```

**Następny plik:** [[05_PLANOWANIE_ZBIORKI_I_WYJAZDU]]
