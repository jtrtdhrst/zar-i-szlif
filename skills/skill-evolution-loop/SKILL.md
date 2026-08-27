---
name: skill-evolution-loop
description: Evidence-driven pętla ewolucji instrukcji Kompas Zbiórek (Company Skills i konteksty agentów) — dowód → propozycja → bramka → apply z hash-guardem → publikacja → weryfikacja. Używaj przy retro, reflection-coach, analizie failed runs i każdej propozycji zmiany SKILL.md lub kontekstów .paperclip-wiki.
---

# Skill Evolution Loop (Kompas)

Cel: instrukcje agentów zmieniają się tylko na dowodach, najmniejszymi trwałymi krokami, z jawną historią i możliwością wycofania.

## Zakres

- Dotyczy: `C:\Kompas Zbiórek\skills\*` (kompas-\*, ceo-audit, ceo-retro, advanced-ui, status) oraz konteksty `\.paperclip-wiki\agents\*\` (AGENTS/SOUL/TOOLS/CONTEXT).
- Nie dotyczy: kodu produktu, runtime'u Paperclip (`C:\paperclip`), skilli bundled/catalog (read-only).
- Źródło prawdy treści: repo `C:\Kompas Zbiórek`. Biblioteka firmy jest dystrybucją — nigdy nie edytuj kopii w instancji jako źródła.

## Pętla (6 kroków)

### 1. EVIDENCE
- Konkretne źródło: run-id, link do issue/komentarza, wzorzec powtórzony ≥2 razy albo pojedynczy kosztowny deterministyczny błąd.
- Brak dowodu = STOP. Opinia, styl czy „warto by" nie są dowodem.

### 2. PROPOSAL
- Najmniejsza zmiana jednego pliku, jedna odpowiedzialność.
- Format wpisu: `BEFORE / WHERE / PROPOSED / WHY / EXPECTED EFFECT / REVERT`.
- Batch ≤ 3 zmian administracyjnych na cykl.

### 3. GATE
- Zwykłe zmiany kontraktów: akceptuje CEO.
- Zmiany `kompas-governance`, polityk bezpieczeństwa, `modelProfile`, przepływów autoryzacji oraz wszystko, co dotyczy agentów innych niż autor: `request_confirmation` do boardu.
- Zamrożenia obowiązujące w organizacji (np. READ-ONLY skills runtime) mają pierwszeństwo przed tą pętlą.

### 4. APPLY
- Hash-guard: przed zapisem porównaj SHA-256 aktualnego fragmentu z oczekiwanym z propozycji; niezgodny = STOP (propozycja stale).
- Zapis + apend-only wpis w `CHANGELOG.md` katalogu skilla: data, dowód (link), decyzja/gate, diff-summary, revert-path.

### 5. PUBLISH (gated)
- Publikacja = import katalogu skilla do biblioteki firmy (`POST /api/companies/{cid}/skills/import`, `source` = ścieżka katalogu z repo), potem resync agentów po slugu; lokalne skille nie wspierają auto-update (tylko GitHub-managed).
- Po re-import sprawdź jednoznaczność sluga; usuń stary wpis i zsynchronizuj ponownie assigned agentów; potwierdź `attachedAgentCount`.
- Ten krok wymaga zniesionego zamrożenia skills runtime (obecnie: potwierdzone K96 PASS) — inaczej MANUAL_ACTION/board.

### 6. VERIFY
- Po ~2 tygodniach lub 3 naturalnych okazjach sprawdź: czy problem zniknął, czy koszt nie wzrósł, czy reguła działa bez autora.
- Decyzja: utrzymaj / zawęź / wycofaj (wycofanie = nowa iteracja APPLY na podstawie wpisu REVERT z CHANGELOG).

## Rejestry

- `CHANGELOG.md` w każdym katalogu skilla — apend-only, wpis per APPLY.
- Dowody zostają w issue Paperclip; CHANGELOG trzyma linki, nie kopie treści.

## Anty-wzorce

- Edycja SKILL.md bez wpisu EVIDENCE i bez APPLY/CHANGELOG.
- Masowe rewrite'y; kilka odpowiedzialności w jednej zmianie.
- Omijanie GATE dla governance/security.
- Osobne issue na każdą mikrozmianę — zmiany batchuje się w istniejącym issue retro/audytu.
- Sync agentów w trybie `replace` bez jawnej zgody boardu.
