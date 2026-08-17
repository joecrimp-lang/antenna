-- Antenna Intelligence v0.1 — Build Chunk 1 schema changes.
-- Run this once, after supabase/schema.sql, against your existing Supabase
-- project's SQL editor. Every statement here is additive and idempotent
-- (safe to re-run): new nullable columns, new tables, new indexes. Nothing
-- is dropped, renamed, or backfilled. Existing `companies`, `signals`, and
-- `runs` rows are completely unaffected — historical signal rows will simply
-- have NULL in every new column, which the application already treats as
-- "not yet classified."
--
-- See ANTENNA_SCORING_MODEL.md for what these fields mean and why.

-- =============================================================================
-- Part B — Signal classification storage
-- =============================================================================

alter table signals
  add column if not exists theme text,
  add column if not exists signal_type text,
  add column if not exists confidence_score int,
  add column if not exists intent_score int,
  add column if not exists scoring_version text,
  add column if not exists classification_reason text,
  add column if not exists confirmed_spend_amount numeric,
  add column if not exists confirmed_spend_currency text,
  add column if not exists estimated_opportunity_low numeric,
  add column if not exists estimated_opportunity_high numeric,
  add column if not exists estimated_opportunity_currency text,
  add column if not exists opportunity_strength text;

-- CHECK constraints enforce the canonical taxonomy so it can't casually
-- drift, while always allowing NULL (unscored/historical rows must keep
-- working). Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so each is
-- dropped-then-added for idempotency — safe to re-run this whole file.

alter table signals drop constraint if exists signals_theme_check;
alter table signals add constraint signals_theme_check check (
  theme is null or theme in (
    'AI & Automation',
    'Cloud & IP Transformation',
    'Streaming & Distribution',
    'Live & Sports Production',
    'Content Supply Chain & Workflow',
    'Trust, Security & Provenance',
    'Creator & Audience Technology',
    'Advertising & Monetisation',
    'Sustainability & Efficiency',
    'Connectivity & Infrastructure'
  )
);

alter table signals drop constraint if exists signals_signal_type_check;
alter table signals add constraint signals_signal_type_check check (
  signal_type is null or signal_type in (
    'expenditure', 'procurement', 'strategy', 'projects_launches', 'hiring'
  )
);

alter table signals drop constraint if exists signals_confidence_score_check;
alter table signals add constraint signals_confidence_score_check check (
  confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)
);

alter table signals drop constraint if exists signals_intent_score_check;
alter table signals add constraint signals_intent_score_check check (
  intent_score is null or (intent_score >= 0 and intent_score <= 100)
);

alter table signals drop constraint if exists signals_opportunity_strength_check;
alter table signals add constraint signals_opportunity_strength_check check (
  opportunity_strength is null or opportunity_strength in ('strong', 'emerging', 'limited')
);

create index if not exists signals_theme_idx on signals (theme);
create index if not exists signals_signal_type_idx on signals (signal_type);
create index if not exists signals_scoring_version_idx on signals (scoring_version);

-- =============================================================================
-- Part D — Subscriber foundations (future email-gated report). No capture
-- form, auth, or email sending against this table exists yet — schema only.
-- =============================================================================

create table if not exists subscribers (
  id bigint generated always as identity primary key,
  email text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  source text,
  referrer text,
  is_suppressed boolean not null default false,
  selected_themes text[],
  organisation text,
  job_title text,
  customer_status text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists subscribers_email_idx on subscribers (email);

-- =============================================================================
-- Part E — Daily report snapshot foundations. Schema only in this chunk: no
-- generation job writes to this table yet (company/theme roll-up
-- methodology needs product approval first — see ANTENNA_SCORING_MODEL.md,
-- "Methodology proposals requiring approval").
-- =============================================================================

create table if not exists daily_reports (
  id bigint generated always as identity primary key,
  report_date date not null unique,
  headline text,
  summary text,
  generated_at timestamptz not null default now(),
  scoring_version text,
  report_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
);

create index if not exists daily_reports_report_date_idx on daily_reports (report_date desc);
