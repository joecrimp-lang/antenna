-- Antenna Phase 3B.1 — Interpretation & Intelligence Refinement.
-- Run once, after 007_research_run_stabilisation.sql, against your existing
-- Supabase project's SQL editor. Additive and idempotent, same pattern as
-- every prior migration in this project: new nullable columns only,
-- nothing dropped/renamed/backfilled. No scoring formula, taxonomy, or
-- research/classification behaviour is touched by this migration.
--
-- Organisation-level "Antenna View" — a short editorial interpretation of
-- an organisation's current activity (brief §6: "not 'what signals exist?'
-- but 'what does this activity mean?'"). No equivalent field existed at the
-- company level before this phase — theme_scores already has this exact
-- shape for themes (narrative / narrative_generated_at,
-- supabase/004_theme_narrative.sql), and this mirrors it one level down.
-- Regenerated in place by scripts/generateOrganisationNarratives.ts, not by
-- the live research pipeline — same "current state, not history" semantics
-- as theme_scores.narrative, so this lives on `companies` directly rather
-- than a new table.
--
-- No CHECK constraint — free-form editorial prose, not a validated
-- enum/number like every other scored field. NULL means "not yet
-- generated" (or the organisation has no signals yet to interpret) — the
-- organisation page must render a clear pending state, not assume every
-- company has one.

alter table companies
  add column if not exists antenna_view text,
  add column if not exists antenna_view_generated_at timestamptz;
