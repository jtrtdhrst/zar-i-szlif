# Migracja Docker -> Coolify (robocza)

Data: 2026-10-28 | Baza: main @ e3dd9cbb419a39aa6934546a1aa9a310058d6573 | Status: szkic (tylko docs, bez kodu)

## Cel
Spisac plan przeniesienia uslug z Dockera rootless na Coolify, bez ruszania produkcji.

## Twardy zakaz
Nie tworzyc ani nie edytowac katalogu `/ops/coolify/` w tym zadaniu.
Obowiazuje tez zakaz dotykania: `/app`, `/registry`, `/content`, `/supabase`.

## Odsylacz
Zasady repo: zob. `AGENTS.md` w katalogu glownym.

## Kroki
1. Zinwentaryzowac uslugi (zob. `services/README.md`).
2. Zinwentaryzowac Workery i upstreamy (zob. `cloudflare/README.md`).
3. Dopiero po akceptacji tego opisu: przygotowac docelowe definicje Coolify w osobnym PR.

## Rollback
Ten PR dodaje tylko 3 pliki README. Rollback = zamknac PR bez mergowania albo revert commita.
Brak wplywu na produkcje (brak zmian w kodzie, workflow i sekretach).
