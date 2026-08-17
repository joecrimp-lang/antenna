import OpenAI from "openai";
import type { Company } from "./supabase";
import {
  ANTENNA_THEMES,
  ANTENNA_SIGNAL_TYPES,
  type AntennaTheme,
  type AntennaSignalType,
} from "./antennaTaxonomy";
// Validation/normalization helpers extracted to their own module so
// scripts/backfillIntelligence.ts can reuse the exact same logic instead of
// duplicating it — a pure, output-preserving move (same function bodies,
// just relocated). Does not touch anything below this point: the prompt,
// the OpenAI call, timeouts, and token caps are all unchanged. See
// lib/classificationValidation.ts.
import { extractJsonArray, normalizeClassificationFields } from "./classificationValidation";

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

Then classify each finding (Antenna Intelligence v0.1). Prioritize consistency and explainability over false precision — if torn between two values, pick the lower/more conservative one and say why in classification_reason.

theme: exactly one, verbatim, from: ${THEME_LIST}
signal_type: exactly one — whichever dimension has the STRONGEST evidence, never several: ${SIGNAL_TYPE_LIST}

confidence_score (0-100) — how certain this evidence is genuine, specific, and correctly interpreted. Never raised just because a finding sounds interesting.
- 90-100: primary/company/IR/regulatory source, or an explicit deal/programme/expenditure — little interpretation needed.
- 75-89: reputable trade press on specific activity — strong, but not directly from the company.
- 60-74: credible but some inference needed (timing, scale, or scope partly unclear).
- 40-59: indirect, ambiguous, or weakly sourced.
- Below 40: don't return this as a signal.

intent_score (0-100) — how strongly this indicates current/forthcoming tech investment, driven by buying STAGE, not how exciting it sounds.
- 95-100: money demonstrably moving (confirmed spend, signed vendor deal, completed acquisition, awarded procurement).
- 88-94: active procurement (live RFP/tender, budget allocated, suppliers being evaluated).
- 80-87: concrete programme with a delivery timeline (named transformation programme, platform/product launch requiring implementation).
- 70-79: strong strategic signal (explicit exec commitment, a dedicated AI/tech team or lab created, hiring tied to a named initiative).
- 60-69: credible emerging intent (named strategic priority, repeated exec statements, hiring without a named programme).
- 45-59: early directional only (isolated hiring, early experimentation, broad strategy statements).
- Below 45: don't return unless there's a compelling reason — state it in classification_reason.

Within a band, rank the exact number by, in order: buying stage, specificity (named project/vendor/budget/timeline), evidence strength, recency, then scale/materiality. No hidden weighting — the number must be defensible from classification_reason alone.

classification_reason: 1-2 sentences naming the evidence and which factor drove the score, so it's checkable without the source.

confirmed_spend_amount / confirmed_spend_currency: only if the source states an explicit figure — never estimate one yourself; otherwise null.

Do not add an Opportunity score/field — not calculated yet.

Respond with ONLY a JSON array (no markdown fences, no commentary before or after). Each item must have this shape:
{"summary": "one sentence", "detail": "1-2 sentences of supporting context", "source_url": "https://...", "source_title": "the article/press-release title", "published_date": "YYYY-MM-DD or null", "theme": "one of the themes above, verbatim", "signal_type": "one of: ${SIGNAL_TYPE_LIST}", "confidence_score": 0-100, "intent_score": 0-100, "classification_reason": "concise explanation grounding both scores", "confirmed_spend_amount": number or null, "confirmed_spend_currency": "ISO 4217 currency code or null"}

If you find nothing relevant, respond with exactly: []`;

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
      ...normalizeClassificationFields(item),
    }))
    // Classification fields failing to parse never blocks storage of the
    // underlying signal — same bar as before (summary + source_url).
    .filter((f) => f.summary && f.source_url)
    .slice(0, 2);
}
