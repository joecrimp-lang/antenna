// Antenna Phase 2A — Phase 4: controlled research test.
//
// Runs ONE real research batch (real OpenAI + Supabase calls, real cost —
// this is not a dry run) against a single organisation_type slice of the
// controlled 40-organisation universe, then prints the "Research test
// complete" report the brief asks for, plus a per-organisation breakdown
// (from research_run_attempts) and the actual signals created (for a human
// to spot-check summary/theme/confidence quality — this script does not
// attempt to auto-grade signal quality itself, which would need its own
// judgment call and isn't asked for).
//
// Per the brief: do NOT run all 40 at once. Run buyers and vendors as two
// separate, evaluated batches:
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/runControlledResearchTest.ts --org-type=buyer --limit=5
//   # review the report, THEN:
//   npx tsx scripts/runControlledResearchTest.ts --org-type=vendor --limit=5
//
// Requires supabase/005_organisation_model.sql, supabase/006_observability
// .sql, and scripts/importOrganisationUniverse.ts to have already been run
// — this script only selects among companies that already have
// organisation_type set and research_enabled=true.

import { getSupabase } from "../lib/supabase";
import { runFullResearch } from "../lib/runResearch";
import type { ResearchRunAttempt } from "../lib/supabase";

type Args = { orgType: string | null; limit: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { orgType: null, limit: 5 };
  for (const raw of argv) {
    if (raw.startsWith("--org-type=")) args.orgType = raw.slice("--org-type=".length);
    else if (raw.startsWith("--limit=")) {
      const n = parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  luna: { input: 1, output: 6 },
  terra: { input: 2.5, output: 15 },
  sol: { input: 5, output: 30 },
};

function pricingFor(model: string) {
  const key = Object.keys(MODEL_PRICING).find((k) => model.toLowerCase().includes(k));
  return key ? MODEL_PRICING[key] : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.orgType) {
    throw new Error("Usage: npx tsx scripts/runControlledResearchTest.ts --org-type=buyer|vendor|platform|technology_provider [--limit=5]");
  }

  // These are read by lib/runResearch.ts's runFullResearch() itself —
  // setting them here (rather than requiring the operator to export shell
  // env vars) is what lets this script run two clean, separate batches
  // back to back without re-exporting anything between them.
  process.env.RESEARCH_ORG_TYPE = args.orgType;
  process.env.RESEARCH_COMPANY_LIMIT = String(args.limit);
  delete process.env.RESEARCH_COMPANY_OFFSET;

  console.log(`Antenna Phase 2A — controlled research test: organisation_type=${args.orgType}, limit=${args.limit}`);
  console.log("This makes real OpenAI + Supabase calls and will incur real cost.\n");

  const wallStart = Date.now();
  const summary = await runFullResearch();
  const wallMs = Date.now() - wallStart;

  const supabase = getSupabase();
  const { data: attemptsData, error: attemptsError } = await supabase
    .from("research_run_attempts")
    .select("*")
    .eq("run_id", summary.runId)
    .order("id", { ascending: true });
  const attempts = (attemptsData ?? []) as ResearchRunAttempt[];

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const pricing = pricingFor(model);
  const estCost = pricing
    ? (summary.totalInputTokens / 1_000_000) * pricing.input + (summary.totalOutputTokens / 1_000_000) * pricing.output
    : null;

  console.log("\n=== Research test complete ===\n");
  console.log(`Organisations attempted: ${summary.organisationsAttempted}`);
  console.log("");
  console.log(`Successful: ${summary.companiesProcessed}`);
  console.log(`Failed: ${summary.organisationsAttempted - summary.companiesProcessed}`);
  console.log("");
  console.log(`Signals created: ${summary.signalsFound}`);
  console.log("");
  console.log(`Duplicates prevented: ${summary.duplicatesPrevented}`);
  console.log("");
  console.log(`Retries used: ${summary.retriesUsed} (organisations that needed the one-time retry before succeeding or failing)`);
  console.log("");
  console.log(`Average runtime per organisation: ${summary.avgDurationMs}ms`);
  console.log(`Total wall-clock time: ${wallMs}ms`);
  console.log("");
  console.log(
    estCost !== null
      ? `Estimated cost: ~$${estCost.toFixed(4)} (${summary.totalInputTokens} input / ${summary.totalOutputTokens} output tokens, model: ${model})`
      : `Estimated cost: unknown model "${model}" — check OpenAI's current pricing manually (${summary.totalInputTokens} input / ${summary.totalOutputTokens} output tokens)`
  );
  console.log("");
  if (summary.errors.length > 0) {
    console.log(`Issues (${summary.errors.length}):`);
    for (const e of summary.errors) console.log(`  - ${e}`);
  } else {
    console.log("Issues: none");
  }

  console.log("\n--- Per-organisation breakdown (for completion-rate / failure-reason review) ---");
  for (const a of attempts) {
    console.log(
      `  [${a.status.padEnd(14)}] ${a.company_name.padEnd(30)} signals=${a.signals_created} duplicates=${a.duplicates_prevented} retries=${a.retry_count} duration=${a.duration_ms}ms${a.error_message ? ` error="${a.error_message.split("\n")[0]}"` : ""}`
    );
  }

  // Signal quality / classification quality (per Phase 4's evaluation
  // checklist) isn't something this script auto-grades — that's a human
  // judgment call. Instead, print every signal this test batch actually
  // created, with its classification, so it can be read and spot-checked
  // directly against the source URL.
  const companyIds = attempts.map((a) => a.company_id);
  if (companyIds.length > 0) {
    const { data: newSignals } = await supabase
      .from("signals")
      .select("company_id, summary, theme, signal_type, confidence_score, intent_score, source_url, published_date, companies(name)")
      .in("company_id", companyIds)
      .gte("created_at", new Date(wallStart).toISOString())
      .order("company_id", { ascending: true });

    console.log("\n--- Signals created this test (for manual quality / evidence-traceability review) ---");
    if (!newSignals || newSignals.length === 0) {
      console.log("  (none)");
    } else {
      for (const s of newSignals as unknown as Array<{
        summary: string;
        theme: string | null;
        signal_type: string | null;
        confidence_score: number | null;
        intent_score: number | null;
        source_url: string | null;
        published_date: string | null;
        companies: { name: string } | null;
      }>) {
        console.log(`  [${s.companies?.name ?? "?"}] ${s.summary}`);
        console.log(
          `    theme=${s.theme ?? "—"} signal_type=${s.signal_type ?? "—"} confidence=${s.confidence_score ?? "—"} intent=${s.intent_score ?? "—"} published=${s.published_date ?? "—"}`
        );
        console.log(`    source: ${s.source_url ?? "—"}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
