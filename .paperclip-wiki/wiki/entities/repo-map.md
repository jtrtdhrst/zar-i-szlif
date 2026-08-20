---
title: REPO MAP — kanoniczne lokalizacje
type: entity
tags: [repo, mapa, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/MAPA-SYSTEMU.md]
created: 2026-08-20
updated: 2026-08-20
---

# REPO MAP

Routing table: `docs/AI-REPO-MAP.md` (nadrzędny względem skrótu w WSPOLNY_KONTEKST). Najwęższe źródła zamiast discovery.

| Obszar | Ścieżka |
|---|---|
| Render statyczny | `kompas-ui-plugin/web/src/static-app-v2.js` |
| Style | `kompas-ui-plugin/web/src/styles.css`, `extended.css` |
| Build web | `kompas-ui-plugin/web/scripts/build-static.mjs` |
| MCP `/mcp` + `zapisz_dane_kompasu` | `kompas-ui-plugin/cloudflare-worker/src/public-ui.ts` |
| OAuth | `oauth.ts`, `google-handler.ts`, `widget-auth.ts` |
| Panel Google Sheets | `panel-handler.ts` |
| Wrangler config | `wrangler.jsonc`, `wrangler.panel.jsonc` |
| Build Worker | `cloudflare-worker/build-worker.mjs` |
| Serwer ChatGPT/MCP | `kompas-ui-plugin/server/index.ts` |
| Testy e2e | `kompas-ui-plugin/e2e/` |
| Lighthouse | `lighthouserc.json`, `scripts/run-lhci.mjs` |
| Design tokens | `kompas-ui-design/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
| Emails | `onboarding-emails/html/`, `MAPA-AUTOMATYZACJI.md` |

Komendy kanoniczne: `npm run build`, `npm run test:all` (`test:ui`, `test:a11y`, `test:visual`, `test:lighthouse`).

