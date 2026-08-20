# Delivery i produkcja

## Produkcja i wdrożenia
- Docelowy Worker: `wtyczka-rr`; domeny: `interfejs.kompaszbiorek.pl`, `wtyczka.kompaszbiorek.pl` (`/ui`), `panel.kompaszbiorek.pl` (`panel-kompaszbiorek`)
- Kolejność stała: `npm run build` (kompas-ui-plugin) → `node build-worker.mjs` (cloudflare-worker) → `npx wrangler deploy --dry-run` → `npx wrangler deploy --keep-vars`
- Wrangler = lokalna devDependency; nigdy globalny
- Po wdrożeniu podaj adres + ID wersji. Wdrożenia prowadzi wyłącznie CTO
- Jeśli zablokowane — nie udawaj, podaj przyczynę

## Testy i bramka jakości UI
- `npm run test:all` w `kompas-ui-plugin` (Playwright desktop + mobile 390×844, axe WCAG A/AA, screenshoty, cache) + Lighthouse — **92/92 zielonych** (ostatnia bramka 20.08.2026)
- Lighthouse: `accessibility ≥0.9`, `best-practices ≥0.9` jako error, `performance ≥0.5` warn
- Responsywność obowiązkowa, bez `test.skip` zależnego od viewportu
- Baseline screenshotów: `npm run test:ui:update` tylko przy zamierzonej zmianie

## Mapa systemu (REPO MAP)
Routing table: `docs/AI-REPO-MAP.md` (kanoniczne ścieżki). Skrót:
- `PRD Kompas Zbiórek.md` — zakres, kryteria akceptacji
- `MAPA SYSTEMU.md` — rola plików, 4 etapy (mapowane na 00–06)
- `AGENTS.md` — zasady wykonawcze
- Cykl: `00`–`06` zmapowane na 4 etapy: Diagnoza(00/01) → Plan(02) → Działanie(03) → Refleksja(04/05/06)
- Szablon: `SZABLON GOOGLE DOCS.md`
- Architektura: patrz `shared/PRODUCT.md`

Lokalizacje (najwęższe źródło):
| Obszar | Ścieżka |
|---|---|
| Aplikacja | `kompas-ui-plugin/web/src/static-app-v2.js` |
| Style | `kompas-ui-plugin/web/src/styles.css` |
| Build web | `kompas-ui-plugin/web/scripts/build-static.mjs` |
| MCP `/mcp` | `kompas-ui-plugin/cloudflare-worker/src/public-ui.ts` |
| OAuth Google | `kompas-ui-plugin/cloudflare-worker/src/oauth.ts` |
| Panel | `kompas-ui-plugin/cloudflare-worker/src/panel-handler.ts` |
| Serwer MCP | `kompas-ui-plugin/server/index.ts` |
| Testy e2e | `kompas-ui-plugin/e2e/` |
| Design tokens | `kompas-ui-design/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |

## Integracje i API
| Integracja | Status | Zasada |
|---|---|---|
| Baza aktywności RR | odczyt przez Worker | filtry `category`, `level`, `energy`, `participants`; brak paginacji |
| API sprawności | odczyt przez Worker | `pobierzSprawnosciRR`: 1 poziom, 1 wywołanie na odpowiedź |
| API daty/godziny | zablokowane | strefa `Europe/Warsaw` |
| Google Sheets | wdrożone | `POST /panel/save`, `drive.file` |

Nie podłączaj ani nie udawaj integracji, której nie ma.
