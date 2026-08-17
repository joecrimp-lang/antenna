// Phase 3B.1 — "Add Market Signal layer" (brief §1).
//
// Explicitly NOT a new score: this derives a qualitative STATE from scores
// lib/intelligence.ts already computes and already persists (momentum_score,
// investment_evidence_pct, velocity_pct, signals_count) — no new number, no
// new stored field, no new methodology version, and lib/intelligence.ts
// itself is not touched by this file. It's a pure, deterministic mapping
// computed at render time, the same category of thing as the
// signal_type -> "Partnerships" display label already established in
// Chunk 3, just answering a bigger question: "what should I take away from
// this market area?" instead of "what kind of evidence is this?".
//
// It replaces the old opportunity_strength badge (strong/emerging/limited)
// in the UI, per the brief's explicit instruction not to use those labels
// "unless made more actionable." opportunity_strength itself is untouched
// in the database and in lib/intelligence.ts — it's just no longer what the
// front end renders as the primary label.
//
// Rules (documented so they're reviewable, not a black box):
//   - No qualifying signals this window -> Limited. Momentum below 35 ->
//     Limited (momentum_score is itself a weighted composite of intent
//     depth, breadth, diversity and velocity, so a low score already means
//     the theme is thin on more than one of those dimensions at once).
//   - Momentum 35-64 ("moderate activity exists") is split by Investment
//     Evidence: >=50% -> Established (a smaller but well-proven pocket),
//     25-49% -> Emerging (early signs, evidence still developing — matches
//     the brief's own wording), <25% -> Watch (activity exists, adoption
//     evidence remains limited — also matches the brief's own wording).
//   - Momentum >=65 ("high activity") is split by whether it's still
//     speeding up: high Investment Evidence (>=50%) AND NOT still
//     accelerating (velocity_pct known and below 15%) -> Established
//     (proven AND currently high, but stable rather than still climbing).
//     Everything else at high momentum -> Accelerating, including the
//     brief's own worked example (AI & Automation: momentum 87, investment
//     evidence 28% -> momentum far outrunning proven investment is exactly
//     "increasing rapidly", not yet "established").
import type { AntennaTheme } from "./antennaTaxonomy";

export const MARKET_SIGNAL_STATES = [
  "accelerating",
  "established",
  "emerging",
  "watch",
  "limited",
] as const;
export type MarketSignalState = (typeof MARKET_SIGNAL_STATES)[number];

// Phase 3B.2 — "make the Market Signal badge more prominent, add a relevant
// icon/visual indicator" (decision doc §1). Labels and meanings are
// unchanged word-for-word from Phase 3B.1 (the doc: "do not make them
// longer or more descriptive in the UI") — only `icon` is new. Chosen so
// the five read as one coherent set at a glance, not five unrelated emoji:
// a growth metaphor running seedling (Emerging) -> tree (Established), a
// rocket for the state that's outpacing even Established (Accelerating), an
// eye for "keep watching, not yet proven" (Watch), and a plain dash for
// "not enough happening to characterise yet" (Limited) rather than forcing
// a metaphor onto an absence of evidence.
export const MARKET_SIGNAL_COPY: Record<MarketSignalState, { label: string; icon: string; meaning: string }> = {
  accelerating: {
    label: "Accelerating",
    icon: "🚀",
    meaning:
      "Activity and evidence are increasing rapidly across media organisations and technology providers.",
  },
  established: {
    label: "Established",
    icon: "🌳",
    meaning: "Strong evidence of sustained market activity and investment.",
  },
  emerging: {
    label: "Emerging",
    icon: "🌱",
    meaning: "Early signs of adoption are appearing, but investment evidence is still developing.",
  },
  watch: {
    label: "Watch",
    icon: "👁",
    meaning: "Activity exists, but evidence of meaningful adoption remains limited.",
  },
  limited: {
    label: "Limited",
    icon: "○",
    meaning: "Insufficient evidence of meaningful market movement.",
  },
};

const MOMENTUM_HIGH = 65;
const MOMENTUM_LOW = 35;
const EVIDENCE_HIGH = 50;
const EVIDENCE_MED = 25;
const RAPID_VELOCITY_PCT = 15;

export type MarketSignalInput = {
  momentum_score: number | null;
  investment_evidence_pct: number | null;
  velocity_pct: number | null;
  signals_count: number;
};

export function computeMarketSignal(input: MarketSignalInput): MarketSignalState {
  const { momentum_score, investment_evidence_pct, velocity_pct, signals_count } = input;

  if (momentum_score === null || signals_count === 0) return "limited";
  if (momentum_score < MOMENTUM_LOW) return "limited";

  const evidence = investment_evidence_pct ?? 0;
  // velocity_pct is null both when there's no prior-period baseline to
  // compare against (genuine new/rapid activity — see
  // lib/intelligence.ts's calculateThemeScores) and, separately, treated as
  // "not clearly decelerating" here rather than penalised for missing data.
  const stillAccelerating = velocity_pct === null || velocity_pct >= RAPID_VELOCITY_PCT;

  if (momentum_score >= MOMENTUM_HIGH) {
    if (evidence >= EVIDENCE_HIGH && !stillAccelerating) return "established";
    return "accelerating";
  }

  // Moderate momentum.
  if (evidence >= EVIDENCE_HIGH) return "established";
  if (evidence >= EVIDENCE_MED) return "emerging";
  return "watch";
}

// Phase 3B.2 — "visually separate" each layer (decision doc §3/§5). Ties
// the interpretation layer's accent colour to the actual Market Signal
// state, using the same colour each state's badge already uses (see
// app/globals.css's badge--<state> rules) rather than introducing a
// second, unrelated colour mapping to keep in sync.
export const MARKET_SIGNAL_COLOR_VAR: Record<MarketSignalState, string> = {
  accelerating: "var(--color-teal)",
  established: "var(--color-strong)",
  emerging: "var(--color-emerging)",
  watch: "var(--color-watch)",
  limited: "var(--color-limited)",
};

// Convenience wrapper matching the shape theme_scores rows already have —
// callers pass the row straight through instead of picking fields out.
export function marketSignalForTheme(score: {
  theme?: AntennaTheme;
  momentum_score: number | null;
  investment_evidence_pct: number | null;
  velocity_pct: number | null;
  signals_count: number;
}): MarketSignalState {
  return computeMarketSignal(score);
}
