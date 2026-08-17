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
// onto theme_scores (supabase/004_theme_narrative.sql Part 1; the required
// columns are documented there and in ANTENNA_CHUNK3_DELIVERY_REPORT.md).
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
//
// --- Response parsing (this revision) ---------------------------------
//
// The original parser matched the model's raw output text against
// /\{[\s\S]*\}/ — greedy, so it grabbed from the FIRST "{" to the LAST "}"
// anywhere in the whole response. Two ways that fails even when the model's
// JSON is fine: (1) any trailing text containing its own brace, and (2) a
// response cut off before the closing brace ever arrived, in which case the
// regex has no "}" to match at all and returns null, which read at the call
// site as "model response did not contain both fields" even though both
// fields were present and complete right up until the cutoff.
//
// That second case is the one actually observed here (inconsistent
// per-theme failures, different themes each run, same prompt): this
// project already hit and diagnosed the same failure mode once before, in
// lib/research.ts (see README.md's "Recall tuning" section) — for the
// Luna model tier, `max_output_tokens` caps the model's ENTIRE turn, not
// just the visible JSON, so a tight budget can get exhausted before the
// response finishes, and it varies run to run for the same prompt because
// generation isn't deterministic. Two changes follow from that:
//
// 1. NARRATIVE_MAX_OUTPUT_TOKENS raised from 500 to 900, and
//    NARRATIVE_TIMEOUT_MS raised from 20s to 30s to match (more permitted
//    output means more generation time; there's no Vercel-style ceiling on
//    a local script, so there's no reason to hold the timeout tight). These
//    are request parameters, not prompt text — NARRATIVE_PROMPT below is
//    unchanged.
// 2. The parser (parseNarrativeResponse, below) replaces the greedy regex
//    with a string/escape-aware scan for the first balanced JSON object,
//    and distinguishes two truncation shapes instead of collapsing them
//    into one vague error: if the scan runs off the end of the text while
//    still inside a string literal, the actual content was cut off
//    mid-sentence and there's nothing valid to recover ("truncated"); if it
//    runs off the end between values, with every string already closed,
//    the content itself is intact and only the closing "}"/"]" punctuation
//    is missing, most likely the very last token of the output budget, and
//    that case is safely repaired and accepted rather than rejected
//    ("recovered"). A markdown-code-fence strip is applied first as a
//    defensive fallback, even though the prompt already says not to use
//    one. Every rejection now reports one of four distinct reasons — empty
//    response, invalid JSON, truncated, missing fields — instead of one
//    generic message, plus database update failures are already their own
//    separate category.
//
// Unchanged by that revision: NARRATIVE_PROMPT's text, the scoring model,
// the taxonomy, and the theme_scores schema.
//
// --- Follow-up: 2 themes still truncating mid-string ------------------
//
// After the fix above, most themes generated cleanly, but 2 (Cloud & IP
// Transformation, Creator & Audience Technology) still came back truncated
// INSIDE narrative_summary itself, the very first field, well before the
// output should have been anywhere near a 900-token ceiling. That's a
// genuine content-length problem, not a parsing problem: the model was
// still producing too much before max_output_tokens (or whatever share of
// it Luna's own internal generation consumes ahead of the visible text)
// ran out, for those two themes' evidence sets specifically.
//
// The fix here is at the prompt, not the request parameters: rather than
// raising the token budget further (which doesn't address why generation
// was running long for these themes, and risks recurring for the next
// theme that happens to need more internal generation), NARRATIVE_PROMPT
// now gives both fields explicit, hard word ceilings, narrative_summary
// at 25 words, narrative at 60, down from "max ~30 words" (a soft target)
// and "3-5 sentences" (a shape, not a length cap). NARRATIVE_MAX_OUTPUT_
// TOKENS stays at 900, unchanged, on purpose. Everything else about the
// prompt (the data it's grounded in, the tone/discipline instructions, the
// output shape) is untouched, and the scoring model, taxonomy, and schema
// remain untouched as before.
//
// --- Editorial differentiation ------------------------------------------
//
// Homepage cards were reading as too similar to one another. Two causes,
// two fixes, one on each side of this file's boundary with the UI:
//
// 1. ThemeCard.tsx was showing the fixed, hand-written theme definition
//    (lib/themeDefinitions.ts) ABOVE narrative_summary on every card. All
//    10 definitions share the same descriptive register ("The use of...",
//    "The systems that...") by design, they're meant to be stable,
//    plain-English category explanations, not editorial voice, so leading
//    every card with one made all 10 cards scan as similarly-shaped
//    regardless of what narrative_summary said underneath. Definitions now
//    only appear on theme detail pages; that's a UI change, not this file.
// 2. narrative_summary's own instruction still just said "state the
//    overall picture plainly", which tends to produce the same sentence
//    shape every time ("[Theme] is showing/seeing broad activity but
//    limited evidence..."), differing only in which numbers get named.
//    The instruction now asks explicitly for "why does this matter right
//    now" rather than "what is happening", names the exact templated
//    openers to avoid, and tells the model to vary sentence shape, not
//    just content, theme to theme. Length also tightened to 20 words (from
//    25): shorter output leaves less room to fall back on a generic frame.
//
// Separately, narrative was tightened again, 60 to 50 words, and now
// explicitly told to stay interpretation-only, no listing or restating
// individual signals/companies, since that's the separate Market Activity
// evidence section's job on the detail page, not this field's. Same
// motivation as the "keep evidence separate" framing used elsewhere in
// this project: Antenna's interpretation and Antenna's evidence are always
// two distinct things, never blended into one block of prose.
//
// Still unchanged: the scoring model, the taxonomy, the theme_scores
// schema, and everything else about the prompt (the data it's grounded in,
// the DATA section itself, the em-dash/tone instructions, the JSON shape).

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

// Raised from 20_000 / 500 — see the header comment's "Response parsing"
// section for why. Not prompt changes; NARRATIVE_PROMPT text is unchanged.
const NARRATIVE_TIMEOUT_MS = 30_000;
const NARRATIVE_MAX_OUTPUT_TOKENS = 900;

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

Write two pieces of copy. Stay within the word limits below, even if it means being less exhaustive; being concise matters as much as being accurate.
1. narrative_summary: ONE sentence, no more than 20 words, for a homepage card. Answer "why does this theme matter right now?", not just "what is happening", lead with the single most decision-relevant fact about this theme's evidence pattern. Do not begin with "${params.theme} is showing", "${params.theme} activity is", or any similarly templated opening: vary the sentence's own shape, not just which numbers it names, so it doesn't read interchangeably with another theme's summary.
2. narrative: a short editorial paragraph, no more than 50 words, for a detail page. Interpret what the evidence pattern means, e.g. whether activity is broad but early-stage, or narrower but backed by stronger buying signals, grounded in the data above. This is interpretation only, keep it separate from evidence: do not list, cite, or restate individual signals or companies here, that is a separate section's job. Confident, analytical tone; no hype, no generic AI-marketing language, no clichés.

Writing style: do not use em dashes ("—") anywhere in your response. Use commas, full stops, colons, or brackets instead.

Respond with ONLY a JSON object (no markdown fences, no commentary), exactly this shape:
{"narrative_summary": "...", "narrative": "..."}`;

// --- Response parsing ---------------------------------------------------

type ParsedNarrative = { narrative_summary: string; narrative: string };

type ParseFailureKind = "empty" | "invalid_json" | "truncated" | "missing_fields";

type ParseResult =
  | { ok: true; value: ParsedNarrative; recovered: boolean }
  | { ok: false; kind: ParseFailureKind; detail: string };

// Defensive fallback: the prompt already says "no markdown fences", but
// strip one if the model added one anyway, rather than letting it break
// the object scan below.
function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

type JsonScan =
  | { found: false }
  | { found: true; complete: true; json: string }
  | { found: true; complete: false; endedInString: boolean; partial: string; openStack: Array<"}" | "]"> };

// Scans from the first "{" for a balanced JSON object, tracking string and
// escape state so braces inside string VALUES (e.g. a narrative that
// happens to mention a curly brace) don't get mistaken for structural
// braces. Reports not just whether it found a complete object, but, if
// not, whether the cutoff happened mid-string (real content loss) or
// between values (recoverable — see header comment).
function scanJsonObject(text: string): JsonScan {
  const start = text.indexOf("{");
  if (start === -1) return { found: false };

  const openStack: Array<"}" | "]"> = [];
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") openStack.push("}");
    else if (ch === "[") openStack.push("]");
    else if (ch === "}" || ch === "]") {
      openStack.pop();
      if (openStack.length === 0) {
        return { found: true, complete: true, json: text.slice(start, i + 1) };
      }
    }
  }

  return { found: true, complete: false, endedInString: inString, partial: text.slice(start), openStack };
}

export function parseNarrativeResponse(rawText: string): ParseResult {
  const trimmed = stripCodeFence(rawText.trim()).trim();

  if (!trimmed) {
    return { ok: false, kind: "empty", detail: "response was empty" };
  }

  const scan = scanJsonObject(trimmed);

  if (!scan.found) {
    return { ok: false, kind: "invalid_json", detail: `no '{' found in response: ${trimmed.slice(0, 200)}` };
  }

  let jsonText: string;
  let recovered = false;

  if (scan.complete) {
    jsonText = scan.json;
  } else if (scan.endedInString) {
    // Cut off mid-value, e.g. `{"narrative_summary":"...","narrative":"AI
    // and`. The visible content itself is incomplete; there's nothing
    // valid to recover, only where the cutoff happened.
    return {
      ok: false,
      kind: "truncated",
      detail: `response ended mid-value, most likely hit max_output_tokens: ...${scan.partial.slice(-160)}`,
    };
  } else {
    // Cut off between values, e.g. missing only a trailing "}". Every
    // string is already closed, so the content is intact; close out the
    // remaining open structure and try again.
    const closers = [...scan.openStack].reverse().join("");
    jsonText = scan.partial.replace(/,\s*$/, "") + closers;
    recovered = true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      kind: recovered ? "truncated" : "invalid_json",
      detail: `${(err as Error).message}: ${jsonText.slice(0, 200)}`,
    };
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const narrative_summary =
    typeof obj.narrative_summary === "string" ? stripEmDashes(obj.narrative_summary.trim()) : "";
  const narrative = typeof obj.narrative === "string" ? stripEmDashes(obj.narrative.trim()) : "";

  if (!narrative_summary || !narrative) {
    return {
      ok: false,
      kind: "missing_fields",
      detail: `parsed JSON but a required field was missing or empty: narrative_summary=${JSON.stringify(
        obj.narrative_summary
      )}, narrative=${JSON.stringify(obj.narrative)}`.slice(0, 300),
    };
  }

  return { ok: true, value: { narrative_summary, narrative }, recovered };
}

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

type ErrorKind = ParseFailureKind | "request_error" | "db_error";

type GenerateStatus = { status: "generated"; recovered: boolean } | { status: "error"; kind: ErrorKind };

async function generateOne(
  supabase: SupabaseClient,
  score: ThemeScoreRow,
  usage: { inputTokens: number; outputTokens: number },
  errors: string[]
): Promise<GenerateStatus> {
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
    const result = parseNarrativeResponse(text);

    if (!result.ok) {
      errors.push(`${score.theme}: [${result.kind}] ${result.detail}`);
      return { status: "error", kind: result.kind };
    }

    const { error: updateError } = await supabase
      .from("theme_scores")
      .update({
        narrative_summary: result.value.narrative_summary,
        narrative: result.value.narrative,
        narrative_generated_at: new Date().toISOString(),
      })
      .eq("id", score.id);

    if (updateError) {
      errors.push(`${score.theme}: [db_error] ${updateError.message}`);
      return { status: "error", kind: "db_error" };
    }

    return { status: "generated", recovered: result.recovered };
  } catch (err) {
    errors.push(`${score.theme}: [request_error] ${(err as Error).message}`);
    return { status: "error", kind: "request_error" };
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
  let recoveredCount = 0;
  let failed = 0;
  const failureCounts: Partial<Record<ErrorKind, number>> = {};
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const row of rows) {
    const result = await generateOne(supabase, row, usage, errors);
    if (result.status === "generated") {
      generated += 1;
      if (result.recovered) recoveredCount += 1;
      console.log(`[${generated + failed}/${rows.length}] ${row.theme}: generated${result.recovered ? " (recovered from incomplete JSON structure)" : ""}`);
    } else {
      failed += 1;
      failureCounts[result.kind] = (failureCounts[result.kind] ?? 0) + 1;
      console.log(`[${generated + failed}/${rows.length}] ${row.theme}: error (${result.kind})`);
    }
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const actualCost = pricing
    ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n--- Narrative generation complete ---");
  console.log(
    `Generated: ${generated}${recoveredCount > 0 ? ` (${recoveredCount} recovered from incomplete JSON structure)` : ""}, failed: ${failed}${args.theme ? "" : `, skipped (no signals): ${ANTENNA_THEMES.length - rows.length}`}`
  );
  if (failed > 0) {
    const breakdown = Object.entries(failureCounts)
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ");
    console.log(`Failure breakdown: ${breakdown}`);
  }
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
