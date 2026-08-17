import { createClient } from "@supabase/supabase-js";
import type {
  AntennaOpportunityStrength,
  AntennaSignalType,
  AntennaTheme,
} from "./antennaTaxonomy";

// Server-only client using the service role key. This app has no user-facing
// auth, so every route that touches the database uses this single client.
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export type Company = {
  id: number;
  rank: number;
  name: string;
  website: string | null;
  country: string | null;
};

export type Signal = {
  id: number;
  company_id: number;
  summary: string;
  detail: string | null;
  source_url: string | null;
  source_title: string | null;
  published_date: string | null;
  created_at: string;
  emailed_at: string | null;
  // Antenna Intelligence v0.1 — additive, all nullable. Historical rows
  // predate classification and will have null here; the app must keep
  // rendering them correctly. See ANTENNA_SCORING_MODEL.md.
  theme: AntennaTheme | null;
  signal_type: AntennaSignalType | null;
  confidence_score: number | null;
  intent_score: number | null;
  scoring_version: string | null;
  classification_reason: string | null;
  confirmed_spend_amount: number | null;
  confirmed_spend_currency: string | null;
  // Opportunity fields exist for future use only — no code populates these
  // in v0.1 (no approved methodology yet — a per-signal dollar estimate, a
  // different concept from the theme-level Opportunity Score in v0.2, see
  // ThemeScore below). Always null for now.
  estimated_opportunity_low: number | null;
  estimated_opportunity_high: number | null;
  estimated_opportunity_currency: string | null;
  opportunity_strength: AntennaOpportunityStrength | null;
  // Antenna Intelligence v0.2 — Signal Intent Score (lib/intelligence.ts).
  // Computed once at signal-creation time from the fields above; null for
  // any signal with null confidence_score/intent_score, and null for every
  // historical (pre-v0.2) row, which is not backfilled. See
  // ANTENNA_SCORING_MODEL.md §14.
  signal_intent_score: number | null;
  scoring_reason: string | null;
  intelligence_scoring_version: string | null;
};

// Antenna Intelligence v0.2 — theme-level Market Momentum + Opportunity
// Score (lib/intelligence.ts). One row per canonical theme, upserted after
// each research run — always the LATEST computed value, not history (see
// ThemeScoreSnapshot below for that).
export type ThemeScore = {
  id: number;
  theme: AntennaTheme;
  window_days: number;
  signals_count: number;
  organisations_count: number;
  high_intent_signal_count: number;
  signal_diversity: number;
  velocity_pct: number | null;
  momentum_score: number | null;
  // Chunk 3 — component values behind opportunity_score, persisted so the
  // theme detail page's score-transparency section can show real numbers
  // (supabase/004_theme_narrative.sql Part 2). No formula change — see
  // lib/intelligence.ts's ThemeScoreResult comment.
  investment_evidence_pct: number | null;
  adoption_shift_delta: number | null;
  opportunity_score: number | null;
  opportunity_strength: AntennaOpportunityStrength | null;
  scoring_reason: string | null;
  scoring_version: string;
  computed_at: string;
  // Chunk 3 — editorial narrative (supabase/004_theme_narrative.sql Part 1).
  // Regenerated in place by scripts/generateThemeNarratives.ts, not by the
  // daily pipeline. NULL means "not yet generated" — the UI must handle
  // that as a normal, expected state, not an error. narrative_summary is a
  // single sentence (Market Overview cards); narrative is the fuller
  // editorial paragraph (theme detail page Layer 1) — same analysis, two
  // lengths, written together.
  narrative_summary: string | null;
  narrative: string | null;
  narrative_generated_at: string | null;
};

// Append-only history — one new row per theme every time the aggregation
// step runs, so momentum/opportunity trend over time is queryable. Same
// shape as ThemeScore MINUS narrative/narrative_generated_at — migration
// 004 deliberately added those columns only to theme_scores (see that
// file's header for why), so theme_score_snapshots never has them.
export type ThemeScoreSnapshot = Omit<
  ThemeScore,
  "id" | "narrative_summary" | "narrative" | "narrative_generated_at"
> & {
  id: number;
};

// Foundations for the future email-gated report experience (Build Chunk 1,
// Part D). No code writes to this table yet — capture form, auth, and
// suppression handling are all later work. Only `email` is required.
export type Subscriber = {
  id: number;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  source: string | null;
  referrer: string | null;
  is_suppressed: boolean;
  selected_themes: string[] | null;
  organisation: string | null;
  job_title: string | null;
  customer_status: string | null;
  metadata: Record<string, unknown>;
};

// Foundations for storing a generated daily intelligence report as an
// immutable snapshot (Build Chunk 1, Part E). No code generates or writes
// reports yet — company/theme roll-up methodology needs approval first
// (see ANTENNA_SCORING_MODEL.md, "Methodology proposals requiring
// approval"). Schema only.
export type DailyReport = {
  id: number;
  report_date: string;
  headline: string | null;
  summary: string | null;
  generated_at: string;
  scoring_version: string | null;
  report_data: Record<string, unknown>;
  status: string;
};
