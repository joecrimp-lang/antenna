// Homepage card. Chunk 3 built the base layout; Phase 3B removed the
// organisation count in favour of "Leading activity" org names (see the
// bottom of this file); Phase 3B.1 adds two more things per the brief:
// (1) Market Signal now sits above Opportunity/Momentum, replacing the old
// opportunity_strength badge (Strong/Emerging/Limited) the brief explicitly
// asked not to keep using as-is; (2) a fixed one-line theme definition
// ("What this means") so a reader doesn't need prior media-tech knowledge
// before the numbers mean anything to them.
//
// Phase 3B.2 (decision doc §5): "Theme cards should answer: What is this?
// (theme definition), What is happening? (market interpretation), Who is
// involved? (leading activity)". The card now makes that three-part
// structure visible rather than implicit: the definition sits in its own
// zone, a thin rule separates it from the interpretation zone (signal,
// scores, narrative, tinted so it reads as Antenna's read rather than fixed
// data), and a colour accent tied to the theme's Market Signal state gives
// the card a scannable identity before any text is read.
//
// The card is still not a single <Link> wrapping everything — the leading-
// organisation names need to be their own links to /organisations/[slug],
// and an <a> cannot nest inside another <a> (see the Phase 3B version of
// this comment for the full explanation). Only the definition/signal/
// scores/summary block is wrapped in the "open this theme" Link.
import Link from "next/link";
import type { ThemeScore } from "@/lib/supabase";
import { themeToSlug } from "@/lib/themeSlug";
import { themeDefinition } from "@/lib/themeDefinitions";
import { computeMarketSignal, MARKET_SIGNAL_COLOR_VAR } from "@/lib/marketSignal";
import ScoreIndicator from "./ScoreIndicator";
import MarketSignalBadge from "./MarketSignalBadge";
import styles from "./ThemeCard.module.css";

export type LeadingOrganisation = { name: string; slug: string };

export default function ThemeCard({
  score,
  leadingOrganisations = [],
}: {
  score: ThemeScore;
  leadingOrganisations?: LeadingOrganisation[];
}) {
  const marketSignal = computeMarketSignal({
    momentum_score: score.momentum_score,
    investment_evidence_pct: score.investment_evidence_pct,
    velocity_pct: score.velocity_pct,
    signals_count: score.signals_count,
  });
  const accentColor = MARKET_SIGNAL_COLOR_VAR[marketSignal];

  return (
    <div className={`card ${styles.card}`} style={{ borderTopColor: accentColor }}>
      <Link href={`/themes/${themeToSlug(score.theme)}`} className={styles.cardLink}>
        <div className={styles.top}>
          <h3 className={styles.title}>{score.theme}</h3>
        </div>
        <p className={styles.definition}>{themeDefinition(score.theme)}</p>

        <div className={styles.interpretation}>
          <MarketSignalBadge state={marketSignal} />

          <div className={styles.scores}>
            <ScoreIndicator label="Opportunity" value={score.opportunity_score} variant="gold" />
            <ScoreIndicator label="Momentum" value={score.momentum_score} variant="teal" />
          </div>
          <p className={styles.summary}>
            {score.narrative_summary ?? "Editorial analysis pending for this theme."}
          </p>
        </div>
      </Link>

      <div className={styles.meta}>
        <span>
          <strong>{score.signals_count}</strong> signal{score.signals_count === 1 ? "" : "s"} detected
        </span>
      </div>

      {leadingOrganisations.length > 0 && (
        <div className={styles.leading}>
          <span className={styles.leadingLabel}>Leading activity:</span>{" "}
          {leadingOrganisations.map((org, i) => (
            <span key={org.slug}>
              <Link href={`/organisations/${org.slug}`} className={styles.leadingLink}>
                {org.name}
              </Link>
              {i < leadingOrganisations.length - 1 ? " / " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
