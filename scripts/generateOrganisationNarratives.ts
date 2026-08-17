// Antenna Phase 3B.1 — organisation-level "Antenna View" (brief §6).
//
// Same pattern as scripts/generateThemeNarratives.ts (Chunk 3), one level
// down: reads each organisation's already-collected signals (nothing here
// changes what was collected or how it was classified/scored — that's
// lib/research.ts and lib/intelligence.ts, untouched), asks OpenAI to write
// ONE short interpretive paragraph from that evidence, and writes
// antenna_view/antenna_view_generated_at back onto companies
// (supabase/008_organisation_antenna_view.sql).
//
// NOT part of the deployed app, the daily cron, or any Vercel route — run
// once, locally, by a human, and re-run any time an organisation's evidence
// meaningfully changes (no dependency tracking; every run simply
// regenerates and overwrites, safe by design — this is read-side prose,
// not source data):
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/generateOrganisationNarratives.ts --dry-run
//   npx tsx scripts/generateOrganisationNarratives.ts
//
// Flags:
//   --dry-run          Print what would be generated for each organisation
//                        (including the grounding data assembled), make no
//                        OpenAI calls, write nothing.
//   --org=<slug>       Only this organisation, e.g. --org=netflix. For
//                        testing a single organisation's copy first.
//
// Organisations with no signals yet are skipped — there's no evidence to
// interpret, and the organisation page already renders a plain "not yet
// generated" fallback for that case (see app/organisations/[slug]/page.tsx).

import OpenAI from "openai";
import { getSupabase, type Company } from "../lib/supabase";
import { companyToSlug } from "../lib/companySlug";
import { organisationTypeLabel } from "../lib/organisationDisplay";
import { stripEmDashes } from "../lib/textSanitize";

// --- CLI args --------------------------------------------------------------

type Args = { dryRun: boolean; org: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, org: null };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--org=")) args.org = raw.slice("--org=".length);
  }
  return args;
}

// --- OpenAI ------------------------------------------------------------

const NARRATIVE_TIMEOUT_MS = 20_000;
const NARRATIVE_MAX_OUTPUT_TOKENS = 350;

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
  companyName: string;
  organisationType: string;
  themes: string[];
  signalsCount: number;
  examples: string[];
}) => `You are the editorial voice of Antenna, a media & entertainment technology market-intelligence product. Antenna distinguishes ACTIVITY from genuine INVESTMENT SIGNAL — mentioning a topic is not the same as evidence of real spend or adoption. Write from that discipline.

Write a short interpretation of "${params.companyName}" (a ${params.organisationType} in Antenna's model) using ONLY the data below. Do not invent deals, figures, or activity that aren't given to you.

DATA:
- ${params.signalsCount} signal(s) on record
- Active in these Antenna themes: ${params.themes.join(", ") || "(none classified yet)"}

REPRESENTATIVE EVIDENCE (a sample, not the full set, highest-intent first):
${params.examples.map((e) => `- ${e}`).join("\n")}

Write "antenna_view": a short paragraph (2-4 sentences) answering "what does this organisation's activity mean?", not a list of what signals exist. Where the evidence supports it, characterise the trajectory (e.g. moving from experimentation toward operational adoption, or a vendor extending from an existing capability into a new one), but only if the evidence above actually supports that read; do not invent a trend that isn't there. Confident, analytical tone; no hype, no generic AI-marketing language, no clichés.

Writing style: do not use em dashes ("—") anywhere in your response. Use commas, full stops, colons, or brackets instead.

Respond with ONLY a JSON object (no markdown fences, no commentary), exactly this shape:
{"antenna_view": "..."}`;

// --- Types -------------------------------------------------------------

type SignalRow = {
  summary: string;
  theme: string | null;
  signal_type: string | null;
  signal_intent_score: number | null;
};

type SupabaseClient = ReturnType<typeof getSupabase>;

const MAX_EXAMPLES = 6;

async function getCompanyEvidence(
  supabase: SupabaseClient,
  companyId: number
): Promise<{ examples: string[]; themes: string[]; signalsCount: number }> {
  const { data, error } = await supabase
    .from("signals")
    .select("summary, theme, signal_type, signal_intent_score")
    .eq("company_id", companyId)
    .order("signal_intent_score", { ascending: false, nullsFirst: false });

  if (error || !data) return { examples: [], themes: [], signalsCount: 0 };

  const rows = data as unknown as SignalRow[];
  const themes = Array.from(new Set(rows.map((r) => r.theme).filter((t): t is string => Boolean(t))));
  const examples = rows.slice(0, MAX_EXAMPLES).map((r) => `${r.theme ?? "Uncategorised"} — ${r.summary}`);

  return { examples, themes, signalsCount: rows.length };
}

async function generateOne(
  supabase: SupabaseClient,
  company: Company,
  usage: { inputTokens: number; outputTokens: number },
  errors: string[]
): Promise<"generated" | "error"> {
  try {
    const { examples, themes, signalsCount } = await getCompanyEvidence(supabase, company.id);
    const client = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

    const response = await client.responses.create(
      {
        model,
        input: NARRATIVE_PROMPT({
          companyName: company.name,
          organisationType: organisationTypeLabel(company.organisation_type),
          themes,
          signalsCount,
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

    const antenna_view = typeof parsed?.antenna_view === "string" ? stripEmDashes(parsed.antenna_view.trim()) : null;

    if (!antenna_view) {
      errors.push(`${company.name}: model response did not contain antenna_view — raw: ${text.slice(0, 200)}`);
      return "error";
    }

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        antenna_view,
        antenna_view_generated_at: new Date().toISOString(),
      })
      .eq("id", company.id);

    if (updateError) {
      errors.push(`${company.name}: update failed: ${updateError.message}`);
      return "error";
    }

    return "generated";
  } catch (err) {
    errors.push(`${company.name}: ${(err as Error).message}`);
    return "error";
  }
}

// --- Main --------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = getSupabase();
  const errors: string[] = [];

  console.log("Antenna — organisation Antenna View generation");
  console.log(args.dryRun ? "(dry run — no writes, no OpenAI calls)" : "(live run)");
  if (args.org) console.log(`  organisation filter: ${args.org}`);
  console.log("");

  const { data, error } = await supabase.from("companies").select("*");
  if (error || !data) throw new Error(`Could not load companies: ${error?.message}`);

  let companies = data as Company[];
  if (args.org) {
    companies = companies.filter((c) => companyToSlug(c.name) === args.org);
  }

  // Only organisations with at least one signal — nothing to interpret
  // otherwise, and the page's fallback text already handles that case.
  const withSignals: Company[] = [];
  for (const c of companies) {
    const { signalsCount } = await getCompanyEvidence(supabase, c.id);
    if (signalsCount > 0) withSignals.push(c);
  }

  console.log(`Organisations with qualifying data: ${withSignals.length} / ${companies.length} checked`);
  console.log("");

  if (withSignals.length === 0) {
    console.log("Nothing to generate — no matching organisation has signals yet.");
    return;
  }

  if (args.dryRun) {
    for (const c of withSignals) {
      const { examples, themes, signalsCount } = await getCompanyEvidence(supabase, c.id);
      console.log(`--- ${c.name} (${companyToSlug(c.name)}) ---`);
      console.log(`  type=${organisationTypeLabel(c.organisation_type)} themes=${themes.join(", ") || "—"}`);
      console.log(`  ${signalsCount} signal(s), ${examples.length} example(s) would be sent`);
    }
    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const pricing = pricingFor(model);
    if (pricing) {
      const estCost = withSignals.length * ((900 / 1_000_000) * pricing.input + (150 / 1_000_000) * pricing.output);
      console.log(`\nEstimated cost (model: ${model}): ~$${estCost.toFixed(2)} for ${withSignals.length} organisation(s)`);
    }
    console.log("\nDry run complete — no writes made. Re-run without --dry-run to execute.");
    return;
  }

  let generated = 0;
  let failed = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const company of withSignals) {
    const result = await generateOne(supabase, company, usage, errors);
    if (result === "generated") generated += 1;
    else failed += 1;
    console.log(`[${generated + failed}/${withSignals.length}] ${company.name}: ${result}`);
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const actualCost = pricing
    ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n--- Organisation narrative generation complete ---");
  console.log(`Generated: ${generated}, failed: ${failed}`);
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
