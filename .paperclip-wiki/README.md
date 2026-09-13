# .paperclip-wiki — Wiki mirror + external agent knowledge

Ten katalog pełni dwie powiązane, ale różne funkcje:

1. **mirror trwałej wiedzy Paperclip Wiki** (`wiki/`, `raw/`),
2. **wersjonowane external agent bundles** (`agents/`, `shared/`).

Nie jest execution workspace i nie należy traktować go jako miejsca wykonywania zmian produktu.

## Struktura

```text
.paperclip-wiki/
├── wiki/                 # znormalizowane strony durable knowledge
├── raw/                  # historyczne/snapshotowe źródła; nie są automatycznie CURRENT
├── shared/               # wspólny lazy-load dla agentów
│   ├── CONTEXT.md        # TARGET/CURRENT/DELTA/UNAPPROVED + źródła prawdy
│   ├── PRODUCT.md        # produkt TARGET / MUST-HAVE
│   ├── STATE.md          # CURRENT / AS-IS z dowodem
│   ├── GOVERNANCE.md     # delivery, DoD, context-first
│   ├── TEAM.md           # routing ról
│   └── DELIVERY.md       # delivery/deploy/integracje
└── agents/               # bundle per agent; AGENTS.md jest entry pointem roli
```

## Zasady źródeł

- **Live Paperclip Wiki** jest trwałym źródłem decyzji produktowych/architektonicznych.
- Ten mirror może pozostawać w tyle za refactorem repo. `TARGET` z Wiki nie dowodzi `CURRENT`.
- Dla stanu wdrożenia rozstrzygają bieżący kod/runtime/testy.
- Dla aktualnej mapy repo i technicznych invariantów używaj `skills/kompas-technical-context/SKILL.md`.
- Root `CONTEXT.md` jest operacyjnym routerem konfliktów źródeł, workspace i trwałych lekcji z incydentów.
- `raw/` i materiały historyczne służą do provenance/porównań; nie przywracaj z nich starej architektury bez jawnej decyzji.

## External instructions ≠ execution workspace

`instructionsRootPath` określa, skąd agent czyta instrukcje. `currentExecutionWorkspace` określa, gdzie agent może wykonywać task i pisać do repo. Nie wolno utożsamiać tych ścieżek.

Zmiany w bundle instrukcji obowiązują od kolejnego wake/run. Nie edytuj ręcznie managed cache pod `~/.paperclip/...` jako substytutu wersjonowanego źródła.

## Minimalny model ładowania

Nie ładuj całej Wiki do każdego runu. Agent zaczyna od bieżącego issue/wake i ładuje tylko potrzebny shared context/skill. `shared/CONTEXT.md` definiuje status wiedzy; szczegóły domenowe zostają w dedykowanych stronach/skillach.

Szczegóły historycznej migracji external bundles są w `context-README.md`.
