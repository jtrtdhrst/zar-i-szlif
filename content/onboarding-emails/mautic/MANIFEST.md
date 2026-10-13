# Mautic — welcome (inert staging, KOMAA-786)

Status: STAGED, NOT imported. No Mautic email resource created, nothing sent.
Production: OFF. No live campaign enrollment before CMO + CTO acceptance.

## Canonical source (untouched)
- KOMAA-773 doc `creative-package`, final HTML sha256
  `2628e01982b3d94c15ca969f2aa70de896fdf1a6c28546435ac1a152b492b0fc` (17,301 B)
- Subject: `Twoje konto INFLUENCY jest aktywne — harcówka czeka`
- Preheader: `Plan pierwszej zbiórki, materiały i zadania — 3 minuty.`

## Test variant: `welcome-mautic-test.html`
- sha256 `0f70cae4341574670933ae0889a71453b4d986e35938993555528e050ccf939a` (17,311 B)
- 3 token swaps vs canonical (official Mautic token syntax, docs.mautic.org):
  - `Cześć, Jan!` → `Cześć, {contactfield=firstname|Jan}!` (demo fallback kept for TEST render)
  - `Wypisz się` placeholder href → `{unsubscribe_url}`
  - `Ustawienia powiadomień` placeholder href → `{unsubscribe_url}` (preference-center URL when activated; CMO may replace with a dedicated settings URL)
- Demo names (Jan Kowalski et al.) and static dates left literal: TEST-only render, never to real users.
- Import target (Lifecycle Ops, when API credentials exist): INACTIVE, non-sending email; TEST-only segment; read back subject + HTML hash before any test delivery.
