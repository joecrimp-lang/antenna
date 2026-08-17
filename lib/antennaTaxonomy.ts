// Canonical Antenna taxonomy — Antenna Intelligence Scoring Model v0.1.
// Single source of truth, shared by lib/research.ts (prompt + classification
// validation) and lib/supabase.ts (types), so the app can't drift internally.
//
// If this list ever changes, the CHECK constraints in
// supabase/002_antenna_intelligence_v0.1.sql must be updated to match, and
// the change documented in ANTENNA_SCORING_MODEL.md as a new scoring
// version. Do not add, remove, or rename themes/dimensions without separate
// product approval — see Build Chunk 1 instructions.

// The 10 canonical Antenna market themes. A signal's `theme` is exactly one
// of these.
export const ANTENNA_THEMES = [
  "AI & Automation",
  "Cloud & IP Transformation",
  "Streaming & Distribution",
  "Live & Sports Production",
  "Content Supply Chain & Workflow",
  "Trust, Security & Provenance",
  "Creator & Audience Technology",
  "Advertising & Monetisation",
  "Sustainability & Efficiency",
  "Connectivity & Infrastructure",
] as const;
export type AntennaTheme = (typeof ANTENNA_THEMES)[number];

// The 5 canonical Intent dimensions. A signal's `signal_type` is exactly
// one of these — the single dimension the strongest underlying evidence
// supports, not a set of all dimensions it might touch.
export const ANTENNA_SIGNAL_TYPES = [
  "expenditure",
  "procurement",
  "strategy",
  "projects_launches",
  "hiring",
] as const;
export type AntennaSignalType = (typeof ANTENNA_SIGNAL_TYPES)[number];

// Qualitative Market Opportunity strength. Schema/type only in v0.1 — no
// code currently populates this (no approved methodology yet).
export const ANTENNA_OPPORTUNITY_STRENGTHS = [
  "strong",
  "emerging",
  "limited",
] as const;
export type AntennaOpportunityStrength =
  (typeof ANTENNA_OPPORTUNITY_STRENGTHS)[number];

// Antenna Intelligence Scoring Model version currently applied to newly
// classified signals. Persisted on every scored signal so historical scores
// keep their original meaning even if the methodology changes later — bump
// this (as a new version) rather than silently redefining what an existing
// score means. See ANTENNA_SCORING_MODEL.md.
export const SCORING_VERSION = "v0.1";
