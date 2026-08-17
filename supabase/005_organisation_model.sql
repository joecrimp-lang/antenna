-- Antenna Phase 2A — organisation model (Phase 2 of the brief).
-- Additive only: four new columns on `companies`, two check constraints.
-- No drops, no renames, nothing existing is touched. Run this once, after
-- 004_theme_narrative.sql, in the Supabase SQL editor.
--
-- The model, four orthogonal fields, each answering one question:
--   organisation_type    — what the organisation is
--   priority              — how important it is to Antenna
--   research_enabled      — whether it's currently included in live research
--   research_scope_note   — why that research_enabled decision was made
--
-- research_enabled and priority are deliberately kept separate rather than
-- one being derived from the other: a company can be high-priority and
-- still be temporarily out of the active research universe for scope/
-- capacity reasons unrelated to its importance (see research_scope_note),
-- and collapsing the two would make that undiscoverable later.
--
-- research_scope_note is documentation only — free text, no constraint, not
-- read by any query or filter anywhere in the pipeline. It exists purely so
-- a `research_enabled=false` row is still explainable months from now,
-- without needing a full cohort/history table for that alone.
--
-- research_enabled defaults TRUE so nothing currently running is silently
-- paused by this migration alone — scripts/importOrganisationUniverse.ts
-- (Phase 3) is what actually sets it false on the companies being moved out
-- of the active research universe, as a separate, reviewable step.

alter table companies
  add column if not exists organisation_type text,
  add column if not exists priority text,
  add column if not exists research_enabled boolean not null default true,
  add column if not exists research_scope_note text;

alter table companies drop constraint if exists companies_organisation_type_check;
alter table companies add constraint companies_organisation_type_check check (
  organisation_type is null or organisation_type in ('buyer', 'vendor', 'platform', 'technology_provider')
);

alter table companies drop constraint if exists companies_priority_check;
alter table companies add constraint companies_priority_check check (
  priority is null or priority in ('high', 'medium', 'low')
);

create index if not exists companies_research_enabled_idx on companies (research_enabled);
create index if not exists companies_organisation_type_idx on companies (organisation_type);
