# Kompas Zbiórek — prototyp UI

Interaktywny prototyp wtyczki do ChatGPT. Nie zawiera integracji z Google Docs, Google Calendar, OAuth ani produkcyjnego backendu. Wszystkie dane są demonstracyjne i działają wyłącznie lokalnie.

## Wymagania

- Node.js 18+ (zalecana jest aktualna wersja LTS)
- ChatGPT z włączonym Trybem programisty

## Uruchomienie

W terminalu, w katalogu projektu:

```powershell
npm install
npm run build
npm start
```

Po komunikacie o gotowym serwerze dodaj w ChatGPT lokalny konektor MCP o adresie:

```
http://127.0.0.1:8787/mcp
```

Następnie w nowej rozmowie napisz: **„Pokaż mi Kompas Zbiórek.”**

## Co można przeklikać

- karta inline i przejście do obszaru roboczego;
- widok dokumentu i problemu;
- edycja eksperymentu, czytelny podgląd zmian i lokalny zapis demonstracyjny;
- plan zbiórki, wyszukiwarka aktywności, szczegóły oraz dodanie do planu;
- podgląd kalendarza i komunikat sukcesu;
- responsywny widok desktopowy i mobilny.

## Struktura

- `web/` — komponent React i ciemny interfejs nawiązujący do dostarczonego brandingu;
- `server/` — minimalny lokalny serwer MCP, który udostępnia komponent ChatGPT;
- `web/public/kompas-logo.png` — dostarczone logo.
