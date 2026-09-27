# Kontekst Advanced UI — Kompas Zbiórek

## Kanoniczne miejsca

- Kod interfejsu: `C:\Kompas Zbiórek\kompas-ui-plugin\web`.
- Testy UI: `C:\Kompas Zbiórek\kompas-ui-plugin\e2e`.
- Produkcyjny punkt wejścia UI/API: `https://panel.kompaszbiorek.pl`.
- Dokumentacja projektu: `C:\Kompas Zbiórek\documentation.md`.
- Zasady nadrzędne: `C:\Kompas Zbiórek\AGENTS.md`.

## Ustalenia, które ograniczają audyt

- Pełny `npm run test:all` jest bramką finalną, nie narzędziem do każdej mikroiteracji.
- Testy Playwright obejmują projekty desktop i mobile; mobilny kontrakt należy sprawdzać przy 390×844.
- Axe blokuje zakończenie przy naruszeniach `critical` i `serious`.
- Lighthouse nie ma kategorii SEO; obowiązujące kategorie to accessibility, best-practices i performance.
- Źródłem prawdy dla brandingu jest `kompas-ui-design/INSTRUKCJE-BRANDINGU-AI.md`, jeśli istnieje w danym checkoutcie.
- Nie zmieniać struktury, danych roboczych, kolejności sekcji ani zachowań przy samym zadaniu brandingowym.
- Nie tworzyć dekoracji spoza kanonicznego brandingu i nie redukować wymaganych pól do demonstracyjnych skrótów.

## Szybkie wyszukiwanie

Używaj `rg` zamiast czytania całych dużych plików:

```powershell
rg -n "nazwa-widoku|data-action|klasa-css|endpoint" documentation.md "PRD Kompas Zbiórek.md" kompas-ui-plugin\web kompas-ui-plugin\e2e
```

Przy zmianie CSS sprawdzaj regułę źródłową w `web\src\styles.css`, a nie tylko wygenerowany `cloudflare-worker\worker.js`. Wygenerowany Worker jest artefaktem builda.
