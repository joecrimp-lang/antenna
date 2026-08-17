// Theme detail page — Chunk 3, the four-layer view described in the brief:
// (1) editorial summary, (2) score transparency, (3) evidence explorer,
// (4) companies as supporting evidence. Reuses the same theme_scores +
// signals data the homepage and intelligence layer already produce; no new
// tables, no new taxonomy, no scoring change.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSupabase,
  type Company,
  type Signal,
  type ThemeScore,
} from "@/lib/supabase";
import type { AntennaSignalType } from "@/lib/antennaTaxonomy";
import { slugToTheme } from "@/lib/themeSlug";
import Header from "../../components/Header";
import ScoreIndicator from "../../components/ScoreIndicator";
import ScoreBreakdown from "../../components/ScoreBreakdown";
import EvidenceSection, { type EvidenceItem } from "../../components/EvidenceSection";
import CompanyList, { type CompanyEvidence } from "../../components/CompanyList";
import styles from "./theme.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type SignalWithCompany = Signal & { company: Company };

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong",
  emerging: "Emerging",
  limited: "Limited",
};

// Display labels for the Evidence Explorer. Antenna's canonical signal_type
// taxonomy (lib/antennaTaxonomy.ts) has no "partnerships" dimension — the
// brief's Layer 3 asks for a Partnerships section, so "strategy" is shown
// under that label here. This is a display-only mapping: the underlying
// signal_type value, taxonomy, and stored data are all unchanged.
const EVIDENCE_SECTIONS: { type: AntennaSignalType; label: string }[] = [
  { type: "projects_launches", label: "Projects & Launches" },
  { type: "hiring", label: "Hiring" },
  { type: "expenditure", label: "Expenditure" },
  { type: "procurement", label: "Procurement" },
  { type: "strategy", label: "Partnerships" },
];

async function getThemeData(themeName: string) {
  const supabase = getSupabase();
  const errors: string[] = [];

  const { data: score, error: scoreError } = await supabase
    .from("theme_scores")
    .select("*")
    .eq("theme", themeName)
    .maybeSingle();
  if (scoreError) {
    console.error("Supabase error loading theme_scores:", scoreError);
    errors.push(`theme_scores: ${scoreError.message}`);
  }

  const { data: signals, error: signalsError } = await supabase
    .from("signals")
    .select("*, company:companies(*)")
    .eq("theme", themeName)
    .order("created_at", { ascending: false });
  if (signalsError) {
    console.error("Supabase error loading signals:", signalsError);
    errors.push(`signals: ${signalsError.message}`);
  }

  return {
    score: score as ThemeScore | null,
    signals: (signals ?? []) as unknown as SignalWithCompany[],
    errors,
  };
}

export default async function ThemeDetail({ params }: { params: { slug: string } }) {
  const theme = slugToTheme(params.slug);
  if (!theme) notFound();

  const { score, signals, errors } = await getThemeData(theme);

  const organisationCount = new Set(signals.map((s) => s.company_id)).size;

  const evidenceBuckets = EVIDENCE_SECTIONS.map(({ type, label }) => {
    const items: EvidenceItem[] = signals
      .filter((s) => s.signal_type === type)
      .map((s) => ({
        companyName: s.company?.name ?? "Unknown organisation",
        summary: s.summary,
      }));
    const organisations = new Set(
      signals.filter((s) => s.signal_type === type).map((s) => s.company_id)
    ).size;
    return { label, items, organisations };
  });

  const companiesById = new Map<number, CompanyEvidence>();
  for (const s of signals) {
    if (!s.company) continue;
    const existing = companiesById.get(s.company_id);
    if (existing) {
      existing.findings.push(s.summary);
    } else {
      companiesById.set(s.company_id, {
        companyName: s.company.name,
        companyWebsite: s.company.website,
        findings: [s.summary],
      });
    }
  }
  const companies = Array.from(companiesById.values());

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

      {/* Layer 1 — editorial intelligence summary */}
      <section className={styles.titleRow}>
        <div>
          <p className="eyebrow">Theme</p>
          <h1 className={styles.title}>{theme}</h1>
        </div>
        {score?.opportunity_strength && (
          <span className={`badge badge--${score.opportunity_strength}`}>
            {STRENGTH_LABEL[score.opportunity_strength]}
          </span>
        )}
      </section>

      <div className={`card ${styles.narrativeCard}`}>
        <div className={styles.scores}>
          <ScoreIndicator label="Opportunity" value={score?.opportunity_score ?? null} variant="gold" size="lg" />
          <ScoreIndicator label="Momentum" value={score?.momentum_score ?? null} variant="teal" size="lg" />
        </div>
        <p className={styles.narrative}>
          {score?.narrative ??
            "Editorial analysis for this theme hasn't been generated yet. The scores above are already live and reflect Antenna's current intelligence data."}
        </p>
      </div>

      {/* Layer 2 — score transparency */}
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Score transparency</p>
            <h2>Why this score?</h2>
          </div>
        </div>
        <ScoreBreakdown
          momentumScore={score?.momentum_score ?? null}
          investmentEvidencePct={score?.investment_evidence_pct ?? null}
          adoptionShiftDelta={score?.adoption_shift_delta ?? null}
          opportunityScore={score?.opportunity_score ?? null}
        />
      </section>

      {/* Layer 3 — evidence explorer */}
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Evidence Explorer</h2>
          </div>
        </div>
        <p className={styles.sectionSubhead}>
          {signals.length} signal{signals.length === 1 ? "" : "s"} from {organisationCount}{" "}
          organisation{organisationCount === 1 ? "" : "s"}, grouped by the kind of evidence they
          represent.
        </p>
        {signals.length === 0 ? (
          <p className="empty-state">No signals recorded for this theme yet.</p>
        ) : (
          <div className={styles.evidenceList}>
            {evidenceBuckets.map((bucket, i) => (
              <EvidenceSection
                key={bucket.label}
                title={bucket.label}
                signalCount={bucket.items.length}
                organisationCount={bucket.organisations}
                items={bucket.items}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        )}
      </section>

      {/* Layer 4 — companies, as supporting evidence rather than the primary
          organising structure */}
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contributing organisations</p>
            <h2>Companies</h2>
          </div>
        </div>
        <CompanyList companies={companies} />
      </section>
    </main>
  );
}
