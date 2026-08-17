// Phase 3B — organisation intelligence pages (brief §6). New route, e.g.
// /organisations/netflix. "The organisation page is not a CRM page. It is a
// research briefing" — name, Buyer/Vendor label, signal count, the themes
// this organisation is active in, and its latest evidence, each signal
// linking back into its theme. No new tables: reuses `companies` and
// `signals` exactly as they already exist.
//
// Company names don't have a stored slug (see lib/companySlug.ts's header
// for why that's a deliberate choice, not an oversight) — this route reads
// every company and matches by slugifying each name, rather than adding a
// slug column purely to support routing. Acceptable at this project's
// controlled scale (dozens of companies); scripts/checkCompanySlugCollisions
// .ts is provided to verify that stays safe against the real data.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase, type Company, type Signal } from "@/lib/supabase";
import { themeToSlug } from "@/lib/themeSlug";
import { companyToSlug } from "@/lib/companySlug";
import { signalTypeLabel } from "@/lib/signalTypeLabel";
import { organisationTypeLabel } from "@/lib/organisationDisplay";
import Header from "../../components/Header";
import SignalCard, { type SignalCardData } from "../../components/SignalCard";
import styles from "./organisation.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

async function findCompanyBySlug(slug: string): Promise<{ company: Company | null; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("companies").select("*");
  if (error) {
    console.error("Supabase error loading companies:", error);
    return { company: null, error: error.message };
  }
  const companies = (data ?? []) as Company[];
  const match = companies.find((c) => companyToSlug(c.name) === slug) ?? null;
  return { company: match, error: null };
}

async function getSignalsForCompany(companyId: number): Promise<{ signals: Signal[]; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Supabase error loading signals:", error);
    return { signals: [], error: error.message };
  }
  return { signals: (data ?? []) as Signal[], error: null };
}

function toSignalCardData(s: Signal, company: Company): SignalCardData {
  return {
    id: s.id,
    organisationName: company.name,
    organisationSlug: companyToSlug(company.name),
    organisationTypeLabel: organisationTypeLabel(company.organisation_type),
    headline: s.summary,
    signalTypeLabel: signalTypeLabel(s.signal_type),
    intentScore: s.signal_intent_score,
    shortSummary: s.detail,
    sourceUrl: s.source_url,
    sourceTitle: s.source_title,
  };
}

export default async function OrganisationDetail({ params }: { params: { slug: string } }) {
  const { company, error: companyError } = await findCompanyBySlug(params.slug);
  if (!company) notFound();

  const { signals, error: signalsError } = await getSignalsForCompany(company.id);
  const errors = [companyError, signalsError].filter((e): e is string => Boolean(e));

  const themes = Array.from(
    new Set(signals.map((s) => s.theme).filter((t): t is NonNullable<typeof t> => t !== null))
  );

  const typeLabel = organisationTypeLabel(company.organisation_type);

  return (
    <main>
      <Header tagline="Media technology intelligence" />

      <Link href="/" className={styles.back}>
        ← Market Overview
      </Link>

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

      <section className={styles.titleRow}>
        <div>
          <p className="eyebrow">Organisation</p>
          <h1 className={styles.title}>{company.name}</h1>
        </div>
        <span className="badge badge--neutral">{typeLabel}</span>
      </section>

      <p className={styles.subline}>
        <strong>{signals.length}</strong> signal{signals.length === 1 ? "" : "s"} detected
        {themes.length > 0 && (
          <>
            {" · "}
            Themes:{" "}
            {themes.map((theme, i) => (
              <span key={theme}>
                <Link href={`/themes/${themeToSlug(theme)}`} className={styles.themeLink}>
                  {theme}
                </Link>
                {i < themes.length - 1 ? ", " : ""}
              </span>
            ))}
          </>
        )}
      </p>

      {/* Antenna View: interpretation before evidence, same hierarchy as
          the theme detail page. Not "what signals exist" (that's the list
          below) but "what does this activity mean" — the decision doc
          calls this "one of the most valuable parts of the product," so it
          gets the same prominent, analyst-briefing treatment as the theme
          page's Antenna View card (larger type, gold accent). */}
      <div className={`card ${styles.antennaViewCard}`}>
        <p className={styles.layerLabel}>What does this activity mean?</p>
        <h3 className={styles.antennaViewHeading}>Antenna View</h3>
        <p className={styles.antennaView}>
          {company.antenna_view ??
            "Antenna has not generated an interpretation for this organisation yet. The signals below are already live and reflect Antenna's current intelligence data."}
        </p>
      </div>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Latest intelligence</h2>
          </div>
        </div>

        {signals.length === 0 ? (
          <p className="empty-state">No signals recorded for this organisation yet.</p>
        ) : (
          <div className={styles.signalGrid}>
            {signals.map((s) => (
              <SignalCard key={s.id} data={toSignalCardData(s, company)} showOrganisationLink={false} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
