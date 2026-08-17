// Theme detail page. Chunk 3 built this as 4 layers: editorial summary,
// score transparency, an evidence explorer grouped by signal_type, and a
// flat companies list. Phase 3B replaced the evidence layer with a
// Buyer/Vendor split "Market Evidence" section and removed the companies
// list. Phase 3B.1 added the Market Signal and relabelled the narrative
// "Antenna View", and merged Buyer/Vendor evidence back into one "Market
// Activity" stream.
//
// Phase 3B.2 ("Product Polish & Trust Layer") restructures the layout into
// four visually distinct layers, following the decision doc's own user
// journey: what should I take away (Market Signal), why does Antenna think
// this (Antenna View), what are the underlying indicators (Opportunity,
// Momentum and the score breakdown, grouped together as one metrics layer
// on a subtly tinted panel), what evidence supports it (Market Activity).
// Presentation only: no research methodology, taxonomy, or scoring formula
// changes in this file or this phase, see the Phase 3B.2 delivery report.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSupabase,
  type Company,
  type Signal,
  type ThemeScore,
} from "@/lib/supabase";
import { slugToTheme } from "@/lib/themeSlug";
import { companyToSlug } from "@/lib/companySlug";
import { signalTypeLabel } from "@/lib/signalTypeLabel";
import { organisationTypeLabel } from "@/lib/organisationDisplay";
import { themeDefinition } from "@/lib/themeDefinitions";
import { computeMarketSignal, MARKET_SIGNAL_COLOR_VAR } from "@/lib/marketSignal";
import Header from "../../components/Header";
import ScoreIndicator from "../../components/ScoreIndicator";
import ScoreBreakdown from "../../components/ScoreBreakdown";
import MarketSignalBadge from "../../components/MarketSignalBadge";
import SignalCard, { type SignalCardData } from "../../components/SignalCard";
import styles from "./theme.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type SignalWithCompany = Signal & { company: Company };

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

function toSignalCardData(s: SignalWithCompany): SignalCardData {
  return {
    id: s.id,
    organisationName: s.company?.name ?? "Unknown organisation",
    organisationSlug: companyToSlug(s.company?.name ?? ""),
    organisationTypeLabel: organisationTypeLabel(s.company?.organisation_type ?? null),
    headline: s.summary,
    signalTypeLabel: signalTypeLabel(s.signal_type),
    intentScore: s.signal_intent_score,
    shortSummary: s.detail,
    sourceUrl: s.source_url,
    sourceTitle: s.source_title,
  };
}

export default async function ThemeDetail({ params }: { params: { slug: string } }) {
  const theme = slugToTheme(params.slug);
  if (!theme) notFound();

  const { score, signals, errors } = await getThemeData(theme);

  const withCompany = signals.filter((s) => s.company);
  const organisationCount = new Set(withCompany.map((s) => s.company_id)).size;

  const marketSignal = computeMarketSignal({
    momentum_score: score?.momentum_score ?? null,
    investment_evidence_pct: score?.investment_evidence_pct ?? null,
    velocity_pct: score?.velocity_pct ?? null,
    signals_count: score?.signals_count ?? 0,
  });
  const accentColor = MARKET_SIGNAL_COLOR_VAR[marketSignal];

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

      {/* Layer 1 — page identity: what this theme is */}
      <section className={styles.titleRow}>
        <div>
          <p className="eyebrow">Theme</p>
          <h1 className={styles.title}>{theme}</h1>
        </div>
      </section>
      <p className={styles.definition}>{themeDefinition(theme)}</p>

      {/* Layer 2 — interpretation: what should I take away, why does
          Antenna think this. Two distinct cards, not one blended block. */}
      <div className={styles.interpretationStack}>
        <div className={`card ${styles.signalCard}`} style={{ borderTopColor: accentColor }}>
          <p className={styles.layerLabel}>What should I take away?</p>
          <MarketSignalBadge state={marketSignal} size="lg" />
        </div>

        <div className={`card ${styles.antennaViewCard}`}>
          <p className={styles.layerLabel}>Why does Antenna think this?</p>
          <h3 className={styles.antennaViewHeading}>Antenna View</h3>
          <p className={styles.narrative}>
            {score?.narrative ??
              "Antenna has not generated an interpretation for this theme yet. The scores below are already live and reflect Antenna's current intelligence data."}
          </p>
        </div>
      </div>

      {/* Layer 3 — metrics: the underlying indicators, grouped on one
          subtly tinted panel so it reads as supporting data, not another
          headline card competing with the interpretation above it. */}
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Score transparency</p>
            <h2>What are the underlying indicators?</h2>
          </div>
        </div>
        <div className={styles.metricsPanel}>
          <div className={styles.scores}>
            <ScoreIndicator label="Opportunity" value={score?.opportunity_score ?? null} variant="gold" size="lg" />
            <ScoreIndicator label="Momentum" value={score?.momentum_score ?? null} variant="teal" size="lg" />
          </div>
          <ScoreBreakdown
            momentumScore={score?.momentum_score ?? null}
            investmentEvidencePct={score?.investment_evidence_pct ?? null}
            adoptionShiftDelta={score?.adoption_shift_delta ?? null}
            opportunityScore={score?.opportunity_score ?? null}
          />
        </div>
      </section>

      {/* Layer 4 — evidence: one combined Market Activity stream (decision
          doc: "the insight is the market movement, not the category"),
          Buyer/Vendor labels kept per card via SignalCard. */}
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Market Activity</h2>
          </div>
        </div>
        <p className={styles.sectionSubhead}>
          {withCompany.length} signal{withCompany.length === 1 ? "" : "s"} detected across{" "}
          {organisationCount} organisation{organisationCount === 1 ? "" : "s"}: who is investing,
          and who is enabling that investment.
        </p>

        {withCompany.length === 0 ? (
          <p className="empty-state">No signals recorded for this theme yet.</p>
        ) : (
          <div className={styles.signalGrid}>
            {withCompany.map((s) => (
              <SignalCard key={s.id} data={toSignalCardData(s)} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
