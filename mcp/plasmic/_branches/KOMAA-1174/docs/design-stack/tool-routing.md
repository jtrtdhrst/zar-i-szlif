# Routing narzędzi i zadań

- Typowe zadanie UI: uruchom `workflows/prepare_ui_task.ts` — zwraca tokeny,
  komponenty, strukturę Plasmic, pliki repo i `recommendation`.
- Reguły routingu: patrz skill `design-stack` (sekcja Routing zadań).
- Konflikt sync: `source != lastSync && target != lastSync` → `SYNC_CONFLICT` + diff,
  nigdy auto-nadpis.
- Uprawnienia (least privilege): OpenCode = OD r/w + Plasmic r/w + GitHub
  wg istniejącej polityki; zdalne klienci HTTP = OD read + Plasmic read/ograniczony write;
  OpenDesign nie dostaje GitHub write.
