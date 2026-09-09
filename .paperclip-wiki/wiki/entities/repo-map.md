---
title: REPO MAP — kanoniczne lokalizacje
type: entity
tags: [repo, mapa, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/MAPA-SYSTEMU.md]
created: 2026-08-20
updated: 2026-09-09
---

# REPO MAP

Repo jest podzielone na cztery warstwy: `app/` (runtime), `dev/` (kod wspierający development), `content/` (treści) i `archive/` (materiały historyczne). Root służy tylko konfiguracji repo/workspace, registry, toolingowi i dokumentacji.

| Obszar | Ścieżka |
|---|---|
| Render statyczny | `app/web/src/static-app-v2.js` |
| Style | `app/web/src/styles.css`, `app/web/src/extended.css` |
| Build web | `app/web/scripts/build-static.mjs` |
| MCP `/mcp` + API Worker | `app/cloudflare-worker/src/public-ui.ts` |
| OAuth | `app/cloudflare-worker/src/oauth.ts`, `google-handler.ts`, `widget-auth.ts` |
| Wrangler config | `app/cloudflare-worker/wrangler.jsonc` |
| Build Worker | `app/cloudflare-worker/build-worker.mjs` |
| Serwer ChatGPT/MCP | `app/server/index.ts` |
| Testy e2e aplikacji | `app/e2e/` |
| Dodatkowe testy/pipeline | `dev/quality/` |
| Design tokens | `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
| Integracje developerskie | `dev/integrations/` |
| Emails | `content/onboarding-emails/` |
| Marketing | `content/marketing/` |
| Archiwum | `archive/` |

Komendy kanoniczne aplikacji uruchamiaj z `app/`: `npm run build`, `npm run test:all` (`test:ui`, `test:a11y`, `test:visual`).

## Repo delivery governance

- Governed product repo: `miloszspyrka-code/kompas-zbiorek`; issue work starts from `main` on the issue branch/worktree.
- Implementer returns exact `candidate_sha` and does not merge its own repo-write work to `main`.
- Required independent PASS is locked to that exact SHA; later commits require re-review.
- CTO owns governed merge/publication after PASS and must not resolve conflicts or modify code during merge.
- `REPO_WRITE` is delivered only when the reviewed SHA is proven in `origin/main` ancestry.
