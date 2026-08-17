// Homepage card. Chunk 3 built the base layout; Phase 3B removed the
// organisation count in favour of "Leading activity" org names (see the
// bottom of this file); Phase 3B.1 added Market Signal above Opportunity/
// Momentum, replacing the old opportunity_strength badge (Strong/Emerging/
// Limited) the brief explicitly asked not to keep using as-is; Phase 3B.2
// then added a fixed one-line theme definition ("What this means") above
// the interpretation zone.
//
// Editorial differentiation pass: cards were reading as too similar to one
// another, and the fixed theme definition was the reason why — 10 themes,
// 10 definitions, all written in the same descriptive register ("The use
// of...", "The systems that...", "How media organisations..."), so every
// card's first line of body text scanned as interchangeable regardless of
// what was actually happening in that theme. The definition is now theme-
// detail-page-only (see app/themes/[slug]/page.tsx, which still shows it
// under "What this means"); the card leads straight from the title into
// Antenna's own generated read, score.narrative_summary — one sentence,
// framed by the generation prompt (scripts/generateThemeNarratives.ts) to
// answer "why does this theme matter right now" rather than restate the
// numbers, and explicitly instructed to vary its own sentence shape theme
// to theme rather than share a template. That's what actually makes each
// card feel distinct: not the layout, the copy.
//
// The card is still not a single <Link> wrapping everything — the leading-
// organisation names need to be their own links to /organisations/[slug],
// and an <a> cannot nest inside another <a> (see the Phase 3B version of
// this comment for the full explanation). Only the signal/scores/summary
// block is wrapped in the "open this theme" Link.
//
// Presentation polish: the click-through wasn't obvious, so a small text
// CTA ("View theme intelligence →") is now the last thing inside that same
// Link, right after the summary. It's an affordance, not a second button:
// no border/background, same click target the card already had (the CTA
// is inside the existing Link, not a new one), and it sits below the
// summary rather than displacing anything already there. meta/leading stay
// exactly where they were, outside the Link, unchanged.
import Link from "next/link";
import type { ThemeScore } from "@/lib/supabase";
import { themeToSlug } from "@/lib/themeSlug";
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

        <MarketSignalBadge state={marketSignal} />

        <div className={styles.scores}>
          <ScoreIndicator label="Opportunity" value={score.opportunity_score} variant="gold" />
          <ScoreIndicator label="Momentum" value={score.momentum_score} variant="teal" />
        </div>
        <p className={styles.summary}>
          {score.narrative_summary ?? "Editorial analysis pending for this theme."}
        </p>

        <span className={styles.cta}>View theme intelligence →</span>
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
