// The Market Signal layer (brief §1): "sits above Opportunity and Momentum,"
// answering "what should I take away from this market area?" before the
// numbers do. See lib/marketSignal.ts for how the state itself is derived
// (pure function over already-computed scores, no new score).
//
// Phase 3B.2 ("make the badge more prominent, add an icon, add a tooltip"):
// the badge always carries its icon, and the meaning is always available,
// at both sizes, so "icon + label + explanation" (the decision doc's own
// phrasing) works wherever the badge appears.
//
// size="md" (ThemeCard, on the homepage) renders inside a card that's
// itself wrapped in a Link (the "click card to open theme" target) — a
// clickable InfoTooltip button nested inside that <a> would be invalid HTML
// and would also trigger card navigation on click. So at size="md" the
// meaning is a native `title` attribute (a plain hover tooltip, no
// interactive element); size="lg" (the theme detail page, not inside a
// Link) uses the full click-to-toggle InfoTooltip, consistent with every
// other score explanation on that page.
import InfoTooltip from "./InfoTooltip";
import { MARKET_SIGNAL_COPY, type MarketSignalState } from "@/lib/marketSignal";
import styles from "./MarketSignalBadge.module.css";

export default function MarketSignalBadge({
  state,
  size = "md",
}: {
  state: MarketSignalState;
  size?: "md" | "lg";
}) {
  const { label, icon, meaning } = MARKET_SIGNAL_COPY[state];
  const isLarge = size === "lg";

  return (
    <div className={`${styles.wrap} ${isLarge ? styles.lg : ""}`}>
      <span className={`badge badge--${state} ${styles.badge}`} title={isLarge ? undefined : meaning}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        {label}
        {isLarge && <InfoTooltip text={meaning} />}
      </span>
      {isLarge && <span className={styles.meaning}>{meaning}</span>}
    </div>
  );
}
