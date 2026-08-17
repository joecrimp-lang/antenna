// Shared Antenna Intelligence v0.1 classification validation — extracted
// from lib/research.ts so it can be reused by scripts/backfillIntelligence.ts
// without duplicating logic. This is a pure, mechanical extraction: every
// function here is byte-for-byte the same implementation that used to live
// privately in lib/research.ts, just moved and exported. It does not touch
// PROMPT_TEMPLATE, the OpenAI call, the model, timeouts, or token caps —
// nothing about the live research/classification *prompt* or *behaviour*
// changes. See ANTENNA_SCORING_MODEL.md / the backfill report for why this
// extraction was judged low-risk enough to do (pure functions, no prompt
// text involved) versus the classification prompt wording itself, which the
// backfill script duplicates rather than shares — see that file's comments.

import {
  ANTENNA_THEMES,
  ANTENNA_SIGNAL_TYPES,
  type AntennaTheme,
  type AntennaSignalType,
} from "./antennaTaxonomy";

export function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
}

const THEME_SET = new Set<string>(ANTENNA_THEMES);
const SIGNAL_TYPE_SET = new Set<string>(ANTENNA_SIGNAL_TYPES);

export function normalizeTheme(value: unknown): AntennaTheme | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return THEME_SET.has(trimmed) ? (trimmed as AntennaTheme) : null;
}

export function normalizeSignalType(value: unknown): AntennaSignalType | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return SIGNAL_TYPE_SET.has(trimmed) ? (trimmed as AntennaSignalType) : null;
}

// Clamps to an integer 0-100. Returns null (not 0) for anything
// missing/invalid — a missing score is not the same as a score of 0.
export function normalizeScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Only accepts a positive finite number — per the prompt, this must be an
// explicit figure stated by the source, never an estimate. We can't verify
// that server-side; this just guards against obviously malformed values.
export function normalizeSpendAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

export type NormalizedClassification = {
  theme: AntennaTheme | null;
  signal_type: AntennaSignalType | null;
  confidence_score: number | null;
  intent_score: number | null;
  classification_reason: string | null;
  confirmed_spend_amount: number | null;
  confirmed_spend_currency: string | null;
};

// Composite mapper — the exact same field-by-field validation
// lib/research.ts applies to every raw JSON item the model returns, exposed
// as one function so both the live pipeline and the backfill script apply
// literally the same validation, not two copies that could drift apart.
export function normalizeClassificationFields(
  item: Record<string, unknown>
): NormalizedClassification {
  return {
    theme: normalizeTheme(item.theme),
    signal_type: normalizeSignalType(item.signal_type),
    confidence_score: normalizeScore(item.confidence_score),
    intent_score: normalizeScore(item.intent_score),
    classification_reason: normalizeReason(item.classification_reason),
    confirmed_spend_amount: normalizeSpendAmount(item.confirmed_spend_amount),
    confirmed_spend_currency: normalizeCurrency(item.confirmed_spend_currency),
  };
}
