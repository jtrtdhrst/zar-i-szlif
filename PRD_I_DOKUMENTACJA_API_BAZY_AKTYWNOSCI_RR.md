# Baza Aktywności RR: MVP i API

**Wersja:** 1.1  
**Status:** zakres MVP  
**Przeznaczenie:** wyszukiwanie aktywności dla instruktorów Royal Rangers  
**Bazowy URL API:** (https://zabawy.kompaszbiorek.pl/

## 1. Cel MVP

Instruktor podaje warunki najbliższej zbiórki i otrzymuje wszystkie pasujące aktywności z bazy.

MVP obejmuje wyłącznie:

- dokumentację API pod `GET /api`;
- odczyt aktywności;
- filtrowanie;
- wyświetlenie wszystkich dopasowanych wyników;
- zapis filtrów w adresie URL interfejsu.

Poza MVP są: dodawanie, edycja, usuwanie, logowanie, oceny, komentarze, moderacja, rekomendacje AI i integracja ze stopniami lub sprawnościami.

## 2. Wartość dla użytkownika

Wynik wyszukiwania musi pozwolić instruktorowi szybko sprawdzić:

- nazwę aktywności;
- kategorię;
- poziom;
- liczbę uczestników;
- czas;
- poziom energii;
- krótki opis;
- materiały;
- zasady.

Jeżeli pole nie jest dostępne w rekordzie, interfejs pokazuje `Brak danych`. Nie wolno dopisywać brakujących informacji.

## 3. Model aktywności

Jedynym polem wymaganym podczas walidacji rekordu jest `category`.

Pozostałe pola są opcjonalne. Mogą być puste lub nieobecne.

| Pole API | Typ | Wartości / znaczenie |
|---|---|---|
| `id` | string | Stabilny identyfikator rekordu |
| `title` | string | Nazwa aktywności |
| `category` | enum | Jedyna wartość wymagana: `ruchowa`, `logiczna`, `kreatywna`, `harcerska`, `terenowa`, `przyrodnicza`, `muzyczna`, `integracyjna`, `duchowa`, `inna` |
| `level` | enum | `odkrywcy`, `zwiadowcy`, `wedrownicy`, `wszystkie_poziomy` |
| `min_participants` | integer | Minimalna liczba uczestników |
| `max_participants` | integer | Maksymalna liczba uczestników |
| `duration_minutes` | integer | Czas aktywności w minutach |
| `energy` | enum | `niska`, `srednia`, `wysoka` |
| `description` | string | Krótki opis aktywności |
| `materials` | array[string] | Materiały potrzebne do przeprowadzenia |
| `rules` | array[string] | Zasady lub kolejne kroki |

## 4. Filtry interfejsu

### Kategoria

Kategoria jest multiselectem. Użytkownik może wybrać jedną lub wiele kategorii.

Nie ma wartości `Wszystkie kategorie`. Brak wybranej kategorii oznacza brak filtrowania po kategorii.

W adresie URL wartości są zapisane jako lista rozdzielona przecinkami:

```text
?category=logiczna,ruchowa
```

### Pozostałe filtry

| Filtr | Parametr URL | Wartości |
|---|---|---|
| Poziom | `level` | `odkrywcy`, `zwiadowcy`, `wedrownicy`, `wszystkie_poziomy` |
| Energia | `energy` | `niska`, `srednia`, `wysoka` |
| Liczba osób | `participants` | Dodatnia liczba całkowita, np. `12` |

Brak parametru oznacza brak filtrowania po danym polu. Nie używaj wartości `all`, `wszystkie` ani `dowolne` w API.

### Zasada liczby osób

Dla `participants=12` zwróć rekord tylko wtedy, gdy oba zakresy są znane i spełniają:

```text
min_participants <= 12 <= max_participants
```

Rekord bez zakresu liczby osób nie pasuje do filtra `participants`.

### Zasada poziomu

Rekord pasuje do filtra poziomu, gdy `level` jest równy wybranemu poziomowi albo ma wartość `wszystkie_poziomy`.

### Zasada wielu filtrów

Filtry różnych rodzajów łączą się operatorem `AND`. Wiele wartości kategorii łączy się operatorem `OR`.

Przykład:

```text
category=logiczna,ruchowa AND level=zwiadowcy AND energy=srednia AND participants=12
```

## 5. Zwracanie wyników

API zwraca wszystkie rekordy spełniające filtry.

Zwracaj pełny zbiór dopasowanych wyników. Nie używaj paginacji ani parametru `limit`.

Kolejność rekordów może być kolejnością zwróconą przez bazę. Interfejs wyświetla liczbę dopasowań, np. `Znaleziono: 21`.

Jeżeli nie ma wyników, zwróć pustą tablicę i `total=0`. Nie zwracaj aktywności niespełniających filtrów.

## 6. API i dokumentacja

### `GET /api`

Zwraca krótką dokumentację API w formacie JSON. Endpoint nie pobiera aktywności i nie przyjmuje filtrów.

#### Odpowiedź `200`

```json
{
  "name": "Baza Aktywności RR",
  "version": "1.0",
  "description": "Odczyt aktywności dla instruktorów Royal Rangers.",
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/activities",
      "description": "Zwraca wszystkie aktywności pasujące do filtrów query."
    }
  ],
  "filters": {
    "category": "multiselect rozdzielony przecinkami",
    "level": "pojedynczy poziom",
    "energy": "niska, srednia albo wysoka",
    "participants": "liczba uczestników"
  }
}
```

Dokumentacja maszynowa może być również udostępniona jako `/api/openapi.json`, ale nie jest wymagana do działania MVP.

### `GET /api/activities`

Pobiera wszystkie aktywności pasujące do filtrów zapisanych w adresie GET.

Filtry muszą być parametrami query. Nie używaj body, sesji ani ukrytego stanu do przekazywania filtrów.

#### Parametry query

| Parametr | Typ | Wymagany | Przykład |
|---|---|---|---|
| `category` | string | nie | `logiczna,ruchowa` |
| `level` | string | nie | `zwiadowcy` |
| `energy` | string | nie | `srednia` |
| `participants` | integer | nie | `12` |

#### Przykład

```http
GET /api/activities?category=logiczna,ruchowa&level=zwiadowcy&energy=srednia&participants=12
```

Ten sam link musi być możliwy do skopiowania, odświeżenia i ponownego użycia z tym samym wynikiem.

#### Odpowiedź `200`

```json
{
  "ok": true,
  "data": [
    {
      "id": "act_01HXYZ",
      "title": "Poczta patrolowa",
      "category": "ruchowa",
      "level": "wedrownicy",
      "min_participants": 8,
      "max_participants": 32,
      "duration_minutes": 30,
      "energy": "wysoka",
      "description": "Patrole przenoszą meldunki między punktami.",
      "materials": ["koperty", "meldunki", "oznaczenia punktów"],
      "rules": ["Meldunek można przekazać tylko w oznaczonym punkcie."]
    }
  ],
  "meta": {
    "total": 1,
    "filters": {
      "category": ["logiczna", "ruchowa"],
      "level": "zwiadowcy",
      "energy": "srednia",
      "participants": 12
    }
  }
}
```

Pole `meta.total` musi odpowiadać liczbie elementów w `data`.

## 7. Walidacja MVP

Walidacja ma być minimalna:

1. `category` musi istnieć.
2. Wartość `category` musi należeć do dozwolonej listy.
3. Jeżeli podano `min_participants` i `max_participants`, minimum nie może być większe od maksimum.
4. Jeżeli podano liczby, muszą być dodatnimi liczbami całkowitymi.
5. Jeżeli podano `level` lub `energy`, wartości muszą należeć do listy enumów.

Walidacja MVP nie obejmuje dodatkowej oceny treści.

## 8. Zachowanie Wtyczki ChatGPT + Interfejsu

Gdy użytkownik chce znaleźć aktywność (wtyczka ChatGPT lub interfejs):

1. Ustal tylko filtry, które są znane lub zmienią wyniki.
2. Nie zadawaj dodatkowych pytań, jeśli użytkownik może od razu zobaczyć wyniki.
3. Wywołaj `GET /api/activities`.
4. Wyświetl wszystkie zwrócone aktywności, nie tylko wybrane przez model.
5. Przy każdej pokaż dostępne pola: nazwę, kategorię, poziom, liczbę osób, czas, energię, opis, materiały i zasady.
6. Brakujące pola oznacz jako `Brak danych`.
7. Nie twórz aktywności, nie poprawiaj rekordów i nie usuwaj rekordów.

## 9. Błędy API

| Status | Znaczenie |
|---|---|
| `400` | Nieprawidłowy filtr lub wartość spoza enumu |
| `500` | Błąd serwera |

Przy błędzie GPT pokazuje komunikat i nie udaje, że otrzymał wyniki.

## 10. Minimalne OpenAPI

Specyfikacja OpenAPI dla MVP ma zawierać wyłącznie:

- `GET /api`;
- `GET /api/activities`;
- schemat `Activity`;
- schemat odpowiedzi listy;
- enumy filtrów;
- kody błędów `400`, `404`, `500`;
- prawdziwy `servers.url`.

Nie dodawaj operacji `POST`, `PUT`, `PATCH` ani `DELETE`.

## 11. Kryteria akceptacji MVP

1. `GET /api` zwraca dokumentację endpointu i filtrów.
2. `GET /api/activities` zwraca aktywności bez filtrów.
3. Wszystkie filtry są przekazywane w linku GET jako parametry query.
4. `category` przyjmuje wiele wartości w jednym parametrze.
5. Brak wybranej kategorii oznacza wszystkie kategorie, bez specjalnej wartości `wszystkie`.
6. Każdy pozostały filtr działa zgodnie z opisanymi zasadami.
7. Filtry różnych rodzajów łączą się przez `AND`.
8. Wiele kategorii łączy się przez `OR`.
9. API zwraca wszystkie dopasowane rekordy bez paginacji i limitu.
10. `meta.total` jest zgodne z liczbą wyników.
11. Jedynym wymaganym polem rekordu jest `category`.
12. API nie posiada endpointu pobierania po ID ani endpointów dodawania, aktualizacji i usuwania.
13. Interfejs zapisuje link GET z filtrami w URL i odtwarza go po odświeżeniu strony.
14. Brak wyników zwraca `data=[]` i `meta.total=0`.
15. Brakujące dane nie są uzupełniane przez API ani GPT.

## 12. Dane do uzupełnienia przed podłączeniem

```text
Bazowy URL API:
URL OpenAPI:
Czy API wymaga autoryzacji odczytu: tak/nie
Maksymalny rozmiar odpowiedzi:
Format kodowania listy category w query:
```
