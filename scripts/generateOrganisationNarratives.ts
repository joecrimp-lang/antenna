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
//
// --- Robustness + editorial pass (this revision) -----------------------
//
// Brought this file in line with the two rounds of fixes already applied
// to scripts/generateThemeNarratives.ts, adapted to the fact that this
// script has only ONE stored field (antenna_view text, not a separate
// summary/narrative pair — see companies schema below), so both changes
// below live inside that single field rather than as two DB columns:
//
// 1. Parser reliability. This file previously used the same greedy regex
//    theme narratives did (/\{[\s\S]*\}/), matching first "{" to LAST "}"
//    in the whole response, which returns null on any response cut off
//    before its closing brace ever arrived. parseNarrativeResponse below
//    replaces it with the same string/escape-aware balanced-object scanner
//    (scanJsonObject) built for theme narratives: it distinguishes a
//    response truncated mid-string (real content loss, unrecoverable) from
//    one truncated only after every string closed (recoverable — the
//    remaining brackets are closed and the parse retried). A markdown-
//    fence strip runs first as a defensive fallback. Failures are now
//    reported as one of four distinct kinds (empty, invalid_json,
//    truncated, missing_fields) instead of one generic message, and
//    database update failures remain their own separate category.
//
// 2. Output format + editorial framing. antenna_view is now written as ONE
//    paragraph but in two explicit, word-capped parts: an opening sentence
//    (max 25 words) answering "what is this organisation doing that
//    matters", followed by up to 60 more words answering "why does that
//    matter in the context of the market". The prompt now also names and
//    forbids the generic filler this kind of copy tends to default to
//    ("The company is showing signs of...", "There is increasing
//    activity...", "The organisation demonstrates...") and is explicit that
//    this is interpretation, not a rundown: it must not list, cite, or
//    restate individual signals, sources, or dates, since the evidence
//    cards immediately below the Antenna View on the organisation page
//    already show exactly that (see app/organisations/[slug]/page.tsx).
//    This mirrors the interpretation/evidence separation already applied
//    to theme narratives' `narrative` field.
//
// 3. Output budget. NARRATIVE_MAX_OUTPUT_TOKENS raised from 350 to 650 and
//    NARRATIVE_TIMEOUT_MS from 20s to 25s. Same reasoning as theme
//    narratives' first fix (see that file's header comment, and
//    README.md's "Recall tuning" section): for the Luna model tier,
//    max_output_tokens caps the model's entire turn, not just the visible
//    JSON, so a tight budget risks truncating output even when the final
//    text itself would have been short. The new copy is shorter than the
//    old unbounded "2-4 sentences" (a combined ~85-word cap vs. previously
//    open-ended), so the budget didn't need raising as far as theme
//    narratives' 900; 650 leaves comparable generation headroom for a
//    single shorter field.
//
// Unchanged by this revision: the JSON response contract (still exactly
// {"antenna_view": "..."}), the companies schema, organisation scoring,
// signal classification, and the organisation page's UI structure.
//
// --- Follow-up: Disney still truncating mid-value ----------------------
//
// After the above, 13/14 organisations generated cleanly; Disney's response
// still cut off mid-value ("truncated"), the same failure shape as theme
// narratives hit for 2 themes after their first round. Same fix as that
// case: the token budget is not the problem (650 already gives headroom
// beyond a ~85-word field), it's that 25 + 60 words still leaves enough
// room for the model to run long on an organisation with a lot of evidence
// to synthesise. So this is a prompt-only change: antenna_view's cap drops
// from a combined ~85 words (25 + 60, in two loosely-sized parts) to a
// single hard ceiling of 70 words total, shaped as exactly two sentences
// (one opening, one interpreting) rather than "a sentence plus up to N more
// words". NARRATIVE_MAX_OUTPUT_TOKENS/NARRATIVE_TIMEOUT_MS stay at 650/25s,
// unchanged, on purpose, same as theme narratives left its budget alone for
// this kind of fix. parseNarrativeResponse (the scanner-based parser) is
// untouched: it already does the right thing here (distinguishing this real
// mid-string truncation from a merely-unclosed one) — the previous run's
// correct "truncated" categorisation for Disney is exactly how this was
// diagnosed. The evidence/interpretation separation, the banned generic
// openers, the schema, scoring, and UI remain unchanged as before.

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

// Raised from 20_000 / 350 — see the header comment's "Output budget"
// section for why. Not a prompt-shape change; the JSON contract and
// grounding data are unchanged.
const NARRATIVE_TIMEOUT_MS = 25_000;
const NARRATIVE_MAX_OUTPUT_TOKENS = 650;

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

Write about "${params.companyName}" (a ${params.organisationType} in Antenna's model) using ONLY the data below. Do not invent deals, figures, or activity that aren't given to you.

DATA:
- ${params.signalsCount} signal(s) on record
- Active in these Antenna themes: ${params.themes.join(", ") || "(none classified yet)"}

REPRESENTATIVE EVIDENCE (a sample, not the full set, highest-intent first):
${params.examples.map((e) => `- ${e}`).join("\n")}

Write "antenna_view" as ONE short paragraph, no more than 70 words total, made up of exactly two sentences. Stay within the limit even if it means being less exhaustive; being concise matters as much as being accurate.
1. Opening sentence: what is this organisation doing that matters? Lead with the single most decision-relevant fact, stated plainly, not a category description of the organisation.
2. One closing sentence: why does that matter in the context of the market, e.g. whether this looks like early experimentation or a firmer commitment, or whether it's ahead of or behind where similar organisations are. This is interpretation only, not a rundown of evidence: do not list, cite, or restate individual signals, sources, or dates here, that's what the evidence cards below the Antenna View already show. Only characterise a trajectory if the evidence above actually supports it.

Avoid generic filler such as "The company is showing signs of...", "There is increasing activity...", or "The organisation demonstrates...": name the specific thing this organisation is doing instead of asserting that something is happening. Confident, analytical tone; no hype, no generic AI-marketing language, no clichés.

Writing style: do not use em dashes ("—") anywhere in your response. Use commas, full stops, colons, or brackets instead.

Respond with ONLY a JSON object (no markdown fences, no commentary), exactly this shape:
{"antenna_view": "..."}`;

// --- Response parsing ---------------------------------------------------

type ParsedNarrative = { antenna_view: string };

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
    // Cut off mid-value, e.g. `{"antenna_view":"Netflix has expanded AI`.
    // The visible content itself is incomplete; there's nothing valid to
    // recover, only where the cutoff happened.
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
  const antenna_view = typeof obj.antenna_view === "string" ? stripEmDashes(obj.antenna_view.trim()) : "";

  if (!antenna_view) {
    return {
      ok: false,
      kind: "missing_fields",
      detail: `parsed JSON but antenna_view was missing or empty: ${JSON.stringify(obj.antenna_view)}`.slice(0, 300),
    };
  }

  return { ok: true, value: { antenna_view }, recovered };
}

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

type ErrorKind = ParseFailureKind | "request_error" | "db_error";

type GenerateStatus = { status: "generated"; recovered: boolean } | { status: "error"; kind: ErrorKind };

async function generateOne(
  supabase: SupabaseClient,
  company: Company,
  usage: { inputTokens: number; outputTokens: number },
  errors: string[]
): Promise<GenerateStatus> {
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
    const result = parseNarrativeResponse(text);

    if (!result.ok) {
      errors.push(`${company.name}: [${result.kind}] ${result.detail}`);
      return { status: "error", kind: result.kind };
    }

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        antenna_view: result.value.antenna_view,
        antenna_view_generated_at: new Date().toISOString(),
      })
      .eq("id", company.id);

    if (updateError) {
      errors.push(`${company.name}: [db_error] ${updateError.message}`);
      return { status: "error", kind: "db_error" };
    }

    return { status: "generated", recovered: result.recovered };
  } catch (err) {
    errors.push(`${company.name}: [request_error] ${(err as Error).message}`);
    return { status: "error", kind: "request_error" };
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
      const estCost = withSignals.length * ((900 / 1_000_000) * pricing.input + (110 / 1_000_000) * pricing.output);
      console.log(`\nEstimated cost (model: ${model}): ~$${estCost.toFixed(2)} for ${withSignals.length} organisation(s)`);
    }
    console.log("\nDry run complete — no writes made. Re-run without --dry-run to execute.");
    return;
  }

  let generated = 0;
  let recoveredCount = 0;
  let failed = 0;
  const failureCounts: Partial<Record<ErrorKind, number>> = {};
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const company of withSignals) {
    const result = await generateOne(supabase, company, usage, errors);
    if (result.status === "generated") {
      generated += 1;
      if (result.recovered) recoveredCount += 1;
      console.log(
        `[${generated + failed}/${withSignals.length}] ${company.name}: generated${result.recovered ? " (recovered from incomplete JSON structure)" : ""}`
      );
    } else {
      failed += 1;
      failureCounts[result.kind] = (failureCounts[result.kind] ?? 0) + 1;
      console.log(`[${generated + failed}/${withSignals.length}] ${company.name}: error (${result.kind})`);
    }
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const actualCost = pricing
    ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n--- Organisation narrative generation complete ---");
  console.log(
    `Generated: ${generated}${recoveredCount > 0 ? ` (${recoveredCount} recovered from incomplete JSON structure)` : ""}, failed: ${failed}`
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
