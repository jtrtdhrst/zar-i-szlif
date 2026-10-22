# Supabase

This is the canonical location for Supabase migrations and seed data.
Migrations live in `migrations/` (Supabase CLI naming: `YYYYMMDDHHMMSS_name.sql`); each one
is idempotent and carries its own seed data, so `supabase db push` alone yields a ready table.
Do not commit credentials here.
