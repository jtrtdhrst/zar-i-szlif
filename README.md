# Żar i Szlif — kod produktu i wyłącznie jego MCP

 Nie jest repozytorium ogólnych serwerów MCP ani infrastruktury VPS.

## Dozwolone obszary

| Folder | Odpowiedzialność |
| --- | --- |
| `product/` | Aplikacja, panel i logika produktu |
| `www/landing/` | Publiczna strona produktu |
| `www/mcp/` | Strona opisująca podłączenie MCP; nie jest niezależnym serwerem |
| `mcp/` | Wyłącznie serwer, narzędzia i integracje MCP specyficzne dla Żar i Szlif |

W `mcp/product-host/` znajduje się źródło produktowego MCP (Node.js/TypeScript, narzędzia tylko do odczytu katalogu `sprawnosci`, sesje Supabase JWT, testy i Dockerfile). Funkcjonalność źródłowa została scalona m.in. w Product PR #168–#172. Dokumentacja implementacji: [`mcp/product-host/README.md`](mcp/product-host/README.md). **Obecność kodu na `main` i scalenie PR nie potwierdzają działającego wdrożenia.** Stan produkcji trzeba osobno sprawdzić w Coolify i przez uwierzytelnione testy MCP; nie należy polegać na historycznych opisach lub nazwach gałęzi.

## Właściciel infrastruktury

Osobne MCP i integracje platformy — m.in. `ubuntu-mcp`, `mantic-mcp`, `emailens-mcp`, `paperclip-mcp`, `comfyui-mcp`, `plasmic-mcp`, `qdrant-mcp`, `supabase-mcp`, `playwright-mcp` i integracja **Hermes Gateway** — należą do prywatnego repozytorium. Nie kopiuj tych implementacji do tego repozytorium. Nie twórz repozytorium `hermes-zar-i-szlif` bez nowej decyzji o podziale odpowiedzialności.
Usunięty z `main` katalog `mcp-bridges/` miał 37 historycznych plików Emailens, Mautic i Ubuntu MCP. W większości były to duplikaty istniejące w harness. Starsze warianty można odzyskać z historii tego repozytorium, commit `97b98dde25265137e1d4c4cc7c5b4d6eac8e38d0`; nie przenoszono jego różnic automatycznie na aktywne serwisy produkcyjne.
