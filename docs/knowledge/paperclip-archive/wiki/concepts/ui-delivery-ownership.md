---
title: UI delivery ownership — Designer × Engineer
type: concept
tags: [ui, plasmic, delivery, dag, ownership]
created: 2026-09-16
updated: 2026-09-16
---

# UI delivery ownership — Designer × Engineer

Ten dokument definiuje **proces i granice artefaktów**, nie zastępuje kontraktów ról. Kanoniczne instrukcje ról pozostają w `wiki/agents/<rola>/AGENTS.md`.

## Kiedy używać

Dla user-facing feature, który jednocześnie zawiera:
- wizualnie zarządzany UI w Plasmic, oraz
- zachowanie aplikacji, dane, API, Supabase, persistence lub code components.

Jeżeli outcome jest wyłącznie designowy albo wyłącznie techniczny, użyj jednego bounded ownera zamiast sztucznego DAG-u.

## Standardowy minimalny DAG

`D1 DESIGN + E1 ENGINEERING → E2 INTEGRATION → Q1 UI QA → CTO acceptance`

### D1 DESIGN
Owner: Designer.

Owned artifacts:
- visual hierarchy, layout, spacing, typography;
- Plasmic tokens, native page/component structure;
- visual variants, breakpoints/responsive behavior;
- visual/accessibility states.

Exit: `DESIGN_READY` z:
- exact Plasmic project/page/component refs;
- changed tokens/variants/breakpoints;
- props/slots/events/actions wymaganymi przez integrację;
- wymaganym desktop/mobile evidence;
- ograniczeniami, które E2 ma zachować.

Po `DESIGN_READY` przekazany visual artifact jest zamrożony do czasu zakończenia E2 albo jawnego Designer amendment.

### E1 ENGINEERING
Owner: Engineer.

Owned artifacts:
- business/application logic;
- state, routing, validation;
- API/backend, Supabase/data contracts, persistence;
- code components i techniczne kontrakty integracji.

D1 i E1 idą równolegle, jeśli nie istnieje realna zależność. E1 nie modyfikuje visual Plasmic tree.

### E2 INTEGRATION
Owner: Engineer.
Blocked by: D1 `DESIGN_READY` + E1 complete.

Cel: związać zaakceptowany/frozen Plasmic artifact z zachowaniem aplikacji i kodem. Engineer nie przejmuje visual ownership. Non-visual wiring jest dozwolony tylko, gdy nie zmienia wyglądu ani struktury UX.

Jeśli E2 ujawni potrzebę zmiany layoutu, tokenu, wariantu, responsywności lub native Plasmic structure, powstaje bounded amendment do Designera; Engineer nie robi „small Studio correction”.

### Q1 UI QA
Owner: UI QA.
Blocked by: E2.

QA sprawdza dokładnie ten sam E2 candidate/workspace i odpowiedni Plasmic artifact. Nie robi świeżego niezależnego checkoutu i nie naprawia błędów.

Defect routing:
- visual/layout/typography/token/responsive/native-Plasmic → Designer amendment;
- behavior/state/data/API/binding/integration/build → Engineer;
- niezależne błędy obu klas → split findings.

Zmiana candidate SHA lub dotkniętego Plasmic artifact po PASS unieważnia affected PASS.

## Collision invariants

1. **One writer per artifact at a time.**
2. Designer i Engineer nie edytują równolegle tego samego Plasmic page/component.
3. Shared/global Plasmic component pozostaje Designer-owned i wymaga usage/blast-radius evidence.
4. E1 nie jest blokowane przez D1 bez realnej zależności.
5. E2 nie startuje przed D1 `DESIGN_READY` i E1 complete.
6. QA nie implementuje poprawek.
7. Execution-harness/environment blocker jest osobną zależnością Harness/Environment i blokuje tylko zależną gałąź.

## Task packet minimum

Przy collision risk task powinien jawnie zawierać:

`OBJECTIVE / OWNED_ARTIFACTS / DO_NOT_TOUCH_ARTIFACTS / INPUTS / ACCEPTANCE / DEPENDENCIES / DONE-EVIDENCE`

Dla code-bearing E2 handoff dodaj `workspace / branch / candidate_sha / verification / Plasmic refs`.

## Powiązane źródła

- `wiki/agents/designer/AGENTS.md`
- `wiki/agents/engineer/AGENTS.md`
- `wiki/agents/cto/AGENTS.md`
- `wiki/agents/coo/AGENTS.md`
- `wiki/agents/ui-qa/AGENTS.md`
- [[wiki/concepts/bramka-jakosci-ui]]
- [[wiki/concepts/definition-of-done]]
