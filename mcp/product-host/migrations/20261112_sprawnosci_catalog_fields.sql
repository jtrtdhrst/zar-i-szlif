-- Żar i Szlif — additive catalog fields for the hosted product MCP (ZARI-155).
--
-- Forward-only and additive: three new columns on public.sprawnosci, a
-- backfill for rows created before this migration, two supporting indexes and a
-- touch trigger that keeps zaktualizowano fresh on every update.
--
-- Application is controller/infrastructure work, not agent work: this file is
-- shipped in the repository and applied by the operator with psql against the
-- target Supabase database. Verify with the SELECT in the README before the MCP
-- service is switched on.

alter table public.sprawnosci
  add column if not exists opis text,
  add column if not exists tagi text[] not null default '{}'::text[],
  add column if not exists zaktualizowano timestamptz not null default now();

update public.sprawnosci
set opis = coalesce(opis, grupa_label || ' — ' || tytul),
    tagi = case when cardinality(tagi) = 0 then array[aspekt, grupa]::text[] else tagi end
where opis is null or cardinality(tagi) = 0;

create index if not exists sprawnosci_tagi_gin on public.sprawnosci using gin (tagi);
create index if not exists sprawnosci_zaktualizowano_idx on public.sprawnosci (zaktualizowano desc);

create or replace function public.touch_sprawnosci_zaktualizowano() returns trigger
language plpgsql as $$
begin
  new.zaktualizowano = now();
  return new;
end $$;

drop trigger if exists sprawnosci_touch on public.sprawnosci;
create trigger sprawnosci_touch before update on public.sprawnosci
for each row execute function public.touch_sprawnosci_zaktualizowano();
