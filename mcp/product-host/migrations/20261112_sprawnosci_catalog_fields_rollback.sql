-- Rollback for 20261112_sprawnosci_catalog_fields.sql.
--
-- Drops only what the forward migration created: the touch trigger, its
-- function, the two indexes and the three added columns. No pre-existing column
-- is modified or dropped.

drop trigger if exists sprawnosci_touch on public.sprawnosci;
drop function if exists public.touch_sprawnosci_zaktualizowano();
drop index if exists public.sprawnosci_zaktualizowano_idx;
drop index if exists public.sprawnosci_tagi_gin;

alter table public.sprawnosci
  drop column if exists zaktualizowano,
  drop column if exists tagi,
  drop column if exists opis;
