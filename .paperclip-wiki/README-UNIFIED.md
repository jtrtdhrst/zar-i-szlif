# Unified Knowledge Base — C:\Kompas Zbiórek\.paperclip-wiki

Jedna lokalizacja dla wszystkiego (wiki + agenci).

```
.paperclip-wiki/               ← baza = wiki-root (plugin paperclipai.plugin-llm-wiki)
├── AGENTS.md                  ← schema wiki (LLM Wiki)
├── IDEA.md
├── raw/                       ← niemutowalne źródła (WSPOLNY_KONTEKST, PRD, docs)
├── wiki/                      ← wiedza trwała (sources, concepts, entities, synthesis, projects)
│   ├── index.md               ← katalog całości (ten plik linkuje też agents/shared)
│   └── log.md
├── agents/                    ← wiedza per-agent (po dopisaniu /agents/<nazwa> jako źródło)
│   ├── ceo/AGENTS.md + SOUL.md + CONTEXT.md + TOOLS.md
│   ├── coo/ ...
│   ├── cto/ ...
│   ├── engineer/ ...
│   ├── designer/ ...
│   ├── ui-qa/ ...
│   └── cmo/ ...
└── shared/                    ← wiedza wspólna (PRODUCT.md, GOVERNANCE.md, TEAM.md, DELIVERY.md)
```

- **Wiki**: `C:\Kompas Zbiórek\.paperclip-wiki` (requiredDirectories: raw, wiki, wiki/sources, wiki/projects, wiki/entities, wiki/concepts, wiki/synthesis)
- **Agenci Paperclip**: `instructionsRootPath = C:\Kompas Zbiórek\.paperclip-wiki\agents\<slug>` (7 agentów zaktualizowanych w DB 2026-08-20, `instructionsBundleMode=external`)
- **Kompatybilność**: `C:\Kompas Zbiórek\.paperclip-context` to junction → `\.paperclip-wiki` (backup w `.paperclip-context.backup`). Stare ścieżki dalej działają.

Użycie:
- Pliki wiki: wrzuć do `raw/` lub edytuj `wiki/...`, zaktualizuj `wiki/index.md`
- Źródło wiedzy agenta: podaj `C:\Kompas Zbiórek\.paperclip-wiki\agents\<nazwa_agenta>` (np. `...\agents\designer`)
