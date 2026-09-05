# kompas-ui-plugin — UI, Worker, MCP (kanon UI)

Jedyne miejsce UI w repo. Render: `web/src/static-app-v2.js`, style: `web/src/styles.css`, build: `web/scripts/build-static.mjs`. Worker: `cloudflare-worker/src/public-ui.ts` (MCP `/mcp`), `panel-handler.ts` (Google Sheets), `oauth.ts`/`google-handler.ts`/`widget-auth.ts`. Serwer lokalny: `server/index.ts`.

> Historyczny opis „prototyp bez integracji" nieaktualny — integracje (OAuth `drive.file`, Sheets, MCP) weryfikuj w `wiki/sources/integracje-mcp` i `wiki/entities/panel-google-sheets`; brak dowodu = `niepotwierdzony stan bieżący`.

```powershell
npm install
npm run build     # web + tsc server
npm run dev       # = build + start (server/dist/index.js)
npm run typecheck # server + web
npm run test:all  # build + test:ui (Playwright desktop+mobile, axe A/AA)
```

MCP lokalnie: `http://127.0.0.1:8787/mcp` → w ChatGPT: „Pokaż mi Kompas Zbiórek." Worker lokalnie: `cd cloudflare-worker && npx wrangler dev --port 8788`. Deploy: `node build-worker.mjs` → `wrangler deploy --dry-run` → `wrangler deploy --keep-vars` (cel `wtyczka-rr`).

Konwencje: ten katalog nie duplikuje kontekstu biznesowego ani brand voice — te mieszkają w `.paperclip-wiki/wiki/sources/wspolny-kontekst.md` i `marketing/01–04`; hierarchia przekazu w root `README.md`. Szczegóły funkcji: `documentation.md`.
