---
title: Integracje, MCP i produkcja — kontrakty
type: source
tags: [integracje, mcp, cloudflare, supabase, produkcja]
sources: [raw/DOKUMENTACJA-INTEGRACJI.md, raw/PROMPT-SYSTEMOWY.md, raw/documentation.md]
created: 2026-08-20
updated: 2026-10-20
---

## VERIFIED SOURCE ROUTING NOTE — 2026-10-22

Source-verified current map and agent ownership: `wiki/concepts/product-app-website-mcp-routing-20261022.md`. The product MCP Cloudflare Worker at `main:app/mcp-worker/src/index.ts` currently imports OAuth from `app/cloudflare-worker/src/**` and retrieval from `app/plugin/knowledge/**`. Product-local `app/mcp-worker/src/oauth/**` and `src/knowledge/**` are **unmerged candidate** sources, not proof of `main` or deployed runtime. Plasmic marketing Website is `plasmic/website:app/website/**` (scaffold, not deployed). Public MCP landing under `product/www:sites/mcp-connect/**` currently has README only. Protected `mcp.zariszlif.pl` routes remain in product Worker. Preserve original branches and independent CTO review; never infer LIVE_VERIFIED from source or documentation.


## AKTUALNA DECYZJA WŁAŚCICIELA 2026-10-22 — tylko używane MCP

**OpenDesign MCP i OpenCode MCP są WYCOFANE.** Nie utrzymuj dla nich katalogów `mcp/opendesign/`, `mcp/opencode/`, usług Coolify, Dockerfile, workflow deploy ani zadań przywrócenia. Dotyczy to TYLKO nieużywanych serwerów MCP: **nie usuwaj i nie rekonfiguruj samego OpenCode, `opencode.json`, agentów ani jakichkolwiek modeli**. Plasmic MCP jest samodzielną usługą, bez serwisu i biblioteki OpenDesign.

W repo `miloszspyrka-code/zar-i-szlif` jedyna zatwierdzana gałąź wdrożeniowa to `main`. Katalogi: aplikacja `app/web/`, strona `app/website/`, MCP produktu `app/mcp-worker/`, własne MCP `mcp/mantic/`, `mcp/qdrant/`, `mcp/penpot/`, `mcp/plasmic/`, `mcp/supabase/`, `mcp/ubuntu/`, `mcp/paperclip/`. Katalog `supabase/` w root to schemat produktu, nie serwer MCP.

Dokładna tabela Base Directory, Dockerfile, kontekst buildu i status realnej gotowości Coolify: `wiki/concepts/mcp-github-branch-migration-20261022.md` oraz `docs/architecture/monorepo-branches-and-deploy.md` i `ops/coolify/targets.json` na PR #74. MCP produktu to nadal Cloudflare Worker, a nie działający Docker Coolify. Brak pełnego kodu Qdrant/Penpot/Supabase/Ubuntu NIE może być oznaczany jako gotowość deploy.

**Cykl obowiązkowy:** issue + watchdog i rzeczywiste DAG → izolowany branch właściwego folderu → testy, CI, dowody SHA → realny niezależny reviewer CTO → zatwierdzenie PR → merge do `main` → deploy TYLKO odpowiadającej usługi → health, digest/SHA, `initialize`/`tools/list`, rollback → Done. Przegląd PR ani status taska nie zastępuje zatwierdzenia i wdrożenia. Wszelkie starsze sprzeczne instrukcje o OpenDesign/OpenCode MCP podlegają niniejszemu nadpisaniu.


# Integracje, MCP i produkcja

## Architektura danych

**Supabase/Postgres jest jedynym source of truth dla danych aplikacji.** Nie twórz nowej domenowej warstwy danych w Cloudflare D1.

Zakres Supabase obejmuje m.in. użytkowników, drużyny, role/członkostwa, karty aktywności, obecności, sprawności, przygotowanie, eksperymenty, plany, refleksje, kalendarz, zadania, historię, formularze, zgody i metadane załączników. Dostęp zabezpieczają RLS/polityki.

Pliki trafiają do Supabase Storage albo Cloudflare R2 zgodnie z kontraktem modułu; Postgres przechowuje metadane/referencje.

**Przed zmianą schema** Engineer/CTO wykonuje targeted odczyt realnego schema przez aktywne narzędzie Supabase/MCP. Historyczny dokument nie jest wystarczającym dowodem aktualnego schema.

## Cloudflare Worker

Worker jest warstwą API i integracji pomiędzy frontendem, Supabase i usługami zewnętrznymi:
- weryfikacja sesji/JWT;
- bezpieczne użycie sekretów integracji;
- endpointy Apps SDK/MCP i proxy wymagające warstwy serwerowej;
- ewentualne użycie R2/cache tam, gdzie jest to uzasadnione.

Worker nie jest drugim systemem prawdy dla danych domenowych.

## Product MCP CRUD / ChatGPT subscription distinction — 2026-11-07

Canonical decision: [Product MCP CRUD, client eligibility and free-user access](wiki/concepts/product-mcp-crud-and-chatgpt-client-eligibility-20261107.md). MCP protocol and our product API can perform typed create/read/update/delete; a historical knowledge-only deployed Worker is a release state, not a universal read-only constraint. The customer-facing app must provide authenticated CRUD without requiring any paid ChatGPT subscription. ChatGPT Free access to custom product MCP writes remains **unverified**; Plus account behavior with Paperclip administrative MCP must not be extrapolated to all plugin plans. No workaround that hides writes as read-only tools; preserve product OAuth, actor/team authorization, RLS, privacy, audit and write-readback acceptance.

## Product MCP / ChatGPT — current split (2026-10-20)

**CURRENT repository:** `miloszspyrka-code/zar-i-szlif`. The new dedicated **product knowledge MCP Worker** lives in `app/mcp-worker/`; deploy target `zar-i-szlif-mcp`, public target `https://mcp.zariszlif.pl/mcp`. The SOURCE/CI build is verified on merged `main` (PR #51, merge `a8b251bb452bd7440d116c9716e892d1bf578230`); **Cloudflare production/OAuth/Qdrant live integration remains UNVERIFIED**.

The Worker reuses `app/plugin/knowledge/` as canonical Qdrant/RAG code, with dedicated OAuth KV and credentials. `app/cloudflare-worker/` and old `kompaszbiorek.pl` routes remain legacy, independently deployed services. Paperclip control-plane MCP and standalone `mcp-qdrant-hybrid` are separate workloads. `/mcp` is the integration contract; schemas and tools must be confirmed against the live Worker and not only inferred from the source.

Cloudflare Git: root `app/mcp-worker`, `main`, build `npm run build`, deploy **`npm run deploy`**; dedicated KV ID via deploy env `MCP_OAUTH_KV_ID`; runtime secrets never committed. Cloudflare Access OFF for public OAuth endpoints; authorization is enforced by MCP OAuthProvider. Docs/runbook: [[wiki/concepts/product-mcp-cloudflare-worker]] (architecture, actual repo, required bindings, owner/CTO release boundaries, security negative tests, troubleshooting, self-repair cycle).

**Open release gate:** `KOMAA-1003` previously specified one legacy Worker/OAuth surface; CTO must reconcile that earlier acceptance contract with the explicitly requested new standalone Worker deployment. Do not infer production readiness or silently close earlier tasks merely from PR #51.

## OpenCode MCP registration (legacy `opencode_local`)

For legacy `opencode_local` agent runs, the effective global OpenCode MCP registration is loaded from `${XDG_CONFIG_HOME}/opencode` under the server process home. In the current Paperclip instance this is `/paperclip/.config/opencode/opencode.jsonc` (`HOME=/paperclip`); it is copied into each run's temporary OpenCode config. The adapter-generated `opencode.json` is not a substitute for this global `.jsonc` MCP registration. Do not treat `/root/.config/opencode/opencode.jsonc` or a repository-local candidate as the effective source without runtime readback.

Remote MCP credentials are referenced in the config using OpenCode's `{env:VARIABLE_NAME}` substitution, e.g. `headers.Authorization: "Bearer {env:PLASMIC_MCP_TOKEN}"`. Bind the variable to the agent through Paperclip's secret binding (`{type: secret_ref, secretId: <existing authorized secret id>, version: "latest"}`); never place secret values in config, source, comments, logs, or screenshots. Confirm the effective agent binding and the actual agent-run environment by checking variable presence only (redacted), then verify the MCP handshake and an authenticated harmless read from that agent's own runtime. A board-side connection test or `GetAgentEffectiveTools` filter alone does not prove OpenCode-configured MCP availability.

KOMAA-996 runtime proof (2026-10-20): Plasmic is registered at `http://plasmic-mcp:8091/mcp`; the effective config uses `Bearer {env:PLASMIC_MCP_TOKEN}` and the Designer binding references the existing Plasmic service secret (value never recorded). Run `4d05dc11-12ce-4f4c-b913-d7ac6c0d93fa` used the Designer principal and included `PLASMIC_MCP_TOKEN` in its redacted environment; its reported native `plasmic_read_page` succeeded for page `mcpmvfk4pspr05tqexp` at revision 91. This evidence does not assert the still-pending project-read result or authorized edit/save/readback.

## Google OAuth and Calendar

Google OAuth scopes są dodawane minimalnie i tylko dla faktycznie używanej funkcji. Szersze zakresy wymagają osobnej potrzeby i oceny weryfikacji.

## Produkcja

Current product repo: `miloszspyrka-code/zar-i-szlif`. Historical `panel.kompaszbiorek.pl` remains a separate legacy deployment; the new product MCP is `app/mcp-worker/` with target host `mcp.zariszlif.pl`, NOT live-verified. All production pushes/deploys require independent CTO release authorization, exact SHA, verified secrets and rollback. Consult [[wiki/concepts/product-mcp-cloudflare-worker]] rather than historical raw snapshots.

## Paperclip MCP Wiki

Bezpieczna edycja Wiki używa `paperclipWikiGetPage/GetMetadata` do pobrania aktualnego hash oraz optimistic concurrency przy `Update/Propose/Apply`. `raw/` jest historycznym snapshotem i nie powinno być modyfikowane jako bieżący kanon.

Powiązania: [[wiki/concepts/paperclip-wiki-mcp]], [[wiki/sources/wspolny-kontekst]], [[wiki/entities/repo-map]].

## PII privacy contract — Product MCP / Supabase (planned)

All app-owned user profile emails, given names and surnames must be protected by authenticated application-layer encryption in Supabase with keys stored outside the database. Do NOT change managed Supabase Auth `auth.users.email` (login exception), but the user-facing product MCP must never receive or return identity fields, OAuth email/name claims, decrypted values, raw profile queries or identity-bearing Qdrant/log content. Use server-side PII-free DTO allowlists and deny-by-default tool permissions; validate with synthetic negative E2E before release. This requirement is **NOT YET IMPLEMENTED**; source-of-truth [[wiki/concepts/product-mcp-supabase-pii-privacy]] and execution plan [KOMAA-1108](https://paperclip.kompaszbiorek.pl/KOMAA/issues/KOMAA-1108).
