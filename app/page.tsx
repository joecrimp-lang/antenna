import { getSupabase, type Company, type Signal } from "@/lib/supabase";
import RunNowButton from "./components/RunNowButton";

export const dynamic = "force-dynamic";
// force-dynamic alone forces this route to render on every request, but
// doesn't stop individual fetch() calls made during that render (including
// supabase-js's internal calls) from being served out of Next's Data Cache.
// This forces every fetch in this route to bypass that cache and hit
// Supabase fresh every time.
export const fetchCache = "force-no-store";

type SignalWithCompany = Signal & { company: Company };

async function getData() {
  const supabase = getSupabase();
  const errors: string[] = [];

  const { data: lastRun, error: lastRunError } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRunError) {
    console.error("Supabase error loading last run:", lastRunError);
    errors.push(`runs: ${lastRunError.message}`);
  }

  const { data: signals, error: signalsError } = await supabase
    .from("signals")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (signalsError) {
    console.error("Supabase error loading signals:", signalsError);
    errors.push(`signals: ${signalsError.message}`);
  }

  const { count: companyCount, error: companyCountError } = await supabase
    .from("companies")
    .select("*", { count: "exact", head: true });
  if (companyCountError) {
    console.error("Supabase error loading company count:", companyCountError);
    errors.push(`companies: ${companyCountError.message}`);
  }

  return {
    lastRun,
    signals: (signals ?? []) as unknown as SignalWithCompany[],
    companyCount: companyCount ?? 0,
    errors,
  };
}

export default async function Home() {
  const { lastRun, signals, companyCount, errors } = await getData();

  return (
    <main>
      <h1>Tech Spend Signal Monitor</h1>
      <p className="subtitle">
        Watching {companyCount} media &amp; entertainment companies for
        public signals of future technology spending. Runs daily; emails a
        digest of new signals.
      </p>

      {errors.length > 0 && (
        <div className="error-banner">
          <strong>Supabase query error{errors.length > 1 ? "s" : ""}:</strong>
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="status-bar">
        <div className="stats">
          {lastRun ? (
            <>
              Last run: {new Date(lastRun.started_at).toLocaleString()} &middot;{" "}
              {lastRun.status} &middot; {lastRun.companies_processed}{" "}
              companies &middot; {lastRun.signals_found} new signals
            </>
          ) : (
            "No runs yet"
          )}
        </div>
        <RunNowButton />
      </div>

      <div className="signal-list">
        {signals.length === 0 && (
          <div className="empty-state">
            No signals found yet. Click &quot;Run now&quot; to kick off the
            first research run.
          </div>
        )}
        {signals.map((signal) => (
          <div className="signal-card" key={signal.id}>
            <div className="company">{signal.company?.name}</div>
            <div className="summary">{signal.summary}</div>
            {signal.detail && <div className="detail">{signal.detail}</div>}
            <div className="meta">
              {signal.source_url && (
                <a href={signal.source_url} target="_blank" rel="noreferrer">
                  {signal.source_title || signal.source_url}
                </a>
              )}
              {signal.published_date && ` · ${signal.published_date}`}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
