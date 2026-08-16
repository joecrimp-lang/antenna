-- Migration for an EXISTING Supabase project that already ran the original
-- schema.sql (which had no `cursor` column). Run this once in the Supabase
-- SQL editor. Safe to re-run — it's a no-op if the column already exists.
--
-- Needed for batched research runs: `cursor` tracks how far through the
-- watchlist the current run has processed, since a run now completes across
-- several short function invocations instead of one long one.

alter table runs add column if not exists cursor int not null default 0;
