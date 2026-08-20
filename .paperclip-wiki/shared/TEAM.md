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

Skille `kompas-*` to lekkie kontrakty (nie frameworki). Klucze: `local/<hash>/<slug>` w bibliotece firmy.

## Profile modeli
| Profil | Typy pracy |
|---|---|
| `cheap` | heartbeat, rutyna, triage, status, dokumentacja, prosty research |
| `primary` | rozwiązanie, zmiana kodu, decyzja, analiza błędu, review |
| eskalacja do Deepseek Pro | gdy `cheap`/`primary` nie rozwiązały |

Tworząc issue/rutynę cheap: `assigneeAdapterOverrides.modelProfile = "cheap"`.

## Zasady uniwersalne
1. Nie podłączaj integracji spoza zintegrowanych Apps
2. Edytuj wyłącznie pliki w `C:\Kompas Zbiórek` (lub katalogach agentów)
3. Zachowuj język polski
4. Po zmianach aktualizuj `documentation.md`
5. Nie redukuj pól karty zbiórki do skrótów
6. Rozbieżności rozstrzygaj na korzyść tego kontekstu i zgłoś do CEO
