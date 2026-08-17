-- Antenna Phase 2A — research run observability (Phase 5 of the brief).
-- Additive only: one new append-only table, plus summary columns on the
-- existing `runs` table. Run once, after 005_organisation_model.sql.
--
-- Purpose: answer "what happened during the last research run?" without
-- parsing a free-text error blob — per-organisation attempt records
-- (status, timing, token usage, duplicate count, failure reason), queryable
-- directly in the Supabase table editor or via SQL. Internal tooling only,
-- per the brief — no public-facing surface is added by this migration.

create table if not exists research_run_attempts (
  id bigint generated always as identity primary key,
  run_id bigint not null references runs (id) on delete cascade,
  company_id bigint not null references companies (id) on delete cascade,
  company_name text not null,           -- denormalised: still readable even if the company is later renamed
  status text not null,                 -- 'success' | 'no_new_signals' | 'failed'
  signals_created int not null default 0,
  duplicates_prevented int not null default 0,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms int not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

alter table research_run_attempts drop constraint if exists research_run_attempts_status_check;
alter table research_run_attempts add constraint research_run_attempts_status_check check (
  status in ('success', 'no_new_signals', 'failed')
);

create index if not exists research_run_attempts_run_id_idx on research_run_attempts (run_id);
create index if not exists research_run_attempts_company_id_idx on research_run_attempts (company_id);
create index if not exists research_run_attempts_status_idx on research_run_attempts (status);

-- Run-level summary columns — the aggregate view; research_run_attempts
-- above is the detail view underneath it. organisations_processed already
-- exists (companies that didn't throw); organisations_attempted is new and
-- distinct — every company the run's query selected, whether it succeeded
-- or not, so "attempted vs. processed vs. failed" is always reconstructable
-- without recomputing it from the attempts table.
alter table runs
  add column if not exists organisations_attempted int,
  add column if not exists duplicates_prevented int,
  add column if not exists total_input_tokens int,
  add column if not exists total_output_tokens int,
  add column if not exists avg_duration_ms int;
