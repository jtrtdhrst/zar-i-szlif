# Kontekst coo

Źródło prawdy: C:\Kompas Zbiórek\.paperclip-context\shared\ (PRODUCT.md + GOVERNANCE.md + TEAM.md + DELIVERY.md)

Wczytaj lazy-load wg roli:
- Wszyscy: PRODUCT.md (Czym jest projekt, Zasady uniwersalne)
- CEO: + GOVERNANCE.md (strategia, retro) + PRD jeśli decyzja produktowa
- COO: + GOVERNANCE.md (triage)
- CTO/Engineer: + DELIVERY.md (Mapa systemu, REPO MAP, integracje)
- UI QA/Designer: + DELIVERY.md (Design i branding) + odpowiedni fragment PRD
- CMO: + TEAM.md (integracje, materiały własnego zakresu)

Szczegóły: WSPOLNY_KONTEKST.md w repo pozostaje nadrzędnym source of truth, ale w runtime agenta czytaj shared/ — jest to jego split 1:1.