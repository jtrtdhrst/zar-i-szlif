# plasmic-mcp

Cienki semantyczny adapter nad WAB REST (bez Chrome/CDP).
Auth: sesja (`PLASMIC_EMAIL`/`PLASMIC_PASSWORD`, dedykowany user) lub
rotowalny `PLASMIC_TEAM_TOKEN` (`x-plasmic-team-token`).

## Narzędzia (17)

Odczyt: `plasmic_get_project`, `plasmic_list_pages`, `plasmic_list_components`,
`plasmic_list_tokens`, `plasmic_read_page`, `plasmic_read_component`,
`plasmic_read_component_tree`.
Zapis: `plasmic_create_page`, `plasmic_create_component`, `plasmic_insert`,
`plasmic_update`, `plasmic_delete`, `plasmic_set_props`, `plasmic_set_styles`,
`plasmic_use_component`.
Operacyjne: `plasmic_validate`, `plasmic_get_changes`.

Manifest deklaruje adnotacje MCP (`readOnlyHint`/`destructiveHint`/`idempotentHint`)
zgodne z podziałem powyżej: odczyt i operacyjne `readOnlyHint:true`, zapis
`readOnlyHint:false`; `destructiveHint:true` tam, gdzie zapis może nadpisać
istniejący wpis (`plasmic_insert`, `plasmic_update`, `plasmic_delete`).
Platforma klasyfikuje narzędzia zmieniające projekt właśnie po tych flagach.

## Mechaniki

- Identyfikatory: stabilne `elementId` (iid bundle). Nazwy tylko do resolution;
  kolizja = błąd AMBIGUOUS.
- Zapis = read-modify-write inkrementalny (`POST .../revisions/:rev`,
  serwer odrzuca niezgodną rewizję) + lock `plasmic-project:<id>` + re-read w `mutate`.
- `create_*` klonuje istniejący wpis (Plasmic nie ma atomowego create API);
  pusty projekt bez wzorca = błąd NEED_TEMPLATE (pierwszą stronę utwórz w Studio).
- `delete` odmawia przy wiszących referencjach bez `force:true`.
- `dryRun:true` dla destrukcyjnych; `idempotencyKey` dla create/insert.
- Audyt: JSONL `timestamp/agent/run/project/tool/target/before/after/ok`, bez sekretów.
- `plasmic_validate`: parsowanie, `__type`, skan podejrzanych referencji.
- Transport: stdio (OpenCode) + bezstanowy Streamable HTTP na 127.0.0.1
  (Bearer, rate-limit 120/min, limit 1 MB, timeout 60 s). TLS zapewnia reverse proxy.
- `/health` (proces) i `/ready` (WAB + sesja Plasmic + daemon OD).
