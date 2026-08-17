// One-off/rerunnable editorial narrative generator — Chunk 3 (Market
// Intelligence Experience MVP), Layer 1 "editorial intelligence summary".
//
// The brief requires this narrative to be STORED, not generated live on
// every page load (consistent, auditable, cheaper, reviewable). This script
// is that generation step: it reads each theme's already-computed
// theme_scores row (Market Momentum, Investment Evidence, Adoption Shift,
// Opportunity Score — all from lib/intelligence.ts, unchanged by this
// script) plus a handful of grounding examples from the theme's own
// signals, asks OpenAI to write two lengths of editorial copy from that
// data, and writes narrative_summary/narrative/narrative_generated_at back
// onto theme_scores (supabase/004_theme_narrative.sql Part 1).
//
// NOT part of the deployed app, the daily cron, or any Vercel route — run
// once, locally, by a human, and re-run any time scores meaningfully change
// (there is no dependency tracking; every run simply regenerates and
// overwrites, which is safe by design — narratives are read-side-only
// prose, not source data):
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/generateThemeNarratives.ts --dry-run
//   npx tsx scripts/generateThemeNarratives.ts
//
// Flags:
//   --dry-run       Print what would be generated for each theme (including
//                    the grounding data assembled), make no OpenAI calls,
//                    write nothing.
//   --theme=<slug>  Only this theme, e.g. --theme=ai-and-automation. For
//                    testing a single theme's copy before running all 10.
//
// Themes with no qualifying signals (theme_scores row missing, or
// signals_count is 0/null) are skipped — there is nothing to write an
// evidence-grounded narrative about, and the UI already renders a plain
// "editorial analysis pending" fallback for that case (see ThemeCard.tsx /
// app/themes/[slug]/page.tsx).

import OpenAI from "openai";
import { getSupabase } from "../lib/supabase";
import { ANTENNA_THEMES, type AntennaTheme } from "../lib/antennaTaxonomy";
import { themeToSlug } from "../lib/themeSlug";
import { stripEmDashes } from "../lib/textSanitize";

// --- CLI args ---------------------------------------------------------

type Args = { dryRun: boolean; theme: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, theme: null };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--theme=")) args.theme = raw.slice("--theme=".length);
  }
  return args;
}

// --- OpenAI --------------------------------------------------------------

const NARRATIVE_TIMEOUT_MS = 20_000;
const NARRATIVE_MAX_OUTPUT_TOKENS = 500;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  luna: { input: 1, output: 6 },
  terra: { input: 2.5, output: 15 },
  sol: { input: 5, output: 30 },
};

function pricingFor(model: string) {
  const key = Object.keys(MODEL_PRICING).find((k) => model.toLowerCase().includes(k));
  return key ? MODEL_PRICING[key] : null;
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Export your .env.local before running: `set -a; source .env.local; set +a`"
    );
  }
  return new OpenAI({ apiKey });
}

const NARRATIVE_PROMPT = (params: {
  theme: string;
  momentumScore: number;
  opportunityScore: number;
  investmentEvidencePct: number;
  adoptionShiftDelta: number;
  signalsCount: number;
  organisationsCount: number;
  examples: string[];
}) => `You are the editorial voice of Antenna, a media & entertainment technology market-intelligence product. Antenna's whole point is that it distinguishes ACTIVITY from genuine INVESTMENT SIGNAL — a theme with a lot of talk is not the same as a theme with strong evidence of real spend. Write from that discipline: never imply "more signals = more important" on its own.

Write about the theme "${params.theme}" using ONLY the data below. Do not invent companies, deals, or figures that aren't given to you.

DATA:
- Market Momentum Score: ${params.momentumScore}/100 (volume and spread of activity across organisations)
- Investment Evidence: ${params.investmentEvidencePct}% (share of recent signals that are high-confidence, high-intent evidence of real buying activity)
- Adoption Shift: ${params.adoptionShiftDelta >= 0 ? "+" : ""}${params.adoptionShiftDelta} (whether evidence is moving toward confirmed spend/procurement/launches vs. staying in early strategy/hiring)
- Opportunity Score: ${params.opportunityScore}/100 (momentum + investment evidence + adoption shift combined)
- ${params.signalsCount} signal(s) from ${params.organisationsCount} organisation(s) in the current window

REPRESENTATIVE EVIDENCE (a sample, not the full set):
${params.examples.map((e) => `- ${e}`).join("\n")}

Write two pieces of copy:
1. narrative_summary: ONE sentence (max ~30 words) for a summary card. State the overall picture plainly — do not just restate the numbers.
2. narrative: a short editorial paragraph (3-5 sentences) for a detail page. Explain what the evidence pattern actually shows, e.g. whether activity is broad but early-stage, or narrower but backed by stronger buying signals, grounded in the data and examples above. Confident, analytical tone; no hype, no generic AI-marketing language, no clichés.

Writing style: do not use em dashes ("—") anywhere in your response. Use commas, full stops, colons, or brackets instead.

Respond with ONLY a JSON object (no markdown fences, no commentary), exactly this shape:
{"narrative_summary": "...", "narrative": "..."}`;

// --- Types ---------------------------------------------------------------

type ThemeScoreRow = {
  id: number;
  theme: AntennaTheme;
  signals_count: number;
  organisations_count: number;
  momentum_score: number | null;
  investment_evidence_pct: number | null;
  adoption_shift_delta: number | null;
  opportunity_score: number | null;
};

type SignalRow = {
  summary: string;
  signal_type: string | null;
  signal_intent_score: number | null;
  company: { name: string } | null;
};

type SupabaseClient = ReturnType<typeof getSupabase>;

const MAX_EXAMPLES = 6;

async function getExamples(supabase: SupabaseClient, theme: AntennaTheme): Promise<string[]> {
  const { data, error } = await supabase
    .from("signals")
    .select("summary, signal_type, signal_intent_score, company:companies(name)")
    .eq("theme", theme)
    .order("signal_intent_score", { ascending: false, nullsFirst: false })
    .limit(MAX_EXAMPLES);

  if (error || !data) return [];
  return (data as unknown as SignalRow[]).map(
    (s) => `${s.company?.name ?? "Unknown organisation"} — ${s.summary}`
  );
}

async function generateOne(
  supabase: SupabaseClient,
  score: ThemeScoreRow,
  usage: { inputTokens: number; outputTokens: number },
  errors: string[]
): Promise<"generated" | "error"> {
  try {
    const examples = await getExamples(supabase, score.theme);
    const client = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

    const response = await client.responses.create(
      {
        model,
        input: NARRATIVE_PROMPT({
          theme: score.theme,
          momentumScore: score.momentum_score ?? 0,
          opportunityScore: score.opportunity_score ?? 0,
          investmentEvidencePct: score.investment_evidence_pct ?? 0,
          adoptionShiftDelta: score.adoption_shift_delta ?? 0,
          signalsCount: score.signals_count,
          organisationsCount: score.organisations_count,
          examples: examples.length > 0 ? examples : ["(no individual signal detail available)"],
        }),
        max_output_tokens: NARRATIVE_MAX_OUTPUT_TOKENS,
      },
      { timeout: NARRATIVE_TIMEOUT_MS, maxRetries: 0 }
    );

    const responseUsage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (responseUsage) {
      usage.inputTokens += responseUsage.input_tokens ?? 0;
      usage.outputTokens += responseUsage.output_tokens ?? 0;
    }

    const text = (response as { output_text?: string }).output_text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as Record<string, unknown>) : null;

    const narrative_summary =
      typeof parsed?.narrative_summary === "string" ? stripEmDashes(parsed.narrative_summary.trim()) : null;
    const narrative = typeof parsed?.narrative === "string" ? stripEmDashes(parsed.narrative.trim()) : null;

    if (!narrative_summary || !narrative) {
      errors.push(`${score.theme}: model response did not contain both fields — raw: ${text.slice(0, 200)}`);
      return "error";
    }

    const { error: updateError } = await supabase
      .from("theme_scores")
      .update({
        narrative_summary,
        narrative,
        narrative_generated_at: new Date().toISOString(),
      })
      .eq("id", score.id);

    if (updateError) {
      errors.push(`${score.theme}: update failed: ${updateError.message}`);
      return "error";
    }

    return "generated";
  } catch (err) {
    errors.push(`${score.theme}: ${(err as Error).message}`);
    return "error";
  }
}

// --- Main ------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = getSupabase();
  const errors: string[] = [];

  console.log("Antenna — theme editorial narrative generation");
  console.log(args.dryRun ? "(dry run — no writes, no OpenAI calls)" : "(live run)");
  if (args.theme) console.log(`  theme filter: ${args.theme}`);
  console.log("");

  const { data, error } = await supabase.from("theme_scores").select("*");
  if (error || !data) throw new Error(`Could not load theme_scores: ${error?.message}`);

  let rows = (data as unknown as ThemeScoreRow[]).filter((r) => (r.signals_count ?? 0) > 0);
  if (args.theme) {
    rows = rows.filter((r) => themeToSlug(r.theme) === args.theme);
  }
  // Stable order matching the canonical taxonomy, not DB return order.
  rows.sort((a, b) => ANTENNA_THEMES.indexOf(a.theme) - ANTENNA_THEMES.indexOf(b.theme));

  console.log(`Themes with qualifying data: ${rows.length}`);
  console.log("");

  if (rows.length === 0) {
    console.log("Nothing to generate — no theme has signals yet.");
    return;
  }

  if (args.dryRun) {
    for (const r of rows) {
      const examples = await getExamples(supabase, r.theme);
      console.log(`--- ${r.theme} (${themeToSlug(r.theme)}) ---`);
      console.log(
        `  momentum=${r.momentum_score} opportunity=${r.opportunity_score} investment_evidence=${r.investment_evidence_pct}% adoption_shift=${r.adoption_shift_delta}`
      );
      console.log(`  ${r.signals_count} signal(s), ${r.organisations_count} organisation(s), ${examples.length} example(s) would be sent`);
    }
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const pricing = pricingFor(model);
    if (pricing) {
      const estCost = rows.length * ((1200 / 1_000_000) * pricing.input + (250 / 1_000_000) * pricing.output);
      console.log(`\nEstimated cost (model: ${model}): ~$${estCost.toFixed(2)} for ${rows.length} theme(s)`);
    }
    console.log("\nDry run complete — no writes made. Re-run without --dry-run to execute.");
    return;
  }

  let generated = 0;
  let failed = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const row of rows) {
    const result = await generateOne(supabase, row, usage, errors);
    if (result === "generated") generated += 1;
    else failed += 1;
    console.log(`[${generated + failed}/${rows.length}] ${row.theme}: ${result}`);
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const actualCost = pricing
    ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n--- Narrative generation complete ---");
  console.log(`Generated: ${generated}, failed: ${failed}${args.theme ? "" : `, skipped (no signals): ${ANTENNA_THEMES.length - rows.length}`}`);
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
