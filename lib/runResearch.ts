import { getSupabase, type Company } from "./supabase";
import { researchCompany } from "./research";
import { sendDigestEmail, type DigestItem } from "./email";
import { SCORING_VERSION } from "./antennaTaxonomy";
import { computeSignalIntentScore, computeAndStoreThemeScores } from "./intelligence";

// Companies are processed in concurrent groups rather than one at a time so
// the whole watchlist finishes within a single Vercel function invocation
// (300s limit) instead of needing multiple invocations. Kept small on
// purpose — reliability over speed.
//
// Phase 2A (stabilisation) safe-batch-size math, updated for the new
// timeout + retry policy below: worst case per company is now
// (PER_COMPANY_TIMEOUT_MS + RETRY_BACKOFF_MS + PER_COMPANY_TIMEOUT_MS) =
// 30s + 1.5s + 30s = 61.5s (every company timing out on both attempts).
// Worst-case total = ceil(N / CONCURRENCY) * 61.5s, which must stay well
// under Vercel's 300s ceiling:
//   N=5  (current controlled-test batch size): 3 rounds * 61.5s = 184.5s — safe, real margin.
//   N=10: 5 rounds * 61.5s = 307.5s — over budget, do not run 10 in one invocation.
//   N=8:  4 rounds * 61.5s = 246s — the practical ceiling with real margin at this policy.
// This is a *smaller* single-invocation ceiling than before the retry was
// added (the pre-Phase-2A audit found ~20-24 safe at 25s/no-retry) — the
// trade is deliberate: fewer companies per call, but each one now gets a
// real second chance instead of a single roll of the dice. It's why the
// remaining 30 (of the 40) should keep running as several
// RESEARCH_COMPANY_LIMIT-capped batches, not one larger call.
export const CONCURRENCY = 2;

export type RunSummary = {
  runId: number;
  organisationsAttempted: number;
  companiesProcessed: number;
  signalsFound: number;
  duplicatesPrevented: number;
  retriesUsed: number;
  emailed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
  errors: string[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type SupabaseClient = ReturnType<typeof getSupabase>;

// Phase 2A (stabilisation) — one bounded retry on researchCompany() itself.
// Observed cause: the controlled buyer test timed out on 3/5 companies
// (Netflix, Warner Bros. Discovery, Paramount) at the previous 25s budget —
// larger, high-news-volume companies plus ordinary API/tool latency
// variance. A single retry gives a transient timeout a second chance
// without turning "one difficult organisation" into an open-ended retry
// loop: MAX_ATTEMPTS is a hard cap, not a policy knob, so worst-case timing
// per company stays a fixed, computable number (see CONCURRENCY's comment
// below and the delivery report for the updated safe-batch-size math this
// implies). RETRY_BACKOFF_MS is a short fixed delay, not exponential —
// one extra attempt doesn't need a backoff strategy, just enough of a gap
// to not immediately repeat whatever the first attempt hit.
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Researches one company (with the bounded retry above) and stores any new
// signals. Errors are caught here rather than thrown, so one failing
// company never breaks the group it's running alongside (Promise.all would
// otherwise reject the whole group on a single rejection) — this isolation
// was already correct before Phase 2A; the retry loop below is additive to
// it, not a replacement for it.
//
// Phase 2A (observability) addition: times itself and writes one row to
// research_run_attempts per company, so "what happened during the last
// run" is answerable per-organisation without parsing runs.error's
// free-text blob. This is purely additive record-keeping — none of the
// research/scoring logic below changed, only what gets measured and
// recorded around it.
async function processCompany(supabase: SupabaseClient, runId: number, company: Company) {
  const errors: string[] = [];
  let signalsFound = 0;
  let duplicatesPrevented = 0;
  let processed = true;
  const startedAt = new Date();
  let usage = { inputTokens: 0, outputTokens: 0 };
  let retryCount = 0;

  let result: Awaited<ReturnType<typeof researchCompany>> | null = null;
  let lastError: Error | null = null;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      result = await researchCompany(company);
      lastError = null;
      break;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }
  // Computed once, after the loop settles either way (success or exhausted
  // attempts) — not from inside the catch block, which would under-count a
  // company that failed once but succeeded on the retry (attemptsMade would
  // be 2, but the failure branch alone would have recorded 0).
  retryCount = attemptsMade - 1;

  try {
    if (!result) {
      // Both attempts failed — same failure-isolation behavior as before
      // (this company is marked failed, the run continues), just with a
      // clearer message noting a retry was already tried.
      throw lastError ?? new Error("Unknown research failure");
    }
    usage = result.usage;
    for (const finding of result.findings) {
      // Explicit created_at (rather than relying on the column default) so
      // Signal Intent Score's recency component and the stored created_at
      // timestamp are computed from the exact same instant — "signal
      // creation time" means one specific moment, not two slightly
      // different ones from two separate clock reads.
      const createdAt = new Date().toISOString();

      // Antenna Intelligence v0.2 — Signal Intent Score (lib/intelligence.ts).
      // Computed once, here, from fields the v0.1 classification pass
      // already produced (confidence_score, intent_score, published_date,
      // confirmed_spend_amount) — no new OpenAI call, lib/research.ts is
      // untouched. Null in, null out: a finding with unparseable
      // classification (confidence_score/intent_score null) simply gets no
      // intelligence score either, same as it gets no theme/signal_type.
      const intelligence = computeSignalIntentScore({
        confidence_score: finding.confidence_score,
        intent_score: finding.intent_score,
        published_date: finding.published_date,
        created_at: createdAt,
        confirmed_spend_amount: finding.confirmed_spend_amount,
      });

      const { error: insertError } = await supabase.from("signals").insert({
        company_id: company.id,
        summary: finding.summary,
        detail: finding.detail,
        source_url: finding.source_url,
        source_title: finding.source_title,
        published_date: finding.published_date,
        created_at: createdAt,
        // Antenna Intelligence v0.1 classification. theme/signal_type/scores
        // are null when the model's output couldn't be validated against
        // the canonical taxonomy — the row is still stored (see research.ts)
        // rather than dropped. scoring_version is set here (not by the
        // model) so it's always exactly right, never a typo the model made.
        theme: finding.theme,
        signal_type: finding.signal_type,
        confidence_score: finding.confidence_score,
        intent_score: finding.intent_score,
        scoring_version: SCORING_VERSION,
        classification_reason: finding.classification_reason,
        confirmed_spend_amount: finding.confirmed_spend_amount,
        confirmed_spend_currency: finding.confirmed_spend_currency,
        // estimated_opportunity_* and signals.opportunity_strength
        // intentionally omitted — still no approved per-signal-dollar
        // methodology (different concept from the theme-level Opportunity
        // Score below), so they stay NULL (see ANTENNA_SCORING_MODEL.md).
        signal_intent_score: intelligence.signal_intent_score,
        scoring_reason: intelligence.scoring_reason,
        intelligence_scoring_version: intelligence.intelligence_scoring_version,
      });
      // Unique constraint on (company_id, source_url) means duplicates are
      // silently skipped rather than treated as an error. Phase 2A: counted
      // rather than only silently skipped, so "duplicates prevented" is a
      // real, reportable number (Phase 4 of the brief) instead of invisible.
      if (!insertError) {
        signalsFound += 1;
      } else if (insertError.message.includes("duplicate")) {
        duplicatesPrevented += 1;
      } else {
        errors.push(`${company.name}: ${insertError.message}`);
      }
    }
  } catch (err) {
    processed = false;
    const retrySuffix = retryCount > 0 ? ` (failed after ${retryCount} retr${retryCount === 1 ? "y" : "ies"})` : "";
    errors.push(`${company.name}: ${(err as Error).message}${retrySuffix}`);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  // "success" / "no_new_signals" / "failed" — deliberately just these
  // three (not a larger status enum) per the brief's "do not over-engineer
  // this" guidance. duplicates_prevented is still recorded either way, so
  // "found nothing" vs. "found only things we already had" stays visible
  // without a fourth status.
  const status: "success" | "no_new_signals" | "failed" = !processed
    ? "failed"
    : signalsFound > 0
      ? "success"
      : "no_new_signals";

  const { error: attemptError } = await supabase.from("research_run_attempts").insert({
    run_id: runId,
    company_id: company.id,
    company_name: company.name,
    status,
    signals_created: signalsFound,
    duplicates_prevented: duplicatesPrevented,
    error_message: errors.length > 0 ? errors.join("\n") : null,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    input_tokens: usage.inputTokens || null,
    output_tokens: usage.outputTokens || null,
    retry_count: retryCount,
  });
  // A logging failure must never fail the research itself — same principle
  // as the theme-intelligence and email-digest steps below, which are also
  // wrapped so a bug in observability can't take down signal collection.
  if (attemptError) {
    errors.push(`${company.name}: could not record research_run_attempts row: ${attemptError.message}`);
  }

  return { processed, signalsFound, duplicatesPrevented, durationMs, usage, retryCount, errors };
}

// Runs research for every company in the watchlist, stores any new
// signals, then emails a digest of whatever hasn't been emailed yet.
// Companies are processed in concurrent groups of CONCURRENCY — the next
// group starts only once the current one fully settles — so the whole run
// completes within one function invocation rather than being split across
// several.
export async function runFullResearch(): Promise<RunSummary> {
  const supabase = getSupabase();
  const errors: string[] = [];

  const { data: run, error: runError } = await supabase
    .from("runs")
    .insert({ status: "running" })
    .select()
    .single();
  if (runError || !run) throw new Error(`Could not create run row: ${runError?.message}`);

  // Phase 2A — research_enabled is always honored, unconditionally (not an
  // opt-in env flag): it's the standing definition of "is this organisation
  // in the currently-active research universe at all," not a per-run pilot
  // knob like LIMIT/OFFSET below. Companies outside the controlled
  // 40-organisation universe (see scripts/importOrganisationUniverse.ts)
  // have research_enabled=false and are never selected here — their rows
  // and signal history are untouched, they're just not re-researched.
  let companiesQuery = supabase
    .from("companies")
    .select("*")
    .eq("research_enabled", true)
    .order("rank", { ascending: true });

  // Optional filter to just one side of the ecosystem (buyer/vendor/
  // platform/technology_provider) — added for the Phase 4 controlled test
  // ("5 buyers, then 5 vendors") and any future controlled runs. Unset
  // means no filter, same as today. Deliberately a single optional
  // env-var-driven filter, not a general query builder — see the brief's
  // "do not over-engineer this" guidance.
  const orgType = process.env.RESEARCH_ORG_TYPE;
  if (orgType) {
    companiesQuery = companiesQuery.eq("organisation_type", orgType);
  }

  // Optional cap on how many companies a run processes, and an optional
  // starting offset into the rank-ordered watchlist, for piloting cost and
  // behavior on a subset of companies (e.g. LIMIT=5, OFFSET=5 processes the
  // companies ranked 6-10) before running all 50. Unset/invalid means no
  // limit and/or no offset — behavior is unchanged.
  const limitRaw = process.env.RESEARCH_COMPANY_LIMIT;
  const limit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const hasLimit = Number.isFinite(limit) && limit > 0;

  const offsetRaw = process.env.RESEARCH_COMPANY_OFFSET;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : NaN;
  const hasOffset = Number.isFinite(offset) && offset > 0;

  if (hasOffset) {
    // .range() is an inclusive [from, to] window, so it covers both the
    // offset and the limit in one call. With no limit set, use a generous
    // upper bound — comfortably beyond the 50-company watchlist — so the
    // offset alone still returns "everything from here on".
    const to = offset + (hasLimit ? limit : 10_000) - 1;
    companiesQuery = companiesQuery.range(offset, to);
  } else if (hasLimit) {
    companiesQuery = companiesQuery.limit(limit);
  }

  const { data: companies, error: companiesError } = await companiesQuery;
  if (companiesError || !companies) {
    throw new Error(`Could not load companies: ${companiesError?.message}`);
  }

  const organisationsAttempted = companies.length;
  let companiesProcessed = 0;
  let signalsFound = 0;
  let duplicatesPrevented = 0;
  let retriesUsed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const durations: number[] = [];

  for (const group of chunk(companies as Company[], CONCURRENCY)) {
    const results = await Promise.all(
      group.map((company) => processCompany(supabase, run.id, company))
    );
    for (const result of results) {
      if (result.processed) companiesProcessed += 1;
      signalsFound += result.signalsFound;
      duplicatesPrevented += result.duplicatesPrevented;
      retriesUsed += result.retryCount;
      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;
      durations.push(result.durationMs);
      errors.push(...result.errors);
    }
  }

  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Antenna Intelligence v0.2 — Market Momentum + Opportunity Score
  // (lib/intelligence.ts). A separate, scheduled aggregation step (not a
  // per-signal or per-company computation, not a database trigger) run once
  // per research run, after every company has been processed and every new
  // signal stored — it necessarily reads across the whole current `signals`
  // dataset, not just this run's inserts. Wrapped in try/catch, same as the
  // digest step below: a bug in the intelligence layer must never be able
  // to take down signal collection itself, which stays the priority this
  // whole project has protected throughout. Failures are recorded like any
  // other run error.
  try {
    await computeAndStoreThemeScores(supabase, errors);
  } catch (err) {
    errors.push(`Theme intelligence aggregation: ${(err as Error).message}`);
  }

  const { data: unsent } = await supabase
    .from("signals")
    .select("*, company:companies(*)")
    .is("emailed_at", null)
    .order("created_at", { ascending: true });

  const digestItems = (unsent ?? []) as unknown as DigestItem[];
  let emailed = 0;

  if (digestItems.length > 0) {
    try {
      await sendDigestEmail(digestItems);
      const ids = digestItems.map((item) => item.id);
      await supabase
        .from("signals")
        .update({ emailed_at: new Date().toISOString() })
        .in("id", ids);
      emailed = digestItems.length;
    } catch (err) {
      errors.push(`Email digest: ${(err as Error).message}`);
    }
  }

  await supabase
    .from("runs")
    .update({
      finished_at: new Date().toISOString(),
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      companies_processed: companiesProcessed,
      signals_found: signalsFound,
      error: errors.length > 0 ? errors.join("\n") : null,
      // Phase 2A aggregate columns (supabase/006_observability.sql) — the
      // per-organisation detail behind these lives in
      // research_run_attempts, keyed by run_id.
      organisations_attempted: organisationsAttempted,
      duplicates_prevented: duplicatesPrevented,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      avg_duration_ms: avgDurationMs,
    })
    .eq("id", run.id);

  return {
    runId: run.id,
    organisationsAttempted,
    companiesProcessed,
    signalsFound,
    duplicatesPrevented,
    retriesUsed,
    emailed,
    totalInputTokens,
    totalOutputTokens,
    avgDurationMs,
    errors,
  };
}
