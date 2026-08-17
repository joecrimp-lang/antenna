// Layer 2 — "Why this score?" Shows the real component values behind
// opportunity_score (lib/intelligence.ts §14.3), not a re-explanation in
// prose alone — the brief's whole point here is that a user should trust
// the score because they can see the calculation, not just be told about it.

import InfoTooltip from "./InfoTooltip";
import styles from "./ScoreBreakdown.module.css";

function Row({
  label,
  value,
  tooltip,
  emphasis,
}: {
  label: string;
  value: string;
  tooltip: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`${styles.row} ${emphasis ? styles.emphasis : ""}`}>
      <span className={styles.label}>
        {label}
        <InfoTooltip text={tooltip} />
      </span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

export default function ScoreBreakdown({
  momentumScore,
  investmentEvidencePct,
  adoptionShiftDelta,
  opportunityScore,
}: {
  momentumScore: number | null;
  investmentEvidencePct: number | null;
  adoptionShiftDelta: number | null;
  opportunityScore: number | null;
}) {
  return (
    <div className={`card ${styles.card}`}>
      <h3 className={styles.heading}>Why this score?</h3>
      <div className={styles.rows}>
        <Row
          label="Market Momentum"
          value={momentumScore === null ? "—" : String(momentumScore)}
          tooltip="Volume and spread of market activity: how many organisations are active, how strong the underlying signals are, and whether activity is accelerating."
        />
        <Row
          label="Investment Evidence"
          value={investmentEvidencePct === null ? "—" : `${investmentEvidencePct}%`}
          tooltip="Share of this theme's recent signals that are both high-confidence and high-intent — genuine, well-sourced evidence of active buying, not just activity."
        />
        <Row
          label="Adoption Shift"
          value={
            adoptionShiftDelta === null
              ? "—"
              : `${adoptionShiftDelta >= 0 ? "+" : ""}${adoptionShiftDelta}`
          }
          tooltip="Whether evidence in this theme is moving toward confirmed spend/procurement/launches, or staying in early strategy/hiring — positive means the market is shifting toward adoption."
        />
        <Row
          label="Opportunity Score"
          value={opportunityScore === null ? "—" : String(opportunityScore)}
          tooltip="Momentum, investment evidence, and adoption shift combined — a generic read on how attractive this area is for a media technology supplier, not personalised to any one company."
          emphasis
        />
      </div>
    </div>
  );
}
