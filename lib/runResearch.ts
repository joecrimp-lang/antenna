import { getSupabase, type Company } from "./supabase";
import { researchCompany } from "./research";
import { sendDigestEmail, type DigestItem } from "./email";

export type RunSummary = {
  runId: number;
  companiesProcessed: number;
  signalsFound: number;
  emailed: number;
  errors: string[];
};

// Runs research for every company in the watchlist, stores any new signals,
// then emails a digest of whatever hasn't been emailed yet (including any
// signals left over from a previous run that failed to send).
export async function runFullResearch(): Promise<RunSummary> {
  const supabase = getSupabase();
  const errors: string[] = [];

  const { data: run, error: runError } = await supabase
    .from("runs")
    .insert({ status: "running" })
    .select()
    .single();
  if (runError || !run) throw new Error(`Could not create run row: ${runError?.message}`);

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("*")
    .order("rank", { ascending: true });
  if (companiesError || !companies) {
    throw new Error(`Could not load companies: ${companiesError?.message}`);
  }

  let companiesProcessed = 0;
  let signalsFound = 0;

  for (const company of companies as Company[]) {
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
      companiesProcessed += 1;
    } catch (err) {
      errors.push(`${company.name}: ${(err as Error).message}`);
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
