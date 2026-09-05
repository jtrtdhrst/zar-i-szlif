# Kompas Zbiórek

System dla instruktorów Royal Rangers Polska: prostsze, powtarzalne planowanie, spięte w jeden proces **Planowanie → Realizacja → Refleksja → Doskonalenie**. Panel ręczny (`panel.kompaszbiorek.pl`) + asystent w ChatGPT, Google Sheets jako trwała pamięć drużyny.

> **TARGET ≠ CURRENT.** Opis wizji nie oznacza wdrożenia. Status funkcji weryfikuj w kodzie, `wiki/projects/kompas-zbiorek/standup` i `wiki/sources/integracje-mcp`. Brak dowodu = `niepotwierdzony stan bieżący`. Szczegóły: `.paperclip-wiki/wiki/sources/wspolny-kontekst.md`.

## Gdzie co mieszka

```
kompas-zbiorek/
├── README.md / AGENTS.md          # ten plik = router, AGENTS.md = kontrakt agentów
├── kompas-ui-plugin/              # UI + Worker + serwer MCP (jedyne miejsce UI)
│   ├── web/src/static-app-v2.js   # render kanoniczny
│   ├── web/src/styles.css         # style kanoniczne
│   ├── web/scripts/build-static.mjs
│   ├── cloudflare-worker/src/public-ui.ts  # MCP /mcp + UI
│   │   ├── oauth.ts / google-handler.ts / widget-auth.ts
│   │   └── panel-handler.ts       # Panel Google Sheets
│   ├── server/index.ts            # serwer ChatGPT/MCP (lokalnie)
│   ├── e2e/ + lighthouserc.json   # Quality Gate
│   └── README.md / documentation.md
├── kompas-ui-design/opendesign/   # tokeny kompas-rrp (colors_and_type.css)
├── marketing/01–04                # brand, audience, voice, przykłady
├── onboarding-emails/             # maile (UNAPPROVED — nie implementować bez decyzji)
├── archiwum/                      # custom-gpt, audyty, snapshoty (im starsze, tym mniej ważne)
└── .paperclip-wiki/               # durable knowledge: wiki/ + agents/ + shared/ + raw/
```

**UI mieszka tylko w `kompas-ui-plugin/`.** Kanon: `web/src/static-app-v2.js` (render), `styles.css`, `cloudflare-worker/src/public-ui.ts` (MCP), `panel-handler.ts` (Sheets), `server/index.ts`. Produkcja: Worker `wtyczka-rr`, panel `https://panel.kompaszbiorek.pl` (`/ui` podgląd, `/panel` aplikacja), MCP `https://panel.kompaszbiorek.pl/mcp`. Pełna mapa: `.paperclip-wiki/wiki/entities/repo-map.md`.

## Konwencje nazewnictwa

- Pliki/katalogi: kebab-case (`kompas-ui-plugin`, `cloudflare-worker`); docs: WIELKIE_LITERY ze spacjami tylko w `raw/` (niemutowalne kopie), Wiki: kebab-case (`.paperclip-wiki/wiki/sources/wspolny-kontekst.md`).
- Branche: `KOMAA-<nr>-<slug>` (1 branch = 1 deliverable, `baseRef=main`, worktree w `.paperclip-worktrees/`). Bezpośredni write do `main` zabroniony.
- Wiki: `sources/` = znormalizowane źródła, `concepts/` = pojęcia/kontrakty, `entities/` = systemy/integracje, `synthesis/` = syntezy, `projects/kompas-zbiorek/` = wiedza trwała projektu (`index`, `decisions`, `standup`, `history`). Linki: `[[wiki/...]]`.
- Marketing: `01_BRAND_PRODUCT` (kim jesteśmy/obietnica) → `02_AUDIENCE` (dla kogo) → `03_VOICE_RULES` (jak brzmi) → `04_EXAMPLES` (wzorce). Kolejność obowiązuje.
- Komunikaty: `BLOCKER/OWNER/ACTION` dla blokad; statusy wiedzy: `TARGET / CURRENT / DELTA / UNAPPROVED`.

## Kontekst biznesowy

Nie duplikowany tutaj — kanon: `.paperclip-wiki/wiki/sources/wspolny-kontekst.md`.

- Produkt obniża próg wejścia do dobrego planowania; problem solving i eksperymenty to warstwa pogłębiająca, nie wejście.
- Karta zbiórki/aktywności = samowystarczalny artefakt (dane i obecność, sprawności, eksperyment, przygotowanie, plan godzinowy, refleksja).
- Baza Aktywności RR = wspólna, ręcznie moderowana baza; wymagania sprawności tylko z oficjalnego katalogu RR, plan ≠ wykonanie.
- Google Sheets = trwały stan i pamięć drużyny; zapisy po podglądzie i potwierdzeniu.
- Onboarding: **brak zatwierdzonego kontraktu** (`UNAPPROVED / DO NOT ASSUME`).
- Odbiorca: czynny instruktor RR; komunikacyjnie najważniejsi młodsi/mniej doświadczeni (prowadzenie krok po kroku).

## Decyzje produktowe

Kanon: `.paperclip-wiki/wiki/projects/kompas-zbiorek/index.md` (wizja TARGET) i `decisions.md` (rejestr ADR).

- Cykl docelowy: Planowanie → Realizacja → Refleksja → Doskonalenie. Materiały `00–06` i model 9 kroków = historia/metodologia.
- Planowanie jest głównym wejściem; AI jest opcjonalnym interfejsem do tego samego procesu, nie podejmuje decyzji za instruktora.
- Wizja = `TARGET / MUST-HAVE`, działanie dziś = `CURRENT / AS-IS`, różnica = `DELTA`. Opis ≠ dowód wdrożenia.
- Marketing dowodzi mechanizmem (demo), nie statystykami/testimonialami — tych nie wymyślamy.

## Brand voice, audience, content guidelines

Kanon: `marketing/01_BRAND_PRODUCT.md`, `02_AUDIENCE.md`, `03_VOICE_RULES.md`, `04_EXAMPLES.md`.

- Obietnica: „Od problemu w drużynie do sprawdzonej zmiany" — porządek, nie magia.
- Sekwencja pisania: kto → problem → oferta → wiarygodność → ton → następny krok. Zaczynaj od problemu instruktora („Twoja drużyna"), nigdy od funkcji.
- Ton: polski, konkretny, ciepło i rzeczowo jak instruktor; metafora terenu tylko gdy niesie znaczenie. Zakaz: żargon SaaS, FOMO/presja, pustosłowie bez działania, wymyślone liczby i cennik.
- CTA: główne „Dodaj Kompas Zbiórek do ChatGPT", pomocnicze „Zobacz poradnik". Każdy tekst kończy się działaniem + jednym CTA + sposobem sprawdzenia.

## Hierarchia przekazu (kolejność wartości)

Z `.paperclip-wiki/wiki/sources/wspolny-kontekst.md` — nie przestawiać:

1. prostsze planowanie i brak pustej kartki;
2. ciągłość: sprawności, cele, materiały, zadania i plan w jednym procesie;
3. lepsze przygotowanie i bardziej zróżnicowane aktywności;
4. wspólna pamięć drużyny;
5. AI jako opcjonalny interfejs rozmowy;
6. refleksja, małe eksperymenty i poprawa między aktywnościami.

Nie zaczynać od problem solvingu. „Działa / możesz / system robi" tylko o `CURRENT`. `TARGET` służy wizji i planowaniu, nie obietnicy.

## Szybki start

```powershell
npm install
cd kompas-ui-plugin && npm install && cd ..
npm run build            # web + tsc server
npm run dev              # widget lokalnie
npx wrangler dev --port 8788   # worker lokalnie (z kompas-ui-plugin/cloudflare-worker)
```

Testy: `cd kompas-ui-plugin && npm run test:all` (Playwright desktop+mobile 390×844, axe WCAG A/AA; `critical/serious` blokuje). Deploy: `npm run build` → `node build-worker.mjs` → `wrangler deploy --dry-run` → `wrangler deploy --keep-vars` (cel: `wtyczka-rr`; panel: `--config wrangler.panel.jsonc`).

Branche: `git branch --show-current; git status --short` (preflight), `KOMAA-*` na worktree, merge do `main` przez `--no-ff`.

## Dokumentacja

- Biznes: `wspolny-kontekst` (nadrzędny) · Produkt: `projects/kompas-zbiorek/index` + `decisions` · PRD: `wiki/sources/prd-kompas` (v1.7, TARGET) · Stan dziś: `standup` + `integracje-mcp` + kod/testy.
- API: `Dokumentacja_API_SPRAWNOSCI` (v14), `PRD_BAZA_AKTYWNOSCI`, `dokumentacja-integracji`; UI: `kompas-ui-plugin/documentation.md`; design: `kompas-ui-design/.../tokens/`.
- Wiki index: `.paperclip-wiki/wiki/index.md`. `raw/` niemutowalne, `archiwum/` wygrywa nowością (cron COO czyści `test-results`, `playwright-report`, `*.yml>30d`).
