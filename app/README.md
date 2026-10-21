# Żar i Szlif — runtime produktu

Katalog `app/` zawiera runtime produktu Żar i Szlif. Część wewnętrznych nazw i modułów jest nadal historyczna; nie oznacza to osobnego produktu.

## Struktura

- `web/` — interfejs produktu.
- `plugin/` — współdzielony/legacy MCP i moduły wiedzy; lokalny entrypoint `plugin/index.ts`, endpoint `/mcp`.
- `mcp-worker/` — **dedykowany product MCP Worker**, przewidziany dla `https://mcp.zariszlif.pl/mcp`; odrębny Wrangler i release.
- `cloudflare-worker/` — dotychczasowy panel/API/OAuth i integracje Cloudflare.
- `documentation.md` — dokumentacja zachowania runtime.

Nie twórz kolejnej kopii product MCP. Kod dedykowanego Workera należy do `app/mcp-worker/`; kod współdzielony pozostaje w `app/plugin/` do czasu zweryfikowanej migracji.

## Uruchomienie lokalne

Z katalogu `app/`:

```bash
npm ci
npm run build
npm start
```

Lokalna Wtyczka / MCP Kompasu Zbiórek jest wtedy dostępna pod:

```text
http://127.0.0.1:8787/mcp
```

Root repo udostępnia również wspólny kontrakt `npm run lint`, `npm run typecheck`, `npm test` i `npm run build`.

## Zmienne środowiskowe współdzielonego/legacy MCP

| Zmienna | Wymagana | Opis |
| --- | --- | --- |
| `PLUGIN_PUBLIC_ORIGIN` | tak w produkcji | Kanoniczny origin serwera, np. `https://mcp-kompas.kompaszbiorek.pl`. Wartość trafia verbatim do identyfikatora `resource` w metadanych RFC 9728 (`/.well-known/oauth-protected-resource`), więc format jest twardo walidowany: **scheme + host, bez ścieżki, query i credentials**; `https` wszędzie poza loopbackiem (`http://localhost`, `http://127.0.0.1`, `http://[::1]` dopuszczalne). Trailing `/` jest obcinany. |
| `QDRANT_URL` | nie | Adres Qdrant dla wiedzy (RAG). Brak = in-memory, bez sekretów. |
| `QDRANT_API_KEY` | nie | Klucz API Qdrant. |
| `EMBEDDING_ALLOW_LEXICAL=1` | tylko eksperymentalnie | Wymagane jawnie, gdy `QDRANT_URL` jest ustawiony, a nie ma bindingu Workers AI — inaczej start pada, zamiast cicho zapisać leksykalne wektory do kolekcji `bge-m3`. |

Kontrakt i przykłady: `.env.example` (root repo) oraz `docs/production-release.md`.

### Zachowanie przy złej konfiguracji

- `PLUGIN_PUBLIC_ORIGIN` nieustawiony w produkcji: serwer startuje, ale `/.well-known/oauth-protected-resource` zwraca `400 {"error":"invalid_host"}` (fallback na `Host` działa wyłącznie dla loopbacka). Endpoint jest wtedy martwy — ustaw zmienną.
- `PLUGIN_PUBLIC_ORIGIN` z błędnym formatem (np. bez `https://`, ze ścieżką lub z credentials): **proces nie startuje** i loguje nazwę zmiennej, błędną wartość i oczekiwany format. Wartość jest zaufaną konfiguracją, nie wejściem atakującego, więc zamiast cichego pogorszenia kontraktu wybrano głośny błąd.

## Granice odpowiedzialności

`app/plugin/` zawiera istniejący kod MCP i współdzielone moduły wiedzy, natomiast `app/mcp-worker/` to dedykowany Cloudflare product MCP. `app/cloudflare-worker/` obsługuje dotychczasowy panel/API/OAuth. Lokalny serwer MCP nie zastępuje produkcyjnego Workera. Ta mapa kodu nie stanowi dowodu udanego wdrożenia `mcp.zariszlif.pl`.

Branding produktu ma osobny kanoniczny katalog `/branding` w root repo. Jest obecnie celowo pusty; techniczna implementacja design systemu pozostaje w `/dev/design-system`.
