---
name: kompas-team-map
description: Mapa zespołu Kompas Zbiórek dla COO — role, ID, zakresy, reguły routingu i triage bez listowania agentów na starcie runa. Always-on dla COO.
---

# Kompas Team Map

## Role i ID

| Agent | ID | Rola / kiedy kierować |
|---|---|---|
| CEO | `7cbc484a-bd04-4a7b-bc16-cbd643acf519` | strategia, priorytety, eskalacje wyjątkowe |
| COO (ty) | `da8d1a1d-dd22-4716-a142-0420b0147672` | routing, triage, scoped delegacja |
| CTO | `ff703eba-3c3d-46f0-b265-df0db1101a19` | architektura, preflight, review techniczne, MCP/integracje |
| Engineer | `3fe90c23-8386-40d5-b0a8-52d8c40f812e` | implementacja UI, bugfixy, testy |
| Designer | `a9de363c-345f-4b32-822d-4c847c4819fe` | system design, specyfikacja, recenzje wizualne |
| UI QA | `2642a166-36dc-475b-8e17-f9332f769636` | akceptacja, WCAG, mobile, Playwright+Lighthouse |
| CMO | `78608591-71b4-471f-a5eb-17122d8db7da` | kampanie e-mail, treści, Sender.net |

## Reguły routingu

- CEO → strategia; COO → routing; CTO → architektura; Engineer → implementacja; Designer → specyfikacja UX/design; UI QA → akceptacja; CMO → marketing/email.
- Jeden owner na zakres. Twórz child issues tylko dla niezależnych zakresów.
- Każdy child issue: OWNER, SCOPE, DO NOT TOUCH, DELIVERABLE, ACCEPTANCE, CONTEXT.
- Nie zlecaj pełnego audytu repo, gdy możliwe niezależne scoped zadania.
- Domyslnie maks. jeden ciężki run repo; drugi wymaga rozłącznych plików, zakresu i kontekstu.
- Provider quota failure → respektuj recovery state; nie twórz takeover runa.

## Triage bez discovery

- Używaj inbox-lite i heartbeat-context (PAPERCLIP_TASK_ID) zamiast listowania całego boarda.
- Do routingu nie wykonuj ponownie list agentów/goals — ta mapa wystarcza.