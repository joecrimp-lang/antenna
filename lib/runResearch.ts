import { getSupabase, type Company } from "./supabase";
import { researchCompany } from "./research";
import { sendDigestEmail, type DigestItem } from "./email";

// Small on purpose: reliability matters more than finishing a run quickly.
// At a pessimistic ~15-20s/company, a batch of 5 finishes in well under a
// minute, leaving large margin under Vercel's 300s function timeout.
export const BATCH_SIZE = 5;

function getBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Creates the tracking row for a new run. Fast (a single insert), so it's
// safe to await directly in a route handler before responding.
export async function startRun(): Promise<number> {
  const supabase = getSupabase();
  const { data: run, error } = await supabase
    .from("runs")
    .insert({ status: "running", cursor: 0 })
    .select()
    .single();
  if (error || !run) {
    throw new Error(`Could not create run row: ${error?.message}`);
  }
  return run.id;
}

// Authenticates itself to /api/continue-research with a secret we control,
// rather than assuming Vercel's CRON_SECRET bearer token (which Vercel only
// attaches to its own scheduled requests) would cover a request our own
// code makes to itself.
//
// The receiving route responds immediately, before doing any batch work, so
// this only waits for that quick acknowledgement — not for the next batch
// to finish. That's what keeps this invocation's own lifetime bounded by
// its own batch rather than the whole remaining chain.
async function triggerNextBatch(runId: number, cursor: number) {
  const secret = process.env.INTERNAL_TRIGGER_SECRET;
  if (!secret) {
    throw new Error(
      "INTERNAL_TRIGGER_SECRET is not set — cannot trigger the next batch"
    );
  }
  const res = await fetch(`${getBaseUrl()}/api/continue-research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ runId, cursor }),
  });
  if (!res.ok) {
    throw new Error(`Failed to trigger next batch: HTTP ${res.status}`);
  }
}

// Processes companies [cursor, cursor + BATCH_SIZE) for the given run,
// accumulates the run's running totals, and either wraps up the run
// (digest email + final status, same as before) or triggers the next
// batch. Meant to be called from inside waitUntil() so it runs after the
// triggering request has already responded to its caller.
export async function processBatchAndContinue(runId: number, cursor: number) {
  const supabase = getSupabase();

  try {
    const { data: run, error: runFetchError } = await supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runFetchError || !run) {
      throw new Error(`Could not load run ${runId}: ${runFetchError?.message}`);
    }

    const { data: companies, error: companiesError } = await supabase
      .from("companies")
      .select("*")
      .order("rank", { ascending: true });
    if (companiesError || !companies) {
      throw new Error(`Could not load companies: ${companiesError?.message}`);
    }

    const batch = (companies as Company[]).slice(cursor, cursor + BATCH_SIZE);
    const priorErrors: string[] = run.error ? String(run.error).split("\n") : [];
    const batchErrors: string[] = [];
    let batchProcessed = 0;
    let batchSignals = 0;

    for (const company of batch) {
      try {
        const findings = await researchCompany(company);
        for (const finding of findings) {
          const { error: insertError } = await supabase.from("signals").insert({
            company_id: company.id,
            summary: finding.summary,
            detail: finding.detail,
            source_url: finding.source_url,
            source_title: finding.source_title,
            published_date: finding.published_date,
          });
          // Unique constraint on (company_id, source_url) means duplicates
          // are silently skipped rather than treated as an error.
          if (!insertError) {
            batchSignals += 1;
          } else if (!insertError.message.includes("duplicate")) {
            batchErrors.push(`${company.name}: ${insertError.message}`);
          }
        }
        batchProcessed += 1;
      } catch (err) {
        batchErrors.push(`${company.name}: ${(err as Error).message}`);
      }
    }

    const nextCursor = cursor + batch.length;
    const isDone = nextCursor >= companies.length;
    const allErrors = [...priorErrors, ...batchErrors];
    const companiesProcessed = (run.companies_processed ?? 0) + batchProcessed;
    const signalsFound = (run.signals_found ?? 0) + batchSignals;

    if (!isDone) {
      await supabase
        .from("runs")
        .update({
          cursor: nextCursor,
          companies_processed: companiesProcessed,
          signals_found: signalsFound,
          error: allErrors.length > 0 ? allErrors.join("\n") : null,
        })
        .eq("id", runId);

      await triggerNextBatch(runId, nextCursor);
      return;
    }

    // Last batch — send the digest for anything unsent, exactly as before:
    // one email per run, covering everything not yet emailed.
    const { data: unsent } = await supabase
      .from("signals")
      .select("*, company:companies(*)")
      .is("emailed_at", null)
      .order("created_at", { ascending: true });

    const digestItems = (unsent ?? []) as unknown as DigestItem[];

    if (digestItems.length > 0) {
      try {
        await sendDigestEmail(digestItems);
        await supabase
          .from("signals")
          .update({ emailed_at: new Date().toISOString() })
          .in(
            "id",
            digestItems.map((item) => item.id)
          );
      } catch (err) {
        allErrors.push(`Email digest: ${(err as Error).message}`);
      }
    }

    await supabase
      .from("runs")
      .update({
        cursor: nextCursor,
        companies_processed: companiesProcessed,
        signals_found: signalsFound,
        finished_at: new Date().toISOString(),
        status: allErrors.length > 0 ? "completed_with_errors" : "completed",
        error: allErrors.length > 0 ? allErrors.join("\n") : null,
      })
      .eq("id", runId);
  } catch (err) {
    // The chain broke badly enough to not continue (e.g. triggering the
    // next batch failed, or the run/company rows couldn't be loaded).
    // Mark the run as stopped instead of leaving it at "running" forever
    // with no explanation.
    await supabase
      .from("runs")
      .update({
        status: "completed_with_errors",
        finished_at: new Date().toISOString(),
        error: `Run stopped: ${(err as Error).message}`,
      })
      .eq("id", runId);
  }
}
