-- Baseline reconciliation migration.
-- The schema changes in 0001-0005 were already applied manually, but the
-- Drizzle snapshot chain only knew about 0000. This no-op lets the new
-- 0006 snapshot become the latest diff base without reapplying existing DDL.
SELECT 1;
