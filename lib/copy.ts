// Antenna Phase 3B — "Score terminology and explanation layer" (the brief's
// priority task). Centralises the exact front-end language for every scored
// concept so it's written once and can't drift between the homepage, theme
// pages, signal cards, and organisation pages.
//
// This file is copy only — it does not compute anything and must never be
// imported by lib/intelligence.ts or lib/research.ts. No score, formula,
// taxonomy value, or classification behaviour changes here; every number
// still comes from the same untouched methodology. This is strictly how
// that methodology is described to a reader.
//
// Every string below is reproduced verbatim from the Phase 3B brief
// ("Score terminology and explanation layer"). Do not paraphrase these in
// components — import and use them directly so the wording stays exact and
// consistent everywhere it appears.
//
// Shape, per concept:
//   - lead: the "what does this mean" sentence, minus the "<Label> — "
//     prefix (components render the label separately, e.g. as a heading).
//   - short: a compact one-line version, only given for Opportunity and
//     Momentum in the brief — used where space is tight (homepage legend,
//     theme cards).
//   - tooltip: the "how is this calculated" methodology text, meant to sit
//     behind an (i) affordance, not in the primary reading path.
// Where the brief gave only a "front-end copy" line and no separate
// tooltip (Investment Evidence, Adoption Shift), `tooltip` repeats `lead`
// rather than inventing new methodology language that wasn't specified.

export const SCORE_COPY = {
  opportunity: {
    label: "Opportunity",
    lead: "How attractive this technology area currently looks for media technology suppliers based on evidence of investment, adoption and market activity.",
    short: "How strong the current market opportunity appears.",
    tooltip:
      "Opportunity combines evidence of investment activity, adoption and market momentum. It is a relative indicator of where technology suppliers may find stronger commercial opportunity. It is not a prediction of future spend.",
  },
  momentum: {
    label: "Momentum",
    lead: "How quickly activity in this technology area is increasing across the media and entertainment market.",
    short: "The pace at which market activity is accelerating.",
    tooltip:
      "Momentum considers recent signal activity, diversity of activity and changes compared with previous periods.",
  },
  signalIntent: {
    label: "Signal Intent",
    lead: "How strongly an individual signal suggests meaningful technology investment, adoption or strategic activity.",
    short: null,
    tooltip:
      "Signal Intent considers factors including evidence quality, activity type, strategic importance and likelihood that the activity represents a genuine technology decision.",
  },
  signalsDetected: {
    label: "Signals detected",
    lead: "The number of relevant technology activity signals identified within the selected timeframe.",
    short: null,
    tooltip:
      "Signals include activity such as technology launches, hiring, partnerships, procurement, expenditure and strategic initiatives.",
  },
  investmentEvidence: {
    label: "Investment Evidence",
    lead: "The proportion of activity supported by direct evidence of technology investment or implementation.",
    short: null,
    tooltip:
      "The proportion of activity supported by direct evidence of technology investment or implementation.",
  },
  adoptionShift: {
    label: "Adoption Shift",
    lead: "Whether activity in this area is increasing or decreasing compared with the previous period.",
    short: null,
    tooltip:
      "Whether activity in this area is increasing or decreasing compared with the previous period.",
  },
} as const;
