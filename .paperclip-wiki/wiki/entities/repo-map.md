---
title: REPO MAP — kanoniczne lokalizacje
type: entity
tags: [repo, mapa, architektura]
sources: [raw/WSPOLNY_KONTEKST.md, raw/MAPA-SYSTEMU.md]
created: 2026-08-20
updated: 2026-09-28
---

# REPO MAP

> Kanoniczna mapa repozytorium `miloszspyrka-code/kompas-zbiorek`. Używaj jej do wyboru miejsca zmian przed rozpoczęciem pracy.

## 1. Podział repo

| Warstwa | Przeznaczenie | Reguła dla agenta |
|---|---|---|
| `app/` | Runtime produktu | UI, Wtyczka / MCP Kompasu Zbiórek, API, auth i integracje runtime. |
| `branding/` | Branding produktu | Jedyne kanoniczne miejsce na przyszłe źródła brandingu. Obecnie celowo puste. |
| `dev/` | Development/tooling | Techniczny design system, quality pipeline i integracje developerskie. |
| `content/` | Treści biznesowe | Maile onboardingowe, marketing i inne treści poza runtime. |
| `archive/` | Historia | Materiały historyczne; nie są CURRENT. |

Nie dodawaj równoległych top-level folderów `brand/`, `brand-assets/` ani alternatywnego katalogu wtyczki.

## 2. Kanoniczne lokalizacje

| Obszar | Ścieżka / entrypoint |
|---|---|
| UI produktu | `app/web/` |
| Render statyczny | `app/web/src/static-app-v2.js` |
| Style web | `app/web/src/styles.css`, `app/web/src/extended.css` |
| Build web | `app/web/scripts/build-static.mjs` |
| **Wtyczka / MCP Kompasu Zbiórek** | `app/plugin/` |
| Entrypoint Wtyczki / MCP | `app/plugin/index.ts` |
| Endpoint MCP | `/mcp` |
| Cloudflare API/OAuth/integracje | `app/cloudflare-worker/` |
| Worker/API | `app/cloudflare-worker/src/public-ui.ts` |
| OAuth / auth | `app/cloudflare-worker/src/oauth.ts`, `google-handler.ts`, `widget-auth.ts` |
| Build Worker | `app/cloudflare-worker/build-worker.mjs` |
| Dokumentacja runtime | `app/documentation.md` |
| Branding produktu | `branding/` — obecnie pusty |
| Techniczny design system | `dev/design-system/` |
| Design tokens | `dev/design-system/opendesign/design-systems/kompas-rrp/tokens/colors_and_type.css` |
| Dodatkowe testy / quality | `dev/quality/` |
| Integracje developerskie | `dev/integrations/` |
| Maile onboardingowe | `content/onboarding-emails/` |
| Marketing | `content/marketing/` |
| Archiwum | `archive/` |

`plugin`, „wtyczka” i „MCP Kompasu Zbiórek” oznaczają ten sam element produktu. Nie twórz `app/server/` ani równoległego `app/mcp/`.

## 3. Routing zmian dla agentów

1. Zmiana Wtyczki / MCP Kompasu Zbiórek → `app/plugin/`.
2. Zmiana UI produktu → `app/web/`.
3. API/OAuth/integracje produkcyjne → `app/cloudflare-worker/`.
4. Źródła brandingu → wyłącznie `branding/`. Jeśli folder jest pusty, nie wymyślaj brakujących reguł.
5. Implementacja design systemu / tokenów / tooling dev → `dev/`.
6. Mail, copy, onboarding lub marketing → `content/`.
7. Materiał historyczny → `archive/`; nie używaj go jako CURRENT.

## 4. Kanoniczne komendy

Z root repo:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Z `app/` dostępne są również `npm run build`, `npm run typecheck`, `npm run test:skill-completion-task` i `npm run test:all`.

Repo nie ma obecnie tracked `app/e2e/`, `playwright.config.ts` ani `lighthouserc.json`. Browser acceptance jest osobną warstwą QA; nie raportuj nieistniejącego gate jako PASS.

## 5. Repo delivery governance

**Governed product repo:** `miloszspyrka-code/kompas-zbiorek`.

1. Issue work startuje z aktualnego `main` na branchu/worktree przypisanym do issue.
2. Implementer zwraca dokładny `candidate_sha`.
3. Implementer nie merge'uje własnej pracy `REPO_WRITE` bez odpowiedniego review/authority.
4. Review/PASS dotyczy dokładnie wskazanego SHA; późniejszy commit wymaga ponownej weryfikacji.
5. Po merge należy potwierdzić obecność reviewed SHA w ancestry `origin/main`.
