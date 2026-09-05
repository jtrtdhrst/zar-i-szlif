# .paperclip-wiki — durable knowledge (wiki + agenci)

```
.paperclip-wiki/
├── wiki/                  # trwała wiedza (linki [[wiki/...]])
│   ├── index.md           # katalog wszystkiego · log.md
│   ├── sources/           # znormalizowane źródła: wspolny-kontekst (kanon biznesowy),
│   │                      # prd-kompas, baza-aktywnosci, integracje-mcp, cykl-doskonalenia
│   ├── concepts/          # pojęcia/kontrakty: karta-zbiorki, cykl, context-first, DoD,
│   │                      # stan-braku-danych, brand-dna, bramka-jakosci-ui
│   ├── entities/          # systemy: repo-map (REPO MAP), worker-wtyczka-rr,
│   │                      # panel-google-sheets, integracje-api, agents-*
│   ├── synthesis/         # single-source-of-truth, invarianty-i-brand
│   └── projects/kompas-zbiorek/  # index (wizja TARGET) · decisions (ADR) · standup (CURRENT) · history
├── agents/<slug>/AGENTS.md  # 7 agentów (ceo/coo/cto/engineer/designer/ui-qa/cmo) — lazy-load ../../shared/*
├── shared/                # CONTEXT (TARGET/CURRENT/DELTA/UNAPPROVED) · PRODUCT · STATE · GOVERNANCE · TEAM · DELIVERY
└── raw/                   # niemutowalne kopie kanonu (WSPOLNY_KONTEKST, PRD, API, 00–06)
```

Zasady: `sources/wspolny-kontekst` = kanon biznesowy; `projects/kompas-zbiorek/index` + `decisions` = wizja i decyzje (TARGET); stan dziś (`CURRENT`) tylko z kodu/standupu/integracji/testów — opis ≠ dowód. Onboarding = `UNAPPROVED / DO NOT ASSUME`. Brand/audience/voice = `marketing/01–04`, hierarchia wartości 1–6 z `wspolny-kontekst` (root README ją cytuje, nie definiuje).

Stara ścieżka `.paperclip-context` to junction → `.paperclip-wiki` (kompatybilność wsteczna).
