# Kompas Zbiórek — runtime produktu

Katalog `app/` zawiera runtime produktu Kompas Zbiórek. Nie jest to osobny prototyp ani alternatywny produkt.

## Struktura

- `web/` — interfejs produktu.
- `plugin/` — **Wtyczka / MCP Kompasu Zbiórek**. Te nazwy oznaczają ten sam element produktu. Lokalny entrypoint MCP to `plugin/index.ts`, endpoint: `/mcp`.
- `cloudflare-worker/` — produkcyjna warstwa API, OAuth i integracji Cloudflare.
- `documentation.md` — dokumentacja zachowania runtime.

Nie twórz równoległego `server/`, `mcp/` ani drugiego katalogu „wtyczki”. Kanoniczną lokalizacją jest `app/plugin/`.

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

## Zmienne środowiskowe Wtyczki / MCP

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

`app/plugin/` udostępnia powierzchnię ChatGPT/MCP produktu. `app/cloudflare-worker/` odpowiada za produkcyjne API, OAuth, integracje i bezpieczny dostęp do sekretów. Nie należy traktować lokalnego serwera MCP jako zamiennika produkcyjnego Workera.

Branding produktu ma osobny kanoniczny katalog `/branding` w root repo. Jest obecnie celowo pusty; techniczna implementacja design systemu pozostaje w `/dev/design-system`.
