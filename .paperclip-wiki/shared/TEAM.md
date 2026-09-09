# Zespół — Kompas Zbiórek

## Konteksty i skille per rola

| Agent | Always-on | On-demand |
|---|---|---|
| CEO | kompas-governance, para-memory-files | ceo-audit, ceo-retro, reflection-coach, doc-maintenance |
| COO | issue-triage, kompas-governance, kompas-team-map | task-planning, para-memory-files |
| CTO | kompas-technical-context, github-pr-workflow | prepare-mcp-integration, task-planning |
| Engineer | kompas-technical-context, github-pr-workflow | prepare-mcp-integration, chatgpt-apps |
| Designer | kompas-design-context, agent-browser | design-critique |
| UI QA | kompas-qa-context, qa-acceptance, agent-browser | design-critique |
| CMO | kompas-brand-email | Sender.net |

Skille `kompas-*` są lekkimi kontraktami domenowymi, nie frameworkami.

### Własność kontekstu

- `kompas-technical-context` jest **jedynym skillowym właścicielem REPO MAP, data/infra invariants i aktualnego test surface** dla CTO + Engineer.
- `github-pr-workflow` odpowiada za workflow Git/PR/review i nie powinien hardcodować ścieżek projektu.
- `kompas-design-context` utrzymuje kanon designu; prompt Designera nie kopiuje brandbooka.
- `kompas-qa-context` utrzymuje acceptance/test contract; prompt UI QA nie kopiuje listy testów.
- `kompas-brand-email` utrzymuje lokalizacje i reguły content/email.

Dzięki temu rename repo aktualizuje się w jednym skillu domenowym zamiast w kilku promptach.

## Profile modeli

| Profil | Typy pracy |
|---|---|
| `cheap` | heartbeat, rutyna, triage, status, dokumentacja, prosty research |
| `primary` | rozwiązanie, zmiana kodu, decyzja, analiza błędu, review |
| eskalacja | gdy `cheap`/`primary` nie rozwiązały |

Tworząc issue/rutynę cheap: `assigneeAdapterOverrides.modelProfile = "cheap"`.

## Zasady uniwersalne

1. Nie podłączaj integracji spoza zintegrowanych Apps bez jawnej potrzeby.
2. Edytuj wyłącznie właściwy execution workspace/repo dla taska.
3. Zachowuj język polski.
4. Aktualizuj dokumentację tylko gdy zmiana modyfikuje jej kontrakt.
5. Nie redukuj wymaganych pól produktu do demonstracyjnych skrótów.
6. Rozbieżności TARGET/CURRENT rozstrzygaj przez odpowiednie źródło i zgłoś istotny konflikt do właściwego ownera.
