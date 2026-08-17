import OpenAI from "openai";
import type { Company } from "./supabase";
import {
  ANTENNA_THEMES,
  ANTENNA_SIGNAL_TYPES,
  type AntennaTheme,
  type AntennaSignalType,
} from "./antennaTaxonomy";

export type ResearchFinding = {
  summary: string;
  detail: string;
  source_url: string;
  source_title: string;
  published_date: string | null;
  // Antenna Intelligence v0.1 classification. All nullable: if the model's
  // output can't be parsed/validated against the canonical taxonomy, we
  // keep the underlying signal (summary/source are still real and useful)
  // rather than dropping it — see normalize* helpers below.
  theme: AntennaTheme | null;
  signal_type: AntennaSignalType | null;
  confidence_score: number | null;
  intent_score: number | null;
  classification_reason: string | null;
  confirmed_spend_amount: number | null;
  confirmed_spend_currency: string | null;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");
  return new OpenAI({ apiKey });
}

// Caps how long a single company's OpenAI call can run, so one slow request
// can't keep an entire concurrency group (and thus the whole run) alive
// indefinitely. maxRetries is set to 0 so the SDK doesn't silently retry
// past this budget on its own — a timeout here is just a per-company
// failure, caught and recorded by the caller like any other error.
const PER_COMPANY_TIMEOUT_MS = 25_000;

// Raised from 1200 to 2000 alongside the Antenna Intelligence classification
// fields added below (Build Chunk 1) — the per-finding JSON payload roughly
// doubled in size (theme, signal_type, two scores, a rationale string, two
// optional spend fields), and max_output_tokens caps the *entire* Responses
// API turn (search/tool-use plus the final JSON), not just the JSON text —
// see the "Recall tuning" note in README.md for why that matters. This is a
// mechanical adjustment to avoid re-introducing truncation, not a cost
// decision; flagged in the implementation report for visibility.
const MAX_OUTPUT_TOKENS = 2000;

const THEME_LIST = ANTENNA_THEMES.join("; ");
const SIGNAL_TYPE_LIST = ANTENNA_SIGNAL_TYPES.join(" | ");

const PROMPT_TEMPLATE = (company: Company) => `You are monitoring the media & entertainment company "${company.name}"${
  company.website ? ` (${company.website})` : ""
} for PUBLIC signals that suggest FUTURE TECHNOLOGY SPENDING. That means things like:
- capital expenditure or budget statements about cloud, streaming, or data infrastructure
- AI, machine learning, or automation initiatives
- earnings call remarks or executive interviews describing technology investment plans
- press releases about new technology vendor deals or partnerships (e.g. AWS, Azure, GCP, Nvidia, Adobe, Salesforce)
- major technology-related hiring pushes or job postings
- technology RFPs, procurement announcements, or tenders
- acquisitions of technology companies or startups
- new internal AI/technology teams, labs, studios, or platform launches — including associated specialist hiring (e.g. a new "AI Creative Lab," an AI-native production platform, a technology division consolidation)

Search the web for the most recent such signals, ideally from the last 90 days. Check company press releases/newsroom and investor relations pages as well as relevant trade press (e.g. Variety, Deadline, Broadcast, Digital TV Europe, The Hollywood Reporter). Only include genuine, specific, sourced findings with a real URL. Do not include generic company background, financial results with no technology angle, or speculation.

Return AT MOST the 2 strongest findings — the most specific, most recent, best-sourced ones. Do not pad the list; if there is only 1 (or 0), return only that many. Keep "detail" tight: 1-2 sentences, not 2-4.

Once you've identified each finding, classify it using the Antenna Intelligence Scoring Model v0.1 below. Consistency and explainability matter more than false precision — if you're between two values, prefer the lower/more conservative one and say why in classification_reason.

THEME — assign exactly one, verbatim, from this list:
${THEME_LIST}

SIGNAL_TYPE — assign exactly one primary dimension representing the STRONGEST underlying evidence for this finding (not several, even if more than one applies — you may mention a secondary dimension in classification_reason instead):
${SIGNAL_TYPE_LIST}

CONFIDENCE_SCORE (integer 0-100) — "How certain are we this evidence is genuine, specific, and correctly interpreted?" Do not raise this merely because a finding sounds commercially interesting.
- 90-100 (very high): primary company/IR/regulatory source, official procurement/tender, explicit programme or expenditure, signed contract, acquisition, named project, direct executive statement — little or no interpretation required.
- 75-89 (high): reputable trade/business press reporting specific activity, named technology initiative, named vendor, defined hiring programme, specific strategic investment — strong evidence but may not come directly from the company.
- 60-74 (moderate): credible evidence but some inference required — timing, scale, or technology scope partly unclear, or the buying implication isn't fully explicit.
- 40-59 (low): indirect or ambiguous evidence, weak sourcing, substantial interpretation required.
- Below 40: normally do not return this as a signal at all.

INTENT_SCORE (integer 0-100) — "How strongly does this evidence indicate current or forthcoming technology investment?" Driven by buying/investment STAGE, not by how exciting the story sounds.
- 95-100: money is demonstrably moving — confirmed material technology expenditure, signed vendor agreement, completed/announced technology acquisition, awarded procurement, explicit approved technology budget with delivery underway.
- 88-94: active buying/procurement — live RFP/tender, active vendor selection, formal procurement process, explicit budget allocated with suppliers being evaluated, late-stage evaluation with near-term implementation.
- 80-87: concrete programme with clear investment implication — named technology transformation programme, platform/product/technology launch requiring implementation, major new capability with a delivery timeline, explicit plan to build/deploy specific infrastructure or systems.
- 70-79: strong strategic investment signal — explicit executive commitment to invest materially in a defined technology area, creation of a dedicated AI/cloud/technology team or lab, substantial specialist hiring attached to a named initiative, clearly stated near-term implementation plans without procurement evidence yet.
- 60-69: credible emerging intent — technology identified as a strategic priority, repeated executive statements about future investment, meaningful specialist hiring without a clearly identified programme, exploratory pilots with credible potential to scale.
- 45-59: early directional signal — isolated specialist hiring, early experimentation, broad strategy statements, partnership exploration with unclear buying implications.
- Below 45: normally do not return this as a signal unless there is a compelling reason — if you do, state that reason explicitly in classification_reason.

Within the correct band, choose the exact number using these factors IN THIS ORDER: (1) buying stage — how close to actual expenditure; (2) specificity — is there a named project, vendor, budget, technology, or timeline; (3) evidence strength — how directly the evidence establishes the claimed intent; (4) recency — newer evidence beats otherwise-equivalent older evidence; (5) scale/materiality — only where genuinely evidenced, may justify the upper end of the band. Do not apply hidden bonuses, arbitrary points, or unstated weighting — every score must be defensible from classification_reason alone.

CLASSIFICATION_REASON — 1-3 concise sentences a reader could use to verify both scores without re-reading the source: name the evidence you weighted and which band/factor drove the number.

CONFIRMED_SPEND_AMOUNT / CONFIRMED_SPEND_CURRENCY — ONLY populate these if the source states an explicit monetary figure (e.g. "a $50 million cloud migration"). Leave both null if the figure is inferred, estimated by you, or simply absent from the source. Never estimate a number yourself.

Do not include an Opportunity score or Opportunity strength field — Antenna does not calculate those yet.

Respond with ONLY a JSON array (no markdown fences, no commentary before or after). Each item must have this shape:
{"summary": "one sentence", "detail": "1-2 sentences of supporting context", "source_url": "https://...", "source_title": "the article/press-release title", "published_date": "YYYY-MM-DD or null", "theme": "one of the themes above, verbatim", "signal_type": "one of: ${SIGNAL_TYPE_LIST}", "confidence_score": 0-100, "intent_score": 0-100, "classification_reason": "concise explanation grounding both scores", "confirmed_spend_amount": number or null, "confirmed_spend_currency": "ISO 4217 currency code or null"}

If you find nothing relevant, respond with exactly: []`;

function extractJsonArray(text: string): unknown {
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

function normalizeTheme(value: unknown): AntennaTheme | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return THEME_SET.has(trimmed) ? (trimmed as AntennaTheme) : null;
}

function normalizeSignalType(value: unknown): AntennaSignalType | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return SIGNAL_TYPE_SET.has(trimmed) ? (trimmed as AntennaSignalType) : null;
}

// Clamps to an integer 0-100. Returns null (not 0) for anything
// missing/invalid — a missing score is not the same as a score of 0.
function normalizeScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Only accepts a positive finite number — per the prompt, this must be an
// explicit figure stated by the source, never an estimate. We can't verify
// that server-side; this just guards against obviously malformed values.
function normalizeSpendAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

export async function researchCompany(company: Company): Promise<ResearchFinding[]> {
  const client = getOpenAI();
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

  const response = await client.responses.create(
    {
      model,
      tools: [{ type: "web_search_preview" }],
      input: PROMPT_TEMPLATE(company),
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    { timeout: PER_COMPANY_TIMEOUT_MS, maxRetries: 0 }
  );

  const text = (response as { output_text?: string }).output_text ?? "";
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      summary: String(item.summary ?? "").trim(),
      detail: String(item.detail ?? "").trim(),
      source_url: String(item.source_url ?? "").trim(),
      source_title: String(item.source_title ?? "").trim(),
      published_date: item.published_date ? String(item.published_date) : null,
      theme: normalizeTheme(item.theme),
      signal_type: normalizeSignalType(item.signal_type),
      confidence_score: normalizeScore(item.confidence_score),
      intent_score: normalizeScore(item.intent_score),
      classification_reason: normalizeReason(item.classification_reason),
      confirmed_spend_amount: normalizeSpendAmount(item.confirmed_spend_amount),
      confirmed_spend_currency: normalizeCurrency(item.confirmed_spend_currency),
    }))
    // Classification fields failing to parse never blocks storage of the
    // underlying signal — same bar as before (summary + source_url).
    .filter((f) => f.summary && f.source_url)
    .slice(0, 2);
}
