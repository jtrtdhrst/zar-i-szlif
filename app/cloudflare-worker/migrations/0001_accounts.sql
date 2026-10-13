-- 0001_accounts.sql — authoritative account store for first-registration proof (KOMAA-790).
--
-- CTO ACTION REQUIRED before production enablement:
--   1. `wrangler d1 create kompas-accounts` (or reuse the canonical app DB).
--   2. Add the binding to BOTH wrangler.jsonc and wrangler.panel.jsonc:
--        "d1_databases": [{ "binding": "DB", "database_id": "<id-from-step-1>" }]
--   3. `wrangler d1 migrations apply kompas-accounts`
--   4. Backfill pre-cutover accounts (sub + original created_at < cutover) so
--      old users logging in after cutover are correctly seen as existing.
-- Until then WELCOME_ENROLLMENT_ENABLED stays "false" and the worker enrolls zero users.

CREATE TABLE IF NOT EXISTS accounts (
  sub TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
