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

## Granice odpowiedzialności

`app/plugin/` udostępnia powierzchnię ChatGPT/MCP produktu. `app/cloudflare-worker/` odpowiada za produkcyjne API, OAuth, integracje i bezpieczny dostęp do sekretów. Nie należy traktować lokalnego serwera MCP jako zamiennika produkcyjnego Workera.

Branding produktu ma osobny kanoniczny katalog `/branding` w root repo. Jest obecnie celowo pusty; techniczna implementacja design systemu pozostaje w `/dev/design-system`.
