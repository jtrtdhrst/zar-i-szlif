# Kontekst engineer

Źródło prawdy: `C:\Kompas Zbiórek\.paperclip-wiki\shared\` — czytaj przez `../../shared/...`.

**Zasada:** nie kopiuj faktów produktowych do własnego promptu. Czytaj `shared/CONTEXT.md` (kanon statusów), `shared/PRODUCT.md` (TARGET) i `shared/STATE.md` (CURRENT). Szczegóły cyklu/statusów są w `STATE.md`/`CONTEXT.md` — nie powielaj ich tutaj.

Wczytaj lazy-load wg roli (zob. `shared/CONTEXT.md` → reguły ról):
- Wszyscy: PRODUCT.md (TARGET) + STATE.md (CURRENT)
- CEO: + GOVERNANCE + PRD przy decyzji produktowej
- COO: + GOVERNANCE (triage)
- CTO/Engineer: + DELIVERY (REPO MAP, integracje) + kontrakty API
- UI QA/Designer: + DELIVERY (Design/branding) + STATE (CURRENT) + fragment PRD
- CMO: + STATE (CURRENT — publish gate) + TEAM
