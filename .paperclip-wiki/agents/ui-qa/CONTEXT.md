# Kontekst ui-qa

Źródło prawdy: `C:\Kompas Zbiórek\.paperclip-wiki\shared\` — czytaj przez `../../shared/...`.

**Zasada:** nie kopiuj faktów produktowych do własnego promptu. Referencjuj wspólne pliki:
- `PRODUCT.md` → TARGET / MUST-HAVE (cel; docelowy cykl **Planowanie → Realizacja → Refleksja → Doskonalenie**)
- `STATE.md` → CURRENT / AS-IS (zweryfikowany stan; bieżący cykl **Planowanie → Realizacja → Analiza → Decyzja**)
- `KONTRAKT-WIEDZY.md` → reguły ról i statusy (TARGET / CURRENT / DELTA / UNAPPROVED)

Wczytaj lazy-load wg roli:
- Wszyscy: PRODUCT.md (TARGET — czym jest projekt)
- CEO: + GOVERNANCE.md (strategia, retro) + PRD przy decyzji produktowej
- COO: + GOVERNANCE.md (triage)
- CTO/Engineer: + DELIVERY.md (Mapa systemu, REPO MAP, integracje) + STATE.md (CURRENT)
- UI QA/Designer: + DELIVERY.md (Design/branding) + STATE.md (CURRENT) + fragment PRD
- CMO: + STATE.md (CURRENT — publish gate) + TEAM.md (zakres własny)
