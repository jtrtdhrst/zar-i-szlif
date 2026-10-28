# Cloudflare: Workery i upstreamy

Data: 2026-10-28 | Baza: main @ e3dd9cbb419a39aa6934546a1aa9a310058d6573

## Workery
Liczba zinwentaryzowanych Workerow: 13 (lista nazw do uzupelnienia w kolejnym kroku).

## Upstreamy
Dla kazdego Workera dopisac docelowy upstream po migracji (Coolify vs stan obecny).

## Znany drift: paperclip-mcp
Odnotowany dryf konfiguracji paperclip-mcp (do wyrownania przed cutover).

## Znany incydent: 503 mcp.zariszlif.pl
Odnotowane bledy 503 na `mcp.zariszlif.pl` — do diagnozy w ramach migracji, bez zmian w tym PR.

## Status 2026-10-28 15:58 UTC: control-plane Coolify down, edge i data-plane OK

- 5x edge healthy przed awaria; data-plane publiczny dziala (panel, paperclip-mcp health, Plasmic).
- Edge sslip: `/healthz` puste.
- Coolify API: 500 potem 504 na trasach DB; tylko `get_version` (4.4.6). Shell/SSH bez outputu.
- Decyzja: zero nowych mutacji Coolify do powrotu API; dane tylko z Paperclip, reszta fresh. Bez sekretow.
