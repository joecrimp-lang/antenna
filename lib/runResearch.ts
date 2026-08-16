import { getSupabase, type Company } from "./supabase";
import { researchCompany } from "./research";
import { sendDigestEmail, type DigestItem } from "./email";

// Companies are processed in concurrent groups rather than one at a time so
// the whole watchlist finishes within a single Vercel function invocation
// (300s limit) instead of needing multiple invocations. Kept small on
// purpose — reliability over speed.
export const CONCURRENCY = 2;

export type RunSummary = {
  runId: number;
  companiesProcessed: number;
  signalsFound: number;
  emailed: number;
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

// Researches one company and stores any new signals. Errors are caught
// here rather than thrown, so one failing company never breaks the group
// it's running alongside (Promise.all would otherwise reject the whole
// group on a single rejection).
async function processCompany(supabase: SupabaseClient, company: Company) {
  const errors: string[] = [];
  let signalsFound = 0;
  let processed = true;

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
      // Unique constraint on (company_id, source_url) means duplicates are
      // silently skipped rather than treated as an error.
      if (!insertError) {
        signalsFound += 1;
      } else if (!insertError.message.includes("duplicate")) {
        errors.push(`${company.name}: ${insertError.message}`);
      }
    }
  } catch (err) {
    processed = false;
    errors.push(`${company.name}: ${(err as Error).message}`);
  }

  return { processed, signalsFound, errors };
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

  let companiesQuery = supabase
    .from("companies")
    .select("*")
    .order("rank", { ascending: true });

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

  let companiesProcessed = 0;
  let signalsFound = 0;

  for (const group of chunk(companies as Company[], CONCURRENCY)) {
    const results = await Promise.all(
      group.map((company) => processCompany(supabase, company))
    );
    for (const result of results) {
      if (result.processed) companiesProcessed += 1;
      signalsFound += result.signalsFound;
      errors.push(...result.errors);
    }
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
    })
    .eq("id", run.id);

  return {
    runId: run.id,
    companiesProcessed,
    signalsFound,
    emailed,
    errors,
  };
}
