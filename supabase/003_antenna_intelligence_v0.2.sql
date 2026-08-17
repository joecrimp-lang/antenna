-- Antenna Intelligence v0.2 — the intelligence layer (Signal Intent Score,
-- Market Momentum Score, Opportunity Score). Run this once, after
-- 002_antenna_intelligence_v0.1.sql, against your existing Supabase
-- project's SQL editor. Every statement here is additive and idempotent
-- (safe to re-run): new nullable columns, two new tables, new indexes.
-- Nothing is dropped, renamed, or backfilled — existing `signals` rows are
-- completely unaffected and simply have NULL in the new columns until this
-- run's aggregation step (or, for signal_intent_score specifically, future
-- runs — see the "not backfilled" note below) populates them.
--
-- See ANTENNA_SCORING_MODEL.md §14 for what these fields mean, the exact
-- formulas, and the versioning approach.

-- =============================================================================
-- Signal Intent Score — per-signal, computed once at signal-creation time
-- (lib/intelligence.ts, called from lib/runResearch.ts). A deterministic
-- derivation of the existing v0.1 confidence_score/intent_score/
-- published_date/confirmed_spend_amount — no new OpenAI call, no change to
-- lib/research.ts. intelligence_scoring_version is intentionally a SEPARATE
-- column from the existing `scoring_version` (which remains the
-- classification methodology version, untouched) — these are two
-- independent methodologies that can evolve on their own timelines.
-- =============================================================================

alter table signals
  add column if not exists signal_intent_score int,
  add column if not exists scoring_reason text,
  add column if not exists intelligence_scoring_version text;

alter table signals drop constraint if exists signals_signal_intent_score_check;
alter table signals add constraint signals_signal_intent_score_check check (
  signal_intent_score is null or (signal_intent_score >= 0 and signal_intent_score <= 100)
);

-- Note: this migration does NOT backfill signal_intent_score for existing
-- (pre-v0.2) signal rows. Signal Intent Score is computed once, at
-- signal-creation time, from the pipeline — there is deliberately no bulk
-- recompute pass over historical rows (see ANTENNA_SCORING_MODEL.md §14 for
-- why: it keeps every stored score a reproducible, point-in-time judgment,
-- same as confidence_score/intent_score already are). Historical signals
-- will simply have NULL signal_intent_score until/unless a separate,
-- explicitly-approved backfill migration is written — the theme-level
-- aggregation step (below) treats NULL signal_intent_score the same way
-- NULL confidence_score/intent_score is already treated: excluded from
-- calculations, not coerced to 0.

create index if not exists signals_signal_intent_score_idx on signals (signal_intent_score);

-- =============================================================================
-- Market Momentum Score + Opportunity Score — theme-level, computed as a
-- scheduled aggregation step after each research run finishes (application
-- code in lib/intelligence.ts, called from lib/runResearch.ts — not a
-- database trigger). Two tables, written together by the same computation:
--   - theme_scores: latest value only, one row per theme (upserted).
--   - theme_score_snapshots: append-only history, one row per theme per
--     computation run, so trend over time is queryable.
-- Both share one scoring_version (momentum + opportunity are computed
-- together, in the same pass, with opportunity directly consuming
-- momentum_score — see ANTENNA_SCORING_MODEL.md §14), independent of the
-- per-signal scoring_version / intelligence_scoring_version above.
-- =============================================================================

create table if not exists theme_scores (
  id bigint generated always as identity primary key,
  theme text not null unique,
  window_days int not null default 90,
  signals_count int not null default 0,
  organisations_count int not null default 0,
  high_intent_signal_count int not null default 0,
  signal_diversity int not null default 0,
  velocity_pct numeric,
  momentum_score int,
  opportunity_score int,
  opportunity_strength text,
  scoring_reason text,
  scoring_version text not null default 'intel-theme-v1',
  computed_at timestamptz not null default now()
);

create table if not exists theme_score_snapshots (
  id bigint generated always as identity primary key,
  theme text not null,
  window_days int not null default 90,
  signals_count int not null default 0,
  organisations_count int not null default 0,
  high_intent_signal_count int not null default 0,
  signal_diversity int not null default 0,
  velocity_pct numeric,
  momentum_score int,
  opportunity_score int,
  opportunity_strength text,
  scoring_reason text,
  scoring_version text not null default 'intel-theme-v1',
  computed_at timestamptz not null default now()
);

alter table theme_scores drop constraint if exists theme_scores_theme_check;
alter table theme_scores add constraint theme_scores_theme_check check (
  theme in (
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

alter table theme_scores drop constraint if exists theme_scores_opportunity_strength_check;
alter table theme_scores add constraint theme_scores_opportunity_strength_check check (
  opportunity_strength is null or opportunity_strength in ('strong', 'emerging', 'limited')
);

alter table theme_scores drop constraint if exists theme_scores_momentum_score_check;
alter table theme_scores add constraint theme_scores_momentum_score_check check (
  momentum_score is null or (momentum_score >= 0 and momentum_score <= 100)
);

alter table theme_scores drop constraint if exists theme_scores_opportunity_score_check;
alter table theme_scores add constraint theme_scores_opportunity_score_check check (
  opportunity_score is null or (opportunity_score >= 0 and opportunity_score <= 100)
);

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_theme_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_theme_check check (
  theme in (
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

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_opportunity_strength_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_opportunity_strength_check check (
  opportunity_strength is null or opportunity_strength in ('strong', 'emerging', 'limited')
);

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_momentum_score_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_momentum_score_check check (
  momentum_score is null or (momentum_score >= 0 and momentum_score <= 100)
);

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_opportunity_score_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_opportunity_score_check check (
  opportunity_score is null or (opportunity_score >= 0 and opportunity_score <= 100)
);

create index if not exists theme_scores_theme_idx on theme_scores (theme);
create index if not exists theme_score_snapshots_theme_computed_at_idx
  on theme_score_snapshots (theme, computed_at desc);
