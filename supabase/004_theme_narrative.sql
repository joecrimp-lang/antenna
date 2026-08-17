-- Chunk 3 — Market Intelligence Experience MVP: editorial narrative storage
-- (Part 1) and score-transparency component columns (Part 2). Run this
-- once, after 003_antenna_intelligence_v0.2.sql, against your existing
-- Supabase project's SQL editor. Additive and idempotent, same pattern as
-- every prior migration in this project: new nullable columns only,
-- nothing dropped/renamed/backfilled. No existing table is redesigned and
-- no scoring FORMULA is touched (Part 2 stores two numbers
-- lib/intelligence.ts already computed and previously discarded — see that
-- file's comments — it does not change what's calculated).

-- =============================================================================
-- Part 1 — editorial narrative (theme_scores only, not theme_score_snapshots)
-- =============================================================================
--
-- Why theme_scores (not theme_score_snapshots, not a new table): the
-- editorial narrative is a "current state" artifact, regenerated in place
-- each time scripts/generateThemeNarratives.ts runs — the same latest-value-
-- only semantics theme_scores already has for momentum_score/opportunity_score.
-- theme_score_snapshots stays a pure historical record of computed scores;
-- adding narrative there would mean either leaving most snapshot rows with
-- a stale copy of old prose or writing to historical rows after the fact,
-- neither of which fits its append-only, point-in-time contract. See
-- ANTENNA_SCORING_MODEL.md §15 for the full writeup.

alter table theme_scores
  add column if not exists narrative_summary text,
  add column if not exists narrative text,
  add column if not exists narrative_generated_at timestamptz;

-- Two lengths, one generation event: narrative_summary is a single sentence
-- for Market Overview cards (the brief's "short explanation" requirement);
-- narrative is the fuller editorial paragraph for the theme detail page's
-- Layer 1. Both are written together by scripts/generateThemeNarratives.ts
-- from the same OpenAI call, sharing one narrative_generated_at timestamp —
-- they're the same analysis at two lengths, not two independent facts.
--
-- No CHECK constraint on either — free-form editorial prose, not a
-- validated enum/number like every other scored field. NULL means "not yet
-- generated for this theme" (or the theme has no qualifying signals at
-- all) — the UI must render a clear pending state, not assume every theme
-- has copy.

-- =============================================================================
-- Part 2 — score-transparency components (both theme_scores AND
-- theme_score_snapshots — these are genuinely part of the scoring
-- computation's audit trail, unlike Part 1's editorial prose, so they
-- belong in history too).
-- =============================================================================

alter table theme_scores
  add column if not exists investment_evidence_pct int,
  add column if not exists adoption_shift_delta int;

alter table theme_score_snapshots
  add column if not exists investment_evidence_pct int,
  add column if not exists adoption_shift_delta int;

alter table theme_scores drop constraint if exists theme_scores_investment_evidence_pct_check;
alter table theme_scores add constraint theme_scores_investment_evidence_pct_check check (
  investment_evidence_pct is null or (investment_evidence_pct >= 0 and investment_evidence_pct <= 100)
);

alter table theme_score_snapshots drop constraint if exists theme_score_snapshots_investment_evidence_pct_check;
alter table theme_score_snapshots add constraint theme_score_snapshots_investment_evidence_pct_check check (
  investment_evidence_pct is null or (investment_evidence_pct >= 0 and investment_evidence_pct <= 100)
);

-- adoption_shift_delta is intentionally unconstrained beyond being an
-- int — it's a signed value centered at 0 (-50..+50 by construction of the
-- current formula), but constraining it to that exact range here would
-- silently need updating if the formula's weighting ever changes; the
-- formula itself, not a DB constraint, is the source of truth for its
-- bounds.
