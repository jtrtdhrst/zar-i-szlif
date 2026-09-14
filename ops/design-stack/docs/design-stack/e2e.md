# E2E: „Dodaj kartę statystyki zgodną z design systemem" (2026-09-14)

Scenariusz z Etapu 20, wykonany na żywych usługach. v0 wyłączone decyzją
operatora — implementacje robi OpenCode.

## Przebieg

1. **Paperclip → OpenCode**: task trafia do agenta z aktywnym skillem `design-stack`.
2. **OpenDesign context**: `prepare_ui_task.ts` + `design_get_context`
   (`user:kompas-zbiorek-2`) → 56 tokenów (format `od-design-tokens/v1`),
   9 grup komponentów (m.in. `cards` — „Cards and panels"), constraints,
   rozmiar ~15 KB (limit 48 KB). Rekomendacja: *OpenDesign → komponent repo →
   rejestracja w Plasmic*.
3. **Plasmic**: projekt testowy `design-stack-e2e` (`rmaGywfZ19y3pB2cxbGzSC`):
   strona E2E Home (rev 3, generowana kodem WAB), rename (rev 4), komponent
   E2E Card (rev 5), strona Stats /stats (rev 6), style (rev 7), props (rev 8),
   token brand-bg (rev 9–10), sync koloru (rev 11). Wszystko przez MCP.
4. **Repo**: pliki kandydujące z `prepare_ui_task.repoFiles`; implementacja
   komponentu w OpenCode.
5. **GitHub**: branch → testy → PR → review → merge (polityka w skillu).

## Weryfikacje techniczne (dowody)

| test | wynik | dowód |
|---|---|---|
| unit (kontrakty, klienci) | 12/12 pass | `npm test` |
| smoke MCP stdio | 2/2 (17 plasmic_*, 9 design_*) | `SMOKE=1` |
| integracyjne INTEG=1 | OD pass, Plasmic pass | `node --test tests/*.test.ts` |
| tsc --noEmit | czysto | CI + lokalnie |
| docker build + compose deploy | OK, oba kontenery healthy | `docker-compose.mcp.yml` |
| bridge HTTP: /health + /ready 200, 401 bez tokenu | OK | deploy |
| bridge MCP: tools + 159 systemów + kontekst | OK | SSE |
| plasmic HTTP: /health 200, /ready 200 (wab + sesja) | OK | deploy |
| plasmic MCP write-cycle (rev 3–11) | OK | audyt JSONL |
| design_sync: plan(drift) → dry-run → apply → in-sync | OK | CLI |
| design_sync: SYNC_CONFLICT exit 3 | OK | sfałszowany state |
| git: commit 409c672, sekrety poza repo | OK | `git show`, check-ignore |

## Deployment (stan)

- `docker compose -f docker-compose.mcp.yml up -d` — obrazy
  `design-stack/{plasmic-mcp,opendesign-bridge-mcp}:20260914-e2e`,
  limity 256M/0.5 CPU, read-only fs, sieci `plasmic_default`/`open-design_default`.
- plasmic-mcp używa publicznego `https://plasmic.kompaszbiorek.pl`, bo WAB
  stawia ciasteczko sesji (Secure) tylko przez HTTPS/proxy — wewnętrzny
  `http://plasmic-wab:3004` nie nadaje się do logowania.
- Repo: `/root/design-stack`, git (bez remote — decyzja operatora).

## Ograniczenia (wejście do dokończenia przez operatora)

1. **Repo aplikacji**: brak na VPS — wskazać canonical repo (GitHub) oraz
   docelową trasę Plasmic host; E2E domyka się PR do tego repo.
   `design-sync/component-map.json` czeka na ścieżki komponentów repo.
2. **Rate limit WAB**: 15 loginów/15 min na IP (egress) — przy intensywnych
   testach odczekać okno.
3. Supabase storage/realtime restartowały się w dniu audytu — poza zakresem,
   do sprawdzenia niezależnie.
