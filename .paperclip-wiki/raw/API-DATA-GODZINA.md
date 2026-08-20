---
id: API_DATA_I_CZAS
status: blocked_missing_openapi
strefa: Europe/Warsaw
---

# API daty i godziny

## Kontrakt narzędzia

| Element | Wymaganie |
|---|---|
| Start | Odpowiedź zależy od bieżącej lub względnej daty |
| Wejście | Brak parametrów |
| Wynik | Zweryfikowana lokalna data i godzina w `Europe/Warsaw` |
| Dalej | Przekaż obliczoną datę do etapu, który poprosił o czas |
| Bloker | Brakuje bazowego URL serwera i specyfikacji OpenAPI dla Action |

Nie konfiguruj Action na podstawie tego pliku, dopóki nie zostanie uzupełniony bazowy URL. Przykładowy host nie jest adresem integracji.

Bazowy URL serwera: `https://data.i.godzina.kompaszbiorek.pl`.

## Endpoint

```http
GET /warsaw-time
```

Pełny adres: `https://data.i.godzina.kompaszbiorek.pl/warsaw-time`.

Parametry: brak.

## Oczekiwana odpowiedź sukcesu

Status `200`:

```json
{
  "timezone": "Europe/Warsaw",
  "date": "2026-08-05",
  "time": "13:45:12",
  "localDateTime": "2026-08-05T13:45:12",
  "weekday": "środa",
  "utcOffset": "GMT+02:00",
  "utcDateTime": "2026-08-05T11:45:12.345Z"
}
```

| Pole | Typ | Znaczenie |
|---|---|---|
| `timezone` | string | Musi mieć wartość `Europe/Warsaw` |
| `date` | string | Lokalna data `YYYY-MM-DD` |
| `time` | string | Lokalny czas `HH:mm:ss` |
| `localDateTime` | string | Lokalna data i czas bez offsetu |
| `weekday` | string | Polski dzień tygodnia |
| `utcOffset` | string | Aktualny offset CET/CEST |
| `utcDateTime` | string | Ten sam moment w UTC |

## Walidacja odpowiedzi

Uznaj wywołanie za udane wyłącznie wtedy, gdy:

1. odpowiedź ma status `200`;
2. `timezone` wynosi `Europe/Warsaw`;
3. istnieją poprawne pola `date`, `time` i `localDateTime`;
4. data użyta w odpowiedzi użytkownika wynika z wartości zwróconych przez API.

Serwer może dla błędnej ścieżki zwrócić status `200` i obiekt:

```json
{
  "status": "ok",
  "endpoint": "/warsaw-time"
}
```

To nie jest odpowiedź czasu. Traktuj ją jako błąd wywołania i nie obliczaj daty.

## Przepływ

1. Wywołaj API tylko wtedy, gdy bieżący moment wpływa na plan, zapis lub interpretację daty względnej.
2. Zweryfikuj odpowiedź według czterech warunków powyżej.
3. Oblicz datę względną od `date` lub `localDateTime`, zachowując `Europe/Warsaw`.
4. Zwróć konkretną datę w formacie `YYYY-MM-DD` oraz dzień tygodnia, jeśli pomaga użytkownikowi.
5. Przekaż wynik do pliku, który zainicjował wywołanie; nie twórz osobnego etapu cyklu.

## Dane wymagane do odblokowania

```text
Bazowy URL: https://data.i.godzina.kompaszbiorek.pl
URL OpenAPI:
Operation ID:
Kody błędów inne niż 200:
Limit i zasady ponawiania:
```

Po uzupełnieniu tych pól zmień `status` na `ready` i wpisz dokładną nazwę operacji do `Prompt systemowy.md`.
