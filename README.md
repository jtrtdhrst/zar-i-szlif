# Żar i Szlif — kod produktu i wyłącznie jego MCP

Repozytorium **`miloszspyrka-code/zar-i-szlif`** jest właścicielem kodu produktu Żar i Szlif, stron produktowych i **jedynie MCP obsługującego tę aplikację**. Nie jest repozytorium ogólnych serwerów MCP ani infrastruktury VPS.

## Dozwolone obszary

| Folder | Odpowiedzialność |
| --- | --- |
| `product/` | Aplikacja, panel i logika produktu |
| `www/landing/` | Publiczna strona produktu |
| `www/mcp/` | Strona opisująca podłączenie MCP; nie jest niezależnym serwerem |
| `mcp/` | Wyłącznie serwer, narzędzia i integracje MCP specyficzne dla Żar i Szlif |

W `mcp/` są obecnie pomocnicze pliki PostHog, a pełne źródła produktowego MCP są jeszcze do przeniesienia z zatwierdzonego źródła/archiwum. Nie należy przedstawiać tego katalogu jako wdrożonego kompletnego serwera MCP.

## Właściciel infrastruktury

Osobne MCP i integracje platformy — m.in. `ubuntu-mcp`, `mantic-mcp`, `emailens-mcp`, `paperclip-mcp`, `comfyui-mcp`, `plasmic-mcp`, `qdrant-mcp`, `supabase-mcp`, `playwright-mcp` i integracja **Hermes Gateway** — należą do prywatnego repozytorium [`miloszspyrka-code/harness-zar-i-szlif`](https://github.com/miloszspyrka-code/harness-zar-i-szlif). Nie kopiuj tych implementacji do tego repozytorium. Nie twórz repozytorium `hermes-zar-i-szlif` bez nowej decyzji o podziale odpowiedzialności.

Usunięty z `main` katalog `mcp-bridges/` miał 37 historycznych plików Emailens, Mautic i Ubuntu MCP. W większości były to duplikaty istniejące w harness. Starsze warianty można odzyskać z historii tego repozytorium, commit `97b98dde25265137e1d4c4cc7c5b4d6eac8e38d0`; nie przenoszono jego różnic automatycznie na aktywne serwisy produkcyjne.

## Deployment produktu

**Przejściowa zgodność:** katalogi app/ i registry/kompas/ przechowują przywrócone źródła kompilacji panelu. product/ i www/ pozostają układem docelowym; przeniesienie wymaga osobnego testu. app/cloudflare-worker/ jest istniejącym kodem produktu, nie upoważnia do tworzenia nowych Workers. Stary workflow publikacji Cloudflare Workers nie został przeniesiony do main.

**Stan kodu źródłowego (sprawdzony 2026-11-05):** `main` przechodzi wyłącznie przez GitHub Actions `validate-product` — scalony PR #156 usunął dawne zadania `promote-release` i `verify-production`. Promocją zatwierdzonego SHA z `main` do gałęzi wdrożeniowej `ci-approved` ma zarządzać osobny kontroler z repozytorium Harness (`scripts/product_native_promotion.py`) po weryfikacji niezależnej akceptacji Paperclip, dokładnego SHA i CI. Sam zielony CI **nie promuje** już produkcji. Coolify `zar-i-szlif-web` śledzi `ci-approved`, a `/__release.json` i `/healthz` służą do sprawdzania faktycznie wdrożonego artefaktu; jednak samo istnienie kodu kontrolera nie dowodzi jego aktywnej pracy na serwerze. W odczycie GitHub z 2026-11-05 `main` i `ci-approved` wskazywały ten sam SHA `b3dd661a0482cfaa3c3f1c94f27c6d8b36061a14` (to **nie** jest odczyt produkcyjnego kontenera). `release/panel-stable-20261027` jest historyczną gałęzią wydania, nie bieżącym źródłem wdrożeń. Nie przesuwaj ręcznie `ci-approved`, nie omijaj zatwierdzeń. [Kontrakt wydań i rollback](ops/coolify/CI_GATED_RELEASE.md) wymaga aktualizacji wraz ze zmianą kontrolera; bez dowodu aktywnego kontrolera i zgodności SHA nie deklaruj DONE.

Trzy istniejące Cloudflare Workers (`stronaglowna`, `zariszlif-prawne`, `paperclip-mcp`) pozostają osobno — nie przenosimy ich i nie zmieniamy w ramach sprzątania repozytoriów.
