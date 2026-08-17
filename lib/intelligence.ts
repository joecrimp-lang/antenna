// Antenna Intelligence Layer v0.2 — Signal Intent Score, Market Momentum
// Score, and a generic (non-personalised) Opportunity Score.
//
// This is a pure, deterministic derivation over data the v0.1 classification
// pass (lib/research.ts) already produces and stores — no new OpenAI call,
// no new data source, and lib/research.ts itself is not touched by this
// file. See ANTENNA_SCORING_MODEL.md §14 for the full methodology writeup,
// formulas, and worked examples this implements.
//
// Two independent computation points, both called from lib/runResearch.ts:
//   - computeSignalIntentScore: pure function, called once per signal at the
//     moment it's about to be stored.
//   - computeAndStoreThemeScores: reads the current `signals` table and
//     writes theme_scores (latest value, upserted) + theme_score_snapshots
//     (append-only history), called once per research run after all
//     companies are processed.
// Neither is a database trigger — both are plain application code, so the
// methodology stays versioned, testable TypeScript.

import {
  ANTENNA_THEMES,
  ANTENNA_SIGNAL_TYPES,
  type AntennaTheme,
  type AntennaSignalType,
  type AntennaOpportunityStrength,
} from "./antennaTaxonomy";
import type { getSupabase } from "./supabase";

// Matches the pattern already used in lib/runResearch.ts — derived from the
// factory function's return type rather than importing SupabaseClient
// directly from @supabase/supabase-js, so this always matches whatever
// client shape getSupabase() actually produces.
type SupabaseClient = ReturnType<typeof getSupabase>;

// Versions the Signal Intent Score formula only (§2 of the proposal) —
// deliberately separate from `signals.scoring_version` (the v0.1
// classification methodology, untouched by this file) so the two can
// change independently without either silently redefining the other.
export const INTELLIGENCE_SCORING_VERSION_SIGNAL = "intel-signal-v1";

// Versions the Market Momentum + Opportunity Score methodology together
// (§3/§4 of the proposal) — they're computed in one pass, over the same
// theme-level dataset, with opportunity directly consuming momentum_score,
// so one version string covers both.
export const INTELLIGENCE_SCORING_VERSION_THEME = "intel-theme-v1";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- Signal Intent Score --------------------------------------------------

// Recency multiplier: full weight for evidence ≤90 days old, decaying to a
// floor of 0.30 by 18 months. A floor rather than zero — old evidence isn't
// false, it's just less indicative of *current* momentum (same principle as
// the recency handling proposed, but not yet implemented, for company-level
// aggregation in ANTENNA_SCORING_MODEL.md §11).
function recencyMultiplier(daysOld: number): number {
  if (daysOld <= 90) return 1.0;
  if (daysOld <= 365) {
    return 1.0 - ((daysOld - 90) / (365 - 90)) * 0.4; // 1.00 -> 0.60
  }
  if (daysOld <= 545) {
    return 0.6 - ((daysOld - 365) / (545 - 365)) * 0.3; // 0.60 -> 0.30
  }
  return 0.3;
}

// Confidence dampens intent multiplicatively rather than sitting alongside
// it as an equal, additive factor — intent stage is "highest importance"
// per the spec, so this lets weak evidence meaningfully discount a score
// without ever letting it swamp a stronger, more-confident signal the way a
// simple average could.
function confidenceMultiplier(confidenceScore: number): number {
  return 0.7 + 0.3 * (confidenceScore / 100);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

export type SignalIntentScoreInput = {
  confidence_score: number | null;
  intent_score: number | null;
  published_date: string | null;
  created_at: string;
  confirmed_spend_amount: number | null;
};

export type SignalIntentScoreResult = {
  signal_intent_score: number | null;
  scoring_reason: string | null;
  intelligence_scoring_version: string | null;
};

// Computed once, at signal-creation time (called from runResearch.ts
// immediately before each signal is inserted). Not recomputed later — a
// stored score stays exactly what it was when the signal was created, the
// same way confidence_score/intent_score are already permanent, point-in-
// time judgments. Trend over time is captured at the theme-aggregation
// layer (theme_score_snapshots) instead, not by letting individual signal
// scores drift after the fact.
export function computeSignalIntentScore(
  input: SignalIntentScoreInput
): SignalIntentScoreResult {
  const { confidence_score, intent_score, published_date, created_at, confirmed_spend_amount } =
    input;

  // Can't derive a composite score without both raw inputs — consistent
  // with the rest of this project's "null, not a coerced 0" policy for
  // missing classification data (a signal with unparseable classification
  // is still stored; it just has no intelligence score either).
  if (confidence_score === null || intent_score === null) {
    return { signal_intent_score: null, scoring_reason: null, intelligence_scoring_version: null };
  }

  const evidenceDate = published_date ?? created_at;
  const daysOld = daysBetween(evidenceDate, created_at);

  const confMult = confidenceMultiplier(confidence_score);
  const recMult = recencyMultiplier(daysOld);
  const spendBonus = confirmed_spend_amount !== null ? 5 : 0;

  const raw = intent_score * confMult * recMult;
  const signal_intent_score = Math.max(0, Math.min(100, Math.round(raw) + spendBonus));

  const scoring_reason =
    `Base intent ${intent_score} (buying-stage score) at ${confidence_score}% confidence ` +
    `(×${confMult.toFixed(2)}), evidence ${daysOld}d old (×${recMult.toFixed(2)} recency weight)` +
    `${spendBonus ? ", +5 confirmed-spend bonus" : ""}. → ${signal_intent_score}.`;

  return {
    signal_intent_score,
    scoring_reason,
    intelligence_scoring_version: INTELLIGENCE_SCORING_VERSION_SIGNAL,
  };
}

// --- Market Momentum Score + Opportunity Score ----------------------------

const MOMENTUM_WINDOW_DAYS = 90;
// Signals older than this are excluded from theme aggregation entirely —
// matches the outer bound of the Signal Intent Score recency floor (§2).
const AGGREGATION_ACTIVE_WINDOW_DAYS = 545;
const HIGH_INTENT_THRESHOLD = 80;

const ADOPTION_LEANING_TYPES: readonly AntennaSignalType[] = [
  "expenditure",
  "procurement",
  "projects_launches",
];
const EXPERIMENTATION_LEANING_TYPES: readonly AntennaSignalType[] = ["strategy", "hiring"];

type AggregationSignal = {
  company_id: number;
  theme: AntennaTheme;
  signal_type: AntennaSignalType | null;
  confidence_score: number | null;
  intent_score: number | null;
  signal_intent_score: number | null;
  published_date: string | null;
  created_at: string;
};

function evidenceAgeDays(signal: AggregationSignal, nowIso: string): number {
  return daysBetween(signal.published_date ?? signal.created_at, nowIso);
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function adoptionRatio(signals: AggregationSignal[]): number | null {
  if (signals.length === 0) return null;
  const adoptionCount = signals.filter(
    (s) => s.signal_type !== null && (ADOPTION_LEANING_TYPES as string[]).includes(s.signal_type)
  ).length;
  return adoptionCount / signals.length;
}

export type ThemeScoreResult = {
  theme: AntennaTheme;
  window_days: number;
  signals_count: number;
  organisations_count: number;
  high_intent_signal_count: number;
  signal_diversity: number;
  velocity_pct: number | null;
  momentum_score: number | null;
  opportunity_score: number | null;
  opportunity_strength: AntennaOpportunityStrength | null;
  scoring_reason: string;
  scoring_version: string;
};

// Pure calculation, no I/O — takes every signal already fetched from the
// database (theme is not null, within the active window) and returns one
// result per canonical theme. Kept separate from the DB read/write below so
// the formula itself is easy to test in isolation.
export function calculateThemeScores(
  signals: AggregationSignal[],
  nowIso: string
): ThemeScoreResult[] {
  const results: ThemeScoreResult[] = [];

  for (const theme of ANTENNA_THEMES) {
    const themeSignals = signals.filter((s) => s.theme === theme);
    const current = themeSignals.filter((s) => evidenceAgeDays(s, nowIso) <= MOMENTUM_WINDOW_DAYS);
    const prior = themeSignals.filter((s) => {
      const age = evidenceAgeDays(s, nowIso);
      return age > MOMENTUM_WINDOW_DAYS && age <= MOMENTUM_WINDOW_DAYS * 2;
    });

    const signals_count = current.length;
    const organisations_count = new Set(current.map((s) => s.company_id)).size;
    const signalTypesPresent = new Set(
      current.map((s) => s.signal_type).filter((t): t is AntennaSignalType => t !== null)
    );
    const signal_diversity = signalTypesPresent.size;
    const high_intent_signal_count = current.filter(
      (s) => s.signal_intent_score !== null && s.signal_intent_score >= HIGH_INTENT_THRESHOLD
    ).length;

    if (signals_count === 0) {
      results.push({
        theme,
        window_days: MOMENTUM_WINDOW_DAYS,
        signals_count: 0,
        organisations_count: 0,
        high_intent_signal_count: 0,
        signal_diversity: 0,
        velocity_pct: null,
        momentum_score: null,
        opportunity_score: null,
        opportunity_strength: null,
        scoring_reason: `No qualifying signals in the last ${MOMENTUM_WINDOW_DAYS} days for this theme.`,
        scoring_version: INTELLIGENCE_SCORING_VERSION_THEME,
      });
      continue;
    }

    // Depth: average Signal Intent Score of this window's signals. Signals
    // with no signal_intent_score (e.g. unparseable classification, see
    // lib/research.ts) are excluded from the average rather than treated
    // as 0 — consistent with the rest of the project's null-not-zero rule.
    const scoredCurrent = current.filter(
      (s): s is AggregationSignal & { signal_intent_score: number } => s.signal_intent_score !== null
    );
    const depth = scoredCurrent.length > 0 ? average(scoredCurrent.map((s) => s.signal_intent_score)) : 0;

    const breadth = Math.min(100, Math.round((organisations_count / 10) * 100));
    const diversity = Math.round((signal_diversity / ANTENNA_SIGNAL_TYPES.length) * 100);

    const priorCount = prior.length;
    let velocity: number;
    let velocity_pct: number | null;
    if (priorCount === 0 && signals_count > 0) {
      velocity = 100;
      velocity_pct = null; // undefined/infinite % change — no finite prior baseline
    } else if (priorCount === 0) {
      velocity = 50;
      velocity_pct = 0;
    } else {
      const pct = ((signals_count - priorCount) / priorCount) * 100;
      velocity = clampScore(50 + Math.round(pct));
      velocity_pct = Math.round(pct * 10) / 10;
    }

    const momentum_score = clampScore(0.35 * depth + 0.25 * breadth + 0.2 * diversity + 0.2 * velocity);

    const investmentEvidenceCount = current.filter(
      (s) => s.confidence_score !== null && s.confidence_score >= 75 && s.intent_score !== null && s.intent_score >= 80
    ).length;
    const investmentEvidence = Math.round((investmentEvidenceCount / signals_count) * 100);

    const currentAdoptionRatio = adoptionRatio(current);
    const priorAdoptionRatio = adoptionRatio(prior);
    let adoptionShift: number;
    if (currentAdoptionRatio === null || priorAdoptionRatio === null) {
      adoptionShift = 50; // no baseline to compare against — neutral, not a penalty
    } else {
      adoptionShift = clampScore(50 + 100 * (currentAdoptionRatio - priorAdoptionRatio));
    }

    const opportunity_score = clampScore(
      0.5 * momentum_score + 0.3 * investmentEvidence + 0.2 * adoptionShift
    );
    const opportunity_strength: AntennaOpportunityStrength =
      opportunity_score >= 70 ? "strong" : opportunity_score >= 40 ? "emerging" : "limited";

    const velocityDescription =
      priorCount === 0
        ? "no signals in the prior period (new activity)"
        : `${signals_count - priorCount >= 0 ? "+" : ""}${signals_count - priorCount} vs. the prior ${MOMENTUM_WINDOW_DAYS} days`;

    const scoring_reason =
      `${signals_count} signal${signals_count === 1 ? "" : "s"} across ${organisations_count} ` +
      `compan${organisations_count === 1 ? "y" : "ies"} in the last ${MOMENTUM_WINDOW_DAYS} days, ` +
      `avg intent ${Math.round(depth)}, ${signal_diversity}/${ANTENNA_SIGNAL_TYPES.length} signal types represented, ` +
      `${velocityDescription}. Momentum ${momentum_score}. Investment evidence ${investmentEvidence}%, ` +
      `adoption shift ${adoptionShift >= 50 ? "+" : ""}${adoptionShift - 50}. ` +
      `Opportunity ${opportunity_score} (${opportunity_strength}).`;

    results.push({
      theme,
      window_days: MOMENTUM_WINDOW_DAYS,
      signals_count,
      organisations_count,
      high_intent_signal_count,
      signal_diversity,
      velocity_pct,
      momentum_score,
      opportunity_score,
      opportunity_strength,
      scoring_reason,
      scoring_version: INTELLIGENCE_SCORING_VERSION_THEME,
    });
  }

  return results;
}

// Reads the current signals table (theme not null, within the active
// window), computes all 10 theme scores, upserts theme_scores (current
// state) and inserts one new row per theme into theme_score_snapshots
// (append-only history). Called once per research run, after all companies
// are processed — not per-signal, not a database trigger.
export async function computeAndStoreThemeScores(
  supabase: SupabaseClient,
  errors: string[]
): Promise<ThemeScoreResult[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - AGGREGATION_ACTIVE_WINDOW_DAYS * MS_PER_DAY);

  const { data, error } = await supabase
    .from("signals")
    .select(
      "company_id, theme, signal_type, confidence_score, intent_score, signal_intent_score, published_date, created_at"
    )
    .not("theme", "is", null)
    .gte("created_at", cutoff.toISOString());

  if (error || !data) {
    errors.push(`Theme intelligence aggregation: could not load signals: ${error?.message}`);
    return [];
  }

  const results = calculateThemeScores(data as AggregationSignal[], now.toISOString());

  for (const result of results) {
    const { error: upsertError } = await supabase
      .from("theme_scores")
      .upsert({ ...result, computed_at: now.toISOString() }, { onConflict: "theme" });
    if (upsertError) {
      errors.push(`Theme intelligence (${result.theme}): upsert failed: ${upsertError.message}`);
    }

    const { error: snapshotError } = await supabase
      .from("theme_score_snapshots")
      .insert({ ...result, computed_at: now.toISOString() });
    if (snapshotError) {
      errors.push(`Theme intelligence (${result.theme}): snapshot insert failed: ${snapshotError.message}`);
    }
  }

  return results;
}
