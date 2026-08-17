// One-off historical backfill: populates Antenna Intelligence classification
// and/or Signal Intent Score onto signals that predate the chunk that added
// them, then recomputes theme-level Market Momentum / Opportunity Score
// from the enlarged corpus.
//
// NOT part of the deployed app, the daily cron, or any Vercel route — run
// once, locally, by a human:
//
//   set -a; source .env.local; set +a     # load env vars into the shell
//   npx tsx scripts/backfillIntelligence.ts --dry-run
//   npx tsx scripts/backfillIntelligence.ts
//
// Flags:
//   --dry-run        Report counts and an estimated cost/time, write nothing,
//                     make no OpenAI calls.
//   --limit=N        Process at most N rows per group (Group A and Group B
//                     each get their own N — see "Two groups" below).
//   --offset=N       Skip the first N rows per group before applying --limit.
//     (--limit/--offset are for testing on a small slice first, e.g.
//     --limit=5, before running the full backfill.)
//
// Safe to re-run: every query below filters on the current null-state of
// the row, so anything already backfilled simply no longer matches and is
// skipped. If interrupted partway (Ctrl-C, network blip), just run it
// again — no dedupe/checkpoint bookkeeping needed.
//
// Two groups, two different costs (see ANTENNA_BACKFILL_PROPOSAL.md §1):
//   Group A — `theme is null`: never classified at all (predates Build
//     Chunk 1). Needs an OpenAI classification-only call (no web search —
//     the finding is already recorded, it just needs classifying), then
//     Signal Intent Score computed from the result. This is the only part
//     of this script that costs money or calls OpenAI.
//   Group B — `theme is not null and signal_intent_score is null`: already
//     classified (Build Chunk 1), predates the v0.2 intelligence layer.
//     Signal Intent Score only — pure arithmetic over already-stored
//     fields, via the exact same computeSignalIntentScore() the live
//     pipeline uses. No OpenAI call, no cost.
//
// Does NOT modify lib/research.ts's behaviour, the daily pipeline, or any
// route. Reuses (imports, does not duplicate) computeSignalIntentScore and
// computeAndStoreThemeScores from lib/intelligence.ts, and the validation
// helpers from lib/classificationValidation.ts (extracted from
// lib/research.ts as a pure, output-preserving refactor — see that file's
// header comment). The ONE thing duplicated rather than shared is the
// classification instruction wording itself (BACKFILL_CLASSIFICATION_PROMPT
// below) — see the comment above that constant for why.

import OpenAI from "openai";
import { getSupabase } from "../lib/supabase";
import { ANTENNA_THEMES, ANTENNA_SIGNAL_TYPES, SCORING_VERSION } from "../lib/antennaTaxonomy";
import { extractJsonArray, normalizeClassificationFields } from "../lib/classificationValidation";
import { computeSignalIntentScore, computeAndStoreThemeScores } from "../lib/intelligence";

// --- CLI args ---------------------------------------------------------

type Args = { dryRun: boolean; limit: number | null; offset: number | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null, offset: null };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--limit=")) {
      const n = parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (raw.startsWith("--offset=")) {
      const n = parseInt(raw.slice("--offset=".length), 10);
      if (Number.isFinite(n) && n >= 0) args.offset = n;
    }
  }
  return args;
}

// --- OpenAI (classification-only, no web search) -----------------------

const BACKFILL_TIMEOUT_MS = 20_000; // no search step, so a much smaller budget than the live 25s per-company call suffices
const BACKFILL_MAX_OUTPUT_TOKENS = 600; // one classification object, generous margin vs. the live 2-finding cap of 2000
const BACKFILL_CONCURRENCY = 3;

const THEME_LIST = ANTENNA_THEMES.join("; ");
const SIGNAL_TYPE_LIST = ANTENNA_SIGNAL_TYPES.join(" | ");

// Rough $/1M-token pricing as documented in README.md "Cost" — used only to
// print an estimate, not for anything functional. Update here if pricing
// changes; this script has no other dependency on it.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  luna: { input: 1, output: 6 },
  terra: { input: 2.5, output: 15 },
  sol: { input: 5, output: 30 },
};

function pricingFor(model: string) {
  const key = Object.keys(MODEL_PRICING).find((k) => model.toLowerCase().includes(k));
  return key ? MODEL_PRICING[key] : null;
}

// ⚠️ DUPLICATED, not shared, from lib/research.ts's PROMPT_TEMPLATE
// classification block — deliberately, per the decision in
// ANTENNA_BACKFILL_PROPOSAL.md §3: extracting this into a shared constant
// would mean restructuring PROMPT_TEMPLATE's template-literal construction
// in research.ts, which carries a real risk of subtly altering the exact,
// carefully-tuned live prompt (this exact file has already been through one
// timeout-driven word-count audit — see README.md "Timeout regression").
// The validation/normalization LOGIC below (extractJsonArray,
// normalizeClassificationFields) is genuinely shared — only this prose is
// duplicated. If lib/research.ts's classification wording changes again,
// this block should be updated to match by hand.
const BACKFILL_CLASSIFICATION_PROMPT = (params: {
  companyName: string;
  companyWebsite: string | null;
  summary: string;
  detail: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  publishedDate: string | null;
}) => `You are backfilling Antenna Intelligence classification onto an ALREADY-FOUND, already-recorded signal about the media & entertainment company "${params.companyName}"${
  params.companyWebsite ? ` (${params.companyWebsite})` : ""
}. Do not search the web — classify only using the finding already recorded below.

FINDING:
summary: ${params.summary}
detail: ${params.detail ?? "(none recorded)"}
source_url: ${params.sourceUrl}
source_title: ${params.sourceTitle ?? "(none recorded)"}
published_date: ${params.publishedDate ?? "(unknown)"}

Classify this finding (Antenna Intelligence v0.1). Prioritize consistency and explainability over false precision — if torn between two values, pick the lower/more conservative one and say why in classification_reason.

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

Respond with ONLY a JSON array containing exactly one object (no markdown fences, no commentary before or after), with this shape:
{"theme": "one of the themes above, verbatim", "signal_type": "one of: ${SIGNAL_TYPE_LIST}", "confidence_score": 0-100, "intent_score": 0-100, "classification_reason": "concise explanation grounding both scores", "confirmed_spend_amount": number or null, "confirmed_spend_currency": "ISO 4217 currency code or null"}

If this finding genuinely cannot be classified (too vague, no real technology-spending signal), respond with exactly: []`;

function getOpenAIClient() {
  // Constructed lazily (only when a Group A row is actually being
  // classified), same pattern as lib/research.ts's getOpenAI() — a
  // Group-B-only run never needs OPENAI_API_KEY at all.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Export your .env.local before running: `set -a; source .env.local; set +a`"
    );
  }
  return new OpenAI({ apiKey });
}

// --- Types ---------------------------------------------------------------

type SignalRow = {
  id: number;
  company_id: number;
  summary: string;
  detail: string | null;
  source_url: string | null;
  source_title: string | null;
  published_date: string | null;
  created_at: string;
  theme: string | null;
  signal_type: string | null;
  confidence_score: number | null;
  intent_score: number | null;
  classification_reason: string | null;
  confirmed_spend_amount: number | null;
  confirmed_spend_currency: string | null;
  signal_intent_score: number | null;
  company: { name: string; website: string | null } | null;
};

type SupabaseClient = ReturnType<typeof getSupabase>;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// --- Group A: classify + score ------------------------------------------

async function classifyAndScoreOne(
  supabase: SupabaseClient,
  row: SignalRow,
  usage: { inputTokens: number; outputTokens: number },
  errors: string[]
): Promise<"classified" | "unclassifiable" | "error"> {
  try {
    const client = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

    const response = await client.responses.create(
      {
        model,
        input: BACKFILL_CLASSIFICATION_PROMPT({
          companyName: row.company?.name ?? "Unknown company",
          companyWebsite: row.company?.website ?? null,
          summary: row.summary,
          detail: row.detail,
          sourceUrl: row.source_url ?? "",
          sourceTitle: row.source_title,
          publishedDate: row.published_date,
        }),
        max_output_tokens: BACKFILL_MAX_OUTPUT_TOKENS,
      },
      { timeout: BACKFILL_TIMEOUT_MS, maxRetries: 0 }
    );

    const responseUsage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (responseUsage) {
      usage.inputTokens += responseUsage.input_tokens ?? 0;
      usage.outputTokens += responseUsage.output_tokens ?? 0;
    }

    const text = (response as { output_text?: string }).output_text ?? "";
    const parsed = extractJsonArray(text);
    const item =
      Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null
        ? (parsed[0] as Record<string, unknown>)
        : null;

    if (!item) {
      // Model judged this unclassifiable, or returned something unparseable.
      // Row stays exactly as it was (theme null) — will be retried on the
      // next run, same as any other still-null row (cheap enough not to
      // need a retry cap — see ANTENNA_BACKFILL_PROPOSAL.md §5).
      return "unclassifiable";
    }

    const classification = normalizeClassificationFields(item);

    const intelligence = computeSignalIntentScore({
      confidence_score: classification.confidence_score,
      intent_score: classification.intent_score,
      published_date: row.published_date,
      // Original created_at, not "now" — see ANTENNA_BACKFILL_PROPOSAL.md
      // §3: recency is a permanent, point-in-time judgment, scored the same
      // way regardless of when the backfill happens to run.
      created_at: row.created_at,
      confirmed_spend_amount: classification.confirmed_spend_amount,
    });

    const { error: updateError } = await supabase
      .from("signals")
      .update({
        theme: classification.theme,
        signal_type: classification.signal_type,
        confidence_score: classification.confidence_score,
        intent_score: classification.intent_score,
        scoring_version: SCORING_VERSION,
        classification_reason: classification.classification_reason,
        confirmed_spend_amount: classification.confirmed_spend_amount,
        confirmed_spend_currency: classification.confirmed_spend_currency,
        signal_intent_score: intelligence.signal_intent_score,
        scoring_reason: intelligence.scoring_reason,
        intelligence_scoring_version: intelligence.intelligence_scoring_version,
      })
      .eq("id", row.id);

    if (updateError) {
      errors.push(`Signal ${row.id} (Group A): update failed: ${updateError.message}`);
      return "error";
    }

    return classification.theme ? "classified" : "unclassifiable";
  } catch (err) {
    errors.push(`Signal ${row.id} (Group A): ${(err as Error).message}`);
    return "error";
  }
}

// --- Group B: score only ---------------------------------------------

async function scoreOnlyOne(supabase: SupabaseClient, row: SignalRow, errors: string[]): Promise<"scored" | "skipped" | "error"> {
  try {
    const intelligence = computeSignalIntentScore({
      confidence_score: row.confidence_score,
      intent_score: row.intent_score,
      published_date: row.published_date,
      created_at: row.created_at,
      confirmed_spend_amount: row.confirmed_spend_amount,
    });

    if (intelligence.signal_intent_score === null) {
      // confidence_score/intent_score were themselves null despite theme
      // being set (an already-tolerated v0.1 outcome) — nothing to score.
      return "skipped";
    }

    const { error: updateError } = await supabase
      .from("signals")
      .update({
        signal_intent_score: intelligence.signal_intent_score,
        scoring_reason: intelligence.scoring_reason,
        intelligence_scoring_version: intelligence.intelligence_scoring_version,
      })
      .eq("id", row.id);

    if (updateError) {
      errors.push(`Signal ${row.id} (Group B): update failed: ${updateError.message}`);
      return "error";
    }
    return "scored";
  } catch (err) {
    errors.push(`Signal ${row.id} (Group B): ${(err as Error).message}`);
    return "error";
  }
}

// --- Main ------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = getSupabase();
  const errors: string[] = [];

  console.log("Antenna — historical intelligence backfill");
  console.log(args.dryRun ? "(dry run — no writes, no OpenAI calls)" : "(live run)");
  if (args.limit !== null || args.offset !== null) {
    console.log(`  limit=${args.limit ?? "none"} offset=${args.offset ?? "none"} (applied per group)`);
  }
  console.log("");

  // --- Group A: never classified ---
  let groupAQuery = supabase
    .from("signals")
    .select(
      "id, company_id, summary, detail, source_url, source_title, published_date, created_at, theme, signal_type, confidence_score, intent_score, classification_reason, confirmed_spend_amount, confirmed_spend_currency, signal_intent_score, company:companies(name, website)"
    )
    .is("theme", null)
    .order("id", { ascending: true });
  // Same offset/limit convention as RESEARCH_COMPANY_LIMIT/OFFSET in
  // lib/runResearch.ts — .range() covers both in one call when offset is
  // given, otherwise .limit() alone.
  if (args.offset !== null) {
    const to = args.offset + (args.limit ?? 10_000) - 1;
    groupAQuery = groupAQuery.range(args.offset, to);
  } else if (args.limit !== null) {
    groupAQuery = groupAQuery.limit(args.limit);
  }

  const { data: groupAData, error: groupAError } = await groupAQuery;
  if (groupAError) throw new Error(`Could not load Group A signals: ${groupAError.message}`);
  const groupA = (groupAData ?? []) as unknown as SignalRow[];

  // --- Group B: classified, missing signal_intent_score ---
  let groupBQuery = supabase
    .from("signals")
    .select(
      "id, company_id, summary, detail, source_url, source_title, published_date, created_at, theme, signal_type, confidence_score, intent_score, classification_reason, confirmed_spend_amount, confirmed_spend_currency, signal_intent_score, company:companies(name, website)"
    )
    .not("theme", "is", null)
    .is("signal_intent_score", null)
    .order("id", { ascending: true });
  if (args.offset !== null) {
    const to = args.offset + (args.limit ?? 10_000) - 1;
    groupBQuery = groupBQuery.range(args.offset, to);
  } else if (args.limit !== null) {
    groupBQuery = groupBQuery.limit(args.limit);
  }

  const { data: groupBData, error: groupBError } = await groupBQuery;
  if (groupBError) throw new Error(`Could not load Group B signals: ${groupBError.message}`);
  const groupB = (groupBData ?? []) as unknown as SignalRow[];

  console.log(`Group A (never classified — needs OpenAI):        ${groupA.length} row(s)`);
  console.log(`Group B (classified, needs Signal Intent Score):  ${groupB.length} row(s)`);
  console.log("");

  if (args.dryRun) {
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const pricing = pricingFor(model);
    if (pricing) {
      // Rough per-signal estimate: ~800 input / ~200 output tokens.
      const estCost = groupA.length * ((800 / 1_000_000) * pricing.input + (200 / 1_000_000) * pricing.output);
      console.log(`Estimated Group A cost (model: ${model}): ~$${estCost.toFixed(2)}`);
    } else {
      console.log(`Estimated Group A cost: unknown model "${model}" — check OpenAI's current pricing.`);
    }
    console.log(`Estimated Group A time (concurrency ${BACKFILL_CONCURRENCY}, no search step): a few seconds per call.`);
    console.log("Group B: no cost, near-instant (pure arithmetic).");
    console.log("\nDry run complete — no writes made. Re-run without --dry-run to execute.");
    return;
  }

  // --- Process Group B first: free, fast, no external dependency ---
  let groupBScored = 0;
  let groupBSkipped = 0;
  let groupBFailed = 0;
  for (let i = 0; i < groupB.length; i++) {
    const result = await scoreOnlyOne(supabase, groupB[i], errors);
    if (result === "scored") groupBScored += 1;
    else if (result === "skipped") groupBSkipped += 1;
    else groupBFailed += 1;
    if ((i + 1) % 25 === 0 || i === groupB.length - 1) {
      console.log(`Group B: [${i + 1}/${groupB.length}] scored=${groupBScored} skipped=${groupBSkipped} failed=${groupBFailed}`);
    }
  }

  // --- Process Group A: costs money, needs concurrency control ---
  let groupAClassified = 0;
  let groupAUnclassifiable = 0;
  let groupAFailed = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  let processed = 0;
  for (const group of chunk(groupA, BACKFILL_CONCURRENCY)) {
    const results = await Promise.all(group.map((row) => classifyAndScoreOne(supabase, row, usage, errors)));
    for (const result of results) {
      if (result === "classified") groupAClassified += 1;
      else if (result === "unclassifiable") groupAUnclassifiable += 1;
      else groupAFailed += 1;
    }
    processed += group.length;
    console.log(
      `Group A: [${processed}/${groupA.length}] classified=${groupAClassified} unclassifiable=${groupAUnclassifiable} failed=${groupAFailed}`
    );
  }

  // --- Recalculate theme scores once, from the enlarged corpus ---
  let themeScoresOk = true;
  try {
    await computeAndStoreThemeScores(supabase, errors);
  } catch (err) {
    themeScoresOk = false;
    errors.push(`Theme intelligence aggregation: ${(err as Error).message}`);
  }

  // --- Final report ---
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const actualCost = pricing
    ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n--- Backfill complete ---");
  console.log(`Group A: ${groupA.length} row(s) — classified ${groupAClassified}, unclassifiable ${groupAUnclassifiable}, failed ${groupAFailed}`);
  console.log(`Group B: ${groupB.length} row(s) — scored ${groupBScored}, skipped (no raw scores) ${groupBSkipped}, failed ${groupBFailed}`);
  console.log(`Theme scores recalculated: ${themeScoresOk ? "yes" : "no (see errors below)"}`);
  console.log(`OpenAI usage: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens`);
  console.log(actualCost !== null ? `Estimated cost: ~$${actualCost.toFixed(4)}` : "Estimated cost: unknown model, check pricing manually");
  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors) console.log(`  - ${e}`);
  } else {
    console.log("\nNo errors.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
