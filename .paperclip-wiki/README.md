# .paperclip-context — External Knowledge Base

Ten katalog to **zewnętrzna baza wiedzy** dla agentów Paperclip. Zastępuje `~/.paperclip/.../instructions` (managed) i pozwala wersjonować instrukcje w repo.

## Struktura

```
.paperclip-context/
├── shared/              # Wiedza wspólna (czytana przez AGENTS.md via relative path)
│   ├── PRODUCT.md       # Produkt, repo, invariants, architektura
│   ├── GOVERNANCE.md    # Delivery, DoD, CONTEXT-FIRST, STARTUP I/O BUDGET
│   ├── TEAM.md          # Zespół, skille per rola, profile modeli
│   └── DELIVERY.md      # REPO MAP, produkcja, testy, integracje
└── agents/              # Bundle per worker (External)
    ├── ceo/             # RootPath dla CEO
    │   ├── AGENTS.md    # Entry file — jedyny plik ładowany automatycznie
    │   ├── SOUL.md      # Persona
    │   ├── HEARTBEAT.md # Procedura heartbeat (jeśli dotyczy)
    │   ├── TOOLS.md     # Narzędzia
    │   └── CONTEXT.md   # Dodatkowy kontekst (lazy-load)
    ├── coo/
    ├── cto/
    ├── engineer/
    ├── designer/
    ├── ui-qa/
    └── cmo/
```

## Zasady

1. **External = bundle instrukcji, nie eksplorator repo.** RootPath to `C:\Kompas Zbiórek\.paperclip-context\agents\<slug>`, nie całe `C:\Kompas Zbiórek`. AGENTS.md jest jedynym plikiem ładowanym przy heartbeat — reszta musi być jawnie wskazana w AGENTS.md.

2. **Shared ≠ kopiowanie.** Wspólne zasady nie są kopiowane do 7 AGENTS.md, tylko trzymane jako Skills (`kompas-governance`, `kompas-technical-context` itd.) lub jako `shared/*.md` czytane via `../../shared/...` w AGENTS.md.

3. **External ≠ workspace.** `instructionsRootPath` to gdzie agent czyta instrukcje. `execution workspace` (`C:\Kompas Zbiórek\.paperclip-worktrees\...`) to gdzie wykonuje zadania. Nie mieszaj.

## Aktualizacja

- Zmiany w `AGENTS.md` / `SOUL.md` obowiązują od następnego runa/heartbeat, nie w trakcie aktywnego runa.
- Historia: 20.08.2026 — migracja z `managed` ( `~/.paperclip/.../agents/<id>/instructions` ) na `external` (ten katalog), 1:1 kopia + split shared.
- Weryfikacja: `paperclipListAgents` → `adapterConfig.instructionsBundleMode == "external"` i `instructionsRootPath` wskazuje tutaj.

## Edycja

Edytuj pliki w tym katalogu normalnie w IDE. Paperclip odczyta je przy następnym wake. Nie edytuj `~/.paperclip/...` ręcznie — ten katalog jest teraz source of truth.
